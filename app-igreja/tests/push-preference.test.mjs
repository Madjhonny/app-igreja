import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPushPreference } from '../services/push-preference.ts';

function setup() {
  let record = null, time = 0, token = 'ExpoPushToken[test_token_123]', fail = false, failRevoke = false;
  const calls = [];
  const prefs = createPushPreference({ read: async () => record, write: async value => { record = value; }, remove: async () => { record = null; },
    getToken: async ask => { calls.push(['permission', ask]); return token; }, generateKey: async () => 'a'.repeat(64),
    register: async (_api, _auth, value) => { assert.equal(record.active, false); calls.push(['register', value.userId]); return !fail; },
    revoke: async (_api, key) => { calls.push(['revoke', key]); return !failRevoke; }, now: () => time });
  return { prefs, calls, record: () => record, setToken: value => { token = value; }, failRegister: () => { fail = true; }, failRevoke: value => { failRevoke = value; }, tick: () => { time += 86_400_000; } };
}
test('não solicita permissão nem registra sem consentimento explícito', async () => {
  const { prefs, calls } = setup();
  await prefs.reconcile('api', 1, 'auth');
  assert.deepEqual(calls, []);
  assert.equal(await prefs.status(1), 'off');
});
test('registra somente após permissão e revoga na saída', async () => {
  const { prefs, record, calls } = setup();
  assert.equal(await prefs.enable('api', 1, 'auth'), true);
  assert.equal(await prefs.status(1), 'active');
  assert.equal(record().userId, 1);
  assert.equal(await prefs.disable('api'), true);
  assert.equal(record(), null);
  assert.deepEqual(calls.map(c => c[0]), ['permission', 'register', 'revoke']);
});
test('permissão negada não registra dispositivo', async () => {
  const { prefs, calls, setToken } = setup(); setToken(null);
  assert.equal(await prefs.enable('api', 1, 'auth'), false);
  assert.deepEqual(calls, [['permission', true]]);
});
test('resposta perdida e logout offline conservam chave para revogação posterior', async () => {
  const { prefs, record, failRegister, failRevoke } = setup(); failRegister();
  assert.equal(await prefs.enable('api', 1, 'auth'), false);
  assert.equal(await prefs.status(1), 'pending');
  failRevoke(true);
  assert.equal(await prefs.disable('api'), false);
  assert.equal(record().active, false);
  failRevoke(false);
  await prefs.reconcile('api', 2, 'other');
  assert.equal(record(), null);
});
test('renova registro sem novo pedido de consentimento e revoga ao mudar de conta', async () => {
  const { prefs, calls, tick } = setup();
  await prefs.enable('api', 1, 'auth'); tick();
  await prefs.reconcile('api', 1, 'auth');
  assert.deepEqual(calls.filter(c => c[0] === 'permission'), [['permission', true], ['permission', false]]);
  await prefs.reconcile('api', 2, 'new');
  assert.equal(await prefs.status(2), 'off');
});
