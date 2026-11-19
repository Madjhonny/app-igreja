const { newMuralPublicId } = require('./cloudinary-media');

// A reserva é gravada antes de chamar o provedor. Se o upload ou o INSERT
// falhar (inclusive por timeout ou conexão perdida), o asset continua rastreável.
function createMuralStorage({ pool, media }) {
  async function createPost(query, values) {
    media.validateMuralImage(values[6]);
    const publicId = newMuralPublicId();
    await pool.query('INSERT INTO mural_cloudinary_assets (public_id) VALUES ($1)', [publicId]);
    const uploaded = await media.uploadMuralImage(values[6], publicId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reserve = await client.query(
        'SELECT public_id FROM mural_cloudinary_assets WHERE public_id = $1 AND post_id IS NULL FOR UPDATE', [publicId]
      );
      if (reserve.rowCount !== 1) throw new Error('Reserva da imagem indisponível.');
      const stored = [...values];
      stored[6] = uploaded.url;
      const result = await client.query(query, stored);
      const linked = await client.query(
        'UPDATE mural_cloudinary_assets SET post_id = $2 WHERE public_id = $1 AND post_id IS NULL',
        [publicId, result.rows[0].id]
      );
      if (linked.rowCount !== 1) throw new Error('Não foi possível vincular imagem ao post.');
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* A reserva permanece para reconciliação. */ }
      throw error;
    } finally { client.release(); }
  }

  async function findByPost(postId) {
    const result = await pool.query('SELECT public_id FROM mural_cloudinary_assets WHERE post_id = $1', [postId]);
    return result.rows[0]?.public_id ?? null;
  }

  // A FK torna a mídia órfã quando o post é excluído. A operação só destrói
  // um ID reservado por esta API, sem post associado, mantendo o lock até o fim.
  async function cleanupOne(publicId, { allowRecent = false } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        SELECT public_id FROM mural_cloudinary_assets
         WHERE public_id = $1 AND post_id IS NULL
           AND ($2::boolean OR created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour')
         FOR UPDATE SKIP LOCKED`, [publicId, allowRecent]);
      if (!result.rowCount) {
        await client.query('COMMIT');
        return false;
      }
      await media.deleteMuralImage(result.rows[0].public_id);
      await client.query('DELETE FROM mural_cloudinary_assets WHERE public_id = $1 AND post_id IS NULL', [publicId]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Tenta novamente numa execução posterior. */ }
      throw error;
    } finally { client.release(); }
  }

  async function listPending(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Limite inválido.');
    const result = await pool.query(`
      SELECT public_id FROM mural_cloudinary_assets WHERE post_id IS NULL
        AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
      ORDER BY created_at, public_id LIMIT $1`, [limit]);
    return result.rows.map(row => row.public_id);
  }

  return { createPost, findByPost, cleanupOne, listPending };
}

module.exports = { createMuralStorage };
