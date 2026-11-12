const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');

function setup(
  user = { id: 1, nivel_acesso: 'MEMBRO', status_conta: 'APROVADO', congregacao_id: 10 },
  { statusTarget = null, commentTarget = null } = {}
) {
  const routes = new Map();
  const queries = [];
  const app = { use() {}, listen() {}, disable() {}, set() {} };
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (url, ...handlers) => routes.set(`${method} ${url}`, handlers);
  const express = Object.assign(() => app, { json: () => () => {} });
  let dbError = false;
  let currentUser = user;
  const pool = { async query(sql, values) {
    queries.push({ sql, values });
    if (dbError) throw new Error('DB offline');
    if (sql.includes('SELECT id, nivel_acesso')) return { rows: currentUser ? [currentUser] : [], rowCount: currentUser ? 1 : 0 };
    if (sql.includes('SELECT id, nome_completo')) return {rows: currentUser ? [currentUser] : [], rowCount: currentUser ? 1 : 0};
    if (sql.includes('FROM usuarios WHERE LOWER(email)')) return { rows: currentUser ? [{...currentUser, senha_hash:'hash'}] : [] };
    if (sql.includes('SELECT usuario_id FROM mural_comentarios WHERE id = $1')) {
      const comentario = commentTarget && String(commentTarget.id) === String(values[0]) ? commentTarget : null;
      return { rows: comentario ? [comentario] : [], rowCount: comentario ? 1 : 0 };
    }
    if (sql.includes('DELETE FROM mural_comentarios WHERE id = $1 RETURNING id')) {
      const apagado = commentTarget && String(commentTarget.id) === String(values[0]) ? commentTarget : null;
      return { rows: apagado ? [{ id: apagado.id }] : [], rowCount: apagado ? 1 : 0 };
    }
    if (sql.includes('SELECT id, COALESCE(nome_exibicao')) {
      return { rows: currentUser ? [currentUser] : [], rowCount: currentUser ? 1 : 0 };
    }
    if (sql.includes('UPDATE usuarios SET status_conta')) {
      const [status_conta, id, nivelSolicitante, congregacaoSolicitante] = values;
      const alvoPermitido = statusTarget && String(statusTarget.id) === String(id) &&
        (nivelSolicitante === 'MASTER' ||
          (statusTarget.congregacao_id === congregacaoSolicitante && statusTarget.nivel_acesso === 'MEMBRO'));
      const atualizado = alvoPermitido ? { ...statusTarget, status_conta } : null;
      return { rows: atualizado ? [atualizado] : [], rowCount: atualizado ? 1 : 0 };
    }
    if (sql.includes('SET nome_exibicao = $1')) {
      const atualizado = currentUser ? {
        ...currentUser,
        nome_exibicao: values[0],
        bio: values[1],
        foto_perfil: values[2],
      } : null;
      return { rows: atualizado ? [atualizado] : [], rowCount: atualizado ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  } };
  const mocks = { express, cors: () => () => {}, pg: { Pool: function () { return pool; } },
    'express-rate-limit': { rateLimit: () => (_req, _res, next) => next() },
    bcryptjs: { compare: async () => true, genSalt: async () => 'salt', hash: async () => 'hash' }, 'node:crypto': crypto, dotenv: { config() {} },
    jsonwebtoken: { verify(token) { if (token === 'bad') throw new Error('Invalid'); return { id: 1, nivel_acesso: 'MASTER', status_conta: 'APROVADO' }; }, sign: () => 'token' } };
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8').replace(/iniciarServidor\(\);\s*$/, '');
  vm.runInNewContext(source, { require: name => { if (!(name in mocks)) throw new Error(name); return mocks[name]; }, process: { env: { JWT_SECRET: 'test-only' } }, console: { error() {} }, Buffer });
  return { queries, failDB() { dbError = true; }, setUser(nextUser) { currentUser = nextUser; }, async call(method, url, body = {}, header = 'Bearer valid', paramId = '2') {
    const req = { headers: { authorization: header }, body, params: { id: paramId }, query: {} };
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
  for (const [method, url] of [
    ['get','/usuarios'], ['put','/usuarios/:id/status'],
    ['post','/eventos'], ['put','/eventos/:id'], ['delete','/eventos/:id'],
    ['post','/mural'], ['delete','/mural/:id'],
  ]) {
    const queriesBefore = s.queries.length;
    assert.equal((await s.call(method,url)).code,403, `${method} ${url}`);
    assert.equal(s.queries.length, queriesBefore + 1, `${method} ${url} must stop after session validation`);
  }
});
test('Pending MASTER cannot use privileged routes', async () => {
  const s=setup({id:1,nivel_acesso:'MASTER',status_conta:'PENDENTE',congregacao_id:null});
  for (const [method, url] of [
    ['get','/usuarios'], ['put','/usuarios/:id/status'],
    ['post','/eventos'], ['put','/eventos/:id'], ['delete','/eventos/:id'],
    ['post','/mural'], ['delete','/mural/:id'],
    ['put','/usuarios/:id/nivel'], ['put','/usuarios/:id/congregacao'],
    ['get','/gestao-datas'], ['post','/gestao-datas'],
    ['put','/gestao-datas/:id/marcador'], ['delete','/gestao-datas/:id'],
    ['post','/gestao-datas/publicar'],
  ]) {
    const queriesBefore = s.queries.length;
    assert.equal((await s.call(method,url)).code,403, `${method} ${url}`);
    assert.equal(s.queries.length, queriesBefore + 1, `${method} ${url} must stop after session validation`);
  }
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
test('Pending members can read guest content and update only their own profile', async () => {
  const pendente={id:1,nome_completo:'Convidado',nivel_acesso:'MEMBRO',status_conta:'PENDENTE',congregacao_id:10};
  const s=setup(pendente);
  for (const [method, url, body] of [
    ['get','/sessao'],
    ['get','/congregacoes'],
    ['get','/eventos'],
    ['get','/mural'],
    ['get','/mural/:id/comentarios'],
    ['get','/usuarios/:id/perfil-publico'],
    ['put','/usuarios/perfil',{nome_exibicao:'Convidado ADP',bio:'Aguardando aprovação',foto_perfil:null}],
  ]) {
    assert.equal((await s.call(method,url,body)).code,200, `${method} ${url}`);
  }
});

test('Pending members cannot like, comment, like comments, or delete comments', async () => {
  const s=setup({id:1,nivel_acesso:'MEMBRO',status_conta:'PENDENTE',congregacao_id:10});
  for (const [method, url, body] of [
    ['post','/mural/:id/curtir'],
    ['post','/mural/:id/comentarios',{texto:'Teste'}],
    ['post','/comentarios/:id/curtir'],
    ['delete','/comentarios/:id'],
  ]) {
    const queriesBefore = s.queries.length;
    assert.equal((await s.call(method,url,body)).code,403, `${method} ${url}`);
    assert.equal(s.queries.length, queriesBefore + 1, `${method} ${url} must not reach a mutation query`);
  }
});

test('MEMBRO aprovado pode excluir apenas o próprio comentário', async () => {
  const autor = { id:1, nivel_acesso:'MEMBRO', status_conta:'APROVADO', congregacao_id:10 };
  const s = setup(autor, { commentTarget: { id:2, usuario_id:1 } });
  const response = await s.call('delete','/comentarios/:id');
  assert.equal(response.code, 200);
  assert.match(s.queries.at(-1).sql, /DELETE FROM mural_comentarios WHERE id = \$1 RETURNING id/);
  assert.doesNotMatch(s.queries.at(-1).sql, /parent_id = \$1/);
});

test('MEMBRO não pode excluir comentário escrito por outra pessoa', async () => {
  const membro = { id:1, nivel_acesso:'MEMBRO', status_conta:'APROVADO', congregacao_id:10 };
  const s = setup(membro, { commentTarget: { id:2, usuario_id:55 } });
  const response = await s.call('delete','/comentarios/:id');
  assert.equal(response.code,403);
  assert.ok(!s.queries.some(q => q.sql.includes('DELETE FROM mural_comentarios')));
});

test('ADMIN aprovado pode moderar comentário de qualquer congregação', async () => {
  const admin = { id:1, nivel_acesso:'ADMIN', status_conta:'APROVADO', congregacao_id:10 };
  const s = setup(admin, { commentTarget: { id:2, usuario_id:55, post_congregacao_id:77 } });
  const response = await s.call('delete','/comentarios/:id');
  assert.equal(response.code,200);
  assert.ok(s.queries.some(q => q.sql.includes('DELETE FROM mural_comentarios')));
});

test('MASTER aprovado pode moderar qualquer comentário', async () => {
  const master = { id:1, nivel_acesso:'MASTER', status_conta:'APROVADO', congregacao_id:null };
  const s = setup(master, { commentTarget: { id:2, usuario_id:55 } });
  assert.equal((await s.call('delete','/comentarios/:id')).code,200);
});

test('conta pendente não pode excluir nem seu próprio comentário', async () => {
  const pendente = { id:1, nivel_acesso:'MEMBRO', status_conta:'PENDENTE', congregacao_id:10 };
  const s = setup(pendente, { commentTarget: { id:2, usuario_id:1 } });
  assert.equal((await s.call('delete','/comentarios/:id')).code,403);
  assert.equal(s.queries.length,1);
});

test('comentário inexistente retorna 404 e não executa DELETE', async () => {
  const admin = { id:1, nivel_acesso:'ADMIN', status_conta:'APROVADO', congregacao_id:10 };
  const s = setup(admin);
  const response = await s.call('delete','/comentarios/:id');
  assert.equal(response.code,404);
  assert.ok(!s.queries.some(q => q.sql.includes('DELETE FROM mural_comentarios')));
});

test('identificador de comentário inválido retorna 400 antes da consulta de comentário', async () => {
  const s = setup({id:1,nivel_acesso:'MASTER',status_conta:'APROVADO',congregacao_id:null});
  const response = await s.call('delete','/comentarios/:id',{},'Bearer valid','invalido');
  assert.equal(response.code,400);
  assert.equal(s.queries.length,1);
});

test('Pending members can log in without being promoted', async () => {
  const pendente={id:1,nome_completo:'Convidado',email:'convidado@example.com',nivel_acesso:'MEMBRO',status_conta:'PENDENTE',congregacao_id:10};
  const response=await setup(pendente).call('post','/login',{email:pendente.email,senha:'senha-segura'});
  assert.equal(response.code,200);
  assert.equal(response.data.usuario.status_conta,'PENDENTE');
  assert.equal(response.data.usuario.nivel_acesso,'MEMBRO');
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

test('Session refresh reflects approval from the database without a new token', async () => {
  const pendente={id:1,nivel_acesso:'MEMBRO',status_conta:'PENDENTE',congregacao_id:10};
  const s=setup(pendente);
  assert.equal((await s.call('get','/sessao')).data.usuario.status_conta,'PENDENTE');
  s.setUser({...pendente,status_conta:'APROVADO'});
  assert.equal((await s.call('get','/sessao')).data.usuario.status_conta,'APROVADO');
});

test('Approved ADMIN can approve a pending member from the same congregation', async () => {
  const admin={id:1,nivel_acesso:'ADMIN',status_conta:'APROVADO',congregacao_id:10};
  const alvo={id:2,nome_completo:'Novo membro',nivel_acesso:'MEMBRO',status_conta:'PENDENTE',congregacao_id:10};
  const s=setup(admin,{statusTarget:alvo});
  const response=await s.call('put','/usuarios/:id/status',{status_conta:'APROVADO'});
  assert.equal(response.code,200);
  assert.equal(response.data.usuario.status_conta,'APROVADO');
  assert.equal(response.data.usuario.nivel_acesso,'MEMBRO');
  assert.equal(response.data.usuario.congregacao_id,10);
});

test('Approved ADMIN cannot approve accounts outside its permitted scope', async () => {
  const admin={id:1,nivel_acesso:'ADMIN',status_conta:'APROVADO',congregacao_id:10};
  for (const alvo of [
    {id:2,nivel_acesso:'MEMBRO',status_conta:'PENDENTE',congregacao_id:20},
    {id:2,nivel_acesso:'ADMIN',status_conta:'PENDENTE',congregacao_id:10},
  ]) {
    const response=await setup(admin,{statusTarget:alvo}).call('put','/usuarios/:id/status',{status_conta:'APROVADO'});
    assert.equal(response.code,404);
  }
});
