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
  let geracao = 0;
  let operacao: AbortController | null = null;

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

    geracao++;
    operacao?.abort();
    operacao = null;
    sessao = novaSessao;

    atualizar({
      ids: [],
      carregando: false,
      pronto: false,
      pendente: null,
      erro: '',
    });
  }

  async function carregar(): Promise<boolean> {
    if (!sessao || operacao) return false;

    const atual = geracao;
    const controller = new AbortController();

    operacao = controller;

    atualizar({ carregando: true, erro: '' });

    try {
      const ids = await servico.listar(controller.signal);

      if (atual !== geracao) return false;

      atualizar({ ids, pronto: true });
      return true;
    } catch {
      if (atual === geracao) {
        atualizar({
          pronto: false,
          erro: 'Nao foi possivel consultar seus interesses.',
        });
      }

      return false;
    } finally {
      if (atual === geracao) {
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

    const atual = geracao;
    const anteriores = estado.ids;
    const marcado = !anteriores.includes(postId);
    const controller = new AbortController();

    operacao = controller;

    atualizar({
      ids: atualizarInteresse(anteriores, postId, marcado),
      pendente: postId,
      erro: '',
    });

    try {
      await servico.definir(postId, marcado, controller.signal);

      return atual === geracao;
    } catch {
      if (atual !== geracao) return false;

      atualizar({
        ids: anteriores,
        erro: 'Nao foi possivel confirmar a alteracao.',
      });

      try {
        const ids = await servico.listar(controller.signal);

        if (atual === geracao) {
          atualizar({ ids, pronto: true });
        }
      } catch {
        if (atual === geracao) {
          atualizar({
            pronto: false,
            erro: 'Atualize seus interesses antes de tentar novamente.',
          });
        }
      }

      return false;
    } finally {
      if (atual === geracao) {
        operacao = null;
        atualizar({ pendente: null });
      }
    }
  }

  return {
    trocarSessao,
    carregar,
    alternar,
    obterEstado: () => estado,
    encerrar: () => trocarSessao(null),
  };
}