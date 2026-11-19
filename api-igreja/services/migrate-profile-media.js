const { createHash } = require('node:crypto');
const { newProfilePublicId } = require('./cloudinary-profile-media');
const { createProfileStorage } = require('./profile-photo-storage');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const validId = id => Number.isInteger(id) && id > 0;
const validPublicId = id => typeof id === 'string' && /^agenda-adp-profile-[0-9a-f]{32}$/.test(id);

function validateEntry(entry, media) {
  if (!entry || !validId(entry.id) || !validPublicId(entry.publicId) || typeof entry.original !== 'string' ||
      sha256(entry.original) !== entry.sha256) throw new Error('Backup de perfil inválido.');
  media.validate(entry.original);
}
function makeEntry(row, media) {
  const entry = { id: row.id, original: row.foto_perfil, sha256: sha256(row.foto_perfil), publicId: newProfilePublicId() };
  validateEntry(entry, media);
  return entry;
}
async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Backup permite recuperação. */ }
    throw error;
  } finally { client.release(); }
}

function createMigration({ pool, media }) {
  const storage = createProfileStorage({ pool, media });
  async function migrate(entry) {
    validateEntry(entry, media);
    const { id, original, publicId } = entry;
    // A reserva deve existir antes do upload para permitir recuperação após falhas.
    await pool.query('INSERT INTO profile_cloudinary_assets (public_id) VALUES ($1)', [publicId]);
    const url = await media.upload(original, publicId);
    if (media.parse(url)?.publicId !== publicId) throw new Error('URL protegida inválida.');
    const expected = Buffer.from(original.slice(original.indexOf(',') + 1), 'base64');
    const actual = (await media.read(url)).bytes;
    if (!actual.equals(expected)) throw new Error('Conteúdo da foto diverge.');
    return transaction(pool, async client => {
      const user = (await client.query('SELECT foto_perfil FROM usuarios WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!user || user.foto_perfil !== original) throw new Error('Perfil alterado durante a migração.');
      const reserved = await client.query('SELECT public_id FROM profile_cloudinary_assets WHERE public_id=$1 AND user_id IS NULL FOR UPDATE', [publicId]);
      if (reserved.rowCount !== 1) throw new Error('Reserva indisponível.');
      const updated = await client.query('UPDATE usuarios SET foto_perfil=$1 WHERE id=$2 AND foto_perfil=$3', [url, id, original]);
      if (updated.rowCount !== 1) throw new Error('Perfil alterado durante a migração.');
      const attached = await client.query('UPDATE profile_cloudinary_assets SET user_id=$2 WHERE public_id=$1 AND user_id IS NULL', [publicId, id]);
      if (attached.rowCount !== 1) throw new Error('Vínculo de foto não confirmado.');
      return url;
    });
  }
  async function restore(entry) {
    validateEntry(entry, media);
    const { id, original, publicId } = entry;
    const reserved = await transaction(pool, async client => {
      // Trava o usuário primeiro, na mesma ordem da edição normal do perfil.
      const user = (await client.query('SELECT foto_perfil FROM usuarios WHERE id=$1 FOR UPDATE', [id])).rows[0];
      const asset = (await client.query('SELECT user_id FROM profile_cloudinary_assets WHERE public_id=$1 FOR UPDATE', [publicId])).rows[0];
      if (!user || (asset?.user_id != null && asset.user_id !== id)) throw new Error('Perfil ou vínculo diverge do backup.');
      if (user.foto_perfil === original) {
        if (asset?.user_id != null) throw new Error('Vínculo inesperado.');
        return Boolean(asset);
      }
      if (!asset || asset.user_id !== id || media.parse(user.foto_perfil)?.publicId !== publicId) throw new Error('Perfil alterado; restauração recusada.');
      const restored = await client.query('UPDATE usuarios SET foto_perfil=$1 WHERE id=$2 AND foto_perfil=$3', [original, id, user.foto_perfil]);
      if (restored.rowCount !== 1) throw new Error('Falha ao restaurar perfil.');
      const detached = await client.query('UPDATE profile_cloudinary_assets SET user_id=NULL WHERE public_id=$1 AND user_id=$2', [publicId, id]);
      if (detached.rowCount !== 1) throw new Error('Falha ao liberar foto.');
      return true;
    });
    if (reserved && !await storage.cleanup(publicId)) {
      const remaining = await pool.query('SELECT 1 FROM profile_cloudinary_assets WHERE public_id=$1', [publicId]);
      if (remaining.rowCount) throw new Error('Foto temporária pendente de limpeza.');
    }
  }
  return { migrate, restore };
}
module.exports = { makeEntry, validateEntry, createMigration, sha256 };
