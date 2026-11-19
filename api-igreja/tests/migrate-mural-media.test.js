const test = require('node:test');
const assert = require('node:assert/strict');
const { createMigration, makeEntry, validateEntry, managedUrl, verifyImage } = require('../services/migrate-mural-media');
const { createCloudinaryMedia } = require('../services/cloudinary-media');

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
const bytes = Buffer.from(image.split(',')[1], 'base64');
const validate = createCloudinaryMedia({ env: { CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: '123', CLOUDINARY_API_SECRET: 'fake' } }).validateMuralImage;
const fixture = () => makeEntry({ id: 15, midia: image }, { validateMuralImage: validate });

function setup({ badBytes = false, failUpdate = false, failUpload = false, postOverride, linked = false } = {}) {
  const entry = fixture();
  const url = `https://res.cloudinary.com/test/image/upload/v123/${entry.publicId}.png`;
  const calls = [];
  const client = { async query(sql, args = []) {
    calls.push([sql, args]);
    if (sql.startsWith('SELECT post_id')) return { rows: [{ post_id: linked ? entry.id : null }], rowCount: 1 };
    if (sql.startsWith('SELECT midia')) return { rows: [{ midia: postOverride ?? (linked ? url : image) }], rowCount: 1 };
    if (sql.startsWith('UPDATE mural_eventos') && failUpdate) return { rowCount: 0, rows: [] };
    return { rows: [{ public_id: entry.publicId }], rowCount: 1 };
  }, release() { calls.push(['RELEASE']); } };
  const pool = { async query(sql, args) { calls.push([sql, args]); return { rowCount: 1 }; }, async connect() { return client; } };
  const media = { validateMuralImage: validate, async uploadMuralImage(data, publicId) {
    calls.push(['UPLOAD', [data, publicId]]);
    if (failUpload) throw new Error('upload failed');
    return { publicId, url };
  }, async deleteMuralImage(publicId) { calls.push(['DESTROY', [publicId]]); return 'ok'; } };
  const fetchImpl = async () => { calls.push(['VERIFY']); return new Response(badBytes ? Buffer.from('different') : bytes, { headers: { 'content-type': 'image/png' } }); };
  return { entry, url, calls, migration: createMigration({ pool, media, cloud: 'test', fetchImpl }) };
}

test('backup registra conteúdo, hash e identificador antes de qualquer upload', () => {
  const e = fixture();
  assert.equal(e.original, image);
  assert.match(e.sha256, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => validateEntry(e, { validateMuralImage: validate }));
  assert.throws(() => validateEntry({ ...e, original: image + 'a' }, { validateMuralImage: validate }), /Backup inválido/);
});

test('migração verifica bytes no CDN antes de substituir somente a imagem e registrar vínculo', async () => {
  const { migration, entry, url, calls } = setup();
  assert.equal(await migration.migrate(entry), url);
  assert.match(calls[0][0], /INSERT INTO mural_cloudinary_assets/);
  assert.equal(calls[1][0], 'UPLOAD');
  assert.equal(calls[2][0], 'VERIFY');
  const update = calls.find(([sql]) => sql.startsWith('UPDATE mural_eventos'));
  assert.deepEqual(update[1], [url, entry.id, image]);
  assert.match(update[0], /midia=\$3/);
  assert.equal(calls.at(-2)[0], 'COMMIT');
});

test('imagem diferente no CDN mantém Base64 sem publicar link ou apagar registro', async () => {
  const { migration, entry, calls } = setup({ badBytes: true });
  await assert.rejects(migration.migrate(entry), /diverge/);
  assert.equal(calls.some(([sql]) => sql.startsWith('UPDATE mural_eventos')), false);
  assert.equal(calls.some(([sql]) => sql === 'DESTROY'), false);
});

test('falha no upload mantém a reserva e não altera post', async () => {
  const { migration, entry, calls } = setup({ failUpload: true });
  await assert.rejects(migration.migrate(entry));
  assert.equal(calls.length, 2);
});

test('alteração concorrente aborta transação sem exclusão precipitada', async () => {
  const { migration, entry, calls } = setup({ failUpdate: true });
  await assert.rejects(migration.migrate(entry), /Post alterado/);
  assert.equal(calls.at(-2)[0], 'ROLLBACK');
  assert.equal(calls.some(([sql]) => sql === 'DESTROY'), false);
});

test('restaura Base64 e desvincula antes de remover a imagem temporária', async () => {
  const { migration, entry, url, calls } = setup({ linked: true });
  await migration.restore(entry);
  const update = calls.find(([sql]) => sql.startsWith('UPDATE mural_eventos'));
  assert.deepEqual(update[1], [image, entry.id, url]);
  assert.ok(calls.findIndex(([sql]) => sql === 'COMMIT') < calls.findIndex(([sql]) => sql === 'DESTROY'));
});

test('rollback não sobrescreve post com outra imagem nem destrói asset associado', async () => {
  const { migration, entry, calls } = setup({ linked: true, postOverride: 'https://example.org/other.png' });
  await assert.rejects(migration.restore(entry), /restauração recusada/);
  assert.equal(calls.some(([sql]) => sql.startsWith('UPDATE mural_eventos') || sql === 'DESTROY'), false);
});

test('recupera apenas reserva órfã quando o original já está no post', async () => {
  const { migration, entry, calls } = setup();
  await migration.restore(entry);
  assert.equal(calls.some(([sql]) => sql.startsWith('UPDATE mural_eventos')), false);
  assert.ok(calls.some(([sql]) => sql === 'DESTROY'));
});

test('rejeita URL de outra conta, outro asset ou transformação', async () => {
  const e = fixture();
  assert.equal(managedUrl(`https://res.cloudinary.com/test/image/upload/v1/${e.publicId}.png`, 'test', e.publicId), true);
  for (const url of [`https://res.cloudinary.com/other/image/upload/v1/${e.publicId}.png`, `https://res.cloudinary.com/test/image/upload/w_10/v1/${e.publicId}.png`, 'https://example.org/a.png']) assert.equal(managedUrl(url, 'test', e.publicId), false);
  await assert.rejects(verifyImage('https://example.org/a.png', image, async () => new Response(bytes, { headers: { 'content-type': 'text/html' } })));
});
