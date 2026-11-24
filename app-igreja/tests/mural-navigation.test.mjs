import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  indiceValido,
  limitarIndice,
  indicePorDeslocamento
} from '../services/mural-navigation.ts';

import {
  filtrarPublicacoes
} from '../services/mural-feed.ts';

test('aceita indices validos', () => {
  assert.equal(indiceValido(0, 3), true);
  assert.equal(indiceValido(2, 3), true);
});

test('rejeita indices fora dos limites', () => {
  assert.equal(indiceValido(-1, 3), false);
  assert.equal(indiceValido(3, 3), false);
});

test('rejeita indices invalidos', () => {
  for (const indice of [NaN, Infinity, 1.5]) {
    assert.equal(indiceValido(indice, 3), false);
  }
});

test('lista vazia nao permite abrir fullscreen', () => {
  assert.equal(indiceValido(0, 0), false);
  assert.equal(limitarIndice(5, 0), 0);
});

test('limita indice negativo', () => {
  assert.equal(limitarIndice(-5, 3), 0);
});

test('limita indice acima da lista', () => {
  assert.equal(limitarIndice(8, 3), 2);
});

test('preserva indice valido', () => {
  assert.equal(limitarIndice(2, 5), 2);
});

test('ajusta indice quando a lista diminui', () => {
  assert.equal(limitarIndice(4, 2), 1);
});

test('calcula indice pelo deslocamento vertical', () => {
  assert.equal(indicePorDeslocamento(1600, 800, 5), 2);
});

test('arredonda para a pagina mais proxima', () => {
  assert.equal(indicePorDeslocamento(1300, 800, 5), 2);
  assert.equal(indicePorDeslocamento(900, 800, 5), 1);
});

test('impede navegacao alem da ultima publicacao', () => {
  assert.equal(indicePorDeslocamento(9000, 800, 3), 2);
});

test('trata medidas invalidas da tela', () => {
  assert.equal(indicePorDeslocamento(800, 0, 3), 0);
  assert.equal(indicePorDeslocamento(800, -1, 3), 0);
  assert.equal(indicePorDeslocamento(NaN, 800, 3), 0);
  assert.equal(indicePorDeslocamento(800, Infinity, 3), 0);
});

test('trata quantidades invalidas', () => {
  for (const total of [-1, 1.5, NaN, Infinity]) {
    assert.equal(indiceValido(0, total), false);
    assert.equal(limitarIndice(2, total), 0);
  }
});

test('indice selecionado corresponde ao feed filtrado', () => {
  const posts = [
    { id: 1, congregacao_id: 10 },
    { id: 2, congregacao_id: 20 },
    { id: 3, congregacao_id: 10 },
    { id: 4, congregacao_id: 20 }
  ];

  const visiveis = filtrarPublicacoes(
    posts, 'minha', 20, false
  );

  assert.equal(indiceValido(1, visiveis.length), true);
  assert.equal(visiveis[1].id, 4);
});

test('navegacao respeita os limites do filtro', () => {
  const posts = [
    { id: 1, congregacao_id: 10 },
    { id: 2, congregacao_id: 20 },
    { id: 3, congregacao_id: 10 }
  ];

  const visiveis = filtrarPublicacoes(
    posts, 'minha', 10, false
  );

  const indice = indicePorDeslocamento(
    5000, 800, visiveis.length
  );

  assert.equal(indice, 1);
  assert.equal(visiveis[indice].id, 3);
});