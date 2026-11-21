const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { createPushNotifications } = require('../services/push-notifications');

const dbUrl = process.env.PUSH_TEST_DATABASE_URL;
test('PostgreSQL real: migração, fila transacional, escopo, revogação e recibo', { skip: !dbUrl }, async () => {
  const url = new URL(dbUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/agenda_push_test', 'Somente banco de teste local isolado.');
  const pool = new Pool({ connectionString: dbUrl });
  try {
    for (const filename of ['001_initial_schema.sql', '003_password_recovery.sql', '20261120_push_notifications.sql']) {
      await pool.query(await readFile(path.join(__dirname, '../migrations', filename), 'utf8'));
    }
    const congregation = await pool.query("INSERT INTO congregacoes (nome) VALUES ('Teste Push A'), ('Teste Push B') RETURNING id");
    const [a, b] = congregation.rows.map(row => row.id);
    const addUser = async (suffix, congregationId) => (await pool.query(`INSERT INTO usuarios
      (nome_completo,nome_exibicao,email,senha_hash,congregacao_id,cpf,status_conta)
      VALUES ('Teste','Teste',$1,'test-only',$2,$3,'APROVADO') RETURNING id, congregacao_id, status_conta, token_version`,
    [`push-${suffix}@example.test`, congregationId, String(suffix).padStart(11, '0')])).rows[0];
    const [one, two, other] = await Promise.all([addUser(1, a), addUser(2, a), addUser(3, b)]);
    const sent = [];
    const service = createPushNotifications({ pool, accessToken: 'test-only', fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      if (url.endsWith('/send')) { sent.push(...body); return { ok: true, json: async () => ({ data: body.map(() => ({ status: 'ok', id: 'receipt-one' })) }) }; }
      return { ok: true, json: async () => ({ data: { 'receipt-one': { status: 'error', details: { error: 'DeviceNotRegistered' } } } }) };
    }, logger: { warn() {} } });
    for (const [i, user] of [one, two, other].entries()) assert.equal(await service.register(user, { token: `ExpoPushToken[device_test_${i}]`, key: String(i + 1).repeat(64), platform: 'android' }), true);
    const client = await pool.connect();
    try { await client.query('BEGIN'); await service.enqueue(client, [a, a]); await client.query('ROLLBACK'); }
    finally { client.release(); }
    assert.equal((await pool.query('SELECT * FROM push_jobs')).rowCount, 0);
    await service.enqueue(pool, [a, a]);
    assert.equal((await pool.query('SELECT * FROM push_jobs')).rowCount, 2);
    await pool.query("UPDATE usuarios SET status_conta='BLOQUEADO' WHERE id=$1", [two.id]);
    await service.drain();
    assert.deepEqual(sent.map(message => message.to), ['ExpoPushToken[device_test_0]']);
    await pool.query("UPDATE push_jobs SET due_at=NOW() WHERE state='receipt'");
    await service.drain();
    assert.equal((await pool.query('SELECT * FROM push_devices WHERE usuario_id=$1', [one.id])).rowCount, 0);
    await service.revoke({ key: '3'.repeat(64) });
    assert.equal((await pool.query('SELECT * FROM push_devices WHERE usuario_id=$1', [other.id])).rowCount, 0);
  } finally { await pool.end(); }
});
