export type FiltroMural = 'todos' | 'minha';

type Publicacao = {
  congregacao_id?: unknown;
};

function idValido(valor: unknown): number | null {
  if (typeof valor !== 'number' && typeof valor !== 'string') {
    return null;
  }

  if (typeof valor === 'string' && !/^\d+$/.test(valor)) {
    return null;
  }

  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function podeFiltrarCongregacao(
  congregacaoId: unknown,
  convidado: boolean
): boolean {
  return !convidado && idValido(congregacaoId) !== null;
}

export function filtrarPublicacoes<T extends Publicacao>(
  posts: T[],
  filtro: FiltroMural,
  congregacaoId: unknown,
  convidado: boolean
): T[] {
  if (
    filtro === 'todos' ||
    !podeFiltrarCongregacao(congregacaoId, convidado)
  ) {
    return posts;
  }

  const id = idValido(congregacaoId);

  return posts.filter(
    post => idValido(post.congregacao_id) === id
  );
}