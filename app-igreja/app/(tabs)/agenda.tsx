import React, { useState, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Modal, Alert, ActivityIndicator, Animated, Easing, PanResponder, Dimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  const [usuario, setUsuario] = useState<any>(null);
  const [token, setToken] = useState('');
  
  const [mesAtual, setMesAtual] = useState(new Date().getMonth());
  const [anoAtual, setAnoAtual] = useState(new Date().getFullYear());
  const [eventosDoMes, setEventosDoMes] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);

  // Garante que só a resposta da busca mais recente seja aplicada (evita corrida em trocas rápidas de mês)
  const ultimaBuscaRef = useRef(0);

  // Estados do Modal de Detalhes do Evento
  const [modalDetalhesVisivel, setModalDetalhesVisivel] = useState(false);
  const [eventoSelecionado, setEventoSelecionado] = useState<any>(null);

  useFocusEffect(
    useCallback(() => {
      carregarUsuario();
      buscarEventosDoMes(mesAtual + 1, anoAtual);
    }, [mesAtual, anoAtual])
  );

  const carregarUsuario = async () => {
    const userData = await AsyncStorage.getItem('userData');
    const userToken = await AsyncStorage.getItem('userToken');
    if (userData) setUsuario(JSON.parse(userData));
    if (userToken) setToken(userToken);
  };

  const buscarEventosDoMes = async (mes: number, ano: number) => {
    const idBusca = ++ultimaBuscaRef.current;
    setCarregando(true);
    try {
      const userToken = await AsyncStorage.getItem('userToken');
      const resposta = await fetch(`http://192.168.1.71:3000/eventos?mes=${mes}&ano=${ano}`, {
        headers: { 'Authorization': `Bearer ${userToken || ''}` }
      });
      if (resposta.ok) {
        const dados = await resposta.json();
        if (idBusca === ultimaBuscaRef.current) setEventosDoMes(dados);
      }
    } catch (error) {
      console.error("Erro ao buscar eventos:", error);
    } finally {
      if (idBusca === ultimaBuscaRef.current) setCarregando(false);
    }
  };

  const mudarMes = (direcao: number) => {
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
  };

  // ====================================================================
  // NAVEGAÇÃO ENTRE MESES POR GESTO + ANIMAÇÃO DE DESLIZAMENTO
  // Setas e gesto chamam a mesma mudarMes(); a animação segue o mês atual.
  // ====================================================================
  const [larguraCalendario, setLarguraCalendario] = useState(() => Math.min(Dimensions.get('window').width - 40, 640) - 38);
  const [rolagemHabilitada, setRolagemHabilitada] = useState(true);

  const trilhoX = useRef(new Animated.Value(0)).current;
  const indiceAtual = anoAtual * 12 + mesAtual; // índice absoluto do mês exibido
  const ancoraRef = useRef(indiceAtual);        // mês inicial = posição 0 do trilho
  const indiceRef = useRef(indiceAtual);
  indiceRef.current = indiceAtual;
  const larguraRef = useRef(larguraCalendario);
  larguraRef.current = larguraCalendario;
  const mudarMesRef = useRef(mudarMes);
  mudarMesRef.current = mudarMes;

  const posInicioRef = useRef(0);
  const dxRef = useRef(0);
  const lendoPosicaoRef = useRef(false);
  const indiceAnimadoRef = useRef(indiceAtual);

  const animarPara = (valor: number, duracao: number) => {
    Animated.timing(trilhoX, {
      toValue: valor,
      duration: duracao,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  // Sempre que o mês muda (seta ou gesto), o trilho desliza até a posição do novo mês
  useEffect(() => {
    if (indiceAnimadoRef.current === indiceAtual) return;
    indiceAnimadoRef.current = indiceAtual;
    animarPara(-(indiceAtual - ancoraRef.current) * larguraRef.current, 260);
  }, [indiceAtual]);

  // Se a largura do calendário mudar (ex.: rotação), reposiciona sem animar
  useEffect(() => {
    trilhoX.stopAnimation();
    trilhoX.setValue(-(indiceRef.current - ancoraRef.current) * larguraCalendario);
  }, [larguraCalendario]);

  const finalizarGesto = (vx: number) => {
    setRolagemHabilitada(true);
    const w = larguraRef.current;
    const baseAtual = -(indiceRef.current - ancoraRef.current) * w;
    const deslocamento = posInicioRef.current + dxRef.current - baseAtual; // < 0: arrastou para a esquerda
    const limite = w * 0.2;
    const rapido = Math.abs(vx) > 0.3;

    let direcao = 0;
    if (deslocamento < -limite || (rapido && vx < 0 && deslocamento < 0)) direcao = 1;
    else if (deslocamento > limite || (rapido && vx > 0 && deslocamento > 0)) direcao = -1;

    if (direcao !== 0) {
      mudarMesRef.current(direcao); // o efeito acima conclui a animação
    } else {
      animarPara(baseAtual, 200);   // não atingiu o limite: volta suavemente
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      // Só assume o gesto quando o movimento é claramente horizontal (preserva a rolagem vertical)
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        setRolagemHabilitada(false);
        dxRef.current = 0;
        lendoPosicaoRef.current = true;
        // Interrompe uma animação em andamento e continua o arraste de onde ela estava
        trilhoX.stopAnimation((valor) => {
          posInicioRef.current = valor;
          lendoPosicaoRef.current = false;
          trilhoX.setValue(valor + dxRef.current);
        });
      },
      onPanResponderMove: (_, g) => {
        const w = larguraRef.current;
        dxRef.current = Math.max(-w, Math.min(w, g.dx));
        if (!lendoPosicaoRef.current) trilhoX.setValue(posInicioRef.current + dxRef.current);
      },
      onPanResponderRelease: (_, g) => finalizarGesto(g.vx),
      onPanResponderTerminate: () => finalizarGesto(0),
    })
  ).current;

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
    setModalDetalhesVisivel(true);
  };

  const confirmarExclusao = (eventoId: number) => {
    Alert.alert(
      "Excluir Evento",
      "Tem certeza que deseja excluir este evento?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Excluir", style: "destructive", onPress: () => excluirEvento(eventoId) }
      ]
    );
  };

  const excluirEvento = async (eventoId: number) => {
    try {
      const resposta = await fetch(`http://192.168.1.71:3000/eventos/${eventoId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (resposta.ok) {
        setModalDetalhesVisivel(false);
        buscarEventosDoMes(mesAtual + 1, anoAtual);
        Alert.alert("Sucesso", "Evento excluído com sucesso!");
      } else {
        const dados = await resposta.json();
        Alert.alert("Erro", dados.erro || "Não foi possível excluir o evento.");
      }
    } catch (error) {
      Alert.alert("Erro", "Falha de conexão com o servidor.");
    }
  };

  const mesesNomes = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Agenda da Igreja</Text>
      </View>

      <View style={styles.painel}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={rolagemHabilitada}
        >
          <View style={styles.conteudo}>
        
            {/* CALENDÁRIO ESTÁVEL E SINCRONIZADO */}
            <View style={styles.calendarCard} {...panResponder.panHandlers}>
              <View style={styles.monthNavigator}>
                <TouchableOpacity onPress={() => mudarMes(-1)} style={styles.arrowButton} activeOpacity={0.7}>
                  <Ionicons name="chevron-back" size={20} color={cores.verde} />
                </TouchableOpacity>
                <Text style={styles.monthTitle}>{mesesNomes[mesAtual]} {anoAtual}</Text>
                <TouchableOpacity onPress={() => mudarMes(1)} style={styles.arrowButton} activeOpacity={0.7}>
                  <Ionicons name="chevron-forward" size={20} color={cores.verde} />
                </TouchableOpacity>
              </View>

              <View style={styles.weekDaysContainer}>
                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d, index) => (
                  <Text key={index} style={styles.weekDayText}>{d}</Text>
                ))}
              </View>

              {/* Janela fixa; o trilho com os meses desliza dentro dela */}
              <View
                style={styles.gradeJanela}
                onLayout={(e) => {
                  const l = e.nativeEvent.layout.width;
                  if (Math.abs(l - larguraCalendario) > 0.5) setLarguraCalendario(l);
                }}
              >
                <Animated.View style={[styles.trilho, { width: larguraCalendario, transform: [{ translateX: trilhoX }] }]}>
                  {[-2, -1, 0, 1, 2].map((deslocamento) => {
                    const idx = indiceAtual + deslocamento;
                    return (
                      <PaginaMes
                        key={idx}
                        ano={Math.floor(idx / 12)}
                        mes={idx % 12}
                        eventos={eventosDoMes}
                        largura={larguraCalendario}
                        esquerda={(idx - ancoraRef.current) * larguraCalendario}
                      />
                    );
                  })}
                </Animated.View>
              </View>
            </View>

            {/* Botão Novo Evento */}
            {usuario && (usuario.nivel_acesso === 'MASTER' || usuario.nivel_acesso === 'ADMIN') && (
              <TouchableOpacity style={styles.newButton} onPress={() => router.push('/criar-evento' as any)} activeOpacity={0.85}>
                <Ionicons name="add-circle-outline" size={22} color={cores.bege} style={{ marginRight: 8 }} />
                <Text style={styles.newButtonText}>Novo Evento</Text>
              </TouchableOpacity>
            )}

            {/* ATIVIDADES DO MÊS */}
            <Text style={styles.sectionTitle}>Atividades do Mês</Text>

            {carregando ? (
              <ActivityIndicator size="small" color={cores.verde} style={{ marginTop: 20 }} />
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
      <Modal visible={modalDetalhesVisivel} animationType="slide" transparent={true} onRequestClose={() => setModalDetalhesVisivel(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TouchableOpacity style={styles.closeModalButton} onPress={() => setModalDetalhesVisivel(false)} activeOpacity={0.7}>
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

            {usuario && (
              usuario.nivel_acesso === 'MASTER' || 
              (usuario.nivel_acesso === 'ADMIN' && usuario.congregacao_id === eventoSelecionado?.congregacao_id)
            ) && (
              <TouchableOpacity style={styles.deleteButtonModal} onPress={() => confirmarExclusao(eventoSelecionado.id)} activeOpacity={0.85}>
                <Ionicons name="trash-outline" size={18} color={cores.branco} style={{ marginRight: 8 }} />
                <Text style={styles.deleteButtonText}>Excluir Evento</Text>
              </TouchableOpacity>
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
  deleteButtonModal: { backgroundColor: cores.erro, height: 52, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  deleteButtonText: { color: cores.branco, fontSize: 16, fontWeight: '700' }
});