import { authenticatedFetch, canManage, getStoredUser } from '@/services/session';
import { useSessionUser } from '@/hooks/use-session-user';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Modal, ActivityIndicator, Animated, Easing, Dimensions } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

// Tokens visuais (somente aparência)
const cores = {
  verde: '#2A4B4C',
  bege: '#F7F5EC',
  neutro: '#C4C2B7',
  suave: '#E2EAE9',
  branco: '#FFFFFF',
  erro: '#E63946',
  verdeTexto: 'rgba(42, 75, 76, 0.72)',
  verdeSutil: 'rgba(42, 75, 76, 0.45)',
};

// Grade do calendário: altura fixa de 6 linhas para o card não "pular" ao trocar de mês
const ALTURA_LINHA = 42;
const LINHAS_DA_GRADE = 6;
const TAMANHO_MARCA = 36; // altura/diâmetro da marcação de eventos (limitada à largura da célula)
const DESLOCAMENTOS_MESES = [-2, -1, 0, 1, 2] as const;

type DiaDoMes = { dia: number; dataFormatada: string };

// Mesma lógica de antes, agora parametrizada por mês/ano para poder desenhar os meses vizinhos
const gerarDiasDoMes = (ano: number, mes: number): (DiaDoMes | null)[] => {
  const primeiroDiaIndex = new Date(ano, mes, 1).getDay();
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const dias: (DiaDoMes | null)[] = [];

  for (let i = 0; i < primeiroDiaIndex; i++) {
    dias.push(null);
  }
  for (let i = 1; i <= totalDias; i++) {
    const mesStr = String(mes + 1).padStart(2, '0');
    const diaStr = String(i).padStart(2, '0');
    dias.push({ dia: i, dataFormatada: `${ano}-${mesStr}-${diaStr}` });
  }
  return dias;
};

type PaginaMesProps = { ano: number; mes: number; eventos: any[]; largura: number; esquerda: number };

const eventoIncluiData = (ev: any, data: string) => {
  const inicio = ev.data_inicio.split('T')[0];
  const fim = ev.data_fim ? ev.data_fim.split('T')[0] : inicio;
  return data >= inicio && data <= fim;
};

// Um mês inteiro (grade de dias). Só re-renderiza quando seus próprios dados mudam.
// Cada sequência de dias do mesmo evento, dentro de uma linha da semana, vira uma única faixa
// arredondada (pílula); um dia isolado vira um círculo.
const PaginaMes = React.memo(function PaginaMes({ ano, mes, eventos, largura, esquerda }: PaginaMesProps) {
  const larguraCelula = largura / 7;
  const tamanho = Math.min(TAMANHO_MARCA, larguraCelula); // a marca nunca ultrapassa a célula
  const margem = (larguraCelula - tamanho) / 2;
  const topo = (ALTURA_LINHA - tamanho) / 2;

  const dias = gerarDiasDoMes(ano, mes);
  while (dias.length % 7 !== 0) dias.push(null);

  const linhas: (DiaDoMes | null)[][] = [];
  for (let r = 0; r < dias.length / 7; r++) linhas.push(dias.slice(r * 7, r * 7 + 7));

  const marcado = (item: DiaDoMes | null) =>
    !!item && eventos.some(ev => eventoIncluiData(ev, item.dataFormatada));
  // Dois dias seguidos só se conectam quando pertencem ao MESMO evento
  const conectados = (a: DiaDoMes | null, b: DiaDoMes | null) =>
    !!a && !!b && eventos.some(ev => eventoIncluiData(ev, a.dataFormatada) && eventoIncluiData(ev, b.dataFormatada));

  return (
    <View style={[styles.paginaMes, { width: largura, left: esquerda }]}>
      {linhas.map((celulas, r) => {
        const marcados = celulas.map(marcado);

        const segmentos: { inicio: number; fim: number }[] = [];
        let atual: { inicio: number; fim: number } | null = null;
        for (let c = 0; c < 7; c++) {
          if (!marcados[c]) {
            atual = null;
            continue;
          }
          if (atual && conectados(celulas[c - 1], celulas[c])) {
            atual.fim = c;
          } else {
            atual = { inicio: c, fim: c };
            segmentos.push(atual);
          }
        }

        return (
          <View key={r} style={styles.linhaMes}>
            {segmentos.map((seg) => (
              <View
                key={seg.inicio}
                style={[
                  styles.faixaEvento,
                  {
                    left: seg.inicio * larguraCelula + margem,
                    width: (seg.fim - seg.inicio + 1) * larguraCelula - 2 * margem,
                    top: topo,
                    height: tamanho,
                    borderRadius: tamanho / 2,
                  },
                ]}
              />
            ))}
            <View style={styles.linhaDias}>
              {celulas.map((item, c) => (
                <View key={c} style={[styles.dayBox, { width: larguraCelula }]}>
                  {item ? (
                    <Text style={[styles.dayText, marcados[c] && styles.dayTextHighlighted]}>
                      {item.dia}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
});

export default function TelaAgenda() {
  const [usuario, setUsuario] = useSessionUser();
  const [mesAtual, setMesAtual] = useState(new Date().getMonth());
  const [anoAtual, setAnoAtual] = useState(new Date().getFullYear());
  const [eventosDoMes, setEventosDoMes] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erroCarregamento, setErroCarregamento] = useState('');

  // Garante que só a resposta da busca mais recente seja aplicada (evita corrida em trocas rápidas de mês)
  const ultimaBuscaRef = useRef(0);

  // Estados do Modal de Detalhes do Evento
  const [modalDetalhesVisivel, setModalDetalhesVisivel] = useState(false);
  const [eventoSelecionado, setEventoSelecionado] = useState<any>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [excluindoEvento, setExcluindoEvento] = useState(false);
  const [erroExclusao, setErroExclusao] = useState('');
  const [avisoAgenda, setAvisoAgenda] = useState('');

  const carregarUsuario = useCallback(async () => {
    const user = await getStoredUser();
    if (user) setUsuario(user);
  }, [setUsuario]);

  const buscarEventosDoMes = useCallback(async (mes: number, ano: number) => {
    const idBusca = ++ultimaBuscaRef.current;
    setCarregando(true);
    setErroCarregamento('');
    try {
      const resposta = await authenticatedFetch(`/eventos?mes=${mes}&ano=${ano}`);
      if (resposta.ok) {
        const dados = await resposta.json();
        if (idBusca === ultimaBuscaRef.current) setEventosDoMes(dados);
      } else if (idBusca === ultimaBuscaRef.current) {
        const dados = await resposta.json().catch(() => ({}));
        setErroCarregamento(dados.erro || 'Não foi possível carregar a agenda.');
      }
    } catch {
      if (idBusca === ultimaBuscaRef.current) {
        setErroCarregamento('Falha de conexão. Verifique sua internet e tente novamente.');
      }
    } finally {
      if (idBusca === ultimaBuscaRef.current) setCarregando(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void carregarUsuario();
      void buscarEventosDoMes(mesAtual + 1, anoAtual);
    }, [anoAtual, buscarEventosDoMes, carregarUsuario, mesAtual])
  );

  const mudarMes = useCallback((direcao: number) => {
    let novoMes = mesAtual + direcao;
    let novoAno = anoAtual;
    if (novoMes > 11) {
      novoMes = 0;
      novoAno += 1;
    } else if (novoMes < 0) {
      novoMes = 11;
      novoAno -= 1;
    }
    setMesAtual(novoMes);
    setAnoAtual(novoAno);
  }, [anoAtual, mesAtual]);

  // A largura é medida em tempo de execução para manter a grade responsiva.
  const [larguraCalendario, setLarguraCalendario] = useState(() => Math.min(Dimensions.get('window').width - 40, 640) - 38);
  const [rolagemHabilitada, setRolagemHabilitada] = useState(true);

  const [trilhoX] = useState(() => new Animated.Value(0));
  const indiceAtual = anoAtual * 12 + mesAtual;
  const [indiceAncora] = useState(indiceAtual);

  const posInicioRef = useRef(0);
  const dxRef = useRef(0);
  const lendoPosicaoRef = useRef(false);
  const toqueInicioRef = useRef({ x: 0, y: 0, instante: 0 });

  const animarPara = useCallback((valor: number, duracao: number) => {
    Animated.timing(trilhoX, {
      toValue: valor,
      duration: duracao,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [trilhoX]);

  // Setas e gesto usam o mesmo estado; o trilho apenas acompanha o mês selecionado.
  useEffect(() => {
    animarPara(-(indiceAtual - indiceAncora) * larguraCalendario, 260);
  }, [animarPara, indiceAncora, indiceAtual, larguraCalendario]);

  useEffect(() => () => trilhoX.stopAnimation(), [trilhoX]);

  const finalizarGesto = useCallback((velocidadeX: number) => {
    setRolagemHabilitada(true);
    const baseAtual = -(indiceAtual - indiceAncora) * larguraCalendario;
    const deslocamento = posInicioRef.current + dxRef.current - baseAtual;
    const limite = larguraCalendario * 0.2;
    const gestoRapido = Math.abs(velocidadeX) > 0.3;

    let direcao = 0;
    if (deslocamento < -limite || (gestoRapido && velocidadeX < 0 && deslocamento < 0)) direcao = 1;
    else if (deslocamento > limite || (gestoRapido && velocidadeX > 0 && deslocamento > 0)) direcao = -1;

    if (direcao !== 0) {
      mudarMes(direcao);
    } else {
      animarPara(baseAtual, 200);
    }
  }, [animarPara, indiceAncora, indiceAtual, larguraCalendario, mudarMes]);

  const registrarInicioDoToque = useCallback((evento: GestureResponderEvent) => {
    toqueInicioRef.current = {
      x: evento.nativeEvent.pageX,
      y: evento.nativeEvent.pageY,
      instante: evento.nativeEvent.timestamp,
    };
    return false;
  }, []);

  const deveCapturarGestoHorizontal = useCallback((evento: GestureResponderEvent) => {
    const deslocamentoX = evento.nativeEvent.pageX - toqueInicioRef.current.x;
    const deslocamentoY = evento.nativeEvent.pageY - toqueInicioRef.current.y;
    return Math.abs(deslocamentoX) > 8 && Math.abs(deslocamentoX) > Math.abs(deslocamentoY) * 1.5;
  }, []);

  const iniciarGestoHorizontal = useCallback((evento: GestureResponderEvent) => {
    setRolagemHabilitada(false);
    const deslocamentoInicial = evento.nativeEvent.pageX - toqueInicioRef.current.x;
    dxRef.current = Math.max(-larguraCalendario, Math.min(larguraCalendario, deslocamentoInicial));
    lendoPosicaoRef.current = true;
    trilhoX.stopAnimation((valor) => {
      posInicioRef.current = valor;
      lendoPosicaoRef.current = false;
      trilhoX.setValue(valor + dxRef.current);
    });
  }, [larguraCalendario, trilhoX]);

  const moverGestoHorizontal = useCallback((evento: GestureResponderEvent) => {
    const deslocamentoX = evento.nativeEvent.pageX - toqueInicioRef.current.x;
    dxRef.current = Math.max(-larguraCalendario, Math.min(larguraCalendario, deslocamentoX));
    if (!lendoPosicaoRef.current) trilhoX.setValue(posInicioRef.current + dxRef.current);
  }, [larguraCalendario, trilhoX]);

  const concluirGestoHorizontal = useCallback((evento: GestureResponderEvent) => {
    const duracao = Math.max(1, evento.nativeEvent.timestamp - toqueInicioRef.current.instante);
    finalizarGesto(dxRef.current / duracao);
  }, [finalizarGesto]);

  const formatarDataExibicao = (dataStr: string) => {
    if (!dataStr) return '';
    const partes = dataStr.split('T')[0].split('-');
    if (partes.length === 3) {
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    return dataStr;
  };

  const abrirDetalhesEvento = (evento: any) => {
    setEventoSelecionado(evento);
    setConfirmandoExclusao(false);
    setErroExclusao('');
    setModalDetalhesVisivel(true);
  };

  const cancelarExclusao = () => {
    if (excluindoEvento) return;
    setConfirmandoExclusao(false);
    setErroExclusao('');
  };

  const fecharDetalhes = () => {
    if (excluindoEvento) return;
    if (confirmandoExclusao) {
      cancelarExclusao();
      return;
    }
    setModalDetalhesVisivel(false);
  };

  const confirmarExclusao = () => {
    setErroExclusao('');
    setConfirmandoExclusao(true);
  };

  const excluirEvento = async (eventoId: number) => {
    if (excluindoEvento) return;
    setExcluindoEvento(true);
    setErroExclusao('');
    try {
      const resposta = await authenticatedFetch(`/eventos/${eventoId}`, { method: 'DELETE' });

      if (resposta.ok) {
        // Atualiza a agenda local sem exibir outro modal nem mostrar carregamento global.
        setEventosDoMes(atuais => atuais.filter(ev => Number(ev.id) !== Number(eventoId)));
        setModalDetalhesVisivel(false);
        setConfirmandoExclusao(false);
        setEventoSelecionado(null);
        setAvisoAgenda('Evento excluído com sucesso!');
      } else {
        const dados = await resposta.json().catch(() => ({}));
        setErroExclusao(dados.erro || 'Não foi possível excluir o evento.');
      }
    } catch {
      setErroExclusao('Falha de conexão com o servidor. Tente novamente.');
    } finally {
      setExcluindoEvento(false);
    }
  };

  const mesesNomes = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Agenda da Igreja</Text>
      </View>

      {avisoAgenda ? (
        <View style={styles.feedbackBar}>
          <Ionicons name="checkmark-circle-outline" size={19} color={cores.verde} />
          <Text accessibilityRole="alert" style={styles.feedbackText}>{avisoAgenda}</Text>
          <TouchableOpacity accessibilityLabel="Fechar aviso" onPress={() => setAvisoAgenda('')}>
            <Ionicons name="close" size={18} color={cores.verde} />
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.painel}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={rolagemHabilitada}
        >
          <View style={styles.conteudo}>
        
            {/* CALENDÁRIO ESTÁVEL E SINCRONIZADO */}
            <View
              style={styles.calendarCard}
              onStartShouldSetResponderCapture={registrarInicioDoToque}
              onMoveShouldSetResponderCapture={deveCapturarGestoHorizontal}
              onResponderGrant={iniciarGestoHorizontal}
              onResponderMove={moverGestoHorizontal}
              onResponderRelease={concluirGestoHorizontal}
              onResponderTerminate={() => finalizarGesto(0)}
              onResponderTerminationRequest={() => false}
            >
              <View style={styles.monthNavigator}>
                <TouchableOpacity accessibilityLabel="Mês anterior" onPress={() => mudarMes(-1)} style={styles.arrowButton} activeOpacity={0.7}>
                  <Ionicons name="chevron-back" size={20} color={cores.verde} />
                </TouchableOpacity>
                <Text style={styles.monthTitle}>{mesesNomes[mesAtual]} {anoAtual}</Text>
                <TouchableOpacity accessibilityLabel="Próximo mês" onPress={() => mudarMes(1)} style={styles.arrowButton} activeOpacity={0.7}>
                  <Ionicons name="chevron-forward" size={20} color={cores.verde} />
                </TouchableOpacity>
              </View>

              <View style={styles.weekDaysContainer}>
                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d, index) => (
                  <Text key={index} style={styles.weekDayText}>{d}</Text>
                ))}
              </View>

              <View
                style={styles.gradeJanela}
                onLayout={(e) => {
                  const l = e.nativeEvent.layout.width;
                  if (Math.abs(l - larguraCalendario) > 0.5) setLarguraCalendario(l);
                }}
              >
                <Animated.View style={[styles.trilho, { width: larguraCalendario, transform: [{ translateX: trilhoX }] }]}>
                  {DESLOCAMENTOS_MESES.map((deslocamento) => {
                    const indice = indiceAtual + deslocamento;
                    return (
                      <PaginaMes
                        key={indice}
                        ano={Math.floor(indice / 12)}
                        mes={indice % 12}
                        eventos={eventosDoMes}
                        largura={larguraCalendario}
                        esquerda={(indice - indiceAncora) * larguraCalendario}
                      />
                    );
                  })}
                </Animated.View>
              </View>
            </View>

            {/* Botão Novo Evento */}
            {usuario && canManage(usuario) && (
              <TouchableOpacity style={styles.newButton} onPress={() => router.push('/criar-evento' as any)} activeOpacity={0.85}>
                <Ionicons name="add-circle-outline" size={22} color={cores.bege} style={{ marginRight: 8 }} />
                <Text style={styles.newButtonText}>Novo Evento</Text>
              </TouchableOpacity>
            )}

            {/* ATIVIDADES DO MÊS */}
            <Text style={styles.sectionTitle}>Atividades do Mês</Text>

            {carregando ? (
              <ActivityIndicator size="small" color={cores.verde} style={{ marginTop: 20 }} />
            ) : erroCarregamento ? (
              <View style={styles.emptyBox}>
                <Ionicons name="cloud-offline-outline" size={40} color={cores.erro} />
                <Text accessibilityRole="alert" style={styles.emptyText}>{erroCarregamento}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={() => void buscarEventosDoMes(mesAtual + 1, anoAtual)}>
                  <Text style={styles.retryButtonText}>Tentar novamente</Text>
                </TouchableOpacity>
              </View>
            ) : eventosDoMes.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="calendar-outline" size={40} color={cores.neutro} />
                <Text style={styles.emptyText}>Nenhum evento cadastrado neste mês.</Text>
              </View>
            ) : (
              eventosDoMes.map((evento) => {
                const dataInicioFormatada = formatarDataExibicao(evento.data_inicio);
                const dataFimFormatada = formatarDataExibicao(evento.data_fim);
                const periodoExibicao = dataFimFormatada && dataFimFormatada !== dataInicioFormatada 
                  ? `${dataInicioFormatada} até ${dataFimFormatada}` 
                  : dataInicioFormatada;

                return (
                  <TouchableOpacity key={evento.id} style={styles.eventCard} onPress={() => abrirDetalhesEvento(evento)} activeOpacity={0.8}>
                    <View style={styles.eventCardLeft}>
                      <View style={styles.eventIconBox}>
                        <Ionicons name="calendar" size={20} color={cores.verde} />
                      </View>
                      <View style={styles.eventCardTexts}>
                        <Text style={styles.eventCardTitle}>{evento.titulo}</Text>
                        <View style={styles.eventMetaRow}>
                          <Ionicons name="time-outline" size={14} color={cores.verdeTexto} style={styles.eventMetaIcon} />
                          <Text style={styles.eventCardDate}>{periodoExibicao} às {evento.horario || '00:00'}</Text>
                        </View>
                        <View style={styles.eventMetaRow}>
                          <Ionicons name="location-outline" size={14} color={cores.verdeTexto} style={styles.eventMetaIcon} />
                          <Text style={styles.eventCardLocation}>{evento.congregacao || 'Geral'}</Text>
                        </View>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={cores.verdeSutil} />
                  </TouchableOpacity>
                );
              })
            )}

          </View>
        </ScrollView>
      </View>

      {/* MODAL DE DETALHES E PERMISSÃO DE EXCLUSÃO */}
      <Modal visible={modalDetalhesVisivel} animationType="slide" transparent={true} onRequestClose={fecharDetalhes}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {confirmandoExclusao ? (
              <>
                <View style={styles.confirmacaoIcone}>
                  <Ionicons name="trash-outline" size={25} color={cores.erro} />
                </View>
                <Text style={styles.modalEventTitle}>Excluir evento?</Text>
                <Text style={styles.confirmacaoMensagem}>
                  Tem certeza que deseja excluir "{eventoSelecionado?.titulo}" da agenda?
                </Text>
                {erroExclusao ? (
                  <Text accessibilityRole="alert" style={styles.confirmacaoErro}>{erroExclusao}</Text>
                ) : null}
                <View style={styles.managementActions}>
                  <TouchableOpacity
                    style={styles.cancelButtonModal}
                    onPress={cancelarExclusao}
                    disabled={excluindoEvento}
                    accessibilityRole="button"
                  >
                    <Text style={styles.cancelButtonText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.deleteButtonModal, excluindoEvento && { opacity: 0.6 }]}
                    onPress={() => {
                      if (eventoSelecionado?.id != null) void excluirEvento(eventoSelecionado.id);
                    }}
                    disabled={excluindoEvento}
                    accessibilityRole="button"
                  >
                    {excluindoEvento ? (
                      <ActivityIndicator color={cores.branco} />
                    ) : (
                      <Ionicons name="trash-outline" size={18} color={cores.branco} style={{ marginRight: 8 }} />
                    )}
                    <Text style={styles.deleteButtonText}>
                      {excluindoEvento ? 'Excluindo...' : 'Excluir'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <TouchableOpacity accessibilityLabel="Fechar detalhes" style={styles.closeModalButton} onPress={fecharDetalhes} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color={cores.verde} />
            </TouchableOpacity>

            <Text style={styles.modalEventTitle}>{eventoSelecionado?.titulo}</Text>
            
            <View style={styles.modalInfoBox}>
              <View style={styles.modalInfoRow}>
                <Ionicons name="calendar-outline" size={18} color={cores.verde} style={styles.modalInfoIcon} />
                <Text style={styles.modalInfoText}>
                  <Text style={styles.modalInfoLabel}>Início:</Text> {formatarDataExibicao(eventoSelecionado?.data_inicio)} às {eventoSelecionado?.horario}
                </Text>
              </View>
              <View style={styles.modalInfoRow}>
                <Ionicons name="flag-outline" size={18} color={cores.verde} style={styles.modalInfoIcon} />
                <Text style={styles.modalInfoText}>
                  <Text style={styles.modalInfoLabel}>Término:</Text> {formatarDataExibicao(eventoSelecionado?.data_fim)}
                </Text>
              </View>
              <View style={styles.modalInfoRow}>
                <Ionicons name="location-outline" size={18} color={cores.verde} style={styles.modalInfoIcon} />
                <Text style={styles.modalInfoText}>
                  <Text style={styles.modalInfoLabel}>Local:</Text> {eventoSelecionado?.congregacao || 'Geral'}
                </Text>
              </View>
              {eventoSelecionado?.legenda ? (
                <View style={[styles.modalInfoRow, { marginTop: 10 }]}>
                  <Ionicons name="document-text-outline" size={18} color={cores.verde} style={styles.modalInfoIcon} />
                  <Text style={styles.modalInfoText}>
                    <Text style={styles.modalInfoLabel}>Descrição:</Text> {eventoSelecionado?.legenda}
                  </Text>
                </View>
              ) : null}
            </View>

            {usuario && canManage(usuario) && (
              usuario.nivel_acesso === 'MASTER' ||
              (usuario.nivel_acesso === 'ADMIN' && usuario.congregacao_id === eventoSelecionado?.congregacao_id)
            ) && (
              <View style={styles.managementActions}>
                <TouchableOpacity
                  style={styles.editButtonModal}
                  onPress={() => {
                    setModalDetalhesVisivel(false);
                    router.push({ pathname: '/editar-evento', params: eventoSelecionado } as never);
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="create-outline" size={18} color={cores.branco} style={{ marginRight: 8 }} />
                  <Text style={styles.deleteButtonText}>Editar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteButtonModal} onPress={confirmarExclusao} activeOpacity={0.85}>
                  <Ionicons name="trash-outline" size={18} color={cores.branco} style={{ marginRight: 8 }} />
                  <Text style={styles.deleteButtonText}>Excluir</Text>
                </TouchableOpacity>
              </View>
            )}
              </>
            )}
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.verde },

  // Cabeçalho
  header: { backgroundColor: cores.verde, paddingTop: 52, paddingBottom: 26, alignItems: 'center' },
  headerTitle: { color: cores.bege, fontSize: 20, fontWeight: '700', letterSpacing: 0.3 },
  feedbackBar: { backgroundColor: cores.suave, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 20, paddingVertical: 11 },
  feedbackText: { flex: 1, color: cores.verde, fontSize: 14, fontWeight: '600' },

  // Painel claro com cantos superiores arredondados sobre o cabeçalho verde
  painel: { flex: 1, backgroundColor: cores.bege, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  scrollContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 80 },
  conteudo: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  
  // Calendário
  calendarCard: {
    backgroundColor: cores.branco,
    padding: 18,
    borderRadius: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: cores.suave,
    shadowColor: cores.verde,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  monthNavigator: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  monthTitle: { fontSize: 16, fontWeight: '700', color: cores.verde, letterSpacing: 1 },
  arrowButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: cores.suave, alignItems: 'center', justifyContent: 'center' },

  weekDaysContainer: { flexDirection: 'row', marginBottom: 8, borderBottomWidth: 1, borderBottomColor: cores.suave, paddingBottom: 10 },
  weekDayText: { fontWeight: '600', color: cores.verdeTexto, width: '14.28%', textAlign: 'center', fontSize: 12 },
  
  // Janela + trilho deslizante dos meses
  gradeJanela: { height: ALTURA_LINHA * LINHAS_DA_GRADE, overflow: 'hidden' },
  trilho: { position: 'absolute', top: 0, left: 0, height: ALTURA_LINHA * LINHAS_DA_GRADE },
  paginaMes: { position: 'absolute', top: 0 },

  linhaMes: { height: ALTURA_LINHA },
  linhaDias: { flexDirection: 'row' },
  faixaEvento: { position: 'absolute', backgroundColor: cores.verde },
  dayBox: { height: ALTURA_LINHA, justifyContent: 'center', alignItems: 'center' },
  dayText: { fontSize: 14, color: cores.verde },
  dayTextHighlighted: { color: cores.bege, fontWeight: '700' },

  newButton: {
    backgroundColor: cores.verde,
    flexDirection: 'row',
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
    shadowColor: cores.verde,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  newButtonText: { color: cores.bege, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  sectionTitle: { fontSize: 17, fontWeight: '700', color: cores.verde, marginBottom: 14, marginLeft: 2 },
  emptyBox: { alignItems: 'center', padding: 28, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: cores.neutro },
  emptyText: { color: cores.verdeTexto, fontSize: 14, marginTop: 10, textAlign: 'center' },
  retryButton: { marginTop: 14, backgroundColor: cores.verde, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  retryButtonText: { color: cores.bege, fontWeight: '700' },

  // Cards de evento
  eventCard: {
    backgroundColor: cores.branco,
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: cores.suave,
    shadowColor: cores.verde,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  eventCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  eventIconBox: { width: 42, height: 42, borderRadius: 12, backgroundColor: cores.suave, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  eventCardTexts: { flex: 1 },
  eventCardTitle: { fontSize: 16, fontWeight: '700', color: cores.verde, marginBottom: 5 },
  eventMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  eventMetaIcon: { marginRight: 6 },
  eventCardDate: { fontSize: 13, color: cores.verdeTexto, flexShrink: 1 },
  eventCardLocation: { fontSize: 13, color: cores.verdeTexto, flexShrink: 1 },

  // Modal de detalhes
  modalOverlay: { flex: 1, backgroundColor: 'rgba(42, 75, 76, 0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxWidth: 480, backgroundColor: cores.bege, borderRadius: 24, padding: 22 },
  closeModalButton: { alignSelf: 'flex-end', width: 34, height: 34, borderRadius: 17, backgroundColor: cores.suave, alignItems: 'center', justifyContent: 'center' },
  modalEventTitle: { fontSize: 20, fontWeight: '700', color: cores.verde, marginTop: 4, marginBottom: 18, textAlign: 'center' },
  modalInfoBox: { backgroundColor: cores.suave, padding: 16, borderRadius: 14, marginBottom: 20 },
  modalInfoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  modalInfoIcon: { marginRight: 10, marginTop: 1 },
  modalInfoText: { flex: 1, fontSize: 15, lineHeight: 21, color: cores.verde },
  modalInfoLabel: { fontWeight: '700' },
  managementActions: { flexDirection: 'row', gap: 10 },
  editButtonModal: { flex: 1, backgroundColor: cores.verde, height: 52, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  deleteButtonModal: { flex: 1, backgroundColor: cores.erro, height: 52, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  cancelButtonModal: { flex: 1, backgroundColor: cores.suave, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  cancelButtonText: { color: cores.verde, fontSize: 16, fontWeight: '700' },
  confirmacaoIcone: { alignSelf: 'center', backgroundColor: '#FFE8E9', borderRadius: 28, width: 56, height: 56, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  confirmacaoMensagem: { color: cores.verde, fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  confirmacaoErro: { color: cores.erro, fontSize: 14, marginBottom: 16, textAlign: 'center' },
  deleteButtonText: { color: cores.branco, fontSize: 16, fontWeight: '700' }
});
