export const MAX_IMAGE_BYTES = 1_500_000;
const attempts = [{ maxSide: 1600, quality: 0.8 }, { maxSide: 1600, quality: 0.65 }, { maxSide: 1200, quality: 0.65 }, { maxSide: 900, quality: 0.55 }] as const;

export function base64Bytes(value: string) {
  if (!value || value.length % 4 !== 0) return Infinity;
  return value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
}

export function resizeForMural(width: number, height: number, maxSide: number) {
  if (![width, height, maxSide].every(n => Number.isFinite(n) && n > 0)) throw new Error('Dimensões inválidas.');
  if (Math.max(width, height) <= maxSide) return undefined;
  return width >= height ? { width: maxSide } : { height: maxSide };
}

type ImageAsset = { uri: string; width: number; height: number };
type Encode = (uri: string, resize: { width: number } | { height: number } | undefined, quality: number) => Promise<string | undefined>;

// Cada tentativa usa a imagem original: não acumula perdas de recompressão.
export async function prepareMuralImage(asset: ImageAsset, encode: Encode) {
  for (const { maxSide, quality } of attempts) {
    const base64 = await encode(asset.uri, resizeForMural(asset.width, asset.height, maxSide), quality);
    if (base64 && base64Bytes(base64) <= MAX_IMAGE_BYTES) return `data:image/jpeg;base64,${base64}`;
  }
  throw new Error('Não foi possível reduzir a imagem para até 1,5 MB.');
}

// Somente URLs públicas de mídia do mural criadas pelo nosso provedor.
// Não reescreve URLs assinadas da API, fotos de perfil ou links externos.
export function optimizedMuralUrl(uri: string) {
  const match = /^(https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\/)(v\d+\/agenda-adp-mural-[0-9a-f]{32}\.(?:jpg|jpeg|png|webp))$/.exec(uri);
  return match ? `${match[1]}c_limit,h_1600,w_1600/q_auto/f_auto/${match[2]}` : uri;
}

export function imageAspectRatio(width: number, height: number) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : undefined;
}
