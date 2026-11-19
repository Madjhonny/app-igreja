const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudinaryMedia, MediaStorageError } = require('../services/cloudinary-media');

const env = { CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: '12345', CLOUDINARY_API_SECRET: 'fake-secret' };
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
const validId = 'agenda-adp-mural-' + 'a'.repeat(32);

function uploadResponse(id, override = {}) {
  return { public_id: id, resource_type: 'image', format: 'png', secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v123/${id}.png`, ...override };
}

test('envia imagem na pasta restrita com identificador gerado pelo servidor e devolve URL HTTPS', async () => {
  const calls = [];
  const media = createCloudinaryMedia({ env, fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    return Response.json(uploadResponse(opts.body.get('public_id')));
  } });
  const result = await media.uploadMuralImage(image);
  assert.match(result.publicId, /^agenda-adp-mural-[0-9a-f]{32}$/);
  assert.equal(result.url, uploadResponse(result.publicId).secure_url);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.cloudinary.com/v1_1/test-cloud/image/upload');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Basic ' + Buffer.from('12345:fake-secret').toString('base64'));
  assert.equal(calls[0].opts.body.get('file'), image);
  assert.equal(calls[0].opts.body.get('asset_folder'), 'agenda-adp');
  assert.equal(calls[0].opts.body.get('overwrite'), 'false');
  assert.equal(calls[0].opts.redirect, 'error');
  assert.ok(calls[0].opts.signal instanceof AbortSignal);
});

test('rejeita URL externa, Base64 inválido, formato divergente e excesso de tamanho sem acessar provedor', async () => {
  let calls = 0;
  const media = createCloudinaryMedia({ env: { ...env, MAX_IMAGE_BYTES: '100' }, fetchImpl: async () => { calls++; } });
  for (const invalid of ['https://example.org/a.png', 'data:image/png;base64,abc', image.replace('image/png', 'image/jpeg'), 'data:image/png;base64,' + Buffer.alloc(200).toString('base64')]) {
    await assert.rejects(media.uploadMuralImage(invalid), TypeError);
  }
  assert.equal(calls, 0);
});

test('rejeita resposta com URL externa ou ID diferente', async () => {
  for (const override of [{ secure_url: 'https://example.org/photo.png' }, { public_id: validId }, { resource_type: 'video' }, { secure_url: 'https://res.cloudinary.com/another-cloud/image/upload/v123/test.png' }]) {
    const media = createCloudinaryMedia({ env, fetchImpl: async (_, opts) => Response.json(uploadResponse(opts.body.get('public_id'), override)) });
    await assert.rejects(media.uploadMuralImage(image), MediaStorageError);
  }
});

test('não repete automaticamente uploads recusados e não propaga segredos do provedor', async () => {
  let calls = 0;
  const media = createCloudinaryMedia({ env, fetchImpl: async () => {
    calls++;
    return Response.json({ error: { message: 'fake-secret' } }, { status: 401 });
  } });
  await assert.rejects(media.uploadMuralImage(image), e => e instanceof MediaStorageError && e.status === 401 && !e.message.includes('fake-secret'));
  assert.equal(calls, 1);
});

test('oculta detalhes de erros de rede', async () => {
  const media = createCloudinaryMedia({ env, fetchImpl: async () => { throw new Error('fake-secret'); } });
  await assert.rejects(media.uploadMuralImage(image), e => e instanceof MediaStorageError && !e.message.includes('fake-secret'));
});

test('exclui somente ID no namespace do mural, com invalidação de cache e resposta idempotente', async () => {
  let calls = 0;
  const media = createCloudinaryMedia({ env, fetchImpl: async (url, opts) => {
    calls++;
    assert.equal(url, 'https://api.cloudinary.com/v1_1/test-cloud/image/destroy');
    assert.equal(opts.body.get('public_id'), validId);
    assert.equal(opts.body.get('invalidate'), 'true');
    return Response.json({ result: calls === 1 ? 'ok' : 'not found' });
  } });
  await assert.rejects(media.deleteMuralImage('some-other-image'), TypeError);
  assert.equal(await media.deleteMuralImage(validId), 'ok');
  assert.equal(await media.deleteMuralImage(validId), 'not found');
  assert.equal(calls, 2);
});

test('falha se credenciais ausentes, cloud name incorreto ou limite inválido', () => {
  for (const invalid of [{ ...env, CLOUDINARY_API_SECRET: '' }, { ...env, CLOUDINARY_CLOUD_NAME: '../evil' }, { ...env, MAX_IMAGE_BYTES: '-1' }]) {
    assert.throws(() => createCloudinaryMedia({ env: invalid }));
  }
});
