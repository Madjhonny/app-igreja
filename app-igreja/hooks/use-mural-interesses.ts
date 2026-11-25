import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Platform } from 'react-native';

import {
  apiFetch,
  getSessionToken,
  subscribeSession,
  type SessionUser
} from '@/services/session';

import {
  criarServicoInteresses,
  podeUsarInteresses
} from '@/services/mural-interesses';

import {
  criarControladorInteresses,
  type EstadoInteresses
} from '@/services/mural-interesses-controller';

import {
  criarRequisicaoInteresses
} from '@/services/mural-interesses-session';

const ESTADO_INICIAL: EstadoInteresses = {
  ids: [],
  carregando: false,
  pronto: false,
  pendente: null,
  erro: '',
};

// O mesmo retorno à janela pode disparar visibilitychange e focus.
const INTERVALO_EVENTOS_FOCO_MS = 100;

type Controlador = ReturnType<typeof criarControladorInteresses>;

type Vinculo = {
  usuarioId: number;
  controlador: Controlador;
};

export function useMuralInteresses(
  usuario: SessionUser | null,
  convidado: boolean
) {
  const permitido = podeUsarInteresses(usuario, convidado);
  const usuarioId = permitido ? usuario!.id : null;

  const [estado, setEstado] = useState<EstadoInteresses>(ESTADO_INICIAL);
  const [vinculo, setVinculo] = useState<Vinculo | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [emFoco, setEmFoco] = useState(false);
  const focoAnterior = useRef(false);
  const timerFoco = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useFocusEffect(useCallback(() => {
    setEmFoco(true);
    return () => setEmFoco(false);
  }, []));

  useEffect(() => {
    let ativo = true;
    let controlador: Controlador | null = null;
    let tokenOriginal: string | null = null;

    setVinculo(null);
    setEstado(ESTADO_INICIAL);

    const cancelamento = new AbortController();

    function invalidar() {
      ativo = false;
      cancelamento.abort();
      controlador?.encerrar();
      setVinculo(null);
      setEstado(ESTADO_INICIAL);
    }

    const cancelarInscricao = subscribeSession(evento => {
      if (
        evento.user?.id !== usuarioId ||
        !podeUsarInteresses(evento.user, convidado)
      ) {
        invalidar();
        return;
      }

      if (tokenOriginal) {
        void getSessionToken().then(tokenAtual => {
          if (ativo && tokenAtual !== tokenOriginal) {
            invalidar();
            setTentativa(valor => valor + 1);
          }
        }).catch(() => {
          if (ativo) invalidar();
        });
      }
    });

    async function iniciar() {
      if (!usuarioId) return;

      try {
        const token = await getSessionToken();

        if (!ativo) return;

        if (!token) {
          throw new Error('Sessao indisponivel.');
        }

        tokenOriginal = token;

        const resposta = await apiFetch('/sessao', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
          signal: cancelamento.signal,
        });

        if (!ativo) return;

        if (!resposta.ok) {
          throw new Error('Sessao nao confirmada.');
        }

        const dados = await resposta.json();
        const tokenAtual = await getSessionToken();

        if (!ativo) return;

        if (
          tokenAtual !== token ||
          dados.usuario?.id !== usuarioId ||
          !podeUsarInteresses(dados.usuario, false)
        ) {
          throw new Error('Sessao alterada.');
        }

        const requisicao = criarRequisicaoInteresses(token, {
          obterToken: getSessionToken,
          requisitar: apiFetch,
        });

        const servico = criarServicoInteresses(requisicao);

        controlador = criarControladorInteresses(
          servico,
          novoEstado => {
            if (ativo) setEstado(novoEstado);
          }
        );

        controlador.trocarSessao(String(usuarioId));

        setVinculo({
          usuarioId,
          controlador,
        });
      } catch {
        if (ativo) {
          setEstado({
            ...ESTADO_INICIAL,
            erro: 'Não foi possível carregar seus interesses.',
          });
        }
      }
    }

    void iniciar();

    return () => {
      ativo = false;
      cancelamento.abort();
      cancelarInscricao();
      controlador?.encerrar();
    };
  }, [usuarioId, convidado, tentativa]);

  const vinculoValido =
    permitido &&
    vinculo !== null &&
    vinculo.usuarioId === usuarioId;

  const controladorAtivo = vinculoValido
    ? vinculo.controlador
    : null;

  const falhaInicial = permitido && !controladorAtivo && !!estado.erro;

  useEffect(() => {
    const entrouNaTela = emFoco && !focoAnterior.current;
    focoAnterior.current = emFoco;
    if (!emFoco || (!controladorAtivo && !falhaInicial)) return;

    function agendar() {
      clearTimeout(timerFoco.current);
      timerFoco.current = setTimeout(() => {
        if (Platform.OS === 'web' && document.visibilityState === 'hidden') return;
        if (Platform.OS !== 'web' && AppState.currentState && AppState.currentState !== 'active') return;

        if (controladorAtivo) void controladorAtivo.sincronizar();
        else setTentativa(valor => valor + 1);
      }, INTERVALO_EVENTOS_FOCO_MS);
    }

    if (controladorAtivo || entrouNaTela) agendar();

    if (Platform.OS === 'web') {
      document.addEventListener('visibilitychange', agendar);
      window.addEventListener('focus', agendar);
      window.addEventListener('online', agendar);
      return () => {
        clearTimeout(timerFoco.current);
        document.removeEventListener('visibilitychange', agendar);
        window.removeEventListener('focus', agendar);
        window.removeEventListener('online', agendar);
      };
    }

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') agendar();
    });
    return () => {
      clearTimeout(timerFoco.current);
      subscription.remove();
    };
  }, [controladorAtivo, emFoco, falhaInicial]);

  const carregar = useCallback(async () => {
    if (!permitido) return false;
    clearTimeout(timerFoco.current);

    if (!controladorAtivo) {
      setTentativa(valor => valor + 1);
      return false;
    }

    return controladorAtivo.carregar();
  }, [permitido, controladorAtivo]);

  const alternar = useCallback(async (postId: number) => {
    if (!controladorAtivo) return false;

    return controladorAtivo.alternar(postId);
  }, [controladorAtivo]);

  return {
    permitido,
    estado: vinculoValido
      ? estado
      : {
          ...ESTADO_INICIAL,
          erro: permitido ? estado.erro : '',
        },
    carregar,
    alternar,
  };
}
