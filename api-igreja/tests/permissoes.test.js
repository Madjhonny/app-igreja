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
  const mocks = { './services/monitoring': require('../services/monitoring'), express, cors: () => () => {}, pg: { Pool: function () { return pool; } },
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

test('IDs inválidos são rejeitados antes de consultar posts, comentários ou perfis públicos', async () => {
  const master = { id: 1, nivel_acesso: 'MASTER', status_conta: 'APROVADO', congregacao_id: null };
  for (const [method, url] of [
    ['delete', '/mural/:id'],
    ['get', '/mural/:id/comentarios'],
    ['get', '/usuarios/:id/perfil-publico'],
  ]) {
    for (const id of ['invalido', '0', '-1', '1.5', '1e3', '1.0', '+2', ' 2', '2 ', '0x10', '2147483648', '02']) {
      const s = setup(master);
      const response = await s.call(method, url, {}, 'Bearer valid', id);
      assert.equal(response.code, 400, `${method} ${url} id=${id}`);
      assert.equal(s.queries.length, 1, `${method} ${url} não deve consultar recursos com ID inválido`);
    }
  }
});

test('IDs de rota com formato inválido não alcançam operações privilegiadas', async () => {
  const master = { id: 1, nivel_acesso: 'MASTER', status_conta: 'APROVADO', congregacao_id: null };
  const rotas = [
    ['delete', '/eventos/:id', {}],
    ['delete', '/comentarios/:id', {}],
    ['put', '/usuarios/:id/status', { status_conta: 'PENDENTE' }],
    ['put', '/usuarios/:id/nivel', { nivel_acesso: 'MEMBRO' }],
    ['put', '/usuarios/:id/congregacao', { congregacao_id: 10 }],
  ];
  for (const [method, url, body] of rotas) {
    for (const id of ['1e3', '1.0', '+2', '2147483648']) {
      const s = setup(master);
      const resposta = await s.call(method, url, body, 'Bearer valid', id);
      assert.equal(resposta.code, 400, `${method} ${url} id=${id}`);
      assert.equal(s.queries.length, 1, 'nenhuma operação adicional deve chegar ao banco');
    }
  }
});

test('IDs inválidos no corpo são rejeitados antes de consultar congregações ou criar eventos', async () => {
  const master = { id: 1, nivel_acesso: 'MASTER', status_conta: 'APROVADO', congregacao_id: null };
  for (const id of ['1e3', '1.0', '2147483648', true, [2], {}, 2147483648]) {
    const s = setup(master);
    const resposta = await s.call('put', '/usuarios/:id/congregacao', { congregacao_id: id });
    assert.equal(resposta.code, 400, `alterar congregação com ${JSON.stringify(id)}`);
    assert.equal(s.queries.length, 1, 'não deve consultar congregações com ID inválido');

    const t = setup(master);
    const evento = {
      titulo: 'Programação teste', data_inicio: '2026-11-15', data_fim: '2026-11-15',
      horario: '19:30', congregacao_id: id,
    };
    const retorno = await t.call('post', '/eventos', evento);
    assert.equal(retorno.code, 400, `criar evento com ${JSON.stringify(id)}`);
    assert.equal(t.queries.length, 1, 'não deve abrir transação com congregação inválida');
  }
});

test('IDs inteiros legítimos continuam aceitos no corpo e nas rotas', async () => {
  const master = { id: 1, nivel_acesso: 'MASTER', status_conta: 'APROVADO', congregacao_id: null };
  const s = setup(master);
  const leitura = await s.call('get', '/usuarios/:id/perfil-publico', {}, 'Bearer valid', '2');
  assert.equal(leitura.code, 200);
  assert.equal(s.queries.length, 2);

  for (const id of [2, '2']) {
    const t = setup(master);
    const resposta = await t.call('put', '/usuarios/:id/congregacao', { congregacao_id: id });
    // Com ID válido a consulta avança ao banco simulado e não acha congregação: 404, não 400.
    assert.equal(resposta.code, 404);
    assert.equal(t.queries.length, 2);
  }
});
test('convidado sem login pode consultar agenda e mural publicos', async () => {
  const s = setup(null);

  for (const rota of ['/publico/eventos', '/publico/mural']) {
    const resposta = await s.call('get', rota, {}, '');

    assert.equal(resposta.code, 200, rota);
    assert.ok(Array.isArray(resposta.data), rota);
  }
});
test('convidado sem login nao pode modificar informacoes protegidas', async () => {
  const s = setup(null);

  const rotasProtegidas = [
    ['post', '/eventos'],
    ['put', '/eventos/:id'],
    ['delete', '/eventos/:id'],
    ['post', '/mural'],
    ['delete', '/mural/:id'],
    ['post', '/mural/:id/curtir'],
    ['post', '/mural/:id/comentarios'],
    ['put', '/usuarios/perfil'],
    ['get', '/usuarios'],
    ['post', '/gestao-datas/publicar']
  ];

  for (const [metodo, rota] of rotasProtegidas) {
    const consultasAntes = s.queries.length;
    const resposta = await s.call(metodo, rota, {}, '');

    assert.equal(resposta.code, 401, `${metodo} ${rota}`);
    assert.equal(
      s.queries.length,
      consultasAntes,
      `Acesso sem login nao deve consultar o banco: ${rota}`
    );
  }
});


const rotasInteresses = [
  ['get', '/mural/interesses'],
  ['put', '/mural/:id/interesse'],
  ['delete', '/mural/:id/interesse']
];

for (const nivel of ['MASTER', 'ADMIN', 'MEMBRO']) {
  test(`Interesses: ${nivel} aprovado pode acessar as rotas`, async () => {
    const s = setup({
      id: 1,
      nivel_acesso: nivel,
      status_conta: 'APROVADO',
      congregacao_id: 10
    });

    for (const [method, url] of rotasInteresses) {
      const before = s.queries.length;
      const response = await s.call(method, url);

      assert.equal(response.code, method === 'put' ? 404 : 200);
      assert.equal(s.queries.length, before + 2);
      assert.equal(response.headers['Cache-Control'], 'no-store');
    }
  });
}

for (const nivel of ['MASTER', 'ADMIN', 'MEMBRO']) {
  for (const status of ['PENDENTE', 'BLOQUEADO', 'RECUSADO']) {
    test(`Interesses: ${nivel} ${status} nao pode acessar`, async () => {
      const s = setup({
        id: 1,
        nivel_acesso: nivel,
        status_conta: status,
        congregacao_id: 10
      });

      for (const [method, url] of rotasInteresses) {
        const before = s.queries.length;
        const response = await s.call(method, url);

        assert.equal(response.code, 403);
        assert.equal(s.queries.length, before + 1);
      }
    });
  }
}

test('Interesses: convidado nao acessa rotas privadas', async () => {
  const s = setup();

  for (const [method, url] of rotasInteresses) {
    const response = await s.call(method, url, {}, '');

    assert.equal(response.code, 401);
  }

  assert.equal(s.queries.length, 0);
});

test('Interesses: tokens invalidos sao rejeitados', async () => {
  const s = setup();

  for (const header of [
    'Bearer bad',
    'Basic valid',
    'Bearer valid extra'
  ]) {
    for (const [method, url] of rotasInteresses) {
      const response = await s.call(method, url, {}, header);

      assert.equal(response.code, 401);
    }
  }

  assert.equal(s.queries.length, 0);
});

test('Interesses: usuario removido nao acessa', async () => {
  const s = setup(null);

  for (const [method, url] of rotasInteresses) {
    const response = await s.call(method, url);

    assert.equal(response.code, 401);
  }
});

test('Interesses: identificadores invalidos sao rejeitados', async () => {
  const s = setup();

  for (const id of [
    '0', '-1', '1.5', '1e2', '02',
    '+2', ' 2', '0x10', 'abc', '2147483648'
  ]) {
    for (const method of ['put', 'delete']) {
      const before = s.queries.length;

      const response = await s.call(
        method,
        '/mural/:id/interesse',
        {},
        'Bearer valid',
        id
      );

      assert.equal(response.code, 400);
      assert.equal(s.queries.length, before + 1);
    }
  }
});

test('Interesses: consulta utiliza somente identidade autenticada', async () => {
  const s = setup();

  const response = await s.call(
    'get',
    '/mural/interesses',
    { usuario_id: 999 }
  );

  assert.equal(response.code, 200);
  assert.equal(response.data.post_ids.length, 0);

  const query = s.queries.at(-1);

  assert.match(query.sql, /i\.usuario_id = \$1/);
  assert.match(query.sql, /m\.data_fim >= CURRENT_DATE/);
  assert.equal(query.values.length, 1);
  assert.equal(query.values[0], 1);
});

test('Interesses: marcacao ignora identidade enviada pelo cliente', async () => {
  const s = setup();

  const response = await s.call(
    'put',
    '/mural/:id/interesse',
    { usuario_id: 999, post_id: 999 },
    'Bearer valid',
    '25'
  );

  assert.equal(response.code, 404);

  const query = s.queries.at(-1);

  assert.match(query.sql, /INSERT INTO mural_interesses/);
  assert.match(query.sql, /ON CONFLICT \(usuario_id, post_id\)/);
  assert.equal(query.values.length, 2);
  assert.equal(query.values[0], 1);
  assert.equal(query.values[1], 25);
});

test('Interesses: remocao restrita ao proprio usuario', async () => {
  const s = setup();

  const response = await s.call(
    'delete',
    '/mural/:id/interesse',
    { usuario_id: 999, post_id: 999 },
    'Bearer valid',
    '25'
  );

  assert.equal(response.code, 200);
  assert.equal(response.data.interesse, false);
  assert.equal(response.data.post_id, 25);

  const query = s.queries.at(-1);

  assert.match(query.sql, /DELETE FROM mural_interesses/);
  assert.match(query.sql, /usuario_id = \$1/);
  assert.match(query.sql, /post_id = \$2/);
  assert.equal(query.values[0], 1);
  assert.equal(query.values[1], 25);
});

test('Interesses: revogacao impede acesso com token antigo', async () => {
  const s = setup();

  assert.equal(
    (await s.call('get', '/mural/interesses')).code,
    200
  );

  s.setUser({
    id: 1,
    nivel_acesso: 'MEMBRO',
    status_conta: 'BLOQUEADO'
  });

  for (const [method, url] of rotasInteresses) {
    assert.equal((await s.call(method, url)).code, 403);
  }
});

test('Interesses: falha na validacao da sessao impede acesso', async () => {
  const s = setup();

  s.failDB();

  for (const [method, url] of rotasInteresses) {
    assert.equal((await s.call(method, url)).code, 500);
  }
});
