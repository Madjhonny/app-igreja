const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPushNotifications } = require('../services/push-notifications');
const key = 'a'.repeat(64), token = 'ExpoPushToken[device_token_123]';
const user = { id: 1, status_conta: 'APROVADO', congregacao_id: 2, token_version: 3 };

test('registra somente conta aprovada, plataforma e formato válidos; nunca persiste chave em claro', async () => {
  const calls = [];
  const service = createPushNotifications({ pool: { query: async (...args) => calls.push(args) }, accessToken: 'test' });
  assert.equal(await service.register(user, { token, key, platform: 'android' }), true);
  assert.equal(await service.register({ ...user, status_conta: 'PENDENTE' }, { token, key, platform: 'ios' }), false);
  assert.equal(await service.register(user, { token, key, platform: 'web' }), false);
  assert.equal(await service.register(user, { token: 'malicious', key, platform: 'ios' }), false);
  assert.equal(await service.register(user, { token, key, platform: 'ios', userId: 8 }), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1][0], user.id);
  assert.equal(calls[0][1][4], 3);
  assert.notEqual(calls[0][1][2], key);
  assert.equal(await service.revoke({ key }), true);
  assert.equal(calls[1][1][0], calls[0][1][2]);
  assert.equal(await service.revoke({ key: 'invalid' }), false);
});

test('enfileira somente congregações distintas e usuários aprovados com sessão vigente', async () => {
  let call;
  const service = createPushNotifications({ pool: {}, accessToken: 'test' });
  await service.enqueue({ query: async (...args) => { call = args; } }, [2, '2', 3]);
  assert.deepEqual(call[1], [[2, 3]]);
  assert.match(call[0], /status_conta = 'APROVADO'/);
  assert.match(call[0], /u.token_version = d.token_version/);
});

test('envio em lote contém somente texto genérico, registra ticket e remove token inválido', async () => {
  const queries = [], sent = [];
  let batch = false;
  const pool = { query: async (sql, params) => {
    queries.push([sql, params]);
    if (sql.includes("SET state = 'sending'") && !batch) { batch = true; return { rows: [{ id: 1, device_id: 4, revoke_hash: 'h', token }, { id: 2, device_id: 5, revoke_hash: 'i', token }] }; }
    return { rows: [] };
  } };
  const service = createPushNotifications({ pool, accessToken: 'test-secret', fetchImpl: async (url, init) => {
    sent.push([url, JSON.parse(init.body), init.headers.Authorization]);
    return { ok: true, json: async () => ({ data: [{ status: 'ok', id: 'ticket' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] }) };
  }, logger: { warn() {} } });
  await service.drain();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][2], 'Bearer test-secret');
  assert.deepEqual(Object.keys(sent[0][1][0]).sort(), ['body', 'channelId', 'title', 'to', 'ttl']);
  assert.ok(queries.some(([sql, args]) => sql.includes("SET state = 'receipt'") && args[1] === 'ticket'));
  assert.ok(queries.some(([sql, args]) => sql.includes('DELETE FROM push_devices WHERE id') && args[0] === 5 && args[1] === 'i'));
});

test('resultado ambíguo não reenvia e logs não incluem token ou erro bruto', async () => {
  let dispatched = false, calls = 0; const logs = [], deleted = [];
  const pool = { query: async (sql, args) => {
    if (sql.includes("SET state = 'sending'") && !dispatched) { dispatched = true; return { rows: [{ id: 1, token }] }; }
    if (sql.includes('id = ANY')) deleted.push(args);
    return { rows: [] };
  } };
  const service = createPushNotifications({ pool, accessToken: 'test', fetchImpl: async () => { calls++; throw new Error(token); }, logger: { warn: line => logs.push(line) } });
  await service.drain(); await service.drain();
  assert.equal(calls, 1); assert.deepEqual(deleted, [[[1]]]);
  assert.doesNotMatch(JSON.stringify(logs), /ExpoPushToken/);
});
