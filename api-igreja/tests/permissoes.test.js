const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(user = { id: 1, nivel_acesso: 'MEMBRO', status_conta: 'APROVADO', congregacao_id: 10 }) {
  const routes = new Map();
  const queries = [];
  const app = { use() {}, listen() {}, disable() {}, set() {} };
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (url, ...handlers) => routes.set(`${method} ${url}`, handlers);
  const express = Object.assign(() => app, { json: () => () => {} });
  let dbError = false;
  const pool = { async query(sql, values) {
    queries.push({ sql, values });
    if (dbError) throw new Error('DB offline');
    if (sql.includes('SELECT id, nivel_acesso')) return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    if (sql.includes('SELECT id, nome_completo')) return {rows: user ? [user] : [], rowCount: user ? 1 : 0};
    if (sql.includes('FROM usuarios WHERE LOWER(email)')) return { rows: user ? [{...user, senha_hash:'hash'}] : [] };
    return { rows: [], rowCount: 0 };
  } };
  const mocks = { express, cors: () => () => {}, pg: { Pool: function () { return pool; } },
    'express-rate-limit': { rateLimit: () => (_req, _res, next) => next() },
    bcryptjs: { compare: async () => true, genSalt: async () => 'salt', hash: async () => 'hash' }, dotenv: { config() {} },
    jsonwebtoken: { verify(token) { if (token === 'bad') throw new Error('Invalid'); return { id: 1, nivel_acesso: 'MASTER', status_conta: 'APROVADO' }; }, sign: () => 'token' } };
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8').replace(/iniciarServidor\(\);\s*$/, '');
  vm.runInNewContext(source, { require: name => { if (!(name in mocks)) throw new Error(name); return mocks[name]; }, process: { env: { JWT_SECRET: 'test-only' } }, console: { error() {} } });
  return { queries, failDB() { dbError = true; }, async call(method, url, body = {}, header = 'Bearer valid') {
    const req = { headers: { authorization: header }, body, params: { id: '2' }, query: {} };
    const res = { code: 200, headers: {}, set(k,v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(data) { this.data = data; return this; } };
    const handlers = routes.get(`${method} ${url}`); assert.ok(handlers);
    let i = 0; const next = async () => { if (i < handlers.length) await handlers[i++](req, res, next); };
    await next(); return res;
  } };
}
for (const [method, url] of [['get','/usuarios'], ['put','/usuarios/:id/status'], ['put','/usuarios/:id/nivel'], ['put','/usuarios/:id/congregacao'], ['post','/eventos'], ['put','/eventos/:id'], ['delete','/eventos/:id'], ['post','/mural'], ['delete','/mural/:id'], ['post','/gestao-datas/publicar']]) {
  test(`MEMBRO denied: ${method} ${url}, even with old MASTER token`, async () => {
    const s = setup(); assert.equal((await s.call(method,url)).code,403); assert.equal(s.queries.length,1);
  });
}
for (const status of ['BLOQUEADO','RECUSADO']) {
  test(`${status} denied on login and existing session`, async () => {
    const s = setup({ id:1, nivel_acesso:'MASTER', status_conta:status });
    assert.equal((await s.call('post','/login',{email:'a@b.com',senha:'valid'})).code,403);
    assert.equal((await s.call('get','/eventos')).code,403);
  });
}
test('Removed user and invalid/malformed tokens denied', async () => {
  assert.equal((await setup(null).call('get','/eventos')).code,401);
  for (const header of ['', 'Basic valid', 'Bearer bad','Bearer valid extra']) assert.equal((await setup().call('get','/eventos',{},header)).code,401);
});
test('DB failure is not an invalid-password error', async () => { const s=setup(); s.failDB(); assert.equal((await s.call('get','/eventos')).code,500); });
test('Pending ADMIN cannot manage users or create posts', async () => {
  const s=setup({id:1,nivel_acesso:'ADMIN',status_conta:'PENDENTE',congregacao_id:10});
  assert.equal((await s.call('get','/usuarios')).code,403);
  assert.equal((await s.call('post','/mural')).code,403);
});
test('Pending MASTER cannot use privileged routes', async () => {
  const s=setup({id:1,nivel_acesso:'MASTER',status_conta:'PENDENTE',congregacao_id:null});
  assert.equal((await s.call('get','/usuarios')).code,403);
  assert.equal((await s.call('get','/gestao-datas')).code,403);
});
test('Approved members can read agenda and log in', async () => {
  assert.equal((await setup().call('get','/eventos')).code,200);
  assert.equal((await setup().call('post','/login',{email:'a@b.com',senha:'valid'})).code,200);
});
test('Invalid login fields fail before querying DB', async () => {
  const s=setup(); assert.equal((await s.call('post','/login',{email:[],senha:{}})).code,400); assert.equal(s.queries.length,0);
});
test('Invalid registration is rejected before querying DB', async () => {
  const s=setup();
  const response=await s.call('post','/cadastro',{
    nome_completo:'A',email:'invalido',senha:'123',cpf:'1',telefone:'2',congregacao_id:0,
  });
  assert.equal(response.code,400); assert.equal(s.queries.length,0);
});
test('ADMIN status update uses congregation and member scope, with safe returning fields', async () => {
  const s=setup({id:1,nivel_acesso:'ADMIN',status_conta:'APROVADO',congregacao_id:10});
  assert.equal((await s.call('put','/usuarios/:id/status',{status_conta:'APROVADO'})).code,404);
  const update=s.queries.at(-1); assert.match(update.sql,/congregacao_id = \$4 AND nivel_acesso = 'MEMBRO'/);
  assert.equal(update.values[3],10); assert.doesNotMatch(update.sql,/RETURNING \*/);
});
test('MASTER validates roles and statuses', async () => {
  const s=setup({id:1,nivel_acesso:'MASTER',status_conta:'APROVADO'});
  assert.equal((await s.call('put','/usuarios/:id/status',{status_conta:'UNKNOWN'})).code,400);
  assert.equal((await s.call('put','/usuarios/:id/nivel',{nivel_acesso:'ROOT'})).code,400);
  assert.equal((await s.call('put','/usuarios/:id/nivel',{nivel_acesso:'ADMIN'})).code,404);
});
test('MASTER cannot change own status or demote self', async () => {
  const s=setup({id:2,nivel_acesso:'MASTER',status_conta:'APROVADO'});
  assert.equal((await s.call('put','/usuarios/:id/status',{status_conta:'BLOQUEADO'})).code,403);
  assert.equal((await s.call('put','/usuarios/:id/nivel',{nivel_acesso:'MEMBRO'})).code,403);
});
test('Approved ADMIN can list users; MASTER can list planning', async () => {
  assert.equal((await setup({id:1,nivel_acesso:'ADMIN',status_conta:'APROVADO',congregacao_id:10}).call('get','/usuarios')).code,200);
  assert.equal((await setup({id:1,nivel_acesso:'MASTER',status_conta:'APROVADO'}).call('get','/gestao-datas')).code,200);
});
test('Pending members retain agenda reading but cannot comment', async () => {
  const s=setup({id:1,nivel_acesso:'MEMBRO',status_conta:'PENDENTE'});
  assert.equal((await s.call('get','/eventos')).code,200);
  assert.equal((await s.call('post','/mural/:id/comentarios',{texto:'Teste'})).code,403);
});

test('Session endpoint returns current user and disallows caching', async () => {
  const s=setup(); const response=await s.call('get','/sessao');
  assert.equal(response.code,200); assert.equal(response.data.usuario.nivel_acesso,'MEMBRO');
  assert.equal(response.headers['Cache-Control'],'no-store');
  assert.doesNotMatch(s.queries.at(-1).sql,/senha_hash|SELECT \*/);
});
test('Blocked session returns machine-readable code', async () => {
  const s=setup({id:1,nivel_acesso:'MEMBRO',status_conta:'BLOQUEADO'});
  const response=await s.call('get','/sessao');
  assert.equal(response.code,403);assert.equal(response.data.codigo,'CONTA_SEM_ACESSO');
});
