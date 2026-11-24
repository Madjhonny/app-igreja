import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  criarRequisicaoInteresses
} from '../services/mural-interesses-session.ts';

function diferido() {
  let resolve;
  const promise = new Promise(r => {
    resolve = r;
  });

  return { promise, resolve };
}

function criar() {
  let token = 'token-conta-a';
  const chamadas = [];

  const requisitar = criarRequisicaoInteresses(token, {
    obterToken: async () => token,
    requisitar: async (path, init) => {
      chamadas.push({ path, init });
      return new Response('{}', { status: 200 });
    },
  });

  return {
    requisitar,
    chamadas,
    trocarToken: valor => {
      token = valor;
    },
  };
}

test('utiliza exclusivamente o token da sessao original', async () => {
  const c = criar();

  await c.requisitar('/mural/interesses');

  assert.equal(
    c.chamadas[0].init.headers.get('Authorization'),
    'Bearer token-conta-a'
  );
});

test('consulta privada nao utiliza cache nem cookies', async () => {
  const c = criar();

  await c.requisitar('/mural/interesses');

  assert.equal(c.chamadas[0].init.cache, 'no-store');
  assert.equal(c.chamadas[0].init.credentials, 'omit');
});

test('preserva headers adicionais', async () => {
  const c = criar();

  await c.requisitar('/mural/interesses', {
    headers: { Accept: 'application/json' }
  });

  assert.equal(
    c.chamadas[0].init.headers.get('Accept'),
    'application/json'
  );
});

test('ignora token fornecido externamente nos headers', async () => {
  const c = criar();

  await c.requisitar('/mural/interesses', {
    headers: { Authorization: 'Bearer outra-conta' }
  });

  assert.equal(
    c.chamadas[0].init.headers.get('Authorization'),
    'Bearer token-conta-a'
  );
});

test('impede consulta apos troca de conta', async () => {
  const c = criar();

  c.trocarToken('token-conta-b');

  await assert.rejects(
    c.requisitar('/mural/interesses'),
    /SESSAO_ALTERADA/
  );

  assert.equal(c.chamadas.length, 0);
});

test('impede mutacao apos troca de conta', async () => {
  const c = criar();

  c.trocarToken('token-conta-b');

  await assert.rejects(
    c.requisitar('/mural/1/interesse', {
      method: 'PUT'
    }),
    /SESSAO_ALTERADA/
  );

  assert.equal(c.chamadas.length, 0);
});

test('impede requisicao apos logout', async () => {
  const c = criar();

  c.trocarToken(null);

  await assert.rejects(
    c.requisitar('/mural/interesses'),
    /SESSAO_ALTERADA/
  );

  assert.equal(c.chamadas.length, 0);
});

test('descarta resposta recebida apos troca de conta', async () => {
  let token = 'token-conta-a';

  const espera = diferido();
  const iniciou = diferido();

  const requisitar = criarRequisicaoInteresses(token, {
    obterToken: async () => token,
    requisitar: async () => {
      iniciou.resolve();
      return espera.promise;
    },
  });

  const operacao = requisitar('/mural/interesses');

  await iniciou.promise;

  token = 'token-conta-b';

  espera.resolve(new Response('{"post_ids":[1]}'));

  await assert.rejects(operacao, /SESSAO_ALTERADA/);
});

test('cancelamento previo impede requisicao', async () => {
  const c = criar();
  const controller = new AbortController();

  controller.abort();

  await assert.rejects(
    c.requisitar('/mural/interesses', {
      signal: controller.signal
    }),
    /OPERACAO_CANCELADA/
  );

  assert.equal(c.chamadas.length, 0);
});

test('cancelamento durante leitura do token impede requisicao', async () => {
  const espera = diferido();
  const controller = new AbortController();

  let chamadas = 0;

  const requisitar = criarRequisicaoInteresses('token-a', {
    obterToken: () => espera.promise,
    requisitar: async () => {
      chamadas++;
      return new Response('{}');
    },
  });

  const operacao = requisitar('/mural/interesses', {
    signal: controller.signal
  });

  controller.abort();
  espera.resolve('token-a');

  await assert.rejects(operacao, /OPERACAO_CANCELADA/);

  assert.equal(chamadas, 0);
});

test('encaminha sinal de cancelamento', async () => {
  const c = criar();
  const controller = new AbortController();

  await c.requisitar('/mural/interesses', {
    signal: controller.signal
  });

  assert.equal(
    c.chamadas[0].init.signal,
    controller.signal
  );
});

test('permite marcar interesse', async () => {
  const c = criar();

  await c.requisitar('/mural/7/interesse', {
    method: 'PUT'
  });

  assert.equal(c.chamadas[0].init.method, 'PUT');
});

test('permite remover interesse', async () => {
  const c = criar();

  await c.requisitar('/mural/7/interesse', {
    method: 'DELETE'
  });

  assert.equal(c.chamadas[0].init.method, 'DELETE');
});

test('bloqueia rotas externas e nao autorizadas', async () => {
  const c = criar();

  for (const path of [
    'https://example.com/mural/interesses',
    '/usuarios',
    '/mural/0/interesse',
    '/mural/-1/interesse',
    '/mural/1/interesse?usuario=2'
  ]) {
    await assert.rejects(
      c.requisitar(path, { method: 'PUT' }),
      /ROTA_NAO_PERMITIDA/
    );
  }

  assert.equal(c.chamadas.length, 0);
});

test('bloqueia metodos HTTP nao permitidos', async () => {
  const c = criar();

  await assert.rejects(
    c.requisitar('/mural/1/interesse', {
      method: 'POST'
    }),
    /ROTA_NAO_PERMITIDA/
  );

  assert.equal(c.chamadas.length, 0);
});

test('rejeita token vazio ou invalido', () => {
  for (const token of ['', ' ', 'token invalido']) {
    assert.throws(
      () => criarRequisicaoInteresses(token, {}),
      /Token de sessao invalido/
    );
  }
});

test('descarta resposta apos cancelamento durante requisicao', async () => {
  const espera = diferido();
  const iniciou = diferido();
  const controller = new AbortController();

  const requisitar = criarRequisicaoInteresses('token-a', {
    obterToken: async () => 'token-a',
    requisitar: async () => {
      iniciou.resolve();
      return espera.promise;
    },
  });

  const operacao = requisitar('/mural/interesses', {
    signal: controller.signal
  });

  await iniciou.promise;

  controller.abort();
  espera.resolve(new Response('{}'));

  await assert.rejects(operacao, /OPERACAO_CANCELADA/);
});