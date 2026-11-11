import { useAppDialog } from '@/components/app-dialog';
import { API_URL, apiFetch, getSessionToken } from '@/services/session';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, Modal, TextInput, ActivityIndicator, useWindowDimensions, Platform } from 'react-native';

import { router, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const MESES = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL',
  'MAIO', 'JUNHO', 'JULHO', 'AGOSTO',
  'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
];

const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const ordenarEventos = (eventos: any[]) => [...eventos].sort((a, b) =>
  String(a.data_inicio).localeCompare(String(b.data_inicio)) ||
  String(a.horario || '').localeCompare(String(b.horario || '')) ||
  Number(a.id) - Number(b.id)
);

export default function TelaGestaoDatas() {
  const { alert: mostrarDialogo, showDialog } = useAppDialog();
  const { width, height: windowHeight } = useWindowDimensions();
  const isDesktop = width >= 900;

  const [token, setToken] = useState('');
  const [mesAtual, setMesAtual] = useState(new Date().getMonth());
  const [anoAtual, setAnoAtual] = useState(new Date().getFullYear());

  const [congregacoes, setCongregacoes] = useState<any[]>([]);
  const [eventosPlanejados, setEventosPlanejados] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [salvandoRascunho, setSalvandoRascunho] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [mensagemOperacao, setMensagemOperacao] = useState('');
  const dadosCarregadosRef = useRef(false);
  const revisaoLocalRef = useRef(0);
  const salvandoRef = useRef(false);
  const publicandoRef = useRef(false);

  const [dataSelecionada, setDataSelecionada] = useState(
    formatarData(new Date())
  );
  // calendar = visão mensal/anual; day, threeDays e week = agenda detalhada.
  const [modoVisualizacao, setModoVisualizacao] = useState<'calendar' | 'day' | 'threeDays' | 'week'>('calendar');
  const [duracaoMinutos, setDuracaoMinutos] = useState('60');

  // Modal de criação
  const [modalCriarVisivel, setModalCriarVisivel] = useState(false);
  const [criacaoRapidaVisivel, setCriacaoRapidaVisivel] = useState(false);
  const [criacaoRapidaRetornoSeletor, setCriacaoRapidaRetornoSeletor] = useState(false);
  const [posicaoCriacaoRapida, setPosicaoCriacaoRapida] = useState({ left: 12, top: 80 });
  const [horarioFimRapido, setHorarioFimRapido] = useState('20:30');
  const [titulo, setTitulo] = useState('');
  const [legenda, setLegenda] = useState('');
  const [congregacaoId, setCongregacaoId] = useState('');
  const [nomeCongregacaoSelecionada, setNomeCongregacaoSelecionada] =
    useState('Selecionar congregação');

  const [modalCongregacaoVisivel, setModalCongregacaoVisivel] =
    useState(false);

  const [dataInicio, setDataInicio] = useState<string | null>(null);
  const [dataFim, setDataFim] = useState<string | null>(null);

  const [modalCalendarioVisivel, setModalCalendarioVisivel] =
    useState(false);

  const [horario, setHorario] = useState('19:30');
  const [modalHorarioVisivel, setModalHorarioVisivel] = useState(false);

  const [horaTemp, setHoraTemp] = useState('19');
  const [minTemp, setMinTemp] = useState('30');

  const [marcadorSelecionado, setMarcadorSelecionado] =
    useState('NORMAL');

  // Modal de opções
  const [modalOpcoesVisivel, setModalOpcoesVisivel] = useState(false);
  const [eventoAtivo, setEventoAtivo] = useState<any>(null);

  useEffect(() => {
    if (!mensagemOperacao) return;
    const timeout = setTimeout(() => setMensagemOperacao(''), 4000);
    return () => clearTimeout(timeout);
  }, [mensagemOperacao]);

  const mostrarAviso = (titulo: string, mensagem: string) => {
    mostrarDialogo(titulo, mensagem);
  };

  function formatarData(data: Date) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  function normalizarData(data: string) {
    if (!data) return '';
    return String(data).split('T')[0];
  }

  const adicionarDias = (dataStr: string, quantidade: number) => {
    const [ano, mes, dia] = normalizarData(dataStr).split('-').map(Number);
    const data = new Date(ano, mes - 1, dia);
    data.setDate(data.getDate() + quantidade);
    return formatarData(data);
  };

  const obterDiasVisiveis = () => {
    const quantidade = modoVisualizacao === 'day' ? 1 : modoVisualizacao === 'threeDays' ? 3 : 7;
    return Array.from({ length: quantidade }, (_, index) =>
      adicionarDias(dataSelecionada, index)
    );
  };

  const nomeDiaSemana = (dataStr: string) => {
    const [ano, mes, dia] = dataStr.split('-').map(Number);
    return ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'][
      new Date(ano, mes - 1, dia).getDay()
    ];
  };

  const atualizarDataSelecionada = (dataStr: string) => {
    setDataSelecionada(dataStr);
    const [ano, mes] = dataStr.split('-').map(Number);
    setMesAtual(mes - 1);
    setAnoAtual(ano);
  };

  function obterEventosDoDia(data: string) {
    return eventosPlanejados
      .filter((ev) => {
        const inicio = normalizarData(ev.data_inicio);
        const fim = normalizarData(ev.data_fim || ev.data_inicio);

        return data >= inicio && data <= fim;
      })
      .sort((a, b) =>
        String(a.horario || '').localeCompare(String(b.horario || ''))
      );
  }

  function obterEventosDoMes(mes: number, ano: number) {
    const inicioMes = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
    const fimMes = formatarData(new Date(ano, mes + 1, 0));

    return eventosPlanejados.filter((ev) => {
      const inicio = normalizarData(ev.data_inicio);
      const fim = normalizarData(ev.data_fim || ev.data_inicio);

      return inicio <= fimMes && fim >= inicioMes;
    });
  }

  // =====================================================
  // CARREGAR DADOS
  // =====================================================

  const carregarDados = async () => {
    const revisaoAoIniciar = revisaoLocalRef.current;
    // O spinner de tela inteira só aparece no carregamento inicial.
    if (!dadosCarregadosRef.current) setCarregando(true);

    try {
      const userToken = await getSessionToken();

      if (!userToken) {
        router.replace('/login');
        return;
      }

      setToken(userToken);

      const respCong = await apiFetch(`${API_URL}/congregacoes`);

      if (respCong.ok) {
        setCongregacoes(await respCong.json());
      }

      const respPlan = await apiFetch(`${API_URL}/gestao-datas`, {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      });

      if (respPlan.ok) {
        const dados = await respPlan.json();
        // Uma resposta iniciada antes de uma mutação local não pode desfazê-la.
        if (revisaoAoIniciar === revisaoLocalRef.current) {
          setEventosPlanejados(dados);
        }
        dadosCarregadosRef.current = true;
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      mostrarDialogo('Erro', 'Não foi possível carregar os dados.');
    } finally {
      setCarregando(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      carregarDados();
    }, [])
  );

  // =====================================================
  // NAVEGAÇÃO
  // =====================================================

  const mudarMes = (direcao: number) => {
    let novoMes = mesAtual + direcao;
    let novoAno = anoAtual;

    if (novoMes > 11) {
      novoMes = 0;
      novoAno++;
    } else if (novoMes < 0) {
      novoMes = 11;
      novoAno--;
    }

    setMesAtual(novoMes);
    setAnoAtual(novoAno);
  };

  const mudarAno = (direcao: number) => {
    setAnoAtual((atual) => atual + direcao);
  };

  const irParaHoje = () => {
    const hoje = new Date();
    setMesAtual(hoje.getMonth());
    setAnoAtual(hoje.getFullYear());
    setDataSelecionada(formatarData(hoje));
  };


  // Navega pelo período atualmente selecionado (1, 3 ou 7 dias).
  const mudarPeriodoAgenda = (direcao: number) => {
    const quantidade = modoVisualizacao === 'day' ? 1 : modoVisualizacao === 'threeDays' ? 3 : 7;
    atualizarDataSelecionada(adicionarDias(dataSelecionada, direcao * quantidade));
  };

  // Título do intervalo exibido na agenda detalhada.
  const tituloPeriodoAgenda = () => {
    const dias = obterDiasVisiveis();
    if (dias.length === 0) return '';

    const formatarCurto = (dataStr: string) => {
      const [, mes, dia] = dataStr.split('-').map(Number);
      return `${String(dia).padStart(2, '0')} ${MESES[mes - 1].slice(0, 3)}`;
    };

    const primeiro = dias[0];
    const ultimo = dias[dias.length - 1];
    const anoPrimeiro = primeiro.slice(0, 4);
    const anoUltimo = ultimo.slice(0, 4);

    if (primeiro === ultimo) return `${formatarCurto(primeiro)} ${anoPrimeiro}`;
    if (anoPrimeiro === anoUltimo) {
      return `${formatarCurto(primeiro)} – ${formatarCurto(ultimo)} ${anoPrimeiro}`;
    }
    return `${formatarCurto(primeiro)} ${anoPrimeiro} – ${formatarCurto(ultimo)} ${anoUltimo}`;
  };

  // =====================================================
  // ABRIR CRIAÇÃO DE EVENTO
  // =====================================================

  const prepararCriacaoParaDia = (dataFormatada: string, horarioInicial = '19:30') => {
    setDataInicio(dataFormatada);
    setDataFim(dataFormatada);
    setTitulo('');
    setLegenda('');
    setCongregacaoId('');
    setNomeCongregacaoSelecionada('Selecionar congregação');
    setHorario(horarioInicial);
    setDuracaoMinutos('60');
    setHorarioFimRapido(calcularHorarioFinal(horarioInicial, 60));
    setMarcadorSelecionado('NORMAL');
  };

  const calcularHorarioFinal = (inicio: string, minutos: number) => {
    const partes = /^([0-2]\d):([0-5]\d)$/.exec(inicio);
    if (!partes) return '20:00';
    const total = Math.min(1439, Number(partes[1]) * 60 + Number(partes[2]) + minutos);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  const abrirCriacaoParaDia = (dataFormatada: string, horarioInicial = '19:30') => {
    prepararCriacaoParaDia(dataFormatada, horarioInicial);
    setCriacaoRapidaVisivel(false);
    setModalCriarVisivel(true);
  };

  const abrirCriacaoRapida = (dataFormatada: string, horarioInicial: string, evento: any) => {
    prepararCriacaoParaDia(dataFormatada, horarioInicial);
    setHorarioFimRapido(calcularHorarioFinal(horarioInicial, 60));

    const pageX = Number(evento?.nativeEvent?.pageX ?? evento?.nativeEvent?.clientX ?? 0);
    const pageY = Number(evento?.nativeEvent?.pageY ?? evento?.nativeEvent?.clientY ?? 0);
    const popupWidth = Math.min(360, Math.max(240, width - 24));
    const popupHeight = Math.min(470, Math.max(360, windowHeight - 24));
    const left = isDesktop
      ? Math.max(12, Math.min(pageX + 12, width - popupWidth - 12))
      : Math.max(12, (width - popupWidth) / 2);
    const top = Math.max(12, Math.min(pageY + 12, windowHeight - popupHeight - 12));

    setPosicaoCriacaoRapida({ left, top });
    setModalCriarVisivel(false);
    setCriacaoRapidaVisivel(true);
  };

  const salvarCriacaoRapida = () => {
    const validarHora = (valor: string) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(valor);
    if (!validarHora(horario) || !validarHora(horarioFimRapido)) {
      return mostrarDialogo('Horário inválido', 'Informe os horários no formato HH:MM.');
    }
    const [horaInicio, minutoInicio] = horario.split(':').map(Number);
    const [horaFim, minutoFim] = horarioFimRapido.split(':').map(Number);
    const inicio = horaInicio * 60 + minutoInicio;
    const fim = horaFim * 60 + minutoFim;
    const duracao = fim - inicio;
    if (duracao < 15 || duracao > 1440) {
      return mostrarDialogo('Horário inválido', 'O término deve ser posterior ao início, com duração mínima de 15 minutos.');
    }
    setDuracaoMinutos(String(duracao));
    salvarEventoRascunho(duracao);
  };

  // =====================================================
  // SELEÇÃO DE DATAS
  // =====================================================

  const selecionarDiaCalendario = (diaStr: string) => {
    if (!dataInicio || (dataInicio && dataFim)) {
      setDataInicio(diaStr);
      setDataFim(null);
    } else if (dataInicio && !dataFim) {
      if (diaStr < dataInicio) {
        setDataFim(dataInicio);
        setDataInicio(diaStr);
      } else {
        setDataFim(diaStr);
      }
    }
  };

  const confirmarDatas = () => {
    if (!dataInicio) {
      return mostrarDialogo('Atenção', 'Selecione a data.');
    }

    if (!dataFim) {
      setDataFim(dataInicio);
    }

    setModalCalendarioVisivel(false);
  };

  // =====================================================
  // SALVAR EVENTO
  // =====================================================

  const salvarEventoRascunho = async (duracaoRapida?: number) => {
    if (salvandoRef.current) return;
    if (!titulo.trim()) {
      return mostrarAviso('Atenção', 'Informe o título do evento.');
    }
    if (!congregacaoId) {
      return mostrarAviso('Atenção', 'Selecione uma congregação.');
    }
    if (!dataInicio) {
      return mostrarAviso('Atenção', 'Selecione a data do evento.');
    }
    if (!token) {
      return mostrarAviso('Erro', 'Sua sessão expirou. Faça login novamente.');
    }

    const duracao = duracaoRapida ?? Number(duracaoMinutos);
    if (!Number.isInteger(duracao) || duracao < 15 || duracao > 1440) {
      return mostrarAviso('Atenção', 'Informe uma duração entre 15 e 1440 minutos.');
    }

    salvandoRef.current = true;
    setSalvandoRascunho(true);
    try {
      const resp = await apiFetch(API_URL + '/gestao-datas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({
          titulo: titulo.trim(),
          data_inicio: dataInicio,
          data_fim: dataFim || dataInicio,
          horario,
          duracao_minutos: duracao,
          congregacao_id: congregacaoId,
          legenda,
          marcador: marcadorSelecionado,
        }),
      });
      const dados = await resp.json();
      if (!resp.ok || !dados.evento?.id) {
        mostrarAviso('Erro', dados.erro || 'Não foi possível salvar.');
        return;
      }

      const congregacao = congregacoes.find(c => Number(c.id) === Number(congregacaoId));
      // Usa o evento confirmado pela API; não precisa consultar a lista inteira novamente.
      revisaoLocalRef.current += 1;
      setEventosPlanejados(atuais => ordenarEventos([
        ...atuais,
        { ...dados.evento, congregacao: congregacao?.nome || nomeCongregacaoSelecionada },
      ]));
      setModalCriarVisivel(false);
      setCriacaoRapidaVisivel(false);
      setMensagemOperacao(dados.conflitoDetectado
        ? 'Evento salvo com conflito: revise o marcador vermelho.'
        : 'Evento adicionado ao planejamento.');
      if (dados.conflitoDetectado) {
        mostrarAviso('Conflito identificado',
          'O evento foi salvo, mas existe outro evento da mesma congregação no mesmo período e horário.');
      }
    } catch (error) {
      console.error('Erro ao salvar rascunho:', error);
      mostrarAviso('Erro', 'Falha de conexão com o servidor.');
    } finally {
      salvandoRef.current = false;
      setSalvandoRascunho(false);
    }
  };

  // =====================================================
  // ALTERAR MARCADOR
  // =====================================================

  const alterarMarcadorEvento = async (novoMarcador: string) => {
    if (!eventoAtivo) return;
    const id = eventoAtivo.id;
    const marcadorAnterior = eventoAtivo.marcador;

    // Atualização otimista: o calendário muda imediatamente.
    revisaoLocalRef.current += 1;
    setEventosPlanejados(atuais => atuais.map(ev =>
      ev.id === id ? { ...ev, marcador: novoMarcador } : ev
    ));
    setModalOpcoesVisivel(false);
    setEventoAtivo(null);

    try {
      const resp = await apiFetch(API_URL + '/gestao-datas/' + id + '/marcador', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ marcador: novoMarcador }),
      });
      if (!resp.ok) {
        const dados = await resp.json().catch(() => ({}));
        throw new Error(dados.erro || 'Não foi possível atualizar o marcador.');
      }
      setMensagemOperacao('Marcador atualizado no planejamento.');
    } catch (error) {
      // Se falhar, restaura o estado anterior sem recarregar a página.
      revisaoLocalRef.current += 1;
      setEventosPlanejados(atuais => atuais.map(ev =>
        ev.id === id && ev.marcador === novoMarcador
          ? { ...ev, marcador: marcadorAnterior }
          : ev
      ));
      console.error('Erro ao alterar marcador:', error);
      mostrarAviso('Erro', error instanceof Error ? error.message : 'Falha de conexão.');
    }
  };

  // =====================================================
  // EXCLUIR RASCUNHO
  // =====================================================

  const excluirRascunho = (id: number) => {
    setModalOpcoesVisivel(false);

    const removerEvento = async () => {
      const eventoAnterior = eventosPlanejados.find(ev => ev.id === id);

      // Remove imediatamente da interface, preservando mês, ano e rolagem.
      revisaoLocalRef.current += 1;
      setEventosPlanejados(atuais => atuais.filter(ev => ev.id !== id));

      try {
        const resp = await apiFetch(API_URL + '/gestao-datas/' + id, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + token },
        });
        if (!resp.ok) {
          const dados = await resp.json().catch(() => ({}));
          throw new Error(dados.erro || 'Não foi possível remover o evento.');
        }
        setMensagemOperacao('Evento removido do planejamento.');
      } catch (error) {
        // Reverte somente o evento afetado se a API rejeitar a exclusão.
        if (eventoAnterior) {
          revisaoLocalRef.current += 1;
          setEventosPlanejados(atuais => atuais.some(ev => ev.id === id)
            ? atuais
            : ordenarEventos([...atuais, eventoAnterior]));
        }
        console.error('Erro ao excluir rascunho:', error);
        mostrarAviso('Erro', error instanceof Error ? error.message : 'Falha de conexão.');
      }
    };

    // A própria opção "Remover do Planejamento" inicia a exclusão.
    // Sem confirmação bloqueante na Web ou no Android.
    void removerEvento();
  };

  // =====================================================
  // PUBLICAR EVENTOS
  // =====================================================

  const publicarNaAgendaGeral = () => {
    if (publicandoRef.current || eventosPlanejados.length === 0) return;

    const executarPublicacao = async (confirmarConflitos = false) => {
      if (publicandoRef.current) return;
      publicandoRef.current = true;
      setPublicando(true);
      const idsPublicados = new Set(eventosPlanejados.map(ev => ev.id));
      let confirmacaoNecessaria: any = null;

      try {
        const resp = await apiFetch(`${API_URL}/gestao-datas/publicar`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ confirmar_conflitos: confirmarConflitos }),
        });

        const dados = await resp.json().catch(() => ({}));

        if (resp.ok) {
          revisaoLocalRef.current += 1;
          setEventosPlanejados(atuais => atuais.filter(ev => !idsPublicados.has(ev.id)));
          setMensagemOperacao(dados.mensagem || 'Eventos publicados com sucesso!');
        } else if (resp.status === 409 && dados.codigo === 'CONFIRMACAO_CONFLITOS_NECESSARIA') {
          confirmacaoNecessaria = dados;
        } else {
          mostrarAviso('Erro', dados.erro || 'Falha ao publicar.');
        }
      } catch (error) {
        console.error('Erro ao publicar:', error);
        mostrarAviso('Erro', 'Falha de conexão com o servidor.');
      } finally {
        publicandoRef.current = false;
        setPublicando(false);
      }

      if (confirmacaoNecessaria) {
        const { resumo = {}, conflitos = [] } = confirmacaoNecessaria;
        showDialog({
          title: 'Conflitos ou pendências de publicação',
          message: 'O servidor encontrou situações que exigem sua autorização. Verifique os eventos e as datas abaixo antes de prosseguir.',
          details: [
            { label: 'Sobreposições encontradas', value: resumo.sobreposicoesEncontradas || 0 },
            { label: 'Eventos para revisar', value: resumo.revisar || 0 },
            { label: 'Marcados como conflito', value: resumo.marcadosConflito || 0 },
          ],
          conflicts,
          buttons: [
            { text: 'Voltar e revisar', style: 'cancel' },
            { text: 'Publicar mesmo assim', style: 'destructive',
              onPress: () => void executarPublicacao(true) },
          ],
        });
      }
    };

    const aviso = 'Publicar os eventos planejados na Agenda geral? Os possíveis conflitos serão conferidos pelo servidor antes da publicação.';
    showDialog({
      title: 'Publicar na Agenda',
      message: aviso,
      buttons: [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Verificar e publicar', onPress: () => void executarPublicacao() },
      ],
    });
  };

  // =====================================================
  // GERAR DIAS DE UM MÊS
  // =====================================================

  const gerarDiasDoMes = (mes: number, ano: number) => {
    const primeiroDia = new Date(ano, mes, 1).getDay();
    const totalDias = new Date(ano, mes + 1, 0).getDate();

    const dias: (string | null)[] = [];

    for (let i = 0; i < primeiroDia; i++) {
      dias.push(null);
    }

    for (let i = 1; i <= totalDias; i++) {
      const mStr = String(mes + 1).padStart(2, '0');
      const dStr = String(i).padStart(2, '0');

      dias.push(`${ano}-${mStr}-${dStr}`);
    }

    return dias;
  };

  // =====================================================
  // ESTILOS DOS MARCADORES
  // =====================================================

  const obterEstiloCardMarcador = (marcador: string) => {
    if (marcador === 'REVISAR') return styles.cardRevisar;
    if (marcador === 'CONFLITO') return styles.cardConflito;
    return styles.cardNormal;
  };

  const obterIconeMarcador = (marcador: string) => {
    if (marcador === 'REVISAR') return '🟡';
    if (marcador === 'CONFLITO') return '🔴';
    return '🟢';
  };

  // Retorna o evento que define a cor do dia.
  // Prioridade: CONFLITO > REVISAR > NORMAL.
  const obterEventoPrincipalDoDia = (data: string) => {
    const eventos = obterEventosDoDia(data);

    if (eventos.length === 0) return null;

    const prioridade: Record<string, number> = {
      CONFLITO: 3,
      REVISAR: 2,
      NORMAL: 1,
    };

    return [...eventos].sort(
      (a, b) =>
        (prioridade[b.marcador] || 0) -
        (prioridade[a.marcador] || 0)
    )[0];
  };

  // Cores fortes para destacar os dias com eventos.
  const obterCorFundoEvento = (marcador: string) => {
    if (marcador === 'CONFLITO') return '#D84343';
    if (marcador === 'REVISAR') return '#F9A825';
    return '#388E3C';
  };

  // =====================================================
  // MINI CALENDÁRIO ANUAL - DESKTOP
  // =====================================================

  const renderizarMiniMes = (mes: number) => {
    const dias = gerarDiasDoMes(mes, anoAtual);
    const eventosMes = obterEventosDoMes(mes, anoAtual);
    const hoje = formatarData(new Date());

    return (
      <View key={`${anoAtual}-${mes}`} style={styles.miniMonth}>
        <View style={styles.miniMonthHeader}>
          <Text style={styles.miniMonthTitle}>
            {MESES[mes]}
          </Text>

          <Text style={styles.miniMonthCount}>
            {eventosMes.length} evento(s)
          </Text>
        </View>

        <View style={styles.miniWeekRow}>
          {DIAS_SEMANA.map((dia, index) => (
            <Text key={index} style={styles.miniWeekDay}>
              {dia}
            </Text>
          ))}
        </View>

        <View style={styles.miniDaysGrid}>
          {dias.map((diaStr, index) => {
            if (!diaStr) {
              return (
                <View
                  key={`empty-${index}`}
                  style={styles.miniDayEmpty}
                />
              );
            }

            const eventoPrincipal = obterEventoPrincipalDoDia(diaStr);

            const selecionado = dataSelecionada === diaStr;
            const ehHoje = hoje === diaStr;

            const temEvento = !!eventoPrincipal;

            const corEvento = temEvento
              ? obterCorFundoEvento(eventoPrincipal.marcador)
              : 'transparent';

            let bordasEvento = {};

            if (eventoPrincipal) {
              const inicio = normalizarData(
                eventoPrincipal.data_inicio
              );

              const fim = normalizarData(
                eventoPrincipal.data_fim ||
                eventoPrincipal.data_inicio
              );

              // Arredonda também nas extremidades de cada linha semanal.
              const inicioVisual =
                diaStr === inicio || index % 7 === 0;

              const fimVisual =
                diaStr === fim || index % 7 === 6;

              bordasEvento = {
                borderTopLeftRadius: inicioVisual ? 8 : 0,
                borderBottomLeftRadius: inicioVisual ? 8 : 0,
                borderTopRightRadius: fimVisual ? 8 : 0,
                borderBottomRightRadius: fimVisual ? 8 : 0,
              };
            }

            return (
              <TouchableOpacity
                key={diaStr}
                style={[
                  styles.miniDay,
                  temEvento && {
                    backgroundColor: corEvento,
                    ...bordasEvento,
                  },
                  selecionado && styles.miniDaySelected,
                  ehHoje && !selecionado && !temEvento &&
                  styles.miniDayToday,
                ]}
                onPress={() => atualizarDataSelecionada(diaStr)}
                onLongPress={() => abrirCriacaoParaDia(diaStr)}
              >
                <Text
                  style={[
                    styles.miniDayText,
                    temEvento && styles.miniDayTextEvent,
                    selecionado && styles.miniDayTextSelected,
                    ehHoje && !selecionado && !temEvento &&
                    styles.miniDayTextToday,
                  ]}
                >
                  {parseInt(diaStr.split('-')[2], 10)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  // =====================================================
  // PAINEL LATERAL DE EVENTOS - DESKTOP
  // =====================================================

  const renderizarPainelDia = () => {
    const eventosDia = obterEventosDoDia(dataSelecionada);
    const dataLegivel = dataSelecionada
      ? dataSelecionada.split('-').reverse().join('/')
      : '';

    return (
      <View style={styles.sidePanel}>
        <View style={styles.sidePanelHeader}>
          <View>
            <Text style={styles.sidePanelEyebrow}>
              DIA SELECIONADO
            </Text>
            <Text style={styles.sidePanelDate}>
              {dataLegivel}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.sideAddButton}
            onPress={() => abrirCriacaoParaDia(dataSelecionada)}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.sidePanelStats}>
          <View style={styles.sideStat}>
            <Text style={styles.sideStatNumber}>
              {eventosDia.length}
            </Text>
            <Text style={styles.sideStatLabel}>Eventos</Text>
          </View>

          <View style={styles.sideStatDivider} />

          <View style={styles.sideStat}>
            <Text style={styles.sideStatNumber}>
              {eventosDia.filter((ev) => ev.marcador === 'REVISAR').length}
            </Text>
            <Text style={styles.sideStatLabel}>Revisar</Text>
          </View>

          <View style={styles.sideStatDivider} />

          <View style={styles.sideStat}>
            <Text style={styles.sideStatNumber}>
              {eventosDia.filter((ev) => ev.marcador === 'CONFLITO').length}
            </Text>
            <Text style={styles.sideStatLabel}>Conflitos</Text>
          </View>
        </View>

        <ScrollView
          style={styles.sideEventsList}
          showsVerticalScrollIndicator={false}
        >
          {eventosDia.length === 0 ? (
            <View style={styles.emptyDay}>
              <Ionicons
                name="calendar-outline"
                size={38}
                color="#B7C4C1"
              />
              <Text style={styles.emptyDayTitle}>
                Nenhum evento neste dia
              </Text>
              <Text style={styles.emptyDayText}>
                Você pode adicionar um novo evento usando o botão acima.
              </Text>
            </View>
          ) : (
            eventosDia.map((ev) => (
              <TouchableOpacity
                key={ev.id}
                style={[
                  styles.sideEventCard,
                  obterEstiloCardMarcador(ev.marcador),
                ]}
                onPress={() => {
                  setEventoAtivo(ev);
                  setModalOpcoesVisivel(true);
                }}
              >
                <View style={styles.sideEventTop}>
                  <Text style={styles.sideEventTime}>
                    <Ionicons
                      name="time-outline"
                      size={13}
                      color="#526564"
                    />{' '}
                    {ev.horario || '--:--'}
                  </Text>
                  <Text style={styles.sideEventStatus}>
                    {obterIconeMarcador(ev.marcador)}
                  </Text>
                </View>

                <Text style={styles.sideEventTitle}>
                  {ev.titulo}
                </Text>

                <Text style={styles.sideEventCong}>
                  <Ionicons
                    name="business-outline"
                    size={13}
                    color="#788583"
                  />{' '}
                  {ev.congregacao || 'Congregação'}
                </Text>

                {ev.legenda ? (
                  <Text
                    style={styles.sideEventDescription}
                    numberOfLines={2}
                  >
                    {ev.legenda}
                  </Text>
                ) : null}

                <Text style={styles.sideEventAction}>
                  Gerenciar evento
                  <Ionicons
                    name="chevron-forward"
                    size={13}
                    color="#2A4B4C"
                  />
                </Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
    );
  };

  // =====================================================
  // CALENDÁRIO MENSAL - MOBILE
  // =====================================================

  const renderizarCalendarioMobile = () => {
    return (
      <ScrollView
        horizontal
        contentContainerStyle={styles.horizontalPlanilha}
        showsHorizontalScrollIndicator
      >
        {gerarDiasDoMes(mesAtual, anoAtual)
          .filter((dia): dia is string => dia !== null)
          .map((data) => {
            const diaNum = data.split('-')[2];
            const eventosDia = obterEventosDoDia(data);
            const eventoPrincipal = obterEventoPrincipalDoDia(data);
            const corDia = eventoPrincipal ? obterCorFundoEvento(eventoPrincipal.marcador) : '#2A4B4C';

            return (
              <View key={data} style={styles.dayColumn}>
                <TouchableOpacity
                  style={[
                    styles.dayHeaderBox,
                    { backgroundColor: corDia },
                    data === formatarData(new Date()) &&
                    !eventoPrincipal &&
                    styles.dayHeaderToday,
                  ]}
                  onPress={() => atualizarDataSelecionada(data)}
                >
                  <Text style={styles.dayHeaderNum}>
                    {diaNum}
                  </Text>
                  <Text style={styles.dayHeaderMonth}>
                    {MESES[mesAtual].substring(0, 3)}
                  </Text>
                </TouchableOpacity>

                <ScrollView
                  contentContainerStyle={{ paddingBottom: 10 }}
                  showsVerticalScrollIndicator={false}
                >
                  {eventosDia.map((ev) => (
                    <TouchableOpacity
                      key={ev.id}
                      style={[
                        styles.eventCardItem,
                        obterEstiloCardMarcador(ev.marcador),
                      ]}
                      onPress={() => {
                        setEventoAtivo(ev);
                        setModalOpcoesVisivel(true);
                      }}
                    >
                      <View style={styles.eventCardTop}>
                        <Text style={styles.eventCardTime}>
                          {ev.horario || '--:--'}
                        </Text>
                        <Text style={{ fontSize: 12 }}>
                          {obterIconeMarcador(ev.marcador)}
                        </Text>
                      </View>

                      <Text
                        style={styles.eventCardTitle}
                        numberOfLines={2}
                      >
                        {ev.titulo}
                      </Text>

                      <Text
                        style={styles.eventCardCong}
                        numberOfLines={1}
                      >
                        {ev.congregacao}
                      </Text>
                    </TouchableOpacity>
                  ))}

                  <TouchableOpacity
                    style={styles.addEventColumnBtn}
                    onPress={() => abrirCriacaoParaDia(data)}
                  >
                    <Ionicons name="add" size={22} color="#2A4B4C" />
                  </TouchableOpacity>
                </ScrollView>
              </View>
            );
          })}
      </ScrollView>
    );
  };

  // =====================================================
  // AGENDA DETALHADA (1, 3 OU 7 DIAS)
  // =====================================================

  const renderizarAgendaDetalhada = () => {
    const dias = obterDiasVisiveis();
    const alturaMinuto = 1; // 1 px por minuto; cada intervalo de 30 min mede 30 px.
    const alturaTotal = 24 * 60 * alturaMinuto;
    const larguraColuna = isDesktop ? Math.max(150, Math.floor((width - 110) / dias.length)) : 170;

    return (
      <View style={styles.detailedAgendaContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.detailedAgendaHorizontal}>
          <View>
            <View style={styles.detailedAgendaHeaderRow}>
              <View style={styles.timeGutterHeader} />
              {dias.map((data) => (
                <TouchableOpacity
                  key={`header-${data}`}
                  style={[styles.detailedDayHeader, { width: larguraColuna }, data === formatarData(new Date()) && styles.detailedDayHeaderToday]}
                  onPress={() => atualizarDataSelecionada(data)}
                >
                  <Text style={styles.detailedDayName}>{nomeDiaSemana(data)}</Text>
                  <Text style={styles.detailedDayNumber}>{data.slice(8, 10)}</Text>
                  <Text style={styles.detailedDayMonth}>{MESES[Number(data.slice(5, 7)) - 1].slice(0, 3)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView style={styles.detailedTimelineScroll} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator>
              <View style={[styles.detailedTimelineRow, { height: alturaTotal }]}>
                <View style={styles.detailedTimeGutter}>
                  {Array.from({ length: 24 }, (_, hora) => (
                    <View key={`hour-${hora}`} style={[styles.detailedHourLabel, { top: hora * 60 * alturaMinuto }]}>
                      <Text style={styles.detailedHourText}>{String(hora).padStart(2, '0')}:00</Text>
                    </View>
                  ))}
                </View>

                {dias.map((data) => {
                  const eventos = obterEventosDoDia(data).map((ev: any) => {
                    const [hora, minuto] = String(ev.horario || '00:00').split(':').map(Number);
                    const inicio = Math.max(0, Math.min(1439, (hora || 0) * 60 + (minuto || 0)));
                    const duracao = Math.max(15, Number(ev.duracao_minutos) || 60);
                    return { ev, inicio, fim: Math.min(1440, inicio + duracao), duracao };
                  }).sort((a, b) => a.inicio - b.inicio || b.fim - a.fim);

                  // Distribui eventos que se cruzam em faixas paralelas dentro do dia.
                  const grupos: (typeof eventos)[] = [];
                  let grupoAtual: typeof eventos = [];
                  let fimGrupo = -1;
                  eventos.forEach((item) => {
                    if (grupoAtual.length && item.inicio >= fimGrupo) {
                      grupos.push(grupoAtual);
                      grupoAtual = [];
                      fimGrupo = -1;
                    }
                    grupoAtual.push(item);
                    fimGrupo = Math.max(fimGrupo, item.fim);
                  });
                  if (grupoAtual.length) grupos.push(grupoAtual);

                  const posicionados: { ev: any; inicio: number; fim: number; duracao: number; faixa: number; totalFaixas: number }[] = [];
                  grupos.forEach((grupo) => {
                    const faixasFim: number[] = [];
                    const itensGrupo = grupo.map((item) => {
                      let faixa = faixasFim.findIndex((fim) => fim <= item.inicio);
                      if (faixa === -1) faixa = faixasFim.length;
                      faixasFim[faixa] = item.fim;
                      return { ...item, faixa };
                    });
                    itensGrupo.forEach((item) => posicionados.push({ ...item, totalFaixas: Math.max(1, faixasFim.length) }));
                  });

                  return (
                    <View key={data} style={[styles.detailedDayColumn, { width: larguraColuna, height: alturaTotal }]}>
                      {Array.from({ length: 24 }, (_, horaIndex) => {
                        const hora = String(horaIndex).padStart(2, '0');
                        return (
                          <TouchableOpacity
                            key={`hour-slot-${data}-${horaIndex}`}
                            activeOpacity={1}
                            style={[styles.detailedTimeSlot, { top: horaIndex * 60, height: 60 }]}
                            onPress={(evento: any) => {
                              // O toque é medido dentro da faixa de 60 px: acima = :00; abaixo = :30.
                              const posicaoY = Number(evento?.nativeEvent?.locationY ?? 0);
                              const minuto = posicaoY >= 30 ? '30' : '00';
                              abrirCriacaoRapida(data, `${hora}:${minuto}`, evento);
                            }}
                            accessibilityLabel={`Criar atividade em ${data} às ${hora}:00 ou ${hora}:30`}
                          >
                            <View pointerEvents="none" style={styles.detailedHalfHourLine} />
                          </TouchableOpacity>
                        );
                      })}

                      {posicionados.map((item) => {
                        const cor = obterCorFundoEvento(item.ev.marcador);
                        const larguraFaixa = 100 / item.totalFaixas;
                        const altura = Math.max(22, (item.fim - item.inicio) * alturaMinuto);
                        return (
                          <TouchableOpacity
                            key={`${data}-${item.ev.id}`}
                            style={[
                              styles.detailedEventBlock,
                              {
                                top: item.inicio * alturaMinuto,
                                height: altura,
                                left: `${item.faixa * larguraFaixa}%`,
                                width: `${larguraFaixa}%`,
                                backgroundColor: cor,
                              },
                            ]}
                            onPress={() => {
                              setEventoAtivo(item.ev);
                              setModalOpcoesVisivel(true);
                            }}
                          >
                            <Text style={styles.detailedEventTitle} numberOfLines={2}>{item.ev.titulo}</Text>
                            <Text style={styles.detailedEventTime} numberOfLines={1}>{item.ev.horario || '--:--'} · {item.duracao} min</Text>
                            {altura >= 58 && item.ev.congregacao ? (
                              <Text style={styles.detailedEventCongregation} numberOfLines={1}>{item.ev.congregacao}</Text>
                            ) : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    );
  };

  // =====================================================
  // INTERFACE PRINCIPAL
  // =====================================================

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* CABEÇALHO */}

      <View
        style={[
          styles.header,
          isDesktop && styles.headerDesktop,
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={23} color="#F7F5EC" />
        </TouchableOpacity>

        <View style={styles.headerTextContainer}>
          <Text style={styles.headerTitle}>
            Gestão de Datas
          </Text>
          {isDesktop && (
            <Text style={styles.headerSubtitle}>
              Planejamento anual de eventos e atividades
            </Text>
          )}
        </View>

        <View style={styles.headerActions}>
          {isDesktop && (
            <View style={styles.headerDraftBadge}>
              <View style={styles.headerDraftDot} />
              <Text style={styles.headerDraftText}>
                {eventosPlanejados.length} rascunho(s)
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={publicarNaAgendaGeral}
            disabled={publicando || eventosPlanejados.length === 0}
            style={[styles.publishHeaderBtn, publicando && { opacity: 0.6 }]}
          >
            <Ionicons name="rocket-outline" size={21} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {mensagemOperacao ? (
        <View style={{ backgroundColor: '#E2EAE9', paddingVertical: 8, paddingHorizontal: 16 }}>
          <Text accessibilityRole="alert" style={{ color: '#2A4B4C', fontWeight: '600' }}>
            {mensagemOperacao}
          </Text>
        </View>
      ) : null}

      {/* NAVEGAÇÃO */}

      <View
        style={[
          styles.navigationArea,
          isDesktop && styles.navigationAreaDesktop,
        ]}
      >
        <View style={styles.navigationControls}>
          <TouchableOpacity
            style={styles.navArrow}
            onPress={() => modoVisualizacao === 'calendar'
              ? (isDesktop ? mudarAno(-1) : mudarMes(-1))
              : mudarPeriodoAgenda(-1)
            }
          >
            <Ionicons name="chevron-back" size={22} color="#2A4B4C" />
          </TouchableOpacity>

          <View style={styles.navigationTitleContainer}>
            <Text style={styles.monthTitle}>
              {modoVisualizacao === 'calendar'
                ? (isDesktop ? `ANO ${anoAtual}` : `${MESES[mesAtual]} ${anoAtual}`)
                : tituloPeriodoAgenda()}
            </Text>
            {isDesktop && (
              <Text style={styles.navigationSubtitle}>
                {modoVisualizacao === 'calendar' ? 'Visão geral do calendário' : 'Agenda com horários'}
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={styles.navArrow}
            onPress={() => modoVisualizacao === 'calendar'
              ? (isDesktop ? mudarAno(1) : mudarMes(1))
              : mudarPeriodoAgenda(1)
            }
          >
            <Ionicons
              name="chevron-forward"
              size={22}
              color="#2A4B4C"
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.todayButton}
          onPress={irParaHoje}
        >
          <Ionicons name="today-outline" size={16} color="#2A4B4C" />
          <Text style={styles.todayButtonText}>Hoje</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.viewModeBar}>
        {([
          { key: 'calendar', label: isDesktop ? 'Anual' : 'Mensal', icon: 'calendar' },
          { key: 'day', label: '1 dia', icon: 'today-outline' },
          { key: 'threeDays', label: '3 dias', icon: 'calendar-clear-outline' },
          { key: 'week', label: '7 dias', icon: 'calendar-outline' },
        ] as const).map((item) => (
          <TouchableOpacity
            key={item.key}
            style={[
              styles.viewModeButton,
              modoVisualizacao === item.key && styles.viewModeButtonActive,
            ]}
            onPress={() => setModoVisualizacao(item.key)}
          >
            <Ionicons
              name={item.icon as any}
              size={15}
              color={modoVisualizacao === item.key ? '#fff' : '#52615D'}
            />
            <Text style={[
              styles.viewModeText,
              modoVisualizacao === item.key && styles.viewModeTextActive,
            ]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* LEGENDA */}

      <View
        style={[
          styles.legendContainer,
          isDesktop && styles.legendDesktop,
        ]}
      >
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#388E3C' }]} />
          <Text style={styles.legendText}>Normal</Text>
        </View>

        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#F9A825' }]} />
          <Text style={styles.legendText}>Revisar</Text>
        </View>

        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#D84343' }]} />
          <Text style={styles.legendText}>Conflito</Text>
        </View>

        <Text style={styles.legendHint}>
          {isDesktop
            ? 'Selecione um dia para visualizar os eventos'
            : 'Toque em um evento para gerenciar'}
        </Text>
      </View>

      {/* CONTEÚDO */}

      {carregando ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2A4B4C" />
          <Text style={styles.loadingText}>
            Carregando planejamento...
          </Text>
        </View>
      ) : modoVisualizacao !== 'calendar' ? (
        renderizarAgendaDetalhada()
      ) : isDesktop ? (
        <View style={styles.desktopContent}>
          <ScrollView
            style={styles.annualScroll}
            contentContainerStyle={styles.annualGrid}
            showsVerticalScrollIndicator
          >
            {MESES.map((_, index) => renderizarMiniMes(index))}
          </ScrollView>

          {renderizarPainelDia()}
        </View>
      ) : (
        <View style={styles.mobileContent}>
          {renderizarCalendarioMobile()}
        </View>
      )}

      {/* RODAPÉ */}

      <View
        style={[
          styles.footerBar,
          isDesktop && styles.footerBarDesktop,
        ]}
      >
        <View style={styles.footerInfo}>
          <Text style={styles.footerInfoTitle}>
            {eventosPlanejados.length} evento(s) no planejamento
          </Text>
          <Text style={styles.footerInfoSubtitle}>
            Os eventos ainda não foram publicados na Agenda geral.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.publishButton, publicando && { opacity: 0.6 }]}
          disabled={publicando || eventosPlanejados.length === 0}
          onPress={publicarNaAgendaGeral}
        >
          <Ionicons
            name="rocket"
            size={19}
            color="#fff"
            style={{ marginRight: 8 }}
          />
          <Text style={styles.publishButtonText}>
            {publicando ? 'Publicando...' : isDesktop ? 'Publicar na Agenda' : 'Publicar na Agenda Geral'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ================================================= */}
      {/* MODAL DE CRIAÇÃO */}
      {/* ================================================= */}

      <Modal
        visible={modalCriarVisivel}
        animationType="slide"
        transparent
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContentLarge,
              isDesktop && styles.modalContentDesktop,
            ]}
          >
            <Text style={styles.modalTitle}>
              Novo Evento no Planejamento
            </Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>Título do Evento *</Text>

              <TextInput
                style={styles.input}
                placeholder="Ex: Reunião Ministerial"
                placeholderTextColor="#999"
                value={titulo}
                onChangeText={setTitulo}
              />

              <Text style={styles.label}>Congregação *</Text>

              <TouchableOpacity
                style={styles.selectorButton}
                onPress={() => setModalCongregacaoVisivel(true)}
              >
                <Ionicons
                  name="business-outline"
                  size={20}
                  color="#2A4B4C"
                />
                <Text style={styles.selectorText}>
                  {nomeCongregacaoSelecionada}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={18}
                  color="#666"
                />
              </TouchableOpacity>

              <Text style={styles.label}>
                Período (Data Início / Fim) *
              </Text>

              <TouchableOpacity
                style={styles.selectorButton}
                onPress={() => setModalCalendarioVisivel(true)}
              >
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color="#2A4B4C"
                />
                <Text style={styles.selectorText}>
                  {dataInicio
                    ? `${dataInicio.split('-').reverse().join('/')} ${dataFim && dataFim !== dataInicio
                      ? `até ${dataFim.split('-').reverse().join('/')}`
                      : ''
                    }`
                    : 'Selecionar período'}
                </Text>
              </TouchableOpacity>

              <Text style={styles.label}>Horário de Início *</Text>

              <TouchableOpacity
                style={styles.selectorButton}
                onPress={() => {
                  setHoraTemp(horario.split(':')[0]);
                  setMinTemp(horario.split(':')[1]);
                  setModalHorarioVisivel(true);
                }}
              >
                <Ionicons
                  name="time-outline"
                  size={20}
                  color="#2A4B4C"
                />
                <Text style={styles.selectorText}>
                  {horario}
                </Text>
              </TouchableOpacity>

              <Text style={styles.label}>Duração da atividade (minutos)</Text>
              <TextInput
                style={styles.input}
                placeholder="60"
                placeholderTextColor="#999"
                keyboardType="numeric"
                value={duracaoMinutos}
                onChangeText={setDuracaoMinutos}
              />

              <Text style={styles.label}>
                Marcador / Status Inicial
              </Text>

              <View style={styles.marcadorRow}>
                <TouchableOpacity
                  style={[
                    styles.marcadorBtn,
                    marcadorSelecionado === 'NORMAL' &&
                    styles.marcadorAtivoNormal,
                  ]}
                  onPress={() => setMarcadorSelecionado('NORMAL')}
                >
                  <Text style={styles.marcadorText}>🟢 Normal</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.marcadorBtn,
                    marcadorSelecionado === 'REVISAR' &&
                    styles.marcadorAtivoRevisar,
                  ]}
                  onPress={() => setMarcadorSelecionado('REVISAR')}
                >
                  <Text style={styles.marcadorText}>🟡 Revisar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.marcadorBtn,
                    marcadorSelecionado === 'CONFLITO' &&
                    styles.marcadorAtivoConflito,
                  ]}
                  onPress={() => setMarcadorSelecionado('CONFLITO')}
                >
                  <Text style={styles.marcadorText}>🔴 Conflito</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>
                Descrição / Observações
              </Text>

              <TextInput
                style={[styles.input, styles.descInput]}
                placeholder="Detalhes..."
                placeholderTextColor="#999"
                value={legenda}
                onChangeText={setLegenda}
                multiline
                numberOfLines={3}
              />

              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={styles.cancelBtnModal}
                  onPress={() => setModalCriarVisivel(false)}
                >
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveBtnModal, salvandoRascunho && { opacity: 0.6 }]}
                  disabled={salvandoRascunho}
                  onPress={() => void salvarEventoRascunho()}
                >
                  <Text style={styles.saveBtnText}>
                    {salvandoRascunho ? 'Salvando...' : 'Adicionar Evento'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ================================================= */}
      {/* JANELA CONTEXTUAL DE CRIAÇÃO RÁPIDA */}
      {/* ================================================= */}
      <Modal
        visible={criacaoRapidaVisivel}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setCriacaoRapidaVisivel(false)}
      >
        <View style={styles.quickCreateOverlay}>
          <TouchableOpacity
            activeOpacity={1}
            style={styles.quickCreateBackdrop}
            onPress={() => setCriacaoRapidaVisivel(false)}
          />
          <View
            style={[
              styles.quickCreateCard,
              {
                left: posicaoCriacaoRapida.left,
                top: posicaoCriacaoRapida.top,
                width: Math.min(360, Math.max(240, width - 24)),
                maxHeight: Math.max(320, windowHeight - 24),
              },
            ]}
          >
            <View style={styles.quickCreateHeader}>
              <Text style={styles.quickCreateTitle}>Criar atividade</Text>
              <TouchableOpacity
                accessibilityLabel="Fechar criação rápida"
                onPress={() => setCriacaoRapidaVisivel(false)}
                style={styles.quickCreateClose}
              >
                <Ionicons name="close" size={20} color="#62716C" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.quickCreateLabel}>Título</Text>
              <TextInput
                style={styles.quickCreateInput}
                placeholder="Nome da atividade"
                placeholderTextColor="#929B98"
                value={titulo}
                onChangeText={setTitulo}
                autoFocus={Platform.OS === 'web'}
              />

              <View style={styles.quickCreateMetaRow}>
                <Ionicons name="calendar-outline" size={16} color="#2A4B4C" />
                <Text style={styles.quickCreateMetaText}>
                  {dataInicio ? dataInicio.split('-').reverse().join('/') : 'Data não selecionada'}
                </Text>
              </View>

              <View style={styles.quickCreateTimeRow}>
                <View style={styles.quickCreateTimeField}>
                  <Text style={styles.quickCreateLabel}>Início</Text>
                  <TextInput
                    style={styles.quickCreateInput}
                    value={horario}
                    onChangeText={setHorario}
                    placeholder="17:00"
                    maxLength={5}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <View style={styles.quickCreateTimeField}>
                  <Text style={styles.quickCreateLabel}>Término</Text>
                  <TextInput
                    style={styles.quickCreateInput}
                    value={horarioFimRapido}
                    onChangeText={setHorarioFimRapido}
                    placeholder="18:00"
                    maxLength={5}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>

              <Text style={styles.quickCreateLabel}>Congregação</Text>
              <TouchableOpacity
                style={styles.quickCreateSelector}
                onPress={() => {
                  setCriacaoRapidaRetornoSeletor(true);
                  setCriacaoRapidaVisivel(false);
                  setModalCongregacaoVisivel(true);
                }}
              >
                <Ionicons name="business-outline" size={17} color="#2A4B4C" />
                <Text style={styles.quickCreateSelectorText} numberOfLines={1}>{nomeCongregacaoSelecionada}</Text>
                <Ionicons name="chevron-down" size={16} color="#788583" />
              </TouchableOpacity>

              <Text style={styles.quickCreateLabel}>Marcador</Text>
              <View style={styles.quickCreateMarkerRow}>
                {([
                  { key: 'NORMAL', label: 'Normal', color: '#388E3C' },
                  { key: 'REVISAR', label: 'Revisar', color: '#F9A825' },
                  { key: 'CONFLITO', label: 'Conflito', color: '#D84343' },
                ] as const).map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => setMarcadorSelecionado(item.key)}
                    style={[
                      styles.quickCreateMarker,
                      marcadorSelecionado === item.key && { borderColor: item.color, backgroundColor: `${item.color}20` },
                    ]}
                  >
                    <View style={[styles.quickCreateMarkerDot, { backgroundColor: item.color }]} />
                    <Text style={styles.quickCreateMarkerText}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.quickCreateMore}
                onPress={() => {
                  const inicio = horario.split(':').map(Number);
                  const fim = horarioFimRapido.split(':').map(Number);
                  if (inicio.length === 2 && fim.length === 2 && fim[0] * 60 + fim[1] > inicio[0] * 60 + inicio[1]) {
                    setDuracaoMinutos(String((fim[0] * 60 + fim[1]) - (inicio[0] * 60 + inicio[1])));
                  }
                  setCriacaoRapidaVisivel(false);
                  setModalCriarVisivel(true);
                }}
              >
                <Ionicons name="options-outline" size={16} color="#2A4B4C" />
                <Text style={styles.quickCreateMoreText}>Mais opções e descrição</Text>
              </TouchableOpacity>

              <View style={styles.quickCreateActions}>
                <TouchableOpacity style={styles.quickCreateCancel} onPress={() => setCriacaoRapidaVisivel(false)}>
                  <Text style={styles.quickCreateCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickCreateSave, salvandoRascunho && { opacity: 0.6 }]}
                  disabled={salvandoRascunho}
                  onPress={salvarCriacaoRapida}
                >
                  <Text style={styles.quickCreateSaveText}>
                    {salvandoRascunho ? 'Salvando...' : 'Salvar'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ================================================= */}
      {/* MODAL DE OPÇÕES DO EVENTO */}
      {/* ================================================= */}

      <Modal
        visible={modalOpcoesVisivel}
        animationType="fade"
        transparent
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Gerenciar Evento</Text>

            <Text style={styles.eventoAtivoTitulo}>
              {eventoAtivo?.titulo}
            </Text>

            <Text style={styles.eventoAtivoDetalhe}>
              {eventoAtivo?.data_inicio
                ? normalizarData(eventoAtivo.data_inicio)
                  .split('-')
                  .reverse()
                  .join('/')
                : ''}
              {'  •  '}
              {eventoAtivo?.horario}
              {'  •  '}
              {eventoAtivo?.duracao_minutos || 60} min
            </Text>

            <Text style={styles.subModalLabel}>
              Alterar Marcador:
            </Text>

            <TouchableOpacity
              style={[styles.optionBtn, { backgroundColor: '#E8F5E9' }]}
              onPress={() => alterarMarcadorEvento('NORMAL')}
            >
              <Text style={{ color: '#2E7D32', fontWeight: 'bold' }}>
                🟢 Marcar como Normal
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, { backgroundColor: '#FFFDE7' }]}
              onPress={() => alterarMarcadorEvento('REVISAR')}
            >
              <Text style={{ color: '#F57F17', fontWeight: 'bold' }}>
                🟡 Marcar para Revisar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionBtn, { backgroundColor: '#FFEBEE' }]}
              onPress={() => alterarMarcadorEvento('CONFLITO')}
            >
              <Text style={{ color: '#C62828', fontWeight: 'bold' }}>
                🔴 Marcar como Conflito / Atenção
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.optionBtn,
                { backgroundColor: '#F0F0F0', marginTop: 15 },
              ]}
              onPress={() => excluirRascunho(eventoAtivo.id)}
            >
              <Text style={{ color: '#E63946', fontWeight: 'bold' }}>
                🗑️ Remover do Planejamento
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.closeModalBtn}
              onPress={() => setModalOpcoesVisivel(false)}
            >
              <Text style={styles.closeModalText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ================================================= */}
      {/* MODAL DE CONGREGAÇÕES */}
      {/* ================================================= */}

      <Modal
        visible={modalCongregacaoVisivel}
        animationType="slide"
        transparent
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Selecionar Congregação
            </Text>

            <ScrollView style={{ maxHeight: 300 }}>
              {congregacoes.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.modalOption}
                  onPress={() => {
                    setCongregacaoId(String(c.id));
                    setNomeCongregacaoSelecionada(c.nome);
                    setModalCongregacaoVisivel(false);
                    if (criacaoRapidaRetornoSeletor) {
                      setCriacaoRapidaRetornoSeletor(false);
                      setCriacaoRapidaVisivel(true);
                    }
                  }}
                >
                  <Text style={styles.modalOptionText}>
                    {c.nome}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.closeModalBtn}
              onPress={() => {
                setModalCongregacaoVisivel(false);
                if (criacaoRapidaRetornoSeletor) {
                  setCriacaoRapidaRetornoSeletor(false);
                  setCriacaoRapidaVisivel(true);
                }
              }}
            >
              <Text style={styles.closeModalText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ================================================= */}
      {/* MODAL DE CALENDÁRIO PARA SELEÇÃO DO PERÍODO */}
      {/* ================================================= */}

      <Modal
        visible={modalCalendarioVisivel}
        animationType="slide"
        transparent
      >
        <View style={styles.modalOverlay}>
          <View style={styles.calendarContainer}>
            <Text style={styles.modalTitle}>
              Selecione o Dia ou Período
            </Text>

            <Text style={styles.hintCalendar}>
              1º clique: início | 2º clique: término
            </Text>

            <View style={styles.weekDaysContainer}>
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(
                (dia, index) => (
                  <Text key={index} style={styles.weekDayText}>
                    {dia}
                  </Text>
                )
              )}
            </View>

            <View style={styles.daysGrid}>
              {gerarDiasDoMes(mesAtual, anoAtual).map(
                (diaStr, index) => {
                  if (!diaStr) {
                    return (
                      <View
                        key={`empty-${index}`}
                        style={styles.dayBoxEmpty}
                      />
                    );
                  }

                  const isInicio = diaStr === dataInicio;
                  const isFim = diaStr === dataFim;

                  const isInRange =
                    !!dataInicio &&
                    !!dataFim &&
                    diaStr > dataInicio &&
                    diaStr < dataFim;

                  return (
                    <TouchableOpacity
                      key={diaStr}
                      style={[
                        styles.dayBox,
                        (isInicio || isFim) && styles.dayBoxSelected,
                        isInRange && styles.dayBoxInRange,
                      ]}
                      onPress={() => selecionarDiaCalendario(diaStr)}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          (isInicio || isFim) &&
                          styles.dayTextSelected,
                        ]}
                      >
                        {parseInt(diaStr.split('-')[2], 10)}
                      </Text>
                    </TouchableOpacity>
                  );
                }
              )}
            </View>

            <TouchableOpacity
              style={styles.confirmButtonModal}
              onPress={confirmarDatas}
            >
              <Text style={styles.confirmButtonText}>
                Confirmar Período
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ================================================= */}
      {/* MODAL DE HORÁRIO */}
      {/* ================================================= */}

      <Modal
        visible={modalHorarioVisivel}
        animationType="slide"
        transparent
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Horário de Início</Text>

            <View style={styles.timeRow}>
              <TextInput
                style={styles.timeInput}
                keyboardType="numeric"
                maxLength={2}
                value={horaTemp}
                onChangeText={setHoraTemp}
              />

              <Text style={styles.timeSeparator}>:</Text>

              <TextInput
                style={styles.timeInput}
                keyboardType="numeric"
                maxLength={2}
                value={minTemp}
                onChangeText={setMinTemp}
              />
            </View>

            <TouchableOpacity
              style={styles.confirmButtonModal}
              onPress={() => {
                const hora = parseInt(horaTemp, 10);
                const minuto = parseInt(minTemp, 10);

                if (
                  !Number.isInteger(hora) ||
                  !Number.isInteger(minuto) ||
                  hora < 0 ||
                  hora > 23 ||
                  minuto < 0 ||
                  minuto > 59
                ) {
                  return mostrarDialogo(
                    'Horário inválido',
                    'Informe uma hora entre 00 e 23 e minutos entre 00 e 59.'
                  );
                }

                setHorario(
                  `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`
                );

                setModalHorarioVisivel(false);
              }}
            >
              <Text style={styles.confirmButtonText}>
                Confirmar Horário
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// =====================================================
// ESTILOS
// =====================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F5F0',
  },

  // Cabeçalho
  header: {
    backgroundColor: '#2A4B4C',
    paddingTop: 48,
    paddingBottom: 15,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  headerDesktop: {
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 30,
  },

  backButton: {
    padding: 7,
  },

  headerTextContainer: {
    flex: 1,
    marginLeft: 12,
  },

  headerTitle: {
    color: '#F7F5EC',
    fontSize: 21,
    fontWeight: 'bold',
  },

  headerSubtitle: {
    color: '#C7D7D2',
    fontSize: 12,
    marginTop: 3,
  },

  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },

  headerDraftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 7,
  },

  headerDraftDot: {
    width: 7,
    height: 7,
    borderRadius: 5,
    backgroundColor: '#B9D8A7',
  },

  headerDraftText: {
    color: '#F7F5EC',
    fontSize: 12,
    fontWeight: '600',
  },

  publishHeaderBtn: {
    padding: 7,
  },

  // Navegação
  navigationArea: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 2,
  },

  navigationAreaDesktop: {
    marginHorizontal: 25,
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },

  navigationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },

  navArrow: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F4F1',
  },

  navigationTitleContainer: {
    alignItems: 'center',
    minWidth: 130,
  },

  monthTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#2A4B4C',
  },

  navigationSubtitle: {
    fontSize: 11,
    color: '#899492',
    marginTop: 3,
  },

  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8EFEB',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 8,
    gap: 6,
  },

  todayButtonText: {
    color: '#2A4B4C',
    fontWeight: 'bold',
    fontSize: 12,
  },

  // Legenda
  legendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 17,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexWrap: 'wrap',
  },

  legendDesktop: {
    justifyContent: 'flex-start',
    paddingHorizontal: 28,
    paddingVertical: 15,
  },

  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },

  legendText: {
    color: '#687573',
    fontSize: 11,
  },

  legendHint: {
    color: '#929B98',
    fontSize: 11,
    marginLeft: 5,
  },

  // Conteúdo desktop
  desktopContent: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: 25,
    paddingBottom: 15,
    gap: 18,
    minHeight: 0,
  },

  annualScroll: {
    flex: 1,
    minWidth: 0,
  },

  annualGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingBottom: 15,
    gap: 14,
  },

  miniMonth: {
    width: '32%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E8ECE8',
    minWidth: 190,
  },

  miniMonthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  miniMonthTitle: {
    color: '#2A4B4C',
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 0.4,
  },

  miniMonthCount: {
    color: '#8B9692',
    fontSize: 10,
  },

  miniWeekRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 5,
  },

  miniWeekDay: {
    width: '14.28%',
    textAlign: 'center',
    color: '#9AA39F',
    fontSize: 10,
    fontWeight: 'bold',
  },

  miniDaysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },

  miniDayEmpty: {
    width: '14.28%',
    height: 31,
  },

  miniDay: {
    width: '14.28%',
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    position: 'relative',
  },

  miniDaySelected: {
    borderWidth: 2,
    borderColor: '#2A4B4C',
  },

  miniDayToday: {
    backgroundColor: '#E5EFEB',
    borderWidth: 1,
    borderColor: '#A8C3B8',
  },

  miniDayText: {
    color: '#4B5754',
    fontSize: 11,
  },

  miniDayTextEvent: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },

  miniDayTextSelected: {
    fontWeight: 'bold',
  },

  miniDayTextToday: {
    color: '#2A4B4C',
    fontWeight: 'bold',
  },

  miniDayIndicators: {
    position: 'absolute',
    bottom: 2,
    flexDirection: 'row',
    gap: 2,
  },

  miniDot: {
    width: 4,
    height: 4,
    borderRadius: 3,
  },

  // Painel lateral
  sidePanel: {
    width: 310,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8ECE8',
    overflow: 'hidden',
  },

  sidePanelHeader: {
    backgroundColor: '#2A4B4C',
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  sidePanelEyebrow: {
    color: '#B8CECA',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  sidePanelDate: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 5,
  },

  sideAddButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#45696A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sidePanelStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF0ED',
  },

  sideStat: {
    alignItems: 'center',
    flex: 1,
  },

  sideStatNumber: {
    color: '#2A4B4C',
    fontWeight: 'bold',
    fontSize: 19,
  },

  sideStatLabel: {
    color: '#929B98',
    fontSize: 10,
    marginTop: 3,
  },

  sideStatDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#E9EDEA',
  },

  sideEventsList: {
    flex: 1,
    padding: 12,
  },

  emptyDay: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
    paddingVertical: 45,
  },

  emptyDayTitle: {
    color: '#52615D',
    fontWeight: 'bold',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },

  emptyDayText: {
    color: '#9AA39F',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 17,
  },

  sideEventCard: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 10,
  },

  sideEventTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },

  sideEventTime: {
    color: '#526564',
    fontSize: 11,
    fontWeight: 'bold',
  },

  sideEventStatus: {
    fontSize: 12,
  },

  sideEventTitle: {
    color: '#303C39',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 6,
  },

  sideEventCong: {
    color: '#788583',
    fontSize: 11,
  },

  sideEventDescription: {
    color: '#77817D',
    fontSize: 11,
    marginTop: 7,
    lineHeight: 16,
  },

  sideEventAction: {
    color: '#2A4B4C',
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 10,
    textAlign: 'right',
  },

  // Conteúdo mobile
  mobileContent: {
    flex: 1,
    minHeight: 0,
  },

  horizontalPlanilha: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  dayColumn: {
    width: 135,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginRight: 10,
    padding: 8,
    elevation: 2,
    maxHeight: '100%',
  },

  dayHeaderBox: {
    backgroundColor: '#2A4B4C',
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },

  dayHeaderToday: {
    backgroundColor: '#456F68',
  },

  dayHeaderNum: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },

  dayHeaderMonth: {
    color: '#F7F5EC',
    fontSize: 10,
    textTransform: 'uppercase',
  },

  eventCardItem: {
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
  },

  cardNormal: {
    backgroundColor: '#F4F7F2',
    borderColor: '#DDE8DC',
  },

  cardRevisar: {
    backgroundColor: '#FFFDE7',
    borderColor: '#FFDE75',
  },

  cardConflito: {
    backgroundColor: '#FFEBEE',
    borderColor: '#EF9A9A',
  },

  eventCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  eventCardTime: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#2A4B4C',
    marginBottom: 4,
  },

  eventCardTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },

  eventCardCong: {
    fontSize: 10,
    color: '#777',
  },

  addEventColumnBtn: {
    backgroundColor: '#E2EAE9',
    height: 35,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#2A4B4C',
    marginTop: 4,
  },

  viewModeBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  viewModeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#E8ECE7',
  },
  viewModeButtonActive: {
    backgroundColor: '#2A4B4C',
  },
  viewModeText: {
    color: '#52615D',
    fontSize: 12,
    fontWeight: '600',
  },
  viewModeTextActive: {
    color: '#FFFFFF',
  },
  detailedAgendaContainer: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#F4F5F0',
  },
  detailedAgendaHorizontal: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  detailedAgendaHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F4F5F0',
    zIndex: 2,
  },
  timeGutterHeader: {
    width: 64,
  },
  detailedDayHeader: {
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 2,
    borderBottomColor: '#DCE5DF',
    borderRightWidth: 1,
    borderRightColor: '#E7ECE8',
  },
  detailedDayHeaderToday: {
    backgroundColor: '#E5EFEB',
    borderBottomColor: '#2A4B4C',
  },
  detailedDayName: {
    color: '#62716C',
    fontSize: 10,
    fontWeight: '700',
  },
  detailedDayNumber: {
    color: '#2A4B4C',
    fontSize: 21,
    fontWeight: 'bold',
  },
  detailedDayMonth: {
    color: '#788583',
    fontSize: 10,
  },
  detailedTimelineScroll: {
    maxHeight: '100%',
  },
  detailedTimelineRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  detailedTimeGutter: {
    width: 64,
    position: 'relative',
    backgroundColor: '#F4F5F0',
  },
  detailedHourLabel: {
    position: 'absolute',
    left: 0,
    right: 4,
    height: 20,
    marginTop: -8,
    alignItems: 'flex-end',
  },
  detailedHourText: {
    color: '#596964',
    fontSize: 13,
    fontWeight: '600',
  },
  detailedDayColumn: {
    position: 'relative',
    backgroundColor: '#FFFFFF',
    borderLeftWidth: 1,
    borderLeftColor: '#E7ECE8',
    borderRightWidth: 1,
    borderRightColor: '#E7ECE8',
  },
  detailedTimeSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#DCE4DF',
    zIndex: 0,
  },
  detailedHalfHourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 30,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EDF0ED',
  },
  detailedEventBlock: {
    position: 'absolute',
    zIndex: 1,
    borderRadius: 5,
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(0,0,0,0.18)',
    paddingHorizontal: 5,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  detailedEventTitle: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: 'bold',
  },
  detailedEventTime: {
    color: '#FFFFFF',
    fontSize: 9,
    marginTop: 2,
  },
  detailedEventCongregation: {
    color: '#FFFFFF',
    fontSize: 9,
    marginTop: 2,
  },

  // Janela contextual de criação rápida
  quickCreateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(16, 28, 25, 0.12)',
  },
  quickCreateBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  quickCreateCard: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#DCE5DF',
    elevation: 12,
    shadowColor: '#15221E',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  quickCreateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  quickCreateTitle: {
    color: '#2A4B4C',
    fontSize: 17,
    fontWeight: '700',
  },
  quickCreateClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F4F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickCreateLabel: {
    color: '#52615D',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 5,
    marginTop: 8,
  },
  quickCreateInput: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: '#D8E0DA',
    borderRadius: 8,
    backgroundColor: '#FAFBF9',
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#263A35',
    fontSize: 14,
  },
  quickCreateMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 11,
    paddingVertical: 4,
  },
  quickCreateMetaText: {
    color: '#52615D',
    fontSize: 12,
    fontWeight: '600',
  },
  quickCreateTimeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quickCreateTimeField: {
    flex: 1,
  },
  quickCreateSelector: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#D8E0DA',
    borderRadius: 8,
    backgroundColor: '#FAFBF9',
  },
  quickCreateSelectorText: {
    flex: 1,
    color: '#263A35',
    fontSize: 12,
  },
  quickCreateMarkerRow: {
    flexDirection: 'row',
    gap: 6,
  },
  quickCreateMarker: {
    flex: 1,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#E1E6E2',
    borderRadius: 7,
    paddingHorizontal: 4,
  },
  quickCreateMarkerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  quickCreateMarkerText: {
    color: '#52615D',
    fontSize: 10,
    fontWeight: '600',
  },
  quickCreateMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 2,
  },
  quickCreateMoreText: {
    color: '#2A4B4C',
    fontSize: 12,
    fontWeight: '700',
  },
  quickCreateActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  quickCreateCancel: {
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#EEF1EE',
  },
  quickCreateCancelText: {
    color: '#52615D',
    fontSize: 12,
    fontWeight: '700',
  },
  quickCreateSave: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2A4B4C',
  },
  quickCreateSaveText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  // Rodapé
  footerBar: {
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E9ECE8',
  },

  footerBarDesktop: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  footerInfo: {
    marginBottom: 9,
  },

  footerInfoTitle: {
    color: '#354A46',
    fontSize: 12,
    fontWeight: 'bold',
  },

  footerInfoSubtitle: {
    color: '#929B98',
    fontSize: 10,
    marginTop: 3,
  },

  publishButton: {
    backgroundColor: '#2A4B4C',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },

  publishButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingText: {
    color: '#788583',
    marginTop: 12,
    fontSize: 12,
  },

  // Modais
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.52)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },

  modalContentLarge: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    maxHeight: '85%',
    elevation: 5,
  },

  modalContentDesktop: {
    maxWidth: 560,
  },

  modalContent: {
    width: '100%',
    maxWidth: 450,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    elevation: 5,
  },

  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2A4B4C',
    marginBottom: 15,
    textAlign: 'center',
  },

  label: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2A4B4C',
    marginBottom: 6,
    marginTop: 12,
  },

  input: {
    backgroundColor: '#F9F9F6',
    borderWidth: 1,
    borderColor: '#C4C2B7',
    padding: 12,
    borderRadius: 8,
    fontSize: 15,
    color: '#333',
  },

  descInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },

  selectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F9F6',
    borderWidth: 1,
    borderColor: '#C4C2B7',
    padding: 12,
    borderRadius: 8,
  },

  selectorText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#333',
    flex: 1,
  },

  marcadorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
    gap: 6,
  },

  marcadorBtn: {
    padding: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },

  marcadorAtivoNormal: {
    backgroundColor: '#C8E6C9',
    borderColor: '#4CAF50',
  },

  marcadorAtivoRevisar: {
    backgroundColor: '#FFF9C4',
    borderColor: '#FBC02D',
  },

  marcadorAtivoConflito: {
    backgroundColor: '#FFCDD2',
    borderColor: '#E53935',
  },

  marcadorText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#333',
  },

  eventoAtivoTitulo: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 5,
  },

  eventoAtivoDetalhe: {
    color: '#84908C',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 18,
  },

  subModalLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 10,
  },

  optionBtn: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    alignItems: 'center',
  },

  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 25,
    gap: 10,
  },

  cancelBtnModal: {
    padding: 12,
    flex: 1,
    alignItems: 'center',
  },

  cancelBtnText: {
    color: '#666',
    fontWeight: 'bold',
    fontSize: 14,
  },

  saveBtnModal: {
    backgroundColor: '#2A4B4C',
    padding: 12,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
  },

  saveBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },

  modalOption: {
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },

  modalOptionText: {
    fontSize: 15,
    color: '#333',
    textAlign: 'center',
  },

  closeModalBtn: {
    marginTop: 15,
    alignItems: 'center',
    padding: 8,
  },

  closeModalText: {
    color: '#E63946',
    fontWeight: 'bold',
  },

  // Calendário do modal
  calendarContainer: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    elevation: 5,
  },

  hintCalendar: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 15,
  },

  weekDaysContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
  },

  weekDayText: {
    fontWeight: 'bold',
    color: '#666',
    width: '14.28%',
    textAlign: 'center',
    fontSize: 11,
  },

  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },

  dayBoxEmpty: {
    width: '14.28%',
    height: 38,
  },

  dayBox: {
    width: '14.28%',
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 2,
  },

  dayBoxSelected: {
    backgroundColor: '#2A4B4C',
    borderRadius: 19,
  },

  dayBoxInRange: {
    backgroundColor: '#E2EAE9',
  },

  dayText: {
    fontSize: 14,
    color: '#333',
  },

  dayTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },

  confirmButtonModal: {
    backgroundColor: '#2A4B4C',
    padding: 13,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },

  confirmButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },

  // Horário
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 20,
  },

  timeInput: {
    width: 60,
    height: 55,
    backgroundColor: '#F0F0F0',
    borderRadius: 10,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2A4B4C',
  },

  timeSeparator: {
    fontSize: 24,
    fontWeight: 'bold',
    marginHorizontal: 10,
    color: '#2A4B4C',
  },
});
