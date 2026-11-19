const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudinaryProfileMedia } = require('../services/cloudinary-profile-media');
const { createProfileLinks, createProfileStorage } = require('../services/profile-photo-storage');
const env = { CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: '123', CLOUDINARY_API_SECRET: 'fake' };
const id = 'agenda-adp-profile-' + 'a'.repeat(32);
const url = `https://res.cloudinary.com/test/image/authenticated/v123/${id}.png`;
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
const bytes = Buffer.from(image.split(',')[1], 'base64');
const profile = createCloudinaryProfileMedia({ env });
const viewer = { id: 8, token_version: 2 };
const setupLinks = (now = () => 1795000000) => createProfileLinks({ media: profile, jwtSecret: 'unit-secret', origin: 'https://example.test', now });
const params = value => Object.fromEntries(new URL(value).searchParams);

test('upload de perfil exige authenticated e usa namespace separado', async () => {
  const media = createCloudinaryProfileMedia({ env, fetchImpl: async (target, opts) => {
    assert.match(target, /\/image\/upload$/);
    assert.equal(opts.body.get('type'), 'authenticated');
    assert.equal(opts.body.get('asset_folder'), 'agenda-adp');
    return Response.json({ public_id: id, resource_type: 'image', type: 'authenticated', version: 123, format: 'png' });
  } });
  assert.equal(await media.upload(image, id), url);
});
test('recusa resposta de upload público ou ID diferente', async () => {
  for (const type of ['upload', 'private']) {
    const media = createCloudinaryProfileMedia({ env, fetchImpl: async () => Response.json({ public_id: id, resource_type: 'image', type, version: 123, format: 'png' }) });
    await assert.rejects(media.upload(image, id), /não protegido/);
  }
});
test('lê somente referência protegida assinada no servidor', async () => {
  const media = createCloudinaryProfileMedia({ env, fetchImpl: async (target, opts) => {
    assert.match(target, /\/image\/authenticated\/s--[A-Za-z0-9_-]{8}--\/v123\//);
    assert.equal(opts.redirect, 'error');
    return new Response(bytes, { headers: { 'content-type': 'image/png' } });
  } });
  assert.deepEqual((await media.read(url)).bytes, bytes);
  await assert.rejects(media.read(url.replace('authenticated', 'upload')));
  await assert.rejects(media.read('https://example.org/a.png'));
});
test('remoção de perfil inclui tipo authenticated e nunca aceita ID do mural', async () => {
  const media = createCloudinaryProfileMedia({ env, fetchImpl: async (_, opts) => {
    assert.equal(opts.body.get('public_id'), id); assert.equal(opts.body.get('type'), 'authenticated');
    return Response.json({ result: 'ok' });
  } });
  await media.remove(id);
  await assert.rejects(media.remove(id.replace('profile', 'mural')));
});
test('links temporários não expõem CDN, dependem de usuário, versão, ativo e prazo', () => {
  const links = setupLinks(); const link = links.issue(url, 8, viewer); const q = params(link);
  assert.match(link, /^https:\/\/example.test\/usuarios\/8\/foto\?/);
  assert.equal(links.validate(8, q), true);
  assert.equal(links.validate(9, q), false);
  assert.equal(links.validate(8, { ...q, viewer: '9' }), false);
  assert.equal(links.validate(8, { ...q, v: '3' }), false);
  assert.equal(links.validate(8, { ...q, asset: id.replace(/a$/, 'b') }), false);
  assert.equal(setupLinks(() => Number(q.exp) + 1).validate(8, q), false);
});
test('mantém link próprio ao editar sem trocar foto, mas rejeita link de outro usuário', () => {
  const links = setupLinks(); const link = links.issue(url, 8, viewer);
  assert.equal(links.ownLink(link, 8, url, viewer), true);
  assert.equal(links.ownLink(link, 8, url, { id: 9, token_version: 2 }), false);
  assert.equal(links.ownLink(link, 8, url.replace(/a\.png$/, 'b.png'), viewer), false);
  assert.equal(links.reserved(link), true);
  assert.equal(links.reserved(url), true);
  assert.equal(links.issue(image, 8, viewer), image);
});
test('entrega exige vínculo atual e sessão ainda aprovada ou pendente', async () => {
  const links = setupLinks(); const link = links.issue(url, 8, viewer); const calls = [];
  let row = { foto_perfil: url };
  const storage = createProfileStorage({ pool: { async query(sql, args) { calls.push([sql, args]); return { rows: row ? [row] : [] }; } },
    media: { parse: profile.parse, read: async value => { assert.equal(value, url); return { bytes }; } }, links });
  assert.deepEqual((await storage.get(8, params(link))).bytes, bytes);
  assert.match(calls[0][0], /COALESCE\(viewer.token_version,0\)=\$4/);
  assert.match(calls[0][0], /status_conta IN/);
  row = null; assert.equal(await storage.get(8, params(link)), null);
  assert.equal(await storage.get(8, { ...params(link), sig: '0'.repeat(64) }), null);
});
test('edição rejeita referências protegidas diretas ou de terceiros e reverte sem modificar o perfil', async () => {
  const links = setupLinks();
  const foreign = links.issue(url, 9, viewer);
  for (const photo of [url, foreign]) {
    const calls = [];
    const client = {
      async query(sql) {
        calls.push(sql);
        if (sql === 'SELECT foto_perfil FROM usuarios WHERE id=$1 FOR UPDATE') return { rows: [{ foto_perfil: url }] };
        assert.ok(['BEGIN', 'ROLLBACK'].includes(sql), `Consulta inesperada: ${sql}`);
      },
      release() { calls.push('release'); }
    };
    const storage = createProfileStorage({ pool: { connect: async () => client }, media: profile, links });
    await assert.rejects(storage.updateUser('UPDATE usuarios', ['Nome', 'email', photo, 8], viewer), { name: 'MediaInputError' });
    assert.deepEqual(calls, ['BEGIN', 'SELECT foto_perfil FROM usuarios WHERE id=$1 FOR UPDATE', 'ROLLBACK', 'release']);
  }
});
test('cadastro rejeita referência protegida fornecida pelo cliente antes de gravar no banco', async () => {
  const storage = createProfileStorage({ pool: {}, media: profile, links: setupLinks() });
  await assert.rejects(storage.createUser('INSERT INTO usuarios', [null, null, null, null, null, null, url]), { name: 'MediaInputError' });
});
