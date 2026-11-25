import {
  atualizarInteresse,
  idInteresseValido
} from './mural-interesses.ts';

type Servico = {
  listar(signal?: AbortSignal): Promise<number[]>;
  definir(
    postId: number,
    marcado: boolean,
    signal?: AbortSignal
  ): Promise<boolean>;
};

export type EstadoInteresses = {
  ids: readonly number[];
  carregando: boolean;
  pronto: boolean;
  pendente: number | null;
  erro: string;
};

export function criarControladorInteresses(
  servico: Servico,
  publicar: (estado: EstadoInteresses) => void
) {
  let sessao: string | null = null;
  type Operacao = { tipo: 'consulta' | 'alteracao'; controller: AbortController };
  let operacao: Operacao | null = null;
  let sincronizacaoPendente = false;

  let estado: EstadoInteresses = {
    ids: [],
    carregando: false,
    pronto: false,
    pendente: null,
    erro: '',
  };

  function atualizar(parcial: Partial<EstadoInteresses>) {
    estado = { ...estado, ...parcial };
    publicar(estado);
  }

  function trocarSessao(novaSessao: string | null) {
    if (sessao === novaSessao) return;

    operacao?.controller.abort();
    operacao = null;
    sincronizacaoPendente = false;
    sessao = novaSessao;

    atualizar({
      ids: [],
      carregando: false,
      pronto: false,
      pendente: null,
      erro: '',
    });
  }

  async function carregar(sincronizar = false): Promise<boolean> {
    if (!sessao) return false;
    if (operacao) {
      if (!sincronizar) return false;
      if (operacao.tipo === 'alteracao') {
        sincronizacaoPendente = true;
        return false;
      }
      operacao.controller.abort();
    }

    const atual: Operacao = { tipo: 'consulta', controller: new AbortController() };
    operacao = atual;

    atualizar({ carregando: true, erro: '' });

    try {
      const ids = await servico.listar(atual.controller.signal);

      if (operacao !== atual) return false;

      atualizar({ ids, pronto: true });
      return true;
    } catch {
      if (operacao === atual) {
        atualizar({
          pronto: false,
          erro: 'Não foi possível consultar seus interesses.',
        });
      }

      return false;
    } finally {
      if (operacao === atual) {
        operacao = null;
        atualizar({ carregando: false });
      }
    }
  }

  async function alternar(postId: number): Promise<boolean> {
    if (
      !sessao ||
      !estado.pronto ||
      operacao ||
      !idInteresseValido(postId)
    ) {
      return false;
    }

    const anteriores = estado.ids;
    const marcado = !anteriores.includes(postId);
    const atual: Operacao = { tipo: 'alteracao', controller: new AbortController() };
    operacao = atual;

    atualizar({
      ids: atualizarInteresse(anteriores, postId, marcado),
      pendente: postId,
      erro: '',
    });

    try {
      await servico.definir(postId, marcado, atual.controller.signal);

      return operacao === atual;
    } catch {
      if (operacao !== atual) return false;

      atualizar({ ids: anteriores });

      try {
        const ids = await servico.listar(atual.controller.signal);

        if (operacao !== atual) return false;

        const confirmado = ids.includes(postId) === marcado;
        atualizar({
          ids,
          pronto: true,
          erro: confirmado ? '' : 'Não foi possível confirmar a alteração.',
        });
        return confirmado;
      } catch {
        if (operacao === atual) {
          atualizar({
            pronto: false,
            erro: 'Atualize seus interesses antes de tentar novamente.',
          });
        }
      }

      return false;
    } finally {
      if (operacao === atual) {
        operacao = null;
        atualizar({ pendente: null });
        if (sincronizacaoPendente) {
          sincronizacaoPendente = false;
          void carregar();
        }
      }
    }
  }

  return {
    trocarSessao,
    carregar,
    sincronizar: () => carregar(true),
    alternar,
    obterEstado: () => estado,
    encerrar: () => trocarSessao(null),
  };
}
