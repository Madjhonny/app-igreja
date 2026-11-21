import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicCache } from '../services/public-cache.ts';

const base = 'https://api.example.test';
const url = `${base}/congregacoes`;
const data = [{ id: 1, nome: 'Sede' }];
const ok = () => Response.json(data);

test('consultas simultâneas compartilham a requisição e têm corpos independentes', async () => {
  let calls = 0;
  const cache = createPublicCache(base, async (_, init) => {
    assert.equal(init.credentials, 'omit'); calls++; return ok();
  });
  const responses = await Promise.all([cache.request(url), cache.request(url)]);
  assert.deepEqual(await Promise.all(responses.map(r => r.json())), [data, data]);
  assert.deepEqual(await (await cache.request(url)).json(), data);
  assert.equal(calls, 1);
});

test('TTL expira e limpeza de sessão invalida cache', async () => {
  let calls = 0, time = 0;
  const cache = createPublicCache(base, async () => { calls++; return ok(); }, () => time);
  await cache.request(url); time = 60_000; await cache.request(url);
  cache.clear(); await cache.request(url);
  assert.equal(calls, 3);
});

test('rotas privadas, links, parâmetros, autenticação e cancelamento não são armazenados', async () => {
  let calls = 0;
  const cache = createPublicCache(base, async () => { calls++; return ok(); });
  for (const [target, init] of [[`${base}/sessao`], [`${base}/publico/mural`], [`${base}/publico/eventos`], [`${base}/congregacoes?x=1`], [`https://other.test/congregacoes`], [url, { headers: { Authorization: 'Bearer token' } }], [url, { signal: new AbortController().signal }]]) {
    await cache.request(target, init); await cache.request(target, init);
  }
  assert.equal(calls, 14);
});

test('respostas no-store, privadas, erros e dados inesperados não são armazenados', async () => {
  for (const make of [() => Response.json(data, { headers: { 'Cache-Control': 'no-store' } }), () => Response.json(data, { headers: { 'Cache-Control': 'private' } }), () => Response.json(data, { headers: { 'Set-Cookie': 'session=x' } }), () => Response.json(data, { status: 503 }), () => Response.json([{ ...data[0], token: 'secret' }]), () => new Response('invalid')]) {
    let calls = 0;
    const cache = createPublicCache(base, async () => { calls++; return make(); });
    await cache.request(url); await cache.request(url);
    assert.equal(calls, 2);
  }
});

test('falhas de rede liberam requisição pendente', async () => {
  let calls = 0;
  const cache = createPublicCache(base, async () => { if (++calls === 1) throw new TypeError('network'); return ok(); });
  await assert.rejects(cache.request(url));
  assert.deepEqual(await (await cache.request(url)).json(), data);
  assert.equal(calls, 2);
});

test('limpeza durante requisição impede repovoamento por sessão anterior', async () => {
  let finish, calls = 0;
  const cache = createPublicCache(base, async () => { if (++calls === 1) return new Promise(resolve => { finish = resolve; }); return ok(); });
  const old = cache.request(url);
  cache.clear(); finish(ok()); await old;
  await cache.request(url);
  assert.equal(calls, 2);
});

test('mutações invalidam cache mesmo quando falham', async () => {
  let calls = 0;
  const cache = createPublicCache(base, async () => { calls++; return ok(); });
  await cache.request(url);
  await cache.request(`${base}/eventos`, { method: 'POST' });
  await cache.request(url);
  assert.equal(calls, 3);
});
