
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

// Dados totalmente simulados.
// Este teste não acessa Neon, Render ou qualquer banco real.

function prepararAmbiente() {
  const routes = new Map();
  const queries = [];

  const app = {
    use() {},
    listen() {},
    disable() {},
    set() {},
  };

  for (const metodo of ['get', 'post', 'put', 'delete']) {
    app[metodo] = (rota, ...handlers) => {
      routes.set(`${metodo} ${rota}`, handlers);
    };
  }

  const express = Object.assign(
    () => app,
    { json: () => () => {} }
  );

  const eventoSimulado = {
    id: 10,
    titulo: 'Culto de Jovens',
    data_inicio: '2026-11-20',
    data_fim: '2026-11-20',
    horario: '19:00',
    duracao_minutos: 120,
    congregacao_id: 3,
    legenda: 'Encontro aberto à comunidade.',
    congregacao: 'Congregação Central',
  };

  const postSimulado = {
    id: 25,
    usuario_id: 99,
    congregacao_id: 3,
    titulo: 'Encontro Especial',
    descricao: 'Programação aberta ao público.',
    local: 'Congregação Central',
    tipo_midia: 'imagem',
    midia: 'https://example.test/imagem-publica.png',
    midia_embutida: false,
    data_inicio: '2026-11-20',
    data_fim: '2026-11-21',
    autor: 'Nome Pessoal Simulado',
    autor_foto: 'https://example.test/foto-pessoal.png',
    total_curtidas: '5',
  };

  const pool = {
    async query(sql, parametros = []) {
      queries.push({ sql, parametros });

      if (sql.includes('FROM mural_eventos m')) {
        return {
          rows: [postSimulado],
          rowCount: 1,
        };
      }

      if (sql.includes('FROM eventos e')) {
        return {
          rows: [eventoSimulado],
          rowCount: 1,
        };
      }

      return {
        rows: [],
        rowCount: 0,
      };
    },
  };

  const mocks = {
    express,
    cors: () => () => {},
    pg: {
      Pool: function () {
        return pool;
      },
    },
    'express-rate-limit': {
      rateLimit: () => (_req, _res, next) => next(),
    },
    bcryptjs: {
      compare: async () => true,
      genSalt: async () => 'salt',
      hash: async () => 'hash',
    },
    'node:crypto': crypto,
    dotenv: {
      config() {},
    },
    jsonwebtoken: {
      verify: () => ({ id: 1 }),
      sign: () => 'token',
    },
  };

  const codigo = fs
    .readFileSync(
      path.join(__dirname, '../server.js'),
      'utf8'
    )
    .replace(/iniciarServidor\(\);\s*$/, '');

  vm.runInNewContext(codigo, {
    require(nome) {
      if (!(nome in mocks)) {
        throw new Error(`Dependência inesperada: ${nome}`);
      }

      return mocks[nome];
    },
    process: {
      env: {
        JWT_SECRET: 'segredo-exclusivo-dos-testes',
      },
    },
    console: {
      error() {},
    },
    Buffer,
  });

  async function consultar(rota, query = {}) {
    const handlers = routes.get(`get ${rota}`);

    assert.ok(handlers, `Rota não encontrada: ${rota}`);

    const req = {
      headers: {},
      params: {},
      query,
      body: {},
    };

    const res = {
      code: 200,
      headers: {},
      set(chave, valor) {
        this.headers[chave] = valor;
        return this;
      },
      status(codigoStatus) {
        this.code = codigoStatus;
        return this;
      },
      json(dados) {
        this.data = dados;
        return this;
      },
    };

    let indice = 0;

    const next = async () => {
      if (indice < handlers.length) {
        await handlers[indice++](req, res, next);
      }
    };

    await next();
    return res;
  }

  return {
    consultar,
    queries,
  };
}

test('Agenda pública retorna os campos necessários', async () => {
  const ambiente = prepararAmbiente();

  const resposta = await ambiente.consultar(
    '/publico/eventos',
    { mes: '11', ano: '2026' }
  );

  assert.equal(resposta.code, 200);
  assert.equal(resposta.data.length, 1);
  assert.equal(resposta.data[0].titulo, 'Culto de Jovens');

  const consulta = ambiente.queries[0];

  assert.ok(consulta);
  assert.match(consulta.sql, /e\.id/);
  assert.doesNotMatch(consulta.sql, /SELECT\s+e\.\*/i);

  assert.equal(consulta.parametros[0], 11);
  assert.equal(consulta.parametros[1], 2026);
});

test('Agenda pública rejeita mês inválido', async () => {
  const ambiente = prepararAmbiente();

  const resposta = await ambiente.consultar(
    '/publico/eventos',
    { mes: '13', ano: '2026' }
  );

  assert.equal(resposta.code, 400);
  assert.equal(ambiente.queries.length, 0);
});

test('Mural público não divulga identidade pessoal', async () => {
  const ambiente = prepararAmbiente();

  const resposta = await ambiente.consultar('/publico/mural');

  assert.equal(resposta.code, 200);
  assert.equal(resposta.data.length, 1);

  const post = resposta.data[0];

  assert.equal(post.titulo, 'Encontro Especial');
  assert.equal(post.descricao, 'Programação aberta ao público.');

  // Identificação institucional para visitantes.
  assert.equal(post.autor, 'Equipe Agenda ADP');

  // Dados de identificação pessoal não devem ser enviados.
  assert.equal(
    Object.hasOwn(post, 'usuario_id'),
    false
  );

  assert.equal(
    Object.hasOwn(post, 'autor_foto'),
    false
  );

  assert.equal(
    Object.hasOwn(post, 'congregacao_id'),
    false
  );

  const json = JSON.stringify(post);

  assert.doesNotMatch(json, /Nome Pessoal Simulado/);
  assert.doesNotMatch(json, /foto-pessoal\.png/);
});

test('Mural público não consulta dados pessoais dos autores', async () => {
  const ambiente = prepararAmbiente();

  await ambiente.consultar('/publico/mural');

  const consulta = ambiente.queries[0];

  assert.ok(consulta);

  assert.doesNotMatch(
    consulta.sql,
    /u\.foto_perfil/i
  );

  assert.doesNotMatch(
    consulta.sql,
    /COALESCE\s*\(\s*u\.nome_exibicao/i
  );

  assert.doesNotMatch(
    consulta.sql,
    /m\.usuario_id/i
  );
});
