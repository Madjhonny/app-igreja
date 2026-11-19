const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEntry, validateEntry, createMigration } = require('../services/migrate-profile-media');
const { createCloudinaryProfileMedia } = require('../services/cloudinary-profile-media');

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
const bytes = Buffer.from(image.split(',')[1], 'base64');
const adapter = createCloudinaryProfileMedia({ env: { CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: '123', CLOUDINARY_API_SECRET: 'fake' } });
const fixture = () => makeEntry({ id: 15, foto_perfil: image }, adapter);

function setup({ badBytes = false, failUpdate = false, failUpload = false, override, linked = false, noAsset = false, otherOwner = false, unsafeUrl = false } = {}) {
  const entry = fixture();
  const url = `https://res.cloudinary.com/test/image/authenticated/v123/${entry.publicId}.png`;
  const calls = [];
  const client = { async query(sql, args = []) {
    calls.push([sql, args]);
    if (sql.startsWith('SELECT user_id')) return { rows: noAsset ? [] : [{ user_id: otherOwner ? 99 : linked ? entry.id : null }] };
    if (sql.startsWith('SELECT foto_perfil')) return { rows: [{ foto_perfil: override ?? (linked ? url : image) }] };
    if (sql.startsWith('UPDATE usuarios') && failUpdate) return { rowCount: 0 };
    return { rows: [{ public_id: entry.publicId }], rowCount: 1 };
  }, release() { calls.push(['RELEASE']); } };
  const pool = { async query(sql, args) { calls.push([sql, args]); return { rowCount: 1 }; }, async connect() { return client; } };
  const media = { ...adapter, async upload(data, publicId) {
    calls.push(['UPLOAD', [data, publicId]]);
    if (failUpload) throw new Error('upload failed');
    return unsafeUrl ? url.replace('authenticated', 'upload') : url;
  }, async read() { calls.push(['VERIFY']); return { bytes: badBytes ? Buffer.from('different') : bytes }; },
  async remove(publicId) { calls.push(['DESTROY', [publicId]]); } };
  return { entry, url, calls, migration: createMigration({ pool, media }) };
}

test('backup preserva foto e hash, rejeita adulteração ou ID do mural', () => {
  const e = fixture();
  assert.equal(e.original, image);
  assert.doesNotThrow(() => validateEntry(e, adapter));
  assert.throws(() => validateEntry({ ...e, original: image + 'a' }, adapter), /Backup/);
  assert.throws(() => validateEntry({ ...e, publicId: e.publicId.replace('profile', 'mural') }, adapter), /Backup/);
});
test('migração reserva, verifica foto privada e troca somente foto_perfil', async () => {
  const { migration, entry, url, calls } = setup();
  assert.equal(await migration.migrate(entry), url);
  assert.match(calls[0][0], /INSERT INTO profile_cloudinary_assets/);
  assert.deepEqual(calls[1], ['UPLOAD', [image, entry.publicId]]);
  assert.equal(calls[2][0], 'VERIFY');
  const update = calls.find(([sql]) => sql.startsWith('UPDATE usuarios'));
  assert.deepEqual(update[1], [url, entry.id, image]);
  assert.match(update[0], /foto_perfil=\$3/);
  assert.equal(calls.at(-2)[0], 'COMMIT');
});
test('falhas de upload, URL pública ou bytes divergentes não modificam perfil', async () => {
  for (const opts of [{ failUpload: true }, { unsafeUrl: true }, { badBytes: true }]) {
    const { migration, entry, calls } = setup(opts);
    await assert.rejects(migration.migrate(entry));
    assert.equal(calls.some(([sql]) => sql.startsWith('UPDATE usuarios') || sql === 'DESTROY'), false);
  }
});
test('alteração concorrente ou falha no UPDATE reverte sem destruir a foto', async () => {
  for (const opts of [{ override: 'https://example.org/other.png' }, { failUpdate: true }]) {
    const { migration, entry, calls } = setup(opts);
    await assert.rejects(migration.migrate(entry), /Perfil alterado/);
    assert.equal(calls.at(-2)[0], 'ROLLBACK');
    assert.equal(calls.some(([sql]) => sql === 'DESTROY'), false);
  }
});
test('restauração grava Base64 original e confirma transação antes da exclusão no Cloudinary', async () => {
  const { migration, entry, url, calls } = setup({ linked: true });
  await migration.restore(entry);
  assert.deepEqual(calls.find(([sql]) => sql.startsWith('UPDATE usuarios'))[1], [image, entry.id, url]);
  assert.ok(calls.findIndex(([sql]) => sql === 'COMMIT') < calls.findIndex(([sql]) => sql === 'DESTROY'));
});
test('restauração não substitui foto de terceiros ou alteração posterior', async () => {
  for (const opts of [{ linked: true, override: 'https://example.org/other.png' }, { otherOwner: true }]) {
    const { migration, entry, calls } = setup(opts);
    await assert.rejects(migration.restore(entry));
    assert.equal(calls.some(([sql]) => sql.startsWith('UPDATE usuarios') || sql === 'DESTROY'), false);
  }
});
test('restauração limpa reserva órfã, mas não remove mídia se nenhuma reserva existe', async () => {
  for (const noAsset of [false, true]) {
    const { migration, entry, calls } = setup({ noAsset });
    await migration.restore(entry);
    assert.equal(calls.some(([sql]) => sql.startsWith('UPDATE usuarios')), false);
    assert.equal(calls.some(([sql]) => sql === 'DESTROY'), !noAsset);
  }
});
