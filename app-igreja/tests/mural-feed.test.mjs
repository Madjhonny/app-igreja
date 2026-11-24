import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filtrarPublicacoes,
  podeFiltrarCongregacao
} from '../services/mural-feed.ts';

const posts = [
  { id: 1, congregacao_id: 10 },
  { id: 2, congregacao_id: 20 },
  { id: 3, congregacao_id: 10 },
  { id: 4, congregacao_id: null },
  { id: 5, congregacao_id: '10' }
];

test('Todos preserva todas as publicacoes', () => {
  assert.deepEqual(
    filtrarPublicacoes(posts, 'todos', 10, false),
    posts
  );
});

test('Minha congregacao filtra corretamente', () => {
  assert.deepEqual(
    filtrarPublicacoes(posts, 'minha', 10, false)
      .map(p => p.id),
    [1, 3, 5]
  );
});

test('preserva a ordem original das publicacoes', () => {
  const invertidos = [...posts].reverse();

  assert.deepEqual(
    filtrarPublicacoes(invertidos, 'minha', 10, false)
      .map(p => p.id),
    [5, 3, 1]
  );
});

test('convidado nao possui filtro pessoal', () => {
  assert.equal(podeFiltrarCongregacao(10, true), false);
  assert.deepEqual(
    filtrarPublicacoes(posts, 'minha', 10, true),
    posts
  );
});

test('usuario sem congregacao utiliza Todos', () => {
  assert.equal(podeFiltrarCongregacao(null, false), false);
  assert.deepEqual(
    filtrarPublicacoes(posts, 'minha', null, false),
    posts
  );
});

test('congregacoes invalidas nao habilitam o filtro', () => {
  for (const id of [
    null, undefined, '', ' ', 0, -1, NaN,
    Infinity, 1.5, true, 'abc', '1e1'
  ]) {
    assert.equal(podeFiltrarCongregacao(id, false), false);
  }
});

test('congregacao sem publicacoes retorna lista vazia', () => {
  assert.deepEqual(
    filtrarPublicacoes(posts, 'minha', 99, false),
    []
  );
});

test('filtragem nao modifica a lista original', () => {
  const antes = JSON.stringify(posts);

  filtrarPublicacoes(posts, 'minha', 10, false);

  assert.equal(JSON.stringify(posts), antes);
});

test('aceita identificadores numericos e strings validas', () => {
  assert.equal(podeFiltrarCongregacao(10, false), true);
  assert.equal(podeFiltrarCongregacao('10', false), true);

  assert.deepEqual(
    filtrarPublicacoes(posts, 'minha', '10', false)
      .map(p => p.id),
    [1, 3, 5]
  );
});

test('lista vazia permanece vazia', () => {
  assert.deepEqual(
    filtrarPublicacoes([], 'minha', 10, false),
    []
  );
});