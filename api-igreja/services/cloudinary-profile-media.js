const { createHash, randomUUID } = require('node:crypto');
const { createCloudinaryMedia, MediaStorageError } = require('./cloudinary-media');
const ID_RE = /^agenda-adp-profile-[0-9a-f]{32}$/;
const newProfilePublicId = () => `agenda-adp-profile-${randomUUID().replace(/-/g, '')}`;
const FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp']);

function createCloudinaryProfileMedia({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cloud = env.CLOUDINARY_CLOUD_NAME;
  const key = env.CLOUDINARY_API_KEY;
  const secret = env.CLOUDINARY_API_SECRET;
  const { validateMuralImage: validate } = createCloudinaryMedia({ env, fetchImpl });
  const maxBytes = Number(env.MAX_IMAGE_BYTES || 2_000_000);
  const base = `https://api.cloudinary.com/v1_1/${cloud}/image`;
  const auth = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
  const prefix = `https://res.cloudinary.com/${cloud}/image/authenticated/`;
  function parse(value) {
    if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
    const match = /^v(\d+)\/(agenda-adp-profile-[0-9a-f]{32})\.(jpg|jpeg|png|webp)$/.exec(value.slice(prefix.length));
    return match ? { version: match[1], publicId: match[2], format: match[3] } : null;
  }
  async function request(action, params) {
    try {
      const res = await fetchImpl(`${base}/${action}`, { method: 'POST', headers: { Authorization: auth },
        body: new URLSearchParams(params), redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new MediaStorageError('Provedor recusou operação de perfil.', res.status);
      return await res.json();
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      throw new MediaStorageError('Falha de comunicação com armazenamento de perfil.');
    }
  }
  async function upload(image, publicId = newProfilePublicId()) {
    const file = validate(image);
    if (!ID_RE.test(publicId)) throw new TypeError('ID de perfil inválido.');
    const data = await request('upload', { file, type: 'authenticated', asset_folder: 'agenda-adp', public_id: publicId,
      overwrite: 'false', allowed_formats: 'jpg,jpeg,png,webp' });
    // Não armazenar URL assinada ou aceitar mídia pública como fallback.
    const canonical = `${prefix}v${data.version}/${publicId}.${data.format}`;
    if (data.public_id !== publicId || data.resource_type !== 'image' || data.type !== 'authenticated' ||
        !FORMATS.has(data.format) || !parse(canonical)) throw new MediaStorageError('Upload de perfil não protegido.');
    return canonical;
  }
  async function remove(publicId) {
    if (!ID_RE.test(publicId)) throw new TypeError('ID de perfil inválido.');
    const result = await request('destroy', { public_id: publicId, type: 'authenticated', invalidate: 'true' });
    if (!['ok', 'not found'].includes(result.result)) throw new MediaStorageError('Exclusão de perfil não confirmada.');
  }
  async function read(canonical) {
    const asset = parse(canonical);
    if (!asset) throw new TypeError('Referência de perfil inválida.');
    const tail = `v${asset.version}/${asset.publicId}.${asset.format}`;
    // Assinatura de entrega documentada pelo Cloudinary, restrita ao servidor.
    const signature = createHash('sha1').update(tail + secret).digest('base64url').slice(0, 8);
    try {
      const res = await fetchImpl(`${prefix}s--${signature}--/${tail}`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!res.ok || !res.body) throw new MediaStorageError('Foto protegida indisponível.', res.status);
      const mime = asset.format === 'jpg' ? 'image/jpeg' : `image/${asset.format}`;
      if (res.headers.get('content-type')?.split(';')[0] !== mime) throw new MediaStorageError('Tipo de foto inesperado.');
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new MediaStorageError('Foto acima do limite.');
          chunks.push(Buffer.from(value));
        }
      } finally { try { await reader.cancel(); } catch {} }
      const bytes = Buffer.concat(chunks);
      validate(`data:${mime};base64,${bytes.toString('base64')}`);
      return { bytes, mime };
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      throw new MediaStorageError('Falha ao ler foto protegida.');
    }
  }
  return { validate, parse, upload, remove, read };
}
module.exports = { createCloudinaryProfileMedia, newProfilePublicId };
