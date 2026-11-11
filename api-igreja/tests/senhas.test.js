const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function setup({ emailExiste = true, status = 'APROVADO', provedor = true } = {}) {
  const routes = new Map();
  const queries = [];
  const emails = [];
  const app = { use() {}, disable() {}, set() {}, listen() {} };
  for (const method of ['get', 'post', 'put', 'delete']) {
    app[method] = (url, ...handlers) => routes.set(method + ' ' + url, handlers);
  }
  const express = Object.assign(() => app, { json: () => () => {} });
  const user = { id: 1, nivel_acesso: 'MEMBRO', status_conta: status, congregacao_id: 10,
    email: 'teste@exemplo.com', senha_hash: 'hashed:SenhaAtual123', token_version: 0 };
  let recuperacao = null;
  let rollback = false;
  let commit = false;

  async function query(sql, params = []) {
    queries.push({ sql, params });
    if (sql === 'BEGIN') return { rows: [], rowCount: 0 };
    if (sql === 'ROLLBACK') { rollback = true; return { rows: [], rowCount: 0 }; }
    if (sql === 'COMMIT') { commit = true; return { rows: [], rowCount: 0 }; }
    if (sql.includes('SELECT id, nivel_acesso, status_conta')) {
      return { rows: [user], rowCount: 1 };
    }
    if (sql.includes('SELECT id FROM usuarios WHERE LOWER(email)') &&
        sql.includes('status_conta IN')) {
      return { rows: emailExiste && ['APROVADO','PENDENTE'].includes(status) ? [{ id: 1 }] : [],
        rowCount: emailExiste && ['APROVADO','PENDENTE'].includes(status) ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO senha_recuperacoes')) {
      if (recuperacao && Date.now() - recuperacao.enviadoEm < 120000) return { rows: [], rowCount: 0 };
      recuperacao = { usuario_id: params[0], codigo_hash: params[1],
        expira_em: new Date(Date.now()+900000).toISOString(), tentativas: 0,
        enviadoEm: Date.now() };
      return { rows: [{ usuario_id: params[0] }], rowCount: 1 };
    }
    if (sql.includes('SELECT r.usuario_id, r.codigo_hash, r.expira_em, r.tentativas')) {
      const existe = !!recuperacao && emailExiste && params[0] === user.email && ['APROVADO','PENDENTE'].includes(status);
      return { rows: existe ? [recuperacao] : [], rowCount: existe ? 1 : 0 };
    }
    if (sql.includes('UPDATE senha_recuperacoes SET tentativas')) {
      if (recuperacao) recuperacao.tentativas++;
      return { rows: [], rowCount: recuperacao ? 1 : 0 };
    }
    if (sql.includes('DELETE FROM senha_recuperacoes')) {
      // Preserve a new code if a stale send fails.
      if (recuperacao && (!sql.includes('AND codigo_hash') || params[1] === recuperacao.codigo_hash)) recuperacao = null;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT senha_hash FROM usuarios WHERE id')) return { rows: [{ senha_hash: user.senha_hash }], rowCount: 1 };
    if (sql.includes('UPDATE usuarios SET senha_hash')) {
      if (sql.includes('AND senha_hash = $3') && user.senha_hash !== params[2]) return { rows: [], rowCount: 0 };
      user.senha_hash = params[0];
      user.token_version++;
      return { rows: [{ id: user.id }], rowCount: 1 };
    }
    if (sql.includes('SELECT * FROM usuarios WHERE LOWER(email)')) {
      return { rows: emailExiste ? [user] : [], rowCount: emailExiste ? 1 : 0 };
    }
    throw new Error('SQL inesperado: ' + sql);
  }
  const client = { query, release() {} };
  const pool = { query, async connect() { return client; } };
  const mocks = {
    express, cors: () => () => {}, pg: { Pool: function() { return pool; } },
    bcryptjs: { async compare(s, hash) { return hash === 'hashed:' + s; },
      async hash(s) { return 'hashed:' + s; }, async genSalt() { return ''; } },
    jsonwebtoken: { verify() { return { id: 1, token_version: 0 }; }, sign() { return 'mock-token'; } },
    dotenv: { config() {} }, 'node:crypto': crypto,
    'express-rate-limit': { rateLimit: () => (_req, _res, next) => next() },
  };
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8').replace(/iniciarServidor\(\);\s*$/, '');
  const environment = { JWT_SECRET: 'unit-tests-secret', RESEND_API_KEY: provedor ? 'mock-provider-key' : '',
    EMAIL_FROM: provedor ? 'Agenda ADP <nao-responda@exemplo.com>' : '' };
  vm.runInNewContext(source, {
    require: name => { if (!(name in mocks)) throw new Error('Dependência inesperada: ' + name); return mocks[name]; },
    process: { env: environment }, Buffer, Date, console: { error() {} },
    AbortSignal, async fetch(url, init) {
      assert.equal(url,'https://api.resend.com/emails');
      emails.push(JSON.parse(init.body));
      return { ok: true };
    },
  });

  return {
    user, emails, queries, get recuperacao() { return recuperacao; },
    setExpirado() { if (recuperacao) recuperacao.expira_em = new Date(Date.now()-1000).toISOString(); },
    get commit() { return commit; }, get rollback() { return rollback; },
    async call(method, url, body = {}, auth = 'Bearer token') {
      const route = routes.get(method + ' ' + url); assert.ok(route, 'Rota não existe: ' + url);
      const req = { headers: { authorization: auth }, body, params: {}, query: {} };
      const res = { code: 200, status(i) { this.code = i; return this; },
        json(d) { this.data = d; return this; }, set() { return this; } };
      let i = 0;
      async function next() { if (i < route.length) await route[i++](req,res,next); }
      await next();
      return res;
    },
  };
}

const senhaNova = 'NovaSenha456';
const pedir = (s, email = 'teste@exemplo.com') => s.call('post','/senha/solicitar-recuperacao',{ email });
const redefinir = (s,codigo,senha = senhaNova) =>
  s.call('post','/senha/redefinir',{ email: 'teste@exemplo.com', codigo, nova_senha: senha });

test('solicitar código de senha não revela se o e-mail existe', async () => {
  const existe = setup();
  const ausente = setup({ emailExiste: false });
  const a = await pedir(existe), b = await pedir(ausente);
  assert.equal(a.code, 202); assert.equal(b.code, 202);
  assert.equal(a.data.mensagem,b.data.mensagem);
  assert.equal(existe.emails.length,1);
  assert.equal(ausente.emails.length,0);
});

test('sem provedor configurado, recuperação não emite código', async () => {
  const s=setup({ provedor: false });
  const r=await pedir(s);
  assert.equal(r.code,503);
  assert.equal(s.queries.length,0);
});

test('código é gerado, guardado como hash e enviado sem log', async () => {
  const s=setup(); await pedir(s);
  const email=s.emails[0].text;
  const codigo=email.match(/\b\d{8}\b/)[0];
  assert.match(s.recuperacao.codigo_hash,/^[a-f0-9]{64}$/);
  assert.ok(!s.recuperacao.codigo_hash.includes(codigo));
  assert.equal(email.includes('15 minutos'),true);
});

test('não envia dois códigos para a mesma conta durante cooldown', async () => {
  const s=setup();
  await pedir(s); await pedir(s);
  assert.equal(s.emails.length,1);
});

test('código incorreto não altera senha e incrementa tentativas', async () => {
  const s=setup(); await pedir(s);
  const r=await redefinir(s,'00000000');
  assert.equal(r.code,400);
  assert.equal(s.recuperacao.tentativas,1);
  assert.equal(s.user.senha_hash,'hashed:SenhaAtual123');
});

test('após cinco erros, o código não pode ser utilizado', async () => {
  const s=setup(); await pedir(s);
  for (let i=0;i<5;i++) assert.equal((await redefinir(s,'00000000')).code,400);
  assert.equal((await redefinir(s,'00000000')).code,400);
  assert.equal(s.recuperacao,null);
});

test('código expirado não pode ser usado', async () => {
  const s=setup(); await pedir(s); s.setExpirado();
  const codigo=s.emails[0].text.match(/\b\d{8}\b/)[0];
  assert.equal((await redefinir(s,codigo)).code,400);
  assert.equal(s.user.token_version,0);
});

test('código válido redefine senha, revoga sessões e é de uso único', async () => {
  const s=setup(); await pedir(s);
  const codigo=s.emails[0].text.match(/\b\d{8}\b/)[0];
  const r=await redefinir(s,codigo);
  assert.equal(r.code,200); assert.equal(s.commit,true);
  assert.equal(s.user.senha_hash,'hashed:'+senhaNova);
  assert.equal(s.user.token_version,1);
  assert.equal(s.recuperacao,null);
  assert.equal((await redefinir(s,codigo)).code,400);
  assert.equal((await s.call('get','/sessao')).code,401);
});

test('alteração autenticada exige a senha atual e nova senha forte', async () => {
  const s=setup();
  assert.equal((await s.call('post','/senha/alterar',{ senha_atual:'errada',nova_senha:senhaNova })).code,403);
  assert.equal((await s.call('post','/senha/alterar',{ senha_atual:'SenhaAtual123',nova_senha:'fraca' })).code,400);
  assert.equal(s.user.token_version,0);
});

test('alteração autenticada troca senha e encerra sessões antigas', async () => {
  const s=setup();
  const r=await s.call('post','/senha/alterar',{ senha_atual:'SenhaAtual123',nova_senha:senhaNova });
  assert.equal(r.code,200);
  assert.equal(s.user.senha_hash,'hashed:'+senhaNova);
  assert.equal(s.user.token_version,1);
  assert.equal((await s.call('get','/sessao')).code,401);
});
