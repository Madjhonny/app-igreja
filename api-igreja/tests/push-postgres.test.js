const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile, mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const crypto = require('node:crypto');
const path = require('node:path');
const { Pool } = require('pg');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { performance } = require('node:perf_hooks');
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

test('HTTP + PostgreSQL real: login, escopo, concorrência e revogação de sessão', { skip: !dbUrl, timeout: 90000 }, async t => {
  const url = new URL(dbUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/agenda_push_test');
  const pool = new Pool({ connectionString: dbUrl });
  let child;
  let mailDir;
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
    mailDir = await mkdtemp(path.join(tmpdir(), 'agenda-mail-test-'));
    const mailPath = path.join(mailDir, 'outbox.jsonl');
    await writeFile(mailPath, '');
    // Intercepta todo tráfego externo do processo; só aceita o provedor simulado.
    child = spawn(process.execPath, ['-e', `
      global.fetch = async (url, init) => {
        if (url !== 'https://api.resend.com/emails') throw new Error('Rede externa bloqueada no teste');
        const message = JSON.parse(init.body);
        require('node:fs').appendFileSync(process.env.TEST_MAIL_PATH, JSON.stringify(message) + '\\n');
        return { ok: !message.to.includes('mailfailure@example.test') };
      };
      require(process.argv[1]);
    `, path.join(__dirname, '../server.js')], {
      cwd: __dirname,
      env: { PORT: '0', DB_HOST: url.hostname, DB_PORT: url.port || '5432',
        DB_NAME: 'agenda_push_test', DB_USER: decodeURIComponent(url.username),
        DB_PASSWORD: decodeURIComponent(url.password), DB_SSL: 'false',
        JWT_SECRET: 'isolated-http-test-only', PUSH_NOTIFICATIONS_ENABLED: 'false',
        CORS_ORIGINS: 'https://test.example.test', NODE_ENV: 'test',
        RESEND_API_KEY: 'test-only', EMAIL_FROM: 'test@example.test', TEST_MAIL_PATH: mailPath,
        RESET_REQUEST_RATE_LIMIT: '100', RESET_VERIFY_RATE_LIMIT: '100' },
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
    const request = async (route, { method = 'GET', token, body, origin, timeoutMs = 5000 } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs),
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

    const masterId = await addUser('master', 'MASTER', 'APROVADO', '10000000004');
    const otherMasterId = await addUser('othermaster', 'MASTER', 'APROVADO', '10000000005');
    const master = await login('master');
    const draft = async (owner, title, date, hour, marker = 'NORMAL') => {
      await pool.query(`INSERT INTO gestao_datas_rascunho
        (master_id,titulo,data_inicio,data_fim,horario,congregacao_id,marcador,legenda)
        VALUES ($1,$2,$3,$3,$4,$5,$6,'Observação privada')`, [owner, title, date, hour, a, marker]);
    };
    const publish = (auth = master, confirm = false) => request('/gestao-datas/publicar', {
      method: 'POST', token: auth, body: { confirmar_conflitos: confirm },
    });
    const draftState = async owner => (await pool.query('SELECT titulo, publicado FROM gestao_datas_rascunho WHERE master_id=$1 ORDER BY id', [owner])).rows;
    const published = async prefix => (await pool.query('SELECT titulo, legenda FROM eventos WHERE titulo LIKE $1 ORDER BY titulo', [`${prefix}%`])).rows;

    await t.test('publicação em lote: falha após INSERT reverte todo o lote e permite nova tentativa concorrente', async () => {
      await draft(masterId, 'Lote A', '2030-07-10', '18:00');
      await draft(masterId, 'Lote B', '2030-07-10', '20:00');
      await draft(otherMasterId, 'Lote de outro gestor', '2030-07-11', '18:00');
      const original = await draftState(masterId);
      assert.equal((await publish(member)).status, 403);
      assert.equal((await publish(await login('admin'))).status, 403);
      // Falha de banco deliberada no UPDATE, depois dos INSERTs em eventos.
      await pool.query("ALTER TABLE gestao_datas_rascunho ADD CONSTRAINT teste_falha_publicacao CHECK (titulo <> 'Lote B' OR publicado = FALSE)");
      try {
        assert.equal((await publish()).status, 500);
        assert.deepEqual(await published('Lote '), []);
        assert.deepEqual(await draftState(masterId), original);
      } finally {
        await pool.query('ALTER TABLE gestao_datas_rascunho DROP CONSTRAINT teste_falha_publicacao');
      }
      const results = await Promise.all([publish(), publish()]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
      assert.equal(results.find(r => r.status === 200).data.quantidadePublicada, 2);
      assert.deepEqual(await published('Lote '), [{ titulo: 'Lote A', legenda: null }, { titulo: 'Lote B', legenda: null }]);
      assert.deepEqual(await draftState(masterId), original.map(row => ({ ...row, publicado: true })));
      assert.deepEqual(await draftState(otherMasterId), [{ titulo: 'Lote de outro gestor', publicado: false }]);
      assert.equal((await publish()).status, 400);
      const guestEvents = await request('/publico/eventos?mes=7&ano=2030');
      assert.equal(guestEvents.status, 200);
      assert.deepEqual(guestEvents.data.map(row => row.titulo), ['Lote A', 'Lote B']);
      assert.ok(guestEvents.data.every(row => row.legenda === null));
    });

    await t.test('publicação excepcional: conflitos reais e marcador exigem confirmação do MASTER', async () => {
      await draft(masterId, 'Conflito A', '2030-06-15', '19:15', 'REVISAR');
      await draft(masterId, 'Conflito B', '2030-06-15', '19:30');
      const before = await draftState(masterId);
      const blocked = await publish();
      assert.equal(blocked.status, 409);
      assert.equal(blocked.data.codigo, 'CONFIRMACAO_CONFLITOS_NECESSARIA');
      assert.equal(blocked.data.resumo.revisar, 1);
      assert.equal(blocked.data.resumo.eventosEmConflito, 2);
      assert.deepEqual([...new Set(blocked.data.conflitos.map(row => row.origem))].sort(), ['AGENDA PUBLICADA', 'PLANEJAMENTO']);
      assert.deepEqual(await published('Conflito '), []);
      assert.deepEqual(await draftState(masterId), before);
      assert.equal((await publish(member, true)).status, 403);
      const confirmed = await publish(master, true);
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.data.quantidadePublicada, 2);
      assert.equal(confirmed.data.confirmacaoExcepcional, true);
      assert.deepEqual(await published('Conflito '), [{ titulo: 'Conflito A', legenda: null }, { titulo: 'Conflito B', legenda: null }]);
      assert.ok((await draftState(masterId)).every(row => row.publicado));
    });

    await t.test('mural: curtidas simultâneas, estado individual e privacidade pública', async () => {
      const adminToken = await login('admin');
      const postBody = { titulo: 'Mural HTTP', descricao: 'Teste', tipo_midia: 'imagem', midia: 'https://example.test/image.png', data_inicio: '2030-07-01', data_fim: '2030-07-31' };
      const createPost = token => request('/mural', { method: 'POST', token, body: postBody });
      assert.equal((await createPost(member)).status, 403);
      assert.equal((await createPost(pending)).status, 403);
      const created = await createPost(adminToken);
      assert.equal(created.status, 201);
      const id = created.data.post.id;
      const like = token => request(`/mural/${id}/curtir`, { method: 'POST', token });
      assert.equal((await like()).status, 401);
      assert.equal((await like(pending)).status, 403);
      const toggles = await Promise.all(Array.from({ length: 6 }, () => like(member)));
      assert.ok(toggles.every(r => r.status === 200));
      assert.equal(toggles.filter(r => r.data.curtiu).length, 3);
      assert.equal((await pool.query('SELECT * FROM mural_curtidas WHERE post_id=$1', [id])).rowCount, 0);
      const distinct = await Promise.all([like(member), like(adminToken)]);
      assert.ok(distinct.every(r => r.status === 200 && r.data.curtiu));
      assert.equal((await pool.query('SELECT * FROM mural_curtidas WHERE post_id=$1', [id])).rowCount, 2);
      for (const [token, liked] of [[member, true], [adminToken, true], [master, false]]) {
        const result = await request('/mural', { token });
        assert.equal(result.status, 200);
        const post = result.data.find(row => row.id === id);
        assert.equal(post.totalCurtidas, 2);
        assert.equal(post.curtiuPorMim, liked);
      }
      const publicResult = await request('/publico/mural');
      assert.equal(publicResult.status, 200);
      const publicPost = publicResult.data.find(row => row.id === id);
      assert.equal(publicPost.autor, 'Equipe Agenda ADP');
      assert.equal(publicPost.totalCurtidas, 2);
      assert.equal(publicPost.curtiuPorMim, false);
      assert.deepEqual(publicPost.comentarios, []);
      for (const key of ['usuario_id', 'congregacao_id', 'autor_foto', 'email', 'cpf', 'senha_hash']) assert.equal(Object.hasOwn(publicPost, key), false);
      assert.equal((await request(`/mural/${id}`, { method: 'DELETE', token: member })).status, 403);
      assert.equal((await request(`/mural/${id}`, { method: 'DELETE', token: master })).status, 200);
      assert.equal((await pool.query('SELECT * FROM mural_curtidas WHERE post_id=$1', [id])).rowCount, 0);
      assert.equal((await like(member)).status, 404);
    });

    await t.test('mural: respostas, moderação, curtidas de comentários e exclusão em cascata', async () => {
      const adminToken = await login('admin');
      const otherId = await addUser('othermember', 'MEMBRO', 'APROVADO', '10000000006');
      await pool.query('UPDATE usuarios SET congregacao_id=$1 WHERE id=$2', [b, otherId]);
      const other = await login('othermember');
      const otherAdminId = await addUser('otheradmin', 'ADMIN', 'APROVADO', '10000000007');
      await pool.query('UPDATE usuarios SET congregacao_id=$1 WHERE id=$2', [b, otherAdminId]);
      const otherAdmin = await login('otheradmin');
      const create = async title => {
        const result = await request('/mural', { method: 'POST', token: adminToken, body: { titulo: title, tipo_midia: 'imagem', midia: 'https://example.test/image.png', data_inicio: '2030-07-01', data_fim: '2030-07-31' } });
        assert.equal(result.status, 201);
        return result.data.post.id;
      };
      const id = await create('Comentários HTTP');
      const second = await create('Outro post HTTP');
      const comment = (post, token, parent_id) => request(`/mural/${post}/comentarios`, { method: 'POST', token, body: { texto: 'Comentário de teste', parent_id } });
      assert.equal((await comment(id, pending)).status, 403);
      assert.equal((await comment(id)).status, 401);
      const root = await comment(id, member);
      assert.equal(root.status, 201);
      assert.equal((await comment(second, other, root.data.id)).status, 400);
      const reply = await comment(id, other, root.data.id);
      assert.equal(reply.status, 201);
      const nested = await comment(id, member, reply.data.id);
      assert.equal(nested.status, 201);
      const like = (commentId, token) => request(`/comentarios/${commentId}/curtir`, { method: 'POST', token });
      assert.equal((await like(root.data.id, pending)).status, 403);
      const toggles = await Promise.all(Array.from({ length: 5 }, () => like(root.data.id, other)));
      assert.ok(toggles.every(r => r.status === 200));
      assert.equal(toggles.filter(r => r.data.curtiu).length, 3);
      assert.equal((await like(reply.data.id, member)).data.curtiu, true);
      const list = await request(`/mural/${id}/comentarios`, { token: other });
      assert.equal(list.status, 200);
      assert.equal(list.data.length, 3);
      const row = list.data.find(c => c.id === root.data.id);
      assert.equal(Number(row.total_curtidas), 1);
      assert.equal(row.curtiu_por_mim, true);
      for (const key of ['email', 'cpf', 'telefone', 'senha_hash']) assert.equal(Object.hasOwn(row, key), false);
      const del = (commentId, token) => request(`/comentarios/${commentId}`, { method: 'DELETE', token });
      assert.equal((await del(root.data.id, other)).status, 403);
      assert.equal((await del(root.data.id, pending)).status, 403);
      assert.equal((await request(`/mural/${id}`, { method: 'DELETE', token: otherAdmin })).status, 403);
      assert.equal((await del(root.data.id, otherAdmin)).status, 200);
      assert.equal((await pool.query('SELECT * FROM mural_comentarios WHERE post_id=$1', [id])).rowCount, 0);
      assert.equal((await pool.query('SELECT * FROM mural_comentario_curtidas WHERE comentario_id = ANY($1::int[])', [[root.data.id, reply.data.id, nested.data.id]])).rowCount, 0);
      assert.equal((await like(root.data.id, member)).status, 404);
      const own = await comment(id, member);
      assert.equal(own.status, 201);
      assert.equal((await del(own.data.id, member)).status, 200);
      const moderation = await comment(id, other);
      assert.equal(moderation.status, 201);
      assert.equal((await del(moderation.data.id, master)).status, 200);
      assert.equal((await request(`/mural/${id}`, { method: 'DELETE', token: adminToken })).status, 200);
      assert.equal((await request(`/mural/${second}`, { method: 'DELETE', token: master })).status, 200);
    });

    await t.test('recuperação de senha: envio único, expiração, limite de tentativas e uso único concorrente', async () => {
      const userId = await addUser('recovery', 'MEMBRO', 'APROVADO', '10000000008');
      const blockedId = await addUser('blocked', 'MEMBRO', 'BLOQUEADO', '10000000009');
      const failureId = await addUser('mailfailure', 'MEMBRO', 'APROVADO', '10000000010');
      const oldToken = await login('recovery');
      const email = 'recovery@example.test';
      const requestCode = email => request('/senha/solicitar-recuperacao', { method: 'POST', body: { email } });
      const reset = (codigo, nova_senha) => request('/senha/redefinir', { method: 'POST', body: { email, codigo, nova_senha } });
      const outbox = async () => (await readFile(mailPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
      const state = async id => (await pool.query('SELECT * FROM senha_recuperacoes WHERE usuario_id=$1', [id])).rows[0];
      const latestCode = async () => (await outbox()).filter(m => m.to.includes(email)).at(-1).text.match(/\b\d{8}\b/)[0];
      const attempts = await Promise.all(Array.from({ length: 4 }, () => requestCode(email)));
      assert.ok(attempts.every(r => r.status === 202));
      assert.equal((await outbox()).length, 1);
      const absent = await requestCode('notregistered@example.test');
      const blocked = await requestCode('blocked@example.test');
      assert.equal(absent.status, 202);
      assert.deepEqual(absent.data, attempts[0].data);
      assert.deepEqual(blocked.data, absent.data);
      assert.equal(await state(blockedId), undefined);
      assert.equal((await outbox()).length, 1);
      assert.equal((await requestCode('mailfailure@example.test')).status, 202);
      assert.equal(await state(failureId), undefined);
      assert.equal((await requestCode('mailfailure@example.test')).status, 202);
      assert.equal((await outbox()).filter(m => m.to.includes('mailfailure@example.test')).length, 2);
      let code = await latestCode();
      const row = await state(userId);
      assert.equal(row.codigo_hash, crypto.createHmac('sha256', 'isolated-http-test-only').update(`${userId}:${code}`).digest('hex'));
      assert.equal(row.expira_em.getTime() - row.enviado_em.getTime(), 15 * 60 * 1000);
      await pool.query("UPDATE senha_recuperacoes SET expira_em=NOW()-INTERVAL '1 second' WHERE usuario_id=$1", [userId]);
      assert.equal((await reset(code, 'NovaSenha123!')).status, 400);
      assert.equal(await state(userId), undefined);
      assert.equal((await requestCode(email)).status, 202);
      code = await latestCode();
      const wrong = code === '00000000' ? '00000001' : '00000000';
      const wrongResults = await Promise.all(Array.from({ length: 5 }, () => reset(wrong, 'NovaSenha123!')));
      assert.ok(wrongResults.every(r => r.status === 400));
      assert.equal((await state(userId)).tentativas, 5);
      assert.equal((await reset(code, 'NovaSenha123!')).status, 400);
      assert.equal(await state(userId), undefined);
      assert.equal((await request('/sessao', { token: oldToken })).status, 200);
      assert.equal((await requestCode(email)).status, 202);
      code = await latestCode();
      const passwords = ['NovaSenha123!', 'OutraSenha456!'];
      const results = await Promise.all(passwords.map(password => reset(code, password)));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
      assert.equal(await state(userId), undefined);
      assert.equal((await reset(code, 'TerceiraSenha789!')).status, 400);
      assert.equal((await request('/sessao', { token: oldToken })).status, 401);
      const loginWith = senha => request('/login', { method: 'POST', body: { email, senha } });
      assert.equal((await loginWith(senha)).status, 400);
      assert.equal((await loginWith(passwords[results.findIndex(r => r.status === 400)] )).status, 400);
      assert.equal((await loginWith(passwords[results.findIndex(r => r.status === 200)] )).status, 200);
      assert.equal((await pool.query('SELECT token_version FROM usuarios WHERE id=$1', [userId])).rows[0].token_version, 1);
    });

    await t.test('troca autenticada: falha ao revogar código reverte senha e sessão; nova tentativa funciona', async () => {
      const userId = await addUser('change', 'MEMBRO', 'APROVADO', '10000000011');
      const token = await login('change');
      const code = '12345678';
      const codeHash = crypto.createHmac('sha256', 'isolated-http-test-only').update(`${userId}:${code}`).digest('hex');
      await pool.query("INSERT INTO senha_recuperacoes(usuario_id,codigo_hash,expira_em) VALUES($1,$2,NOW()+INTERVAL '15 minutes')", [userId, codeHash]);
      const change = () => request('/senha/alterar', { method: 'POST', token, body: { senha_atual: senha, nova_senha: 'MudancaSenha123!' } });
      await pool.query("CREATE FUNCTION teste_falha_revogacao() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Falha de teste'; END; $$");
      await pool.query('CREATE TRIGGER teste_falha_revogacao BEFORE DELETE ON senha_recuperacoes FOR EACH ROW EXECUTE FUNCTION teste_falha_revogacao()');
      try {
        assert.equal((await change()).status, 500);
        assert.equal((await request('/sessao', { token })).status, 200);
        assert.equal((await pool.query('SELECT codigo_hash FROM senha_recuperacoes WHERE usuario_id=$1', [userId])).rows[0].codigo_hash, codeHash);
        assert.equal((await pool.query('SELECT senha_hash FROM usuarios WHERE id=$1', [userId])).rows[0].senha_hash, hash);
      } finally {
        await pool.query('DROP TRIGGER teste_falha_revogacao ON senha_recuperacoes');
        await pool.query('DROP FUNCTION teste_falha_revogacao()');
      }
      const results = await Promise.all([change(), change()]);
      assert.equal(results.filter(r => r.status === 200).length, 1);
      assert.ok(results.every(r => [200, 401, 403, 409].includes(r.status)));
      assert.equal((await pool.query('SELECT * FROM senha_recuperacoes WHERE usuario_id=$1', [userId])).rowCount, 0);
      assert.equal((await request('/sessao', { token })).status, 401);
      assert.equal((await request('/senha/redefinir', { method: 'POST', body: { email: 'change@example.test', codigo: code, nova_senha: 'OutraSenha123!' } })).status, 400);
      assert.equal((await request('/login', { method: 'POST', body: { email: 'change@example.test', senha: 'MudancaSenha123!' } })).status, 200);
    });

    await t.test('carga real: 800 contas, 50 usuários simultâneos e login com bcrypt de produção', { timeout: 60000 }, async loadTest => {
      // Volume e identidades fictícios; conexão exclusivamente ao banco local da CI.
      const productionHash = await bcrypt.hash(senha, 12);
      const { rows: users } = await pool.query(`INSERT INTO usuarios
        (nome_completo,nome_exibicao,email,senha_hash,congregacao_id,cpf,status_conta)
        SELECT 'Carga ' || n, 'Carga ' || n, 'load-' || n || '@example.test', $1, $2,
          '2' || lpad(n::text,10,'0'), 'APROVADO' FROM generate_series(1,800) n
        RETURNING id,email,token_version`, [productionHash, a]);
      await pool.query(`INSERT INTO eventos(titulo,data_inicio,data_fim,horario,congregacao_id,criado_por_usuario_id)
        SELECT 'Carga evento ' || n, DATE '2030-01-01' + (n % 365), DATE '2030-01-01' + (n % 365),
          TIME '19:00', $1, $2 FROM generate_series(1,1000) n`, [a, admin]);
      await pool.query(`INSERT INTO mural_eventos(usuario_id,congregacao_id,titulo,tipo_midia,midia,data_inicio,data_fim)
        SELECT $1,$2,'Carga mural ' || n,'imagem','https://example.test/image.png',CURRENT_DATE,CURRENT_DATE+30
        FROM generate_series(1,100) n`, [admin, a]);
      const postIds = (await pool.query("SELECT id FROM mural_eventos WHERE titulo LIKE 'Carga mural %' ORDER BY id")).rows.map(row => row.id);
      await pool.query(`INSERT INTO mural_curtidas(usuario_id,post_id)
        SELECT u.id, p.id FROM unnest($1::int[]) AS u(id) CROSS JOIN unnest($2::int[]) AS p(id)`, [users.slice(0, 20).map(u => u.id), postIds]);
      const routes = [
        ['/congregacoes', false, rows => Array.isArray(rows) && rows.some(r => r.id === a)],
        ['/publico/eventos?mes=6&ano=2030', false, rows => Array.isArray(rows) && rows.length >= 75],
        ['/eventos?mes=6&ano=2030', true, rows => Array.isArray(rows) && rows.length >= 75],
        ['/mural?midia=link', true, rows => Array.isArray(rows) && rows.length >= 100 && rows.filter(r => r.titulo.startsWith('Carga mural ')).every(r => r.totalCurtidas === 20)],
      ];
      const timings = new Map(routes.map(([route]) => [route, []]));
      const actors = users.slice(0, 50).map(user => jwt.sign({ id: user.id, token_version: user.token_version }, 'isolated-http-test-only', { expiresIn: '5m' }));
      const errors = [];
      // Aquecimento fora das métricas, para não confundir inicialização com carga sustentada.
      for (const [route, authenticated] of routes) assert.equal((await request(route, { token: authenticated ? actors[0] : undefined })).status, 200);
      const start = performance.now();
      await Promise.all(actors.map(async token => {
        for (let round = 0; round < 4; round++) {
          for (const [route, authenticated, valid] of routes) {
            const before = performance.now();
            try {
              const result = await request(route, { token: authenticated ? token : undefined });
              if (result.status !== 200 || !valid(result.data)) errors.push(`${route}: ${result.status} ou resposta inválida`);
            } catch (error) { errors.push(`${route}: ${error.name}`); }
            finally { timings.get(route).push(performance.now() - before); }
          }
        }
      }));
      const elapsed = performance.now() - start;
      const summarize = values => {
        const sorted = [...values].sort((a, b) => a - b);
        const percentile = p => Math.round(sorted[Math.ceil(sorted.length * p) - 1]);
        return { requests: values.length, p50_ms: percentile(0.5), p95_ms: percentile(0.95), max_ms: percentile(1) };
      };
      for (const [route, values] of timings) {
        const metrics = summarize(values);
        loadTest.diagnostic(JSON.stringify({ route, ...metrics }));
        assert.equal(metrics.requests, 200);
        assert.ok(metrics.p95_ms <= 3000, `${route}: p95 acima de 3 segundos (${metrics.p95_ms}ms)`);
      }
      loadTest.diagnostic(JSON.stringify({ total_requests: 800, concurrent_users: 50, errors: errors.length, requests_per_second: Math.round(800000 / elapsed) }));
      assert.deepEqual(errors, []);
      const authTimes = await Promise.all(users.slice(0, 8).map(async user => {
        const before = performance.now();
        const result = await request('/login', { method: 'POST', body: { email: user.email, senha }, timeoutMs: 15000 });
        assert.equal(result.status, 200);
        assert.ok(result.data.token);
        return performance.now() - before;
      }));
      const authMetrics = summarize(authTimes);
      loadTest.diagnostic(JSON.stringify({ route: '/login', concurrent_users: 8, bcrypt_cost: 12, ...authMetrics }));
      assert.ok(authMetrics.p95_ms <= 10000, `Login: p95 acima de 10 segundos (${authMetrics.p95_ms}ms)`);
    });
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await pool.end();
    if (mailDir) await rm(mailDir, { recursive: true, force: true });
  }
});
