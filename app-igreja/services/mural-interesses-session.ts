type Dependencias = {
  obterToken: () => Promise<string | null>;
  requisitar: (
    path: string,
    init?: RequestInit
  ) => Promise<Response>;
};

export function criarRequisicaoInteresses(
  tokenSessao: string,
  dependencias: Dependencias
) {
  if (!tokenSessao || /\s/.test(tokenSessao)) {
    throw new Error('Token de sessao invalido.');
  }

  async function verificarSessao(signal?: AbortSignal | null) {
    if (signal?.aborted) {
      throw new Error('OPERACAO_CANCELADA');
    }

    const tokenAtual = await dependencias.obterToken();

    if (signal?.aborted) {
      throw new Error('OPERACAO_CANCELADA');
    }

    if (tokenAtual !== tokenSessao) {
      throw new Error('SESSAO_ALTERADA');
    }
  }

  return async function requisitar(
    path: string,
    init?: RequestInit
  ): Promise<Response> {
    const metodo = (init?.method ?? 'GET').toUpperCase();

    const rotaValida =
      (path === '/mural/interesses' && metodo === 'GET') ||
      (
        /^\/mural\/[1-9]\d*\/interesse$/.test(path) &&
        ['PUT', 'DELETE'].includes(metodo)
      );

    if (!rotaValida) {
      throw new Error('ROTA_NAO_PERMITIDA');
    }

    await verificarSessao(init?.signal);

    const headers = new Headers(init?.headers);

    headers.set('Authorization', `Bearer ${tokenSessao}`);

    const resposta = await dependencias.requisitar(path, {
      ...init,
      method: metodo,
      headers,
      credentials: 'omit',
      cache: 'no-store',
    });

    await verificarSessao(init?.signal);

    return resposta;
  };
}