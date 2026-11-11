const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const master = { id: 1, nivel_acesso: 'MASTER', status_conta: 'APROVADO', congregacao_id: null };
const admin = { id: 1, nivel_acesso: 'ADMIN', status_conta: 'APROVADO', congregacao_id: 10 };

const draft = (id, date = '2026-11-15', time = '19:30', marker = 'NORMAL') => ({
  id, titulo: 'Rascunho ' + id, data_inicio: date, data_fim: date,
  horario: time, duracao_minutos: 60, congregacao_id: 10, marcador: marker,
  legenda: null,
});
const published = (id, date = '2026-11-15', time = '19:30') => ({
  id, titulo: 'Publicado ' + id, data_inicio: date, data_fim: date,
  horario: time, duracao_minutos: 60, congregacao_id: 10,
});
const input = {
  titulo: 'Nova programação', data_inicio: '2026-11-15', data_fim: '2026-11-15',
  horario: '19:30', congregacao_id: 10,
};

function setup({ user = master, drafts = [], existing = [], failInsert = false } = {}) {
  const routes = new Map();
  const queries = [];
  let committed = false;
  let rolledBack = false;
  let released = 0;
  let insertCount = 0;
  const app = { use() {}, listen() {}, disable() {}, set() {} };
  for (const method of ['get', 'post', 'put', 'delete']) {
    app[method] = (route, ...handlers) => routes.set(method + ' ' + route, handlers);
  }
  const express = Object.assign(() => app, { json: () => () => {} });

  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql === 'BEGIN') return { rows: [], rowCount: 0 };
      if (sql === 'ROLLBACK') { rolledBack = true; return { rows: [], rowCount: 0 }; }
      if (sql === 'COMMIT') { committed = true; return { rows: [], rowCount: 0 }; }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.includes('FROM gestao_datas_rascunho') && sql.includes('FOR UPDATE')) {
        return { rows: drafts, rowCount: drafts.length };
      }
      if (sql.includes('FROM eventos') && sql.includes('ANY($1::integer[])')) {
        return { rows: existing, rowCount: existing.length };
      }
      if (sql.includes('FROM eventos') && sql.includes('EXTRACT(EPOCH')) {
        return { rows: existing, rowCount: existing.length };
      }
      if (sql.includes('FROM eventos WHERE id = $1 FOR UPDATE')) {
        return { rows: [published(Number(params[0]))], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO eventos')) {
        if (failInsert) throw Error('Simulação de erro de banco');
        insertCount++;
        return { rows: [{ id: insertCount, ...input }], rowCount: 1 };
      }
      if (sql.includes('UPDATE eventos')) {
        return { rows: [{ id: 2, ...input }], rowCount: 1 };
      }
      if (sql.includes('UPDATE gestao_datas_rascunho SET publicado')) {
        return { rows: [], rowCount: drafts.length };
      }
      throw new Error('Consulta inesperada: ' + sql);
    },
    release() { released++; },
  };
  const pool = {
    async connect() { return client; },
    async query(sql) {
      if (sql.includes('SELECT id, nivel_acesso, status_conta')) {
        return { rows: [user], rowCount: 1 };
      }
      throw new Error('Consulta externa inesperada: ' + sql);
    },
  };
  const mocks = {
    express,
    cors: () => () => {},
    pg: { Pool: function () { return pool; } },
    'express-rate-limit': { rateLimit: () => (_req, _res, next) => next() },
    bcryptjs: { compare: async () => true, genSalt: async () => '', hash: async () => '' },
    dotenv: { config() {} },
    jsonwebtoken: { verify: () => ({ id: 1 }), sign: () => 'token' },
  };
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
    .replace(/iniciarServidor\(\);\s*$/, '');
  vm.runInNewContext(source, {
    require: name => {
      if (!(name in mocks)) throw new Error(name);
      return mocks[name];
    },
    process: { env: { JWT_SECRET: 'test-only' } },
    console: { error() {} },
  });

  return {
    queries,
    get inserts() { return insertCount; },
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    get released() { return released; },
    async call(method, url, body = {}) {
      const req = { headers: { authorization: 'Bearer valid' }, body,
        params: { id: '2' }, query: {} };
      const res = {
        code: 200,
        status(code) { this.code = code; return this; },
        json(data) { this.data = data; return this; },
      };
      const handlers = routes.get(method + ' ' + url);
      assert.ok(handlers, 'Rota não encontrada: ' + method + ' ' + url);
      let index = 0;
      const next = async () => {
        if (index < handlers.length) await handlers[index++](req, res, next);
      };
      await next();
      return res;
    },
  };
}

test('publicação exige autorização do MASTER quando dois rascunhos se sobrepõem', async () => {
  const db = setup({ drafts: [draft(10), draft(11, '2026-11-15', '20:00')] });
  const res = await db.call('post', '/gestao-datas/publicar');
  assert.equal(res.code, 409);
  assert.equal(res.data.codigo, 'CONFIRMACAO_CONFLITOS_NECESSARIA');
  assert.equal(res.data.resumo.eventosEmConflito, 2);
  assert.equal(db.inserts, 0);
  assert.equal(db.committed, false);
  assert.equal(db.rolledBack, true);
  assert.equal(db.released, 1);
});

test('publicação detecta conflitos novos com eventos publicados', async () => {
  const db = setup({ drafts: [draft(10)], existing: [published(100)] });
  const res = await db.call('post', '/gestao-datas/publicar');
  assert.equal(res.code, 409);
  assert.equal(res.data.resumo.sobreposicoesEncontradas, 1);
  assert.equal(res.data.conflitos[0].origem, 'AGENDA PUBLICADA');
  assert.equal(db.inserts, 0);
});

test('avisos manuais REVISAR e CONFLITO também exigem confirmação', async () => {
  for (const marker of ['REVISAR', 'CONFLITO']) {
    const db = setup({ drafts: [draft(10, '2026-11-15', '19:30', marker)] });
    const res = await db.call('post', '/gestao-datas/publicar');
    assert.equal(res.code, 409);
    assert.equal(res.data.resumo[marker === 'REVISAR' ? 'revisar' : 'marcadosConflito'], 1);
  }
});

test('MASTER pode confirmar excepcionalmente e publicação registra somente IDs bloqueados', async () => {
  const db = setup({ drafts: [draft(10), draft(11, '2026-11-15', '20:00')] });
  const res = await db.call('post', '/gestao-datas/publicar', { confirmar_conflitos: true });
  assert.equal(res.code, 200);
  assert.equal(res.data.quantidadePublicada, 2);
  assert.equal(res.data.confirmacaoExcepcional, true);
  assert.equal(db.inserts, 2);
  assert.equal(db.committed, true);
  assert.equal(db.released, 1);
  const update = db.queries.find(x => x.sql.includes('UPDATE gestao_datas_rascunho SET publicado'));
  assert.ok(update);
  assert.match(update.sql, /id = ANY\(\$2::integer\[\]\)/);
  assert.equal(update.params[1].join(','), '10,11');
});

test('publicação sem conflito não exige confirmação excepcional', async () => {
  const db = setup({ drafts: [draft(10), draft(11, '2026-11-15', '20:30')] });
  const res = await db.call('post', '/gestao-datas/publicar');
  assert.equal(res.code, 200);
  assert.equal(db.inserts, 2);
  assert.equal(db.committed, true);
});

test('não publica nada quando não existem rascunhos pendentes', async () => {
  const db = setup();
  const res = await db.call('post', '/gestao-datas/publicar');
  assert.equal(res.code, 400);
  assert.equal(db.inserts, 0);
  assert.equal(db.rolledBack, true);
});

test('falha no INSERT reverte toda a publicação em lote', async () => {
  const db = setup({ drafts: [draft(10)], failInsert: true });
  const res = await db.call('post', '/gestao-datas/publicar');
  assert.equal(res.code, 500);
  assert.equal(db.rolledBack, true);
  assert.equal(db.committed, false);
  assert.equal(db.released, 1);
});

test('criação direta bloqueia evento conflitante para ADMIN mesmo com confirmação', async () => {
  const db = setup({ user: admin, existing: [published(12)] });
  const res = await db.call('post', '/eventos', { ...input, confirmar_conflito: true });
  assert.equal(res.code, 409);
  assert.equal(res.data.codigo, 'CONFLITO_AGENDA');
  assert.equal(res.data.podeConfirmar, false);
  assert.equal(db.inserts, 0);
});

test('criação direta do MASTER exige confirmação de conflito', async () => {
  const db = setup({ existing: [published(12)] });
  const res = await db.call('post', '/eventos', input);
  assert.equal(res.code, 409);
  assert.equal(res.data.podeConfirmar, true);
  assert.equal(db.inserts, 0);
});

test('MASTER pode confirmar criação de evento direto conflitante', async () => {
  const db = setup({ existing: [published(12)] });
  const res = await db.call('post', '/eventos', { ...input, confirmar_conflito: true });
  assert.equal(res.code, 201);
  assert.equal(db.committed, true);
  assert.equal(db.inserts, 1);
});

test('edição direta não trata o próprio evento como conflito', async () => {
  const db = setup();
  const res = await db.call('put', '/eventos/:id', input);
  assert.equal(res.code, 200);
  const query = db.queries.find(x => x.sql.includes('EXTRACT(EPOCH'));
  assert.equal(query.params[5], 2);
  assert.equal(db.committed, true);
});

test('edição direta rejeita sobreposição com outro evento', async () => {
  const db = setup({ existing: [published(12)] });
  const res = await db.call('put', '/eventos/:id', input);
  assert.equal(res.code, 409);
  assert.equal(db.committed, false);
  assert.equal(db.rolledBack, true);
});
