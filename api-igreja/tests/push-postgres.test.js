const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
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

test('HTTP + PostgreSQL real: login, escopo, concorrência e revogação de sessão', { skip: !dbUrl, timeout: 30000 }, async () => {
  const url = new URL(dbUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/agenda_push_test');
  const pool = new Pool({ connectionString: dbUrl });
  let child;
  try {
    for (const filename of ['001_initial_schema.sql', '003_password_recovery.sql']) {
      await pool.query(await readFile(path.join(__dirname, '../migrations', filename), 'utf8'));
    }
    const { rows: congregations } = await pool.query("INSERT INTO congregacoes (nome) VALUES ('HTTP A'), ('HTTP B') RETURNING id");
    const [a, b] = congregations.map(row => row.id);
    const senha = 'TesteLocal123!';
    const hash = await bcrypt.hash(senha, 4);
    const addUser = async (name, role, status, cpf) => (await pool.query(`INSERT INTO usuarios
      (nome_completo,nome_exibicao,email,senha_hash,congregacao_id,cpf,nivel_acesso,status_conta)
      VALUES ($1,$1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [name, `${name}@example.test`, hash, a, cpf, role, status])).rows[0].id;
    const admin = await addUser('admin', 'ADMIN', 'APROVADO', '10000000001');
    await addUser('member', 'MEMBRO', 'APROVADO', '10000000002');
    await addUser('pending', 'ADMIN', 'PENDENTE', '10000000003');

    // Não herda credenciais ou integrações do ambiente real.
    child = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
      cwd: __dirname,
      env: { PORT: '0', DB_HOST: url.hostname, DB_PORT: url.port || '5432',
        DB_NAME: 'agenda_push_test', DB_USER: decodeURIComponent(url.username),
        DB_PASSWORD: decodeURIComponent(url.password), DB_SSL: 'false',
        JWT_SECRET: 'isolated-http-test-only', PUSH_NOTIFICATIONS_ENABLED: 'false',
        CORS_ORIGINS: 'https://test.example.test', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stderr.on('data', chunk => { logs += chunk; });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Servidor não iniciou: ${logs}`)), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Servidor encerrou (${code}): ${logs}`)); });
      child.stdout.on('data', chunk => {
        logs += chunk;
        const match = /rodando na porta (\d+)!/.exec(logs);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    const request = async (route, { method = 'GET', token, body, origin } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000),
      });
      return { status: response.status, data: await response.json(), cors: response.headers.get('access-control-allow-origin') };
    };
    const login = async name => {
      const result = await request('/login', { method: 'POST', body: { email: `${name}@example.test`, senha } });
      assert.equal(result.status, 200);
      assert.ok(result.data.token);
      assert.equal(Object.hasOwn(result.data.usuario, 'senha_hash'), false);
      return result.data.token;
    };
    assert.equal((await request('/health')).status, 200);
    const guest = await request('/congregacoes', { origin: 'https://test.example.test' });
    assert.equal(guest.status, 200);
    assert.equal(guest.cors, 'https://test.example.test');
    assert.ok(guest.data.some(row => row.id === a));
    assert.equal((await request('/congregacoes', { origin: 'https://blocked.example.test' })).status, 403);
    assert.equal((await request('/login', { method: 'POST', body: { email: 'admin@example.test', senha: 'wrong' } })).status, 400);
    const token = await login('admin');
    const member = await login('member');
    const pending = await login('pending');
    const event = { titulo: 'HTTP concorrência', data_inicio: '2030-06-15', data_fim: '2030-06-15', horario: '19:00', congregacao_id: b };
    const create = token => request('/eventos', { method: 'POST', token, body: event });
    assert.equal((await create()).status, 401);
    assert.equal((await create(member)).status, 403);
    assert.equal((await create(pending)).status, 403);
    const results = await Promise.all([create(token), create(token)]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(results.find(r => r.status === 201).data.evento.congregacao_id, a);
    assert.equal(results.find(r => r.status === 409).data.podeConfirmar, false);
    const stored = await pool.query('SELECT congregacao_id FROM eventos WHERE titulo=$1', [event.titulo]);
    assert.deepEqual(stored.rows, [{ congregacao_id: a }]);
    assert.equal((await request('/sessao', { token })).status, 200);
    await pool.query('UPDATE usuarios SET token_version=token_version+1 WHERE id=$1', [admin]);
    assert.equal((await request('/sessao', { token })).status, 401);
    assert.equal((await request('/sessao', { token: await login('admin') })).status, 200);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await pool.end();
  }
});
