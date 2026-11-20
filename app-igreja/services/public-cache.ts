type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

// Somente o catálogo público de congregações pode ser armazenado. Agenda e
// mural declaram no-store; mural pode conter links assinados de mídia.
export function createPublicCache(baseUrl: string, fetcher: Fetcher, now = Date.now) {
  let cached: { body: string; expires: number } | undefined;
  let pending: Promise<Response> | undefined;
  let generation = 0;

  function clear() {
    generation++;
    cached = undefined;
    pending = undefined;
  }

  async function request(url: string, init?: RequestInit): Promise<Response> {
    const eligible = url === `${baseUrl}/congregacoes` &&
      (!init || Object.keys(init).length === 0);
    if (!eligible) {
      if (init?.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) clear();
      return fetcher(url, init);
    }
    if (cached && cached.expires > now()) {
      return new Response(cached.body, { headers: { 'Content-Type': 'application/json' } });
    }
    cached = undefined;
    if (!pending) {
      const current = generation;
      const task = (async () => {
        const response = await fetcher(url, { credentials: 'omit' });
        if (response.ok && !/no-store|private/i.test(response.headers.get('Cache-Control') || '') &&
            !response.headers.has('Set-Cookie')) {
          const body = await response.clone().text();
          try {
            const data = JSON.parse(body);
            if (current === generation && Array.isArray(data) && data.every(item =>
              item && Number.isSafeInteger(item.id) && typeof item.nome === 'string' &&
              Object.keys(item).every(key => key === 'id' || key === 'nome'))) {
              cached = { body, expires: now() + 60_000 };
            }
          } catch { /* Não armazena respostas inválidas. */ }
        }
        return response;
      })();
      pending = task;
      void task.finally(() => { if (pending === task) pending = undefined; }).catch(() => undefined);
    }
    return (await pending).clone();
  }

  return { request, clear };
}
