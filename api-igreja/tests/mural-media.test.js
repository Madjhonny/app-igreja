const test = require('node:test');
const assert = require('node:assert/strict');
const { createMuralStorage } = require('../services/mural-media');

const image = 'data:image/png;base64,test';
const values = [1, 2, 'Titulo', null, null, 'imagem', image, '2026-12-01', '2026-12-02'];
const insertSql = 'INSERT INTO mural_eventos (...) VALUES (...) RETURNING *';
const existingId = 'agenda-adp-mural-' + 'a'.repeat(32);

function setup({ failUpload = false, failInsert = false, failCleanup = false, linked = false, invalid = false } = {}) {
  const calls = [];
  let reservedId = existingId;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT public_id FROM mural_cloudinary_assets')) return linked ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ public_id: reservedId }] };
      if (sql === insertSql) {
        if (failInsert) throw Error('insert failed');
        return { rowCount: 1, rows: [{ id: 15, midia: params[6] }] };
      }
      return { rowCount: 1, rows: [] };
    }, release() { calls.push({ sql: 'RELEASE' }); },
  };
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('INSERT INTO mural_cloudinary_assets')) reservedId = params[0];
      return { rowCount: 1, rows: [{ public_id: reservedId }] };
    }, async connect() { return client; },
  };
  const media = {
    validateMuralImage() { if (invalid) throw new TypeError('invalid'); },
    async uploadMuralImage(data, id) {
      calls.push({ sql: 'UPLOAD', params: [data, id] });
      if (failUpload) throw new Error('provider failed');
      return { publicId: id, url: `https://res.cloudinary.com/test/image/upload/v123/${id}.png` };
    },
    async deleteMuralImage(id) {
      calls.push({ sql: 'DESTROY', params: [id] });
      if (failCleanup) throw new Error('provider failed');
      return 'ok';
    },
  };
  return { storage: createMuralStorage({ pool, media }), calls };
}

test('reserva ID antes do upload, grava só URL e vincula ao post na mesma transação', async () => {
  const { storage, calls } = setup();
  const r = await storage.createPost(insertSql, values);
  const id = calls[0].params[0];
  assert.match(id, /^agenda-adp-mural-[0-9a-f]{32}$/);
  assert.deepEqual(calls[1], { sql: 'UPLOAD', params: [image, id] });
  assert.equal(calls[2].sql, 'BEGIN');
  assert.match(calls[3].sql, /FOR UPDATE/);
  assert.match(r.rows[0].midia, /^https:\/\//);
  assert.equal(calls[4].params[6], r.rows[0].midia);
  assert.equal(values[6], image);
  assert.deepEqual(calls[5].params, [id, 15]);
  assert.equal(calls[6].sql, 'COMMIT');
  assert.equal(calls[7].sql, 'RELEASE');
});

test('imagem inválida não reserva ID nem aciona provedor', async () => {
  const { storage, calls } = setup({ invalid: true });
  await assert.rejects(storage.createPost(insertSql, values), TypeError);
  assert.equal(calls.length, 0);
});

test('falha de upload conserva reserva para reconciliar resultado incerto, sem publicar', async () => {
  const { storage, calls } = setup({ failUpload: true });
  await assert.rejects(storage.createPost(insertSql, values));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sql, 'UPLOAD');
});

test('falha na gravação reverte publicação sem excluir mídia potencialmente referenciada', async () => {
  const { storage, calls } = setup({ failInsert: true });
  await assert.rejects(storage.createPost(insertSql, values));
  assert.equal(calls.at(-2).sql, 'ROLLBACK');
  assert.equal(calls.at(-1).sql, 'RELEASE');
  assert.equal(calls.some(c => c.sql === 'DESTROY'), false);
});

test('limpeza nunca exclui um asset associado a post', async () => {
  const { storage, calls } = setup({ linked: true });
  assert.equal(await storage.cleanupOne(existingId, { allowRecent: true }), false);
  assert.match(calls[1].sql, /post_id IS NULL/);
  assert.equal(calls.some(c => c.sql === 'DESTROY'), false);
});

test('limpa asset órfão com lock e confirma exclusão antes de remover registro', async () => {
  const { storage, calls } = setup();
  assert.equal(await storage.cleanupOne(existingId), true);
  assert.match(calls[1].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[1].sql, /INTERVAL '1 hour'/);
  assert.deepEqual(calls[1].params, [existingId, false]);
  assert.equal(calls[2].sql, 'DESTROY');
  assert.match(calls[3].sql, /DELETE FROM mural_cloudinary_assets/);
  assert.equal(calls[4].sql, 'COMMIT');
});

test('falha do provedor mantém registro para outra tentativa', async () => {
  const { storage, calls } = setup({ failCleanup: true });
  await assert.rejects(storage.cleanupOne(existingId));
  assert.equal(calls.some(c => c.sql.startsWith('DELETE')), false);
  assert.equal(calls.at(-2).sql, 'ROLLBACK');
});
