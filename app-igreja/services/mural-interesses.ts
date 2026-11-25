type Requisicao = (
  path: string,
  init?: RequestInit
) => Promise<Response>;

type Publicacao = {
  id: unknown;
};

type UsuarioInteresses = {
  id: number;
  nivel_acesso: string;
  status_conta: string;
};

export function idInteresseValido(valor: unknown): valor is number {
  return typeof valor === 'number' &&
    Number.isSafeInteger(valor) &&
    valor > 0 &&
    valor <= 2147483647;
}

export function podeUsarInteresses(
  usuario: UsuarioInteresses | null,
  convidado: boolean
): boolean {
  return !convidado &&
    !!usuario &&
    idInteresseValido(usuario.id) &&
    usuario.status_conta === 'APROVADO' &&
    ['MASTER', 'ADMIN', 'MEMBRO'].includes(usuario.nivel_acesso);
}

export function normalizarInteresses(dados: unknown): number[] {
  if (
    !dados ||
    typeof dados !== 'object' ||
    !('post_ids' in dados) ||
    !Array.isArray(dados.post_ids) ||
    !dados.post_ids.every(idInteresseValido)
  ) {
    throw new Error('Resposta de interesses invalida.');
  }

  return [...new Set<number>(dados.post_ids)];
}

export function atualizarInteresse(
  anteriores: readonly number[],
  postId: number,
  marcado: boolean
): number[] {
  if (!idInteresseValido(postId)) {
    throw new Error('Identificador de publicacao invalido.');
  }

  const resultado = new Set(anteriores);

  if (marcado) {
    resultado.add(postId);
  } else {
    resultado.delete(postId);
  }

  return [...resultado];
}

export function filtrarInteresses<T extends Publicacao>(
  posts: T[],
  interesses: readonly number[],
  permitido: boolean
): T[] {
  if (!permitido) return [];

  const ids = new Set(interesses);

  return posts.filter(
    post => idInteresseValido(post.id) && ids.has(post.id)
  );
}

export function criarServicoInteresses(requisicao: Requisicao) {
  return {
    async listar(signal?: AbortSignal): Promise<number[]> {
      const resposta = await requisicao('/mural/interesses', {
        method: 'GET',
        signal,
        cache: 'no-store',
      });

      if (!resposta.ok) {
        throw new Error('Nao foi possivel consultar seus interesses.');
      }

      return normalizarInteresses(await resposta.json());
    },

    async definir(
      postId: number,
      marcado: boolean,
      signal?: AbortSignal
    ): Promise<boolean> {
      if (!idInteresseValido(postId)) {
        throw new Error('Identificador de publicacao invalido.');
      }

      const resposta = await requisicao(
        `/mural/${postId}/interesse`,
        {
          method: marcado ? 'PUT' : 'DELETE',
          signal,
        }
      );

      if (!resposta.ok) {
        throw new Error('Nao foi possivel atualizar seu interesse.');
      }

      const dados = await resposta.json();

      if (
        dados?.post_id !== postId ||
        dados?.interesse !== marcado
      ) {
        throw new Error('Resposta de interesse invalida.');
      }

      return marcado;
    },
  };
}