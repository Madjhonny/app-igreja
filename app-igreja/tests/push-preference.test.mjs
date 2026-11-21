import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPushPreference } from '../services/push-preference.ts';
import { createPushOnboarding } from '../services/push-onboarding.ts';

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

const approved = { id: 1, status_conta: 'APROVADO' };
function onboarding(overrides = {}) {
  const marks = new Set(), calls = [];
  const deps = { available: true, seen: async k => marks.has(k), remember: async k => { marks.add(k); },
    status: async () => 'off', confirm: async () => { calls.push('offer'); return true; },
    currentAuth: async () => 'auth', enable: async () => { calls.push('enable'); return true; },
    failed: () => calls.push('failed'), ...overrides };
  return { offer: createPushOnboarding(deps), deps, calls, marks };
}
test('aviso inicial apenas para conta aprovada e plataforma habilitada', async () => {
  const { offer, calls } = onboarding();
  await offer('api', null); await offer('api', { ...approved, status_conta: 'PENDENTE' });
  const disabled = onboarding({ available: false }); await disabled.offer('api', approved);
  assert.deepEqual(calls, []); assert.deepEqual(disabled.calls, []);
});
test('aceite abre permissão uma vez e não repete após reiniciar', async () => {
  const { offer, calls, deps } = onboarding();
  await Promise.all([offer('api', approved), offer('api', approved)]);
  await createPushOnboarding(deps)('api', approved);
  assert.deepEqual(calls, ['offer', 'enable']);
});
test('recusa é lembrada sem solicitar permissão do sistema', async () => {
  let prompts = 0;
  const { offer, deps, calls } = onboarding({ confirm: async () => { prompts++; return false; } });
  await offer('api', approved); await createPushOnboarding(deps)('api', approved);
  assert.equal(prompts, 1); assert.deepEqual(calls, []);
});
test('notificações já ativas ou pendentes não recebem novo convite', async () => {
  for (const status of ['active', 'pending']) {
    const { offer, calls, marks } = onboarding({ status: async () => status });
    await offer('api', approved); assert.deepEqual(calls, []); assert.equal(marks.size, 1);
  }
});
test('mudança de sessão durante aviso não registra dispositivo', async () => {
  let auth = 'auth';
  const { offer, calls } = onboarding({ currentAuth: async () => auth, confirm: async () => { auth = 'other'; return true; } });
  await offer('api', approved); assert.deepEqual(calls, []);
});
test('falha de ativação informa usuário sem repetir pedido', async () => {
  const { offer, deps, calls } = onboarding({ enable: async () => false });
  await offer('api', approved); await createPushOnboarding(deps)('api', approved);
  assert.deepEqual(calls, ['offer', 'failed']);
});
test('decisões iniciais ficam isoladas por conta e API', async () => {
  const { offer, calls } = onboarding();
  await offer('api', approved); await offer('api', { ...approved, id: 2 });
  await offer('other-api', approved);
  assert.deepEqual(calls, ['offer', 'enable', 'offer', 'enable', 'offer', 'enable']);
});
