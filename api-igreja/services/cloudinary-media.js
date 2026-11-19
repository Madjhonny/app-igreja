const { randomUUID } = require('node:crypto');

const ASSET_FOLDER = 'agenda-adp';
const PUBLIC_ID_RE = /^agenda-adp-mural-[0-9a-f]{32}$/;
const DATA_URI_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp']);

class MediaStorageError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'MediaStorageError';
    this.status = status;
  }
}

class MediaInputError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'MediaInputError';
  }
}

const newMuralPublicId = () => `agenda-adp-mural-${randomUUID().replace(/-/g, '')}`;

function validateImage(dataUri, maxBytes) {
  const match = typeof dataUri === 'string' && DATA_URI_RE.exec(dataUri);
  if (!match || match[2].length > Math.ceil(maxBytes / 3) * 4) {
    throw new MediaInputError('Imagem JPEG, PNG ou WebP inválida ou acima do limite.');
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > maxBytes || bytes.toString('base64') !== match[2]) {
    throw new MediaInputError('Imagem Base64 inválida ou acima do limite.');
  }
  // Versões anteriores do app rotulam qualquer imagem selecionada como JPEG.
  // Detecta o formato real e limita aos três tipos permitidos, sem confiar no MIME.
  let type;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = 'jpeg';
  else if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) type = 'png';
  else if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') type = 'webp';
  if (!type) throw new MediaInputError('O conteúdo não corresponde a um formato permitido.');
  return `data:image/${type};base64,${match[2]}`;
}

function createCloudinaryMedia({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;
  const maxBytes = Number(env.MAX_IMAGE_BYTES || 2_000_000);
  if (!/^[a-zA-Z0-9_-]+$/.test(cloudName || '') || !/^\d+$/.test(apiKey || '') || !apiSecret || /\s/.test(apiSecret)) {
    throw new Error('Credenciais do Cloudinary ausentes ou inválidas.');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 10_000_000 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Limite de imagem ou timeout inválido.');
  }
  const base = `https://api.cloudinary.com/v1_1/${cloudName}/image`;
  const auth = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`, 'utf8').toString('base64')}`;

  async function request(action, params) {
    const body = new URLSearchParams(params);
    try {
      const response = await fetchImpl(`${base}/${action}`, {
        method: 'POST', headers: { Authorization: auth }, body,
        redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new MediaStorageError('O provedor de imagens recusou a operação.', response.status);
      const result = await response.json();
      if (!result || typeof result !== 'object') throw new MediaStorageError('Resposta inválida do provedor de imagens.');
      return result;
    } catch (error) {
      // Não propagar mensagens, corpo da resposta, imagens ou credenciais do provedor.
      if (error instanceof MediaStorageError) throw error;
      throw new MediaStorageError('Falha de comunicação com o armazenamento de imagens.');
    }
  }

  async function uploadMuralImage(dataUri, publicId = newMuralPublicId()) {
    const normalizedImage = validateImage(dataUri, maxBytes);
    if (!PUBLIC_ID_RE.test(publicId || '')) throw new TypeError('Identificador de mídia inválido.');
    const data = await request('upload', {
      file: normalizedImage, asset_folder: ASSET_FOLDER, public_id: publicId,
      overwrite: 'false', allowed_formats: 'jpg,jpeg,png,webp',
    });
    let url;
    try { url = new URL(data.secure_url); } catch { throw new MediaStorageError('URL inválida do provedor de imagens.'); }
    const expectedPath = `/${cloudName}/image/upload/`;
    const path = url.pathname.slice(expectedPath.length);
    if (data.public_id !== publicId || data.resource_type !== 'image' || !FORMATS.has(data.format) ||
        url.origin !== 'https://res.cloudinary.com' || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith(expectedPath) || !/^v\d+\//.test(path) ||
        path.split('/').slice(1).join('/') !== `${publicId}.${data.format}`) {
      throw new MediaStorageError('Resposta de upload inesperada do provedor de imagens.');
    }
    return { publicId, url: url.href };
  }

  async function deleteMuralImage(publicId) {
    if (!PUBLIC_ID_RE.test(publicId || '')) throw new TypeError('Identificador de mídia inválido.');
    const data = await request('destroy', { public_id: publicId, invalidate: 'true' });
    if (data.result !== 'ok' && data.result !== 'not found') throw new MediaStorageError('Exclusão não confirmada pelo provedor.');
    return data.result;
  }

  return { uploadMuralImage, deleteMuralImage, validateMuralImage: dataUri => validateImage(dataUri, maxBytes) };
}

module.exports = { createCloudinaryMedia, MediaStorageError, newMuralPublicId };
