import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  criarControladorInteresses
} from '../services/mural-interesses-controller.ts';

function diferido() {
  let resolve;
  let reject;

  const promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });

  return { promise, resolve, reject };
}

function criar(overrides = {}) {
  return criarControladorInteresses({
    listar: async () => [1, 2],
    definir: async (id, marcado) => marcado,
    ...overrides,
  }, () => {});
}

test('sem sessao nao consulta nem altera interesses', async () => {
  const c = criar();

  assert.equal(await c.carregar(), false);
  assert.equal(await c.alternar(1), false);
});

test('carrega interesses da sessao ativa', async () => {
  const c = criar();

  c.trocarSessao('conta-1');

  assert.equal(await c.carregar(), true);
  assert.deepEqual(c.obterEstado().ids, [1, 2]);
  assert.equal(c.obterEstado().pronto, true);
});

test('nao altera antes da consulta inicial', async () => {
  const c = criar();

  c.trocarSessao('conta-1');

  assert.equal(await c.alternar(3), false);
});

test('marca interesse imediatamente', async () => {
  const espera = diferido();

  const c = criar({
    definir: () => espera.promise
  });

  c.trocarSessao('conta-1');
  await c.carregar();

  const operacao = c.alternar(3);

  assert.deepEqual(c.obterEstado().ids, [1, 2, 3]);
  assert.equal(c.obterEstado().pendente, 3);

  espera.resolve(true);

  assert.equal(await operacao, true);
  assert.equal(c.obterEstado().pendente, null);
});

test('desmarca interesse imediatamente', async () => {
  const espera = diferido();

  const c = criar({
    definir: () => espera.promise
  });

  c.trocarSessao('conta-1');
  await c.carregar();

  const operacao = c.alternar(1);

  assert.deepEqual(c.obterEstado().ids, [2]);

  espera.resolve(false);

  assert.equal(await operacao, true);
});

test('bloqueia cliques simultaneos e consultas concorrentes', async () => {
  const espera = diferido();
  let chamadas = 0;

  const c = criar({
    definir: () => {
      chamadas++;
      return espera.promise;
    }
  });

  c.trocarSessao('conta-1');
  await c.carregar();

  const operacao = c.alternar(3);

  assert.equal(await c.alternar(3), false);
  assert.equal(await c.alternar(4), false);
  assert.equal(await c.carregar(), false);
  assert.equal(chamadas, 1);

  espera.resolve(true);
  await operacao;
});

test('falha reverte alteracao otimista', async () => {
  const c = criar({
    definir: async () => {
      throw new Error('Falha');
    }
  });

  c.trocarSessao('conta-1');
  await c.carregar();

  assert.equal(await c.alternar(3), false);
  assert.deepEqual(c.obterEstado().ids, [1, 2]);
  assert.equal(c.obterEstado().pendente, null);
  assert.match(c.obterEstado().erro, /confirmar a alteração/);
});

test('reconcilia resposta perdida com estado real do servidor', async () => {
  let ids = [1, 2];

  const c = criar({
    listar: async () => ids,
    definir: async () => {
      ids = [1, 2, 3];
      throw new Error('Resposta perdida');
    }
  });

  c.trocarSessao('conta-1');
  await c.carregar();

  assert.equal(await c.alternar(3), true);

  assert.deepEqual(c.obterEstado().ids, [1, 2, 3]);
  assert.equal(c.obterEstado().pronto, true);
  assert.equal(c.obterEstado().erro, '');
});

test('falha na reconciliacao exige nova consulta', async () => {
  let chamadas = 0;

  const c = criar({
    listar: async () => {
      chamadas++;

      if (chamadas > 1) {
        throw new Error('Offline');
      }

      return [1, 2];
    },
    definir: async () => {
      throw new Error('Offline');
    }
  });

  c.trocarSessao('conta-1');
  await c.carregar();
  await c.alternar(3);

  assert.equal(c.obterEstado().pronto, false);
  assert.equal(await c.alternar(4), false);
});

test('troca de conta limpa interesses imediatamente', async () => {
  const c = criar();

  c.trocarSessao('conta-1');
  await c.carregar();

  c.trocarSessao('conta-2');

  assert.deepEqual(c.obterEstado().ids, []);
  assert.equal(c.obterEstado().pronto, false);
});

test('resposta atrasada de outra conta e ignorada', async () => {
  const espera = diferido();
  let chamadas = 0;

  const c = criar({
    listar: async () => {
      chamadas++;

      return chamadas === 1 ? espera.promise : [9];
    }
  });

  c.trocarSessao('conta-1');
  const antiga = c.carregar();

  c.trocarSessao('conta-2');
  await c.carregar();

  espera.resolve([1, 2]);

  assert.equal(await antiga, false);
  assert.deepEqual(c.obterEstado().ids, [9]);
});

test('retorno ao foco substitui a consulta antiga da mesma conta', async () => {
  const antiga = diferido();
  let sinalAntigo;
  let chamadas = 0;
  const c = criar({
    listar: signal => {
      chamadas++;
      if (chamadas === 1) {
        sinalAntigo = signal;
        return antiga.promise;
      }
      return [9];
    }
  });

  c.trocarSessao('conta-1');
  const primeiraConsulta = c.carregar();
  assert.equal(await c.carregar(), false);
  assert.equal(await c.sincronizar(), true);
  assert.equal(sinalAntigo.aborted, true);
  antiga.resolve([1, 2]);

  assert.equal(await primeiraConsulta, false);
  assert.deepEqual(c.obterEstado().ids, [9]);
  assert.equal(c.obterEstado().carregando, false);
  assert.equal(chamadas, 2);
});

test('solicitações de foco durante uma escrita aguardam uma única consulta posterior', async () => {
  const escrita = diferido();
  const consultaPosterior = diferido();
  let consultas = 0;
  let sinalEscrita;
  const c = criar({
    listar: () => ++consultas === 1 ? [1] : consultaPosterior.promise,
    definir: (_id, _marcado, signal) => {
      sinalEscrita = signal;
      return escrita.promise;
    },
  });

  c.trocarSessao('conta-1');
  await c.carregar();
  const mutacao = c.alternar(2);
  assert.equal(await c.sincronizar(), false);
  assert.equal(await c.sincronizar(), false);
  assert.equal(consultas, 1);
  assert.equal(sinalEscrita.aborted, false);

  escrita.resolve(true);
  assert.equal(await mutacao, true);
  assert.equal(consultas, 2);
  consultaPosterior.resolve([2, 3]);
  await consultaPosterior.promise;
  assert.deepEqual(c.obterEstado().ids, [2, 3]);
  assert.equal(c.obterEstado().carregando, false);
});

test('encerrar a sessão descarta a sincronização adiada por uma escrita', async () => {
  const escrita = diferido();
  let consultas = 0;
  const c = criar({
    listar: async () => { consultas++; return [1]; },
    definir: () => escrita.promise,
  });

  c.trocarSessao('conta-1');
  await c.carregar();
  const mutacao = c.alternar(2);
  await c.sincronizar();
  c.encerrar();
  escrita.resolve(true);

  assert.equal(await mutacao, false);
  assert.equal(consultas, 1);
  assert.deepEqual(c.obterEstado().ids, []);
});

test('falha atrasada de outra conta nao reverte interesses atuais', async () => {
  const espera = diferido();

  const c = criar({
    definir: () => espera.promise
  });

  c.trocarSessao('conta-1');
  await c.carregar();

  const antiga = c.alternar(3);

  c.trocarSessao('conta-2');
  await c.carregar();

  espera.reject(new Error('Falha'));

  assert.equal(await antiga, false);
  assert.deepEqual(c.obterEstado().ids, [1, 2]);
  assert.equal(c.obterEstado().erro, '');
});

test('encerrar sessao cancela requisicao pendente', async () => {
  const espera = diferido();
  let sinal;

  const c = criar({
    listar: signal => {
      sinal = signal;
      return espera.promise;
    }
  });

  c.trocarSessao('conta-1');
  const consulta = c.carregar();

  c.encerrar();

  assert.equal(sinal.aborted, true);

  espera.resolve([1, 2]);
  await consulta;

  assert.deepEqual(c.obterEstado().ids, []);
});

test('mesma sessao preserva interesses', async () => {
  const c = criar();

  c.trocarSessao('conta-1');
  await c.carregar();
  c.trocarSessao('conta-1');

  assert.deepEqual(c.obterEstado().ids, [1, 2]);
});

test('identificador invalido nao dispara mutacao', async () => {
  let chamadas = 0;

  const c = criar({
    definir: async () => {
      chamadas++;
      return true;
    }
  });

  c.trocarSessao('conta-1');
  await c.carregar();

  assert.equal(await c.alternar(-1), false);
  assert.equal(chamadas, 0);
});

test('falha inicial permite nova tentativa de consulta', async () => {
  let chamadas = 0;

  const c = criar({
    listar: async () => {
      chamadas++;

      if (chamadas === 1) throw new Error('Offline');

      return [7];
    }
  });

  c.trocarSessao('conta-1');

  assert.equal(await c.carregar(), false);
  assert.equal(c.obterEstado().pronto, false);

  assert.equal(await c.carregar(), true);
  assert.deepEqual(c.obterEstado().ids, [7]);
});
