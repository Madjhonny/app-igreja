import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiTimeoutError, fetchWithResilience } from '../services/network.ts';

const url = 'https://api.example.test/eventos';
const ok = () => new Response('[]', { status: 200 });
const policy = (fetcher, timeoutMs = 100) => ({ fetcher, timeoutMs, retryDelayMs: 1 });

function hangUntilAbort(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

test('GET mantém headers e retorna a primeira resposta válida', async () => {
  let calls = 0;
  const response = await fetchWithResilience(url, { headers: { Authorization: 'Bearer test-token' } },
    policy(async (target, init) => {
      calls++;
      assert.equal(target, url);
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token');
      return ok();
    }));
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), []);
});

test('GET repete uma vez após erro de rede', async () => {
  let calls = 0;
  const response = await fetchWithResilience(url, undefined, policy(async () => {
    if (++calls === 1) throw new TypeError('Network request failed');
    return ok();
  }));
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('GET repete uma vez após timeout e usa novo signal', async () => {
  const signals = [];
  const response = await fetchWithResilience(url, undefined, policy(async (_, init) => {
    signals.push(init.signal);
    return signals.length === 1 ? hangUntilAbort(init.signal) : ok();
  }, 5));
  assert.equal(response.status, 200);
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
});

test('respostas transitórias são repetidas uma única vez', async () => {
  for (const status of [408, 502, 503, 504]) {
    let calls = 0;
    const response = await fetchWithResilience(url, undefined, policy(async () => {
      calls++;
      return new Response('', { status });
    }));
    assert.equal(response.status, status);
    assert.equal(calls, 2);
  }
});

test('não repete 400, 401, 403, 404, 429, 500 nem Retry-After', async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    let calls = 0;
    const response = await fetchWithResilience(url, undefined, policy(async () => {
      calls++;
      return new Response('', { status, headers: status === 503 ? { 'Retry-After': '60' } : {} });
    }));
    assert.equal(response.status, status);
    assert.equal(calls, 1);
  }
});

test('POST, PUT, PATCH e DELETE nunca são reenviados', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    let calls = 0;
    await assert.rejects(fetchWithResilience(url, { method }, policy(async () => {
      calls++;
      throw new TypeError('Network request failed');
    })), TypeError);
    assert.equal(calls, 1);
  }
});

test('timeout de mutação aborta e não reenvia', async () => {
  let calls = 0;
  await assert.rejects(fetchWithResilience(url, { method: 'POST' }, policy(async (_, init) => {
    calls++;
    return hangUntilAbort(init.signal);
  }, 5)), ApiTimeoutError);
  assert.equal(calls, 1);
});

test('cancelamento prévio não dispara nenhuma requisição', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(fetchWithResilience(url, { signal: controller.signal },
    policy(async () => { calls++; return ok(); })), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('cancelamento durante requisição não é confundido com timeout', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = fetchWithResilience(url, { signal: controller.signal }, policy(async (_, init) => {
    calls++;
    return hangUntilAbort(init.signal);
  }));
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('cancelamento durante espera impede a segunda tentativa', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = fetchWithResilience(url, { signal: controller.signal }, {
    fetcher: async () => {
      calls++;
      setTimeout(() => controller.abort(), 5);
      return new Response('', { status: 503 });
    },
    timeoutMs: 100,
    retryDelayMs: 50,
  });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('HEAD é leitura e mantém o limite de uma nova tentativa', async () => {
  let calls = 0;
  await assert.rejects(fetchWithResilience(url, { method: 'HEAD' }, policy(async () => {
    calls++;
    throw new TypeError('network');
  })), TypeError);
  assert.equal(calls, 2);
});
