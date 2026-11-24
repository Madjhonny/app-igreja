export function indiceValido(
  indice: number,
  total: number
): boolean {
  return Number.isSafeInteger(total) &&
    total > 0 &&
    Number.isSafeInteger(indice) &&
    indice >= 0 &&
    indice < total;
}

export function limitarIndice(
  indice: number,
  total: number
): number {
  if (!Number.isSafeInteger(total) || total <= 0) {
    return 0;
  }

  if (!Number.isFinite(indice)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(Math.trunc(indice), total - 1)
  );
}

export function indicePorDeslocamento(
  deslocamento: number,
  alturaPagina: number,
  total: number
): number {
  if (
    !Number.isFinite(deslocamento) ||
    !Number.isFinite(alturaPagina) ||
    alturaPagina <= 0
  ) {
    return 0;
  }

  return limitarIndice(
    Math.round(deslocamento / alturaPagina),
    total
  );
}