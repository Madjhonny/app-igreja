// Limites por tentativa; o Render pode demorar a acordar após inatividade.
const READ_TIMEOUT_MS = 35000;
const WRITE_TIMEOUT_MS = 65000;
const RETRY_DELAY_MS = 800;
const RETRYABLE_STATUS = new Set([408, 502, 503, 504]);

type ConnectionStatus = 'ok' | 'unavailable';
let connectionStatus: ConnectionStatus = 'ok';
const connectionListeners = new Set<(status: ConnectionStatus) => void>();
export function getConnectionStatus() { return connectionStatus; }
export function subscribeConnection(listener: (status: ConnectionStatus) => void) {
  connectionListeners.add(listener);
  return () => { connectionListeners.delete(listener); };
}
function reportConnection(status: ConnectionStatus) {
  if (connectionStatus === status) return;
  connectionStatus = status;
  connectionListeners.forEach(listener => listener(status));
}

export class ApiTimeoutError extends Error {
  constructor() {
    super('O servidor demorou para responder. Tente novamente.');
    this.name = 'ApiTimeoutError';
  }
}

function cancellationError() {
  const error = new Error('Requisição cancelada.');
  error.name = 'AbortError';
  return error;
}

function waitForRetry(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancellationError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(cancellationError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchAttempt(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<Response> {
  const callerSignal = init?.signal;
  if (callerSignal?.aborted) throw cancellationError();

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  callerSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (callerSignal?.aborted) throw cancellationError();
    if (timedOut) throw new ApiTimeoutError();
    return response;
  } catch (error) {
    if (callerSignal?.aborted) throw cancellationError();
    if (timedOut) throw new ApiTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onAbort);
  }
}

type NetworkPolicy = {
  timeoutMs?: number;
  retryDelayMs?: number;
  fetcher?: typeof fetch;
};

/**
 * Limita a espera pela resposta e repete somente leituras que falham de forma
 * transitória. Mutações jamais são reenviadas automaticamente: o servidor pode
 * ter concluído a operação mesmo se a conexão caiu antes da resposta.
 */
export async function fetchWithResilience(
  url: string,
  init?: RequestInit,
  policy: NetworkPolicy = {},
): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const readOnly = method === 'GET' || method === 'HEAD';
  const timeout = policy.timeoutMs ?? (readOnly ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
  const retryDelay = policy.retryDelayMs ?? RETRY_DELAY_MS;
  const fetcher = policy.fetcher ?? fetch;

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetchAttempt(url, init, timeout, fetcher);
      // Respeita autenticação, validação, rate limiting e Retry-After.
      const retry = readOnly && attempt === 0 &&
        RETRYABLE_STATUS.has(response.status) && !response.headers.has('Retry-After');
      if (!retry) {
        reportConnection(RETRYABLE_STATUS.has(response.status) ? 'unavailable' : 'ok');
        return response;
      }
      // Libera o stream antes de repetir, se o ambiente oferecer esta API.
      void response.body?.cancel().catch(() => undefined);
    } catch (error) {
      const transient = error instanceof ApiTimeoutError || error instanceof TypeError;
      if (!readOnly || attempt !== 0 || init?.signal?.aborted || !transient) {
        if (transient && !init?.signal?.aborted) reportConnection('unavailable');
        throw error;
      }
    }
    await waitForRetry(retryDelay, init?.signal);
  }
}
