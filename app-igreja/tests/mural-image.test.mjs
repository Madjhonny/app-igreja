import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64Bytes, resizeForMural, prepareMuralImage, optimizedMuralUrl, imageAspectRatio, MAX_IMAGE_BYTES } from '../services/mural-image.ts';

test('redimensiona sem cortar, distorcer ou ampliar', () => {
  assert.deepEqual(resizeForMural(4000, 3000, 1600), { width: 1600 });
  assert.deepEqual(resizeForMural(3000, 4000, 1600), { height: 1600 });
  assert.equal(resizeForMural(800, 800, 1600), undefined);
  assert.throws(() => resizeForMural(0, 800, 1600));
});

test('calcula o tamanho real do base64 incluindo padding', () => {
  assert.equal(base64Bytes('YQ=='), 1);
  assert.equal(base64Bytes('YWI='), 2);
  assert.equal(base64Bytes('YWJj'), 3);
  assert.equal(base64Bytes(''), Infinity);
  assert.equal(base64Bytes('abc'), Infinity);
});

test('tenta qualidade e resolução progressivamente sempre a partir do original', async () => {
  const calls = [];
  const big = 'A'.repeat((MAX_IMAGE_BYTES / 3 + 1) * 4);
  const result = await prepareMuralImage({ uri: 'file://foto', width: 4000, height: 3000 }, async (...args) => {
    calls.push(args);
    return calls.length < 3 ? big : 'YWJj';
  });
  assert.equal(result, 'data:image/jpeg;base64,YWJj');
  assert.deepEqual(calls, [['file://foto', { width: 1600 }, 0.8], ['file://foto', { width: 1600 }, 0.65], ['file://foto', { width: 1200 }, 0.65]]);
});

test('recusa resultado acima do limite depois de quatro tentativas', async () => {
  let calls = 0;
  await assert.rejects(prepareMuralImage({ uri: 'file://foto', width: 4000, height: 3000 }, async () => { calls++; return 'A'.repeat(2_000_004); }), /1,5 MB/);
  assert.equal(calls, 4);
});

test('preserva links assinados, dados antigos, imagens externas e perfis', () => {
  const original = 'https://res.cloudinary.com/demo/image/upload/v123/agenda-adp-mural-' + 'a'.repeat(32) + '.png';
  assert.equal(optimizedMuralUrl(original), original.replace('/v123/', '/c_limit,h_1600,w_1600/q_auto/f_auto/v123/'));
  for (const value of ['/mural/1/imagem?exp=123&sig=abc', 'data:image/png;base64,abc', original + '?sig=abc', original.replace('mural-', 'perfil-'), original.replace('res.cloudinary.com', 'evil.example')]) assert.equal(optimizedMuralUrl(value), value);
});

test('proporções de feed não distorcem as imagens e ignoram dimensões inválidas', () => {
  assert.equal(imageAspectRatio(1600, 800), 2);
  assert.equal(imageAspectRatio(800, 1600), 0.5);
  assert.equal(imageAspectRatio(0, 1600), undefined);
  assert.equal(imageAspectRatio(NaN, 1600), undefined);
});
