const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { requestMonitoring, healthHandler, clientTelemetryHandler } = require('../services/monitoring');

function simulate({ status = 200, duration = 10, route = '/usuarios/:id/foto', abort = false, failLogger = false } = {}) {
  const records = [];
  let time = 0, nextCalls = 0;
  const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, entry => {
    if (failLogger) throw new Error('logger indisponível');
    records.push({ level, ...JSON.parse(entry) });
  }]));
  const req = { method: 'GET', route: route ? { path: route } : undefined,
    originalUrl: '/usuarios/123/foto?token=SEGREDO', ip: '1.2.3.4', body: { senha: 'SEGREDO' },
    headers: { authorization: 'Bearer SEGREDO' }, params: { id: '123' } };
  const res = new EventEmitter();
  res.statusCode = status;
  requestMonitoring({ logger, now: () => time })(req, res, () => nextCalls++);
  time = duration;
  res.writableFinished = !abort;
  if (!abort) res.emit('finish');
  res.emit('close');
  assert.equal(nextCalls, 1);
  return records;
}

test('registra status, rota parametrizada e latência uma única vez sem dados pessoais', () => {
  const logs = simulate();
  assert.deepEqual(logs, [{ level: 'info', event: 'http_request', method: 'GET', route: '/usuarios/:id/foto', status: 200, duration_ms: 10, slow: false, aborted: false }]);
  assert.doesNotMatch(JSON.stringify(logs), /SEGREDO|1\.2\.3\.4|\/123/);
});

test('classifica lentidão, rate limit, erro de servidor e desconexão', () => {
  assert.equal(simulate({ duration: 1000 })[0].level, 'warn');
  assert.equal(simulate({ status: 429 })[0].level, 'warn');
  assert.equal(simulate({ status: 503 })[0].level, 'error');
  const [aborted] = simulate({ abort: true });
  assert.equal(aborted.status, 499);
  assert.equal(aborted.aborted, true);
});

test('rotas desconhecidas não usam a URL, e saúde normal não gera ruído', () => {
  assert.equal(simulate({ route: null })[0].route, 'unmatched');
  assert.deepEqual(simulate({ route: '/health' }), []);
  assert.equal(simulate({ route: '/health', status: 503 })[0].level, 'error');
});

test('falha no logger não interrompe a resposta', () => {
  assert.deepEqual(simulate({ failLogger: true }), []);
});

test('telemetria aceita somente contadores anônimos e rejeita dados extras', () => {
  const entries = [];
  const handler = clientTelemetryHandler({ logger: { warn: line => entries.push(JSON.parse(line)) } });
  const send = body => {
    const res = { status(n) { this.code = n; return this; }, json() {}, end() {} };
    handler({ body, ip: 'privado', headers: { authorization: 'segredo' } }, res);
    return res.code;
  };
  const valid = { platform: 'ios', events: [{ category: 'network', count: 2 }] };
  assert.equal(send(valid), 204);
  for (const invalid of [null, {}, { ...valid, email: 'privado' }, { ...valid, platform: 'privado' },
    { ...valid, events: [] }, { ...valid, events: [{ category: 'network', count: 101 }] },
    { ...valid, events: [{ category: 'network', count: 0 }] }, { ...valid, events: [{ category: 'network', count: 1.5 }] },
    { ...valid, events: [{ category: 'segredo', count: 1 }] }, { ...valid, events: [{ ...valid.events[0], message: 'privado' }] },
    { ...valid, events: [valid.events[0], valid.events[0]] }]) assert.equal(send(invalid), 400);
  assert.deepEqual(entries, [{ event: 'client_diagnostic', ...valid }]);
});

async function health(handler) {
  const result = {};
  await handler({}, { set(k, v) { result[k] = v; }, status(n) { result.status = n; return this; }, json(value) { result.body = value; } });
  return result;
}

test('saúde consulta apenas SELECT 1, usa cache interno curto e não expõe detalhes', async () => {
  let calls = 0, time = 0;
  const handler = healthHandler({ query: async q => { calls++; assert.deepEqual(q, { text: 'SELECT 1', query_timeout: 2000 }); } }, { now: () => time });
  const ok = { 'Cache-Control': 'no-store', status: 200, body: { status: 'ok' } };
  assert.deepEqual(await health(handler), ok);
  assert.deepEqual(await health(handler), ok);
  assert.equal(calls, 1);
  time = 5000;
  await health(handler);
  assert.equal(calls, 2);
});

test('falhas e timeout retornam 503 sem detalhes e consultas simultâneas não sobrecarregam o banco', async () => {
  const fail = healthHandler({ query: async () => { throw new Error('senha-secreta'); } });
  const unavailable = { 'Cache-Control': 'no-store', status: 503, body: { status: 'unavailable' } };
  assert.deepEqual(await health(fail), unavailable);
  let calls = 0, resolve;
  const slow = healthHandler({ query: () => { calls++; return new Promise(r => { resolve = r; }); } }, { timeoutMs: 10 });
  assert.deepEqual(await Promise.all([health(slow), health(slow)]), [unavailable, unavailable]);
  assert.equal(calls, 1);
  resolve();
  assert.equal((await health(slow)).status, 200);
});

test('Express registra rota real sem parâmetros ou query e retorna saúde sem cache', async () => {
  const express = require('express');
  const app = express();
  const entries = [];
  const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, line => entries.push(JSON.parse(line))]));
  app.use(requestMonitoring({ logger }));
  app.get('/health', healthHandler({ query: async () => {} }));
  app.get('/usuarios/:id/foto', (_req, res) => res.status(404).json({ erro: 'Não encontrado' }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const root = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${root}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const missing = await fetch(`${root}/usuarios/42/foto?token=privado`);
    assert.equal(missing.status, 404);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].route, '/usuarios/:id/foto');
    assert.doesNotMatch(JSON.stringify(entries), /privado|\/42/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
