import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  idInteresseValido,
  podeUsarInteresses,
  normalizarInteresses,
  atualizarInteresse,
  filtrarInteresses,
  criarServicoInteresses
} from '../services/mural-interesses.ts';

const usuario = {
  id: 1,
  nivel_acesso: 'MEMBRO',
  status_conta: 'APROVADO'
};

const posts = [
  { id: 1 },
  { id: 2 },
  { id: 3 },
  { id: 4 }
];

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('aceita identificadores validos', () => {
  assert.equal(idInteresseValido(1), true);
  assert.equal(idInteresseValido(2147483647), true);
});

test('rejeita identificadores invalidos', () => {
  for (const id of [
    null, undefined, '', '1', 0, -1, 1.5,
    NaN, Infinity, true, 2147483648
  ]) {
    assert.equal(idInteresseValido(id), false);
  }
});

for (const nivel of ['MASTER', 'ADMIN', 'MEMBRO']) {
  test(`${nivel} aprovado pode usar interesses`, () => {
    assert.equal(
      podeUsarInteresses(
        { ...usuario, nivel_acesso: nivel },
        false
      ),
      true
    );
  });
}

for (const status of ['PENDENTE', 'BLOQUEADO', 'RECUSADO']) {
  test(`${status} nao pode usar interesses`, () => {
    for (const nivel of ['MASTER', 'ADMIN', 'MEMBRO']) {
      assert.equal(
        podeUsarInteresses({
          ...usuario,
          nivel_acesso: nivel,
          status_conta: status
        }, false),
        false
      );
    }
  });
}

test('convidado nao pode usar interesses', () => {
  assert.equal(podeUsarInteresses(usuario, true), false);
  assert.equal(podeUsarInteresses(null, true), false);
});

test('sessao ausente ou invalida nao permite interesses', () => {
  assert.equal(podeUsarInteresses(null, false), false);
  assert.equal(
    podeUsarInteresses({ ...usuario, id: 0 }, false),
    false
  );
  assert.equal(
    podeUsarInteresses({
      ...usuario,
      nivel_acesso: 'DESCONHECIDO'
    }, false),
    false
  );
});

test('normaliza interesses sem duplicidade', () => {
  assert.deepEqual(
    normalizarInteresses({ post_ids: [3, 1, 3, 2] }),
    [3, 1, 2]
  );
});

test('aceita lista vazia de interesses', () => {
  assert.deepEqual(
    normalizarInteresses({ post_ids: [] }),
    []
  );
});

test('rejeita respostas invalidas da API', () => {
  for (const dados of [
    null, [], {}, { post_ids: null },
    { post_ids: '1' }, { post_ids: [0] },
    { post_ids: ['1'] }, { post_ids: [1, -2] }
  ]) {
    assert.throws(() => normalizarInteresses(dados));
  }
});

test('marcar interesse preserva os anteriores', () => {
  assert.deepEqual(
    atualizarInteresse([1, 2], 3, true),
    [1, 2, 3]
  );
});

test('marcar repetidamente nao duplica interesse', () => {
  assert.deepEqual(
    atualizarInteresse([1, 2], 2, true),
    [1, 2]
  );
});

test('desmarcar remove apenas o interesse selecionado', () => {
  assert.deepEqual(
    atualizarInteresse([1, 2, 3], 2, false),
    [1, 3]
  );
});

test('desmarcar interesse inexistente e seguro', () => {
  assert.deepEqual(
    atualizarInteresse([1, 2], 3, false),
    [1, 2]
  );
});

test('atualizacao nao modifica lista original', () => {
  const original = Object.freeze([1, 2]);

  atualizarInteresse(original, 3, true);
  atualizarInteresse(original, 1, false);

  assert.deepEqual(original, [1, 2]);
});

test('atualizacao rejeita ID invalido', () => {
  assert.throws(
    () => atualizarInteresse([], -1, true)
  );
});

test('filtro mostra somente interesses marcados', () => {
  assert.deepEqual(
    filtrarInteresses(posts, [3, 1], true)
      .map(p => p.id),
    [1, 3]
  );
});

test('filtro ignora publicacoes inexistentes', () => {
  assert.deepEqual(
    filtrarInteresses(posts, [99], true),
    []
  );
});

test('filtro sem interesses retorna lista vazia', () => {
  assert.deepEqual(
    filtrarInteresses(posts, [], true),
    []
  );
});

test('filtro sem permissao nao revela interesses', () => {
  assert.deepEqual(
    filtrarInteresses(posts, [1, 2], false),
    []
  );
});

test('GET consulta interesses sem cache', async () => {
  const servico = criarServicoInteresses(
    async (path, init) => {
      assert.equal(path, '/mural/interesses');
      assert.equal(init.method, 'GET');
      assert.equal(init.cache, 'no-store');
      return json({ post_ids: [1, 3] });
    }
  );

  assert.deepEqual(await servico.listar(), [1, 3]);
});

test('PUT marca interesse na publicacao correta', async () => {
  const servico = criarServicoInteresses(
    async (path, init) => {
      assert.equal(path, '/mural/2/interesse');
      assert.equal(init.method, 'PUT');
      return json({ post_id: 2, interesse: true });
    }
  );

  assert.equal(await servico.definir(2, true), true);
});

test('DELETE remove interesse corretamente', async () => {
  const servico = criarServicoInteresses(
    async (path, init) => {
      assert.equal(path, '/mural/2/interesse');
      assert.equal(init.method, 'DELETE');
      return json({ post_id: 2, interesse: false });
    }
  );

  assert.equal(await servico.definir(2, false), false);
});

test('ID invalido nao dispara requisicao', async () => {
  let chamadas = 0;

  const servico = criarServicoInteresses(async () => {
    chamadas++;
    return json({});
  });

  await assert.rejects(servico.definir(0, true));
  assert.equal(chamadas, 0);
});

test('erros HTTP nao sao tratados como sucesso', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const servico = criarServicoInteresses(
      async () => json({ erro: 'Falha' }, status)
    );

    await assert.rejects(servico.listar());
    await assert.rejects(servico.definir(1, true));
    await assert.rejects(servico.definir(1, false));
  }
});

test('falha de rede nao repete mutacao', async () => {
  let chamadas = 0;

  const servico = criarServicoInteresses(async () => {
    chamadas++;
    throw new TypeError('Falha de rede');
  });

  await assert.rejects(servico.definir(1, true));
  assert.equal(chamadas, 1);
});

test('rejeita confirmacao de outra publicacao', async () => {
  const servico = criarServicoInteresses(
    async () => json({ post_id: 99, interesse: true })
  );

  await assert.rejects(servico.definir(1, true));
});

test('rejeita confirmacao de estado divergente', async () => {
  const servico = criarServicoInteresses(
    async () => json({ post_id: 1, interesse: false })
  );

  await assert.rejects(servico.definir(1, true));
});

test('encaminha sinal de cancelamento', async () => {
  const controller = new AbortController();

  const servico = criarServicoInteresses(
    async (path, init) => {
      assert.equal(init.signal, controller.signal);

      if (init.method === 'GET') {
        return json({ post_ids: [] });
      }

      return json({ post_id: 1, interesse: true });
    }
  );

  await servico.listar(controller.signal);
  await servico.definir(1, true, controller.signal);
});