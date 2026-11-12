const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');

const bytes = Buffer.from('conteudo-imagem-de-teste');
const imagem = 'data:image/png;base64,' + bytes.toString('base64');
const usuario = { id: 1, nivel_acesso: 'MEMBRO', status_conta: 'APROVADO', congregacao_id: 10, token_version: 0 };

function setup({ imagemExiste = true } = {}) {
  const routes = new Map();
  const queries = [];
  const app = { use() {}, listen() {}, disable() {}, set() {} };
  for (const method of ['get', 'post', 'put', 'delete']) {
    app[method] = (url, ...handlers) => routes.set(method + ' ' + url, handlers);
  }
  const express = Object.assign(() => app, { json: () => () => {} });
  const posts = [
    { id: 21, usuario_id: 1, congregacao_id: 10, autor: 'Teste', autor_foto: null,
      titulo: 'Post de teste', descricao: 'Teste de imagem', local: 'Maricá',
      data_inicio: '2026-11-11', data_fim: '2026-11-20', tipo_midia: 'imagem',
      midia: imagem, total_curtidas: 0, curtiu_por_mim: false },
    { id: 22, usuario_id: 1, congregacao_id: 10, autor: 'Teste', autor_foto: null,
      titulo: 'Link externo', descricao: null, local: null,
      data_inicio: '2026-11-11', data_fim: '2026-11-20', tipo_midia: 'imagem',
      midia: 'https://imagens.example.org/teste.webp', total_curtidas: 0, curtiu_por_mim: false },
  ];
  const pool = { async query(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('SELECT id, nivel_acesso, status_conta')) return { rows: [usuario], rowCount: 1 };
    if (sql.includes('FROM mural_eventos m')) {
      const modoLeve = sql.includes('midia_embutida');
      const rows = posts.map(post => ({
        ...post,
        midia: modoLeve && post.midia.startsWith('data:') ? null : post.midia,
        ...(modoLeve ? { midia_embutida: post.midia.startsWith('data:') } : {}),
      }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('SELECT tipo_midia, midia FROM mural_eventos WHERE id')) {
      const post = posts.find(p => p.id === Number(values[0]));
      const rows = imagemExiste && post ? [{ midia: post.midia, tipo_midia: post.tipo_midia }] : [];
      return { rows, rowCount: rows.length };
    }
    throw new Error('Consulta inesperada: ' + sql);
  } };
  const mocks = {
    express, cors: () => () => {}, pg: { Pool: function () { return pool; } },
    bcryptjs: { compare: async () => true, hash: async () => '', genSalt: async () => '' },
    dotenv: { config() {} }, 'node:crypto': crypto,
    'express-rate-limit': { rateLimit: () => (_req, _res, next) => next() },
    jsonwebtoken: { verify: () => ({ id: 1, token_version: 0 }), sign: () => 'token' },
  };
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
    .replace(/iniciarServidor\(\);\s*$/, '');
  vm.runInNewContext(source, {
    require(name) { if (!(name in mocks)) throw new Error('Dependência inesperada: ' + name); return mocks[name]; },
    process: { env: { JWT_SECRET: 'mural-imagens-chave-de-teste' } },
    Buffer, Date, console: { error() {} },
  });

  async function call(route, { query = {}, params = {}, auth = 'Bearer valido' } = {}) {
    const [method, url] = route.split(' ');
    const handlers = routes.get(method + ' ' + url);
    assert.ok(handlers, 'Rota não encontrada: ' + route);
    const req = { headers: { authorization: auth }, query, params, body: {} };
    const res = {
      code: 200, headers: {},
      set(header, value) { this.headers[header] = value; return this; },
      status(code) { this.code = code; return this; },
      json(value) { this.data = value; return this; },
      send(value) { this.data = value; return this; },
    };
    let i = 0;
    const next = async () => { if (i < handlers.length) await handlers[i++](req, res, next); };
    await next();
    return res;
  }
  return { call, queries };
}

function partesUrl(uri) {
  const parsed = new URL(uri, 'https://api.exemplo.test');
  return {
    params: { id: parsed.pathname.split('/')[2] },
    query: { exp: parsed.searchParams.get('exp'), sig: parsed.searchParams.get('sig') },
  };
}

test('cliente legado continua recebendo imagens em Base64', async () => {
  const { call } = setup();
  const r = await call('get /mural');
  assert.equal(r.code, 200);
  assert.equal(r.data[0].midia, imagem);
  assert.equal(r.data[1].midia, 'https://imagens.example.org/teste.webp');
});

test('modo leve devolve URL assinada para Base64 sem carregar os bytes na listagem', async () => {
  const s = setup();
  const r = await s.call('get /mural', { query: { midia: 'link' } });
  assert.equal(r.code, 200);
  assert.match(r.data[0].midia, /^\/mural\/21\/imagem\?exp=\d{10}&sig=[0-9a-f]{64}$/);
  assert.equal(r.data[1].midia, 'https://imagens.example.org/teste.webp');
  assert.equal(r.data[0].totalCurtidas, 0);
  assert.equal(r.headers['Cache-Control'], 'private, no-store');
  const consulta = s.queries.find(q => q.sql.includes('FROM mural_eventos m'));
  assert.match(consulta.sql, /midia_embutida/);
  assert.doesNotMatch(consulta.sql, /SELECT m\.\*/);
});

test('link válido serve a imagem binária com tipo MIME e cache privativo', async () => {
  const s = setup();
  const feed = await s.call('get /mural', { query: { midia: 'link' } });
  const r = await s.call('get /mural/:id/imagem', partesUrl(feed.data[0].midia));
  assert.equal(r.code, 200);
  assert.equal(r.headers['Content-Type'], 'image/png');
  assert.match(r.headers['Cache-Control'], /^private, max-age=\d+$/);
  assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
  assert.deepEqual(r.data, bytes);
});

test('imagem só pode ser acessada com link válido e sem adulteração do id', async () => {
  const s = setup();
  const feed = await s.call('get /mural', { query: { midia: 'link' } });
  const params = partesUrl(feed.data[0].midia);
  assert.equal((await s.call('get /mural/:id/imagem', { params: { id: '22' }, query: params.query })).code, 403);
  assert.equal((await s.call('get /mural/:id/imagem', { params: params.params, query: { ...params.query, sig: '0'.repeat(64) } })).code, 403);
  assert.equal((await s.call('get /mural/:id/imagem', { params: params.params, query: { ...params.query, exp: '1000000000' } })).code, 403);
  assert.equal((await s.call('get /mural/:id/imagem', { params: params.params, query: {} })).code, 403);
  assert.equal(s.queries.filter(q => q.sql.includes('SELECT tipo_midia, midia FROM mural_eventos')).length, 0);
});

test('imagem excluída não pode ser servida mesmo com link assinado', async () => {
  const s = setup({ imagemExiste: false });
  const feed = await s.call('get /mural', { query: { midia: 'link' } });
  const r = await s.call('get /mural/:id/imagem', partesUrl(feed.data[0].midia));
  assert.equal(r.code, 404);
});

test('uma URL externa nunca é usada como proxy do banco de dados', async () => {
  const s = setup();
  const feed = await s.call('get /mural', { query: { midia: 'link' } });
  const r = await s.call('get /mural/:id/imagem', {
    params: { id: '22' }, query: partesUrl(feed.data[0].midia).query,
  });
  assert.equal(r.code, 403);
});
