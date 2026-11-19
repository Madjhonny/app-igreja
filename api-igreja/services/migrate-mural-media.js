const { createHash } = require('node:crypto');
const { newMuralPublicId } = require('./cloudinary-media');
const { createMuralStorage } = require('./mural-media');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const bytesOf = image => Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
const validId = id => /^agenda-adp-mural-[0-9a-f]{32}$/.test(id);
const managedUrl = (url, cloud, id) => {
  if (!validId(id) || !/^[a-zA-Z0-9_-]+$/.test(cloud)) return false;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/');
    return parsed.origin === 'https://res.cloudinary.com' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash &&
      parts.length === 6 && parts[1] === cloud && parts[2] === 'image' && parts[3] === 'upload' && /^v\d+$/.test(parts[4]) &&
      ['jpg', 'jpeg', 'png', 'webp'].some(format => parts[5] === `${id}.${format}`);
  } catch { return false; }
};

function makeEntry(row, media) {
  media.validateMuralImage(row.midia);
  if (!Number.isInteger(row.id) || row.id <= 0) throw new Error('ID de post inválido.');
  return { id: row.id, original: row.midia, sha256: sha256(row.midia), publicId: newMuralPublicId() };
}

function validateEntry(entry, media) {
  if (!entry || !Number.isInteger(entry.id) || entry.id <= 0 || !validId(entry.publicId) ||
      typeof entry.original !== 'string' || sha256(entry.original) !== entry.sha256) throw new Error('Backup inválido.');
  media.validateMuralImage(entry.original);
}

// A entrega original sem transformação deve ser byte a byte igual ao arquivo fonte.
async function verifyImage(url, original, fetchImpl = globalThis.fetch) {
  const expected = bytesOf(original);
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Imagem enviada indisponível.');
  const reader = response.body.getReader();
  const hash = createHash('sha256');
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expected.byteLength) throw new Error('Tamanho da imagem diverge.');
      hash.update(value);
    }
  } finally { try { await reader.cancel(); } catch { /* A conexão pode ter sido encerrada. */ } }
  if (size !== expected.byteLength || hash.digest('hex') !== sha256(expected)) throw new Error('Conteúdo da imagem diverge.');
}

async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Resultado pode ser incerto, backup permanece. */ }
    throw error;
  } finally { client.release(); }
}

function createMigration({ pool, media, cloud, fetchImpl }) {
  const storage = createMuralStorage({ pool, media });
  async function migrate(entry) {
    validateEntry(entry, media);
    const { id, original, publicId } = entry;
    // O ID já consta do backup em disco antes desta chamada.
    await pool.query('INSERT INTO mural_cloudinary_assets (public_id) VALUES ($1)', [publicId]);
    const uploaded = await media.uploadMuralImage(original, publicId);
    if (uploaded.publicId !== publicId || !managedUrl(uploaded.url, cloud, publicId)) throw new Error('Resposta de upload inválida.');
    await verifyImage(uploaded.url, original, fetchImpl);
    return transaction(pool, async client => {
      const reservation = await client.query('SELECT public_id FROM mural_cloudinary_assets WHERE public_id=$1 AND post_id IS NULL FOR UPDATE', [publicId]);
      if (reservation.rowCount !== 1) throw new Error('Reserva indisponível.');
      const updated = await client.query("UPDATE mural_eventos SET midia=$1 WHERE id=$2 AND midia=$3 AND tipo_midia='imagem' RETURNING id", [uploaded.url, id, original]);
      if (updated.rowCount !== 1) throw new Error('Post alterado durante a migração.');
      const linked = await client.query('UPDATE mural_cloudinary_assets SET post_id=$2 WHERE public_id=$1 AND post_id IS NULL', [publicId, id]);
      if (linked.rowCount !== 1) throw new Error('Falha ao registrar mídia.');
      return uploaded.url;
    });
  }

  async function restore(entry) {
    validateEntry(entry, media);
    const { id, original, publicId } = entry;
    const reserved = await transaction(pool, async client => {
      const asset = (await client.query('SELECT post_id FROM mural_cloudinary_assets WHERE public_id=$1 FOR UPDATE', [publicId])).rows[0];
      const post = (await client.query('SELECT midia FROM mural_eventos WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!post || (asset?.post_id != null && asset.post_id !== id)) throw new Error('Post ou vínculo diverge do backup.');
      if (post.midia === original) {
        if (asset?.post_id != null) throw new Error('Vínculo inesperado.');
        return Boolean(asset);
      }
      if (!asset || asset.post_id !== id || !managedUrl(post.midia, cloud, publicId)) throw new Error('Post foi alterado; restauração recusada.');
      const restored = await client.query('UPDATE mural_eventos SET midia=$1 WHERE id=$2 AND midia=$3', [original, id, post.midia]);
      if (restored.rowCount !== 1) throw new Error('Falha ao restaurar post.');
      const unlinked = await client.query('UPDATE mural_cloudinary_assets SET post_id=NULL WHERE public_id=$1 AND post_id=$2', [publicId, id]);
      if (unlinked.rowCount !== 1) throw new Error('Falha ao liberar mídia.');
      return true;
    });
    if (reserved && !await storage.cleanupOne(publicId, { allowRecent: true })) {
      // Uma tentativa anterior pode ter removido a mídia; só aceitamos se o registro sumiu.
      const remaining = await pool.query('SELECT 1 FROM mural_cloudinary_assets WHERE public_id=$1', [publicId]);
      if (remaining.rowCount) throw new Error('Imagem do teste pendente de limpeza.');
    }
  }
  return { migrate, restore };
}

module.exports = { createMigration, makeEntry, validateEntry, managedUrl, verifyImage, sha256 };
