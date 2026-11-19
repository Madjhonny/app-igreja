const { createHmac, timingSafeEqual } = require('node:crypto');
const { newProfilePublicId } = require('./cloudinary-profile-media');
const { MediaInputError } = require('./cloudinary-media');

const ID_RE = /^agenda-adp-profile-[0-9a-f]{32}$/;
const TTL = 12 * 60 * 60;
const validId = value => /^[1-9]\d{0,9}$/.test(String(value)) && Number(value) <= 2147483647;

function createProfileLinks({ media, jwtSecret, origin, now = () => Math.floor(Date.now() / 1000) }) {
  const base = new URL(origin);
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1')) || base.pathname !== '/' || base.username || base.password || base.search || base.hash) throw new Error('PROFILE_MEDIA_BASE_URL inválida.');
  const signature = (owner, asset, expires, viewer, version) => createHmac('sha256', jwtSecret).update(`profile-photo:${owner}:${asset}:${expires}:${viewer}:${version}`).digest('hex');
  function issue(photo, owner, viewer) {
    const asset = media.parse(photo);
    if (!asset) return photo;
    if (!validId(owner) || !validId(viewer?.id)) return null;
    const expires = Math.floor(now() / 3600) * 3600 + TTL;
    const version = Number(viewer.token_version || 0);
    const query = new URLSearchParams({ asset: asset.publicId, exp: String(expires), viewer: String(viewer.id), v: String(version), sig: signature(owner, asset.publicId, expires, viewer.id, version) });
    return `${base.origin}/usuarios/${owner}/foto?${query}`;
  }
  function validate(owner, query, { allowExpired = false } = {}) {
    const { asset, exp, viewer, v, sig } = query;
    if (![asset, exp, viewer, v, sig].every(x => typeof x === 'string') || !validId(owner) || !validId(viewer) || !ID_RE.test(asset) || !/^\d{10}$/.test(exp) || !/^\d{1,10}$/.test(v) || !/^[a-f0-9]{64}$/.test(sig)) return false;
    if ((!allowExpired && Number(exp) <= now()) || Number(exp) > now() + TTL) return false;
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(signature(owner, asset, exp, viewer, v), 'hex'));
  }
  function ownLink(photo, owner, current, viewer) {
    const currentAsset = media.parse(current);
    if (!currentAsset || typeof photo !== 'string') return false;
    try {
      const url = new URL(photo);
      const params = Object.fromEntries(url.searchParams);
      return url.origin === base.origin && url.pathname === `/usuarios/${owner}/foto` && !url.hash && params.asset === currentAsset.publicId && params.viewer === String(viewer.id) && params.v === String(Number(viewer.token_version || 0)) && validate(owner, params, { allowExpired: true });
    } catch { return false; }
  }
  function reserved(photo) {
    if (typeof photo !== 'string') return false;
    try {
      const url = new URL(photo);
      return (url.origin === base.origin && /^\/usuarios\/\d+\/foto\/?$/.test(url.pathname)) ||
        (url.hostname === 'res.cloudinary.com' && (url.pathname.includes('/image/authenticated/') || url.pathname.includes('agenda-adp-profile-')));
    } catch { return false; }
  }
  return { issue, validate, ownLink, reserved };
}

function createProfileStorage({ pool, media, links }) {
  async function tx(fn) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
    finally { client.release(); }
  }
  async function prepare(photo) {
    if (typeof photo !== 'string' || !photo.startsWith('data:')) return null;
    media.validate(photo);
    const id = newProfilePublicId();
    await pool.query('INSERT INTO profile_cloudinary_assets (public_id) VALUES ($1)', [id]);
    const url = await media.upload(photo, id);
    // Verifica que a mídia protegida é legível antes de alterar o banco.
    const picture = await media.read(url);
    if (!picture.bytes.equals(Buffer.from(photo.slice(photo.indexOf(',') + 1), 'base64'))) throw new Error('Conteúdo da foto diverge do original.');
    return { id, url };
  }
  async function attach(client, asset, userId) {
    if (!asset) return;
    const result = await client.query('UPDATE profile_cloudinary_assets SET user_id=$2 WHERE public_id=$1 AND user_id IS NULL', [asset.id, userId]);
    if (result.rowCount !== 1) throw new Error('Reserva de perfil indisponível.');
  }
  async function createUser(query, values) {
    if (links.reserved(values[6])) throw new MediaInputError('Referência de foto de perfil inválida.');
    const asset = await prepare(values[6]);
    if (!asset) return pool.query(query, values);
    return tx(async client => {
      const args = [...values]; args[6] = asset.url;
      const result = await client.query(query, args);
      await attach(client, asset, result.rows[0].id);
      return result;
    });
  }
  async function cleanup(publicId) {
    return tx(async client => {
      const row = await client.query('SELECT public_id FROM profile_cloudinary_assets WHERE public_id=$1 AND user_id IS NULL FOR UPDATE SKIP LOCKED', [publicId]);
      if (!row.rowCount) return false;
      await media.remove(publicId);
      await client.query('DELETE FROM profile_cloudinary_assets WHERE public_id=$1 AND user_id IS NULL', [publicId]);
      return true;
    });
  }
  async function updateUser(query, values, viewer) {
    const photo = values[2];
    const asset = await prepare(photo);
    let previous;
    const result = await tx(async client => {
      const userId = values[3];
      const current = (await client.query('SELECT foto_perfil FROM usuarios WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      if (!current) throw new MediaInputError('Usuário não encontrado.');
      const same = links.ownLink(photo, userId, current.foto_perfil, viewer);
      if (links.reserved(photo) && !same) throw new MediaInputError('Referência de foto inválida. Atualize a sessão.');
      const args = [...values]; args[2] = same ? current.foto_perfil : (asset?.url ?? photo);
      if (!same) {
        previous = (await client.query('UPDATE profile_cloudinary_assets SET user_id=NULL WHERE user_id=$1 RETURNING public_id', [userId])).rows[0]?.public_id;
      }
      const updated = await client.query(query, args);
      if (!updated.rowCount) throw new Error('Perfil não encontrado.');
      await attach(client, asset, userId);
      return updated;
    });
    if (previous) try { await cleanup(previous); } catch { console.error('Foto de perfil pendente de limpeza.'); }
    return result;
  }
  async function get(owner, query) {
    if (!links.validate(owner, query)) return null;
    const row = (await pool.query(`SELECT u.foto_perfil FROM usuarios u JOIN profile_cloudinary_assets a ON a.user_id=u.id
      JOIN usuarios viewer ON viewer.id=$3 AND COALESCE(viewer.token_version,0)=$4 AND viewer.status_conta IN ('APROVADO','PENDENTE')
      AND viewer.nivel_acesso IN ('MASTER','ADMIN','MEMBRO') WHERE u.id=$1 AND a.public_id=$2`, [Number(owner), query.asset, Number(query.viewer), Number(query.v)])).rows[0];
    if (!row || media.parse(row.foto_perfil)?.publicId !== query.asset) return null;
    return media.read(row.foto_perfil);
  }
  return { createUser, updateUser, cleanup, get, links };
}
module.exports = { createProfileLinks, createProfileStorage };
