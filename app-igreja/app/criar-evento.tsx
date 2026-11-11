import { useAppDialog } from '@/components/app-dialog';
import { useSessionUser } from '@/hooks/use-session-user';
import { apiFetch, authenticatedFetch, refreshSession } from '@/services/session';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TelaCriarEvento() {
  const { alert: mostrarDialogo } = useAppDialog();
  const params = useLocalSearchParams();
  const [usuario, setUsuario] = useSessionUser();
  const [congregacoes, setCongregacoes] = useState<any[]>([]);
  
  const [titulo, setTitulo] = useState('');
  const [congregacaoId, setCongregacaoId] = useState('');
  const [congregacaoNomeAdmin, setCongregacaoNomeAdmin] = useState('');
  const [legenda, setLegenda] = useState('');
  const [horario, setHorario] = useState('19:30'); // Horário padrão inicial
  const [carregando, setCarregando] = useState(false);

  // Estados do Modal de Calendário
  const [modalCalendarioVisivel, setModalCalendarioVisivel] = useState(false);
  const dataSelecionada = Array.isArray(params.dataSelecionada) ? params.dataSelecionada[0] : params.dataSelecionada;
  const [dataInicio, setDataInicio] = useState<string | null>(() => dataSelecionada || null);
  const [dataFim, setDataFim] = useState<string | null>(() => dataSelecionada || null);
  const [mesAtual, setMesAtual] = useState(new Date().getMonth());
  const [anoAtual, setAnoAtual] = useState(new Date().getFullYear());

  // Estados do Modal de Horário
  const [modalHorarioVisivel, setModalHorarioVisivel] = useState(false);
  const [horaTemp, setHoraTemp] = useState('19');
  const [minTemp, setMinTemp] = useState('30');

  // Estados do Modal de Seleção de Congregação (Para Master)
  const [modalCongregacaoVisivel, setModalCongregacaoVisivel] = useState(false);
  const [nomeCongregacaoSelecionada, setNomeCongregacaoSelecionada] = useState('Selecionar congregação');

  const carregarDadosIniciais = useCallback(async () => {
    try {
      const [parsedUser, resposta] = await Promise.all([
        refreshSession(),
        apiFetch('/congregacoes'),
      ]);
      if (parsedUser) {
        setUsuario(parsedUser);
        if (parsedUser.nivel_acesso === 'ADMIN') setCongregacaoId(String(parsedUser.congregacao_id || ''));
      }
      if (resposta.ok) {
        const dados = await resposta.json();
        setCongregacoes(dados);
        if (parsedUser) {
          const encontrada = dados.find((c: any) => c.id === parsedUser.congregacao_id);
          if (encontrada) setCongregacaoNomeAdmin(encontrada.nome);
        }
      }
    } catch {
      mostrarDialogo('Erro', 'Não foi possível carregar os dados para criar o evento.');
    }
  }, [setUsuario]);

  useEffect(() => {
    void Promise.resolve().then(carregarDadosIniciais);
  }, [carregarDadosIniciais]);

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
      mostrarDialogo("Atenção", "Selecione pelo menos a data de início.");
      return;
    }
    if (!dataFim) setDataFim(dataInicio);
    setModalCalendarioVisivel(false);
  };

  const confirmarHorario = () => {
    setHorario(`${horaTemp.padStart(2, '0')}:${minTemp.padStart(2, '0')}`);
    setModalHorarioVisivel(false);
  };

  const formatarDataExibicao = (dataStr: string | null) => {
    if (!dataStr) return 'Selecione as datas';
    const [ano, mes, dia] = dataStr.split('-');
    return `${dia}/${mes}/${ano}`;
  };

  const criarEvento = async (confirmarConflito = false) => {
    if (!titulo || !dataInicio || !horario) {
      mostrarDialogo('Atenção', 'Preencha o Título, o Período e o Horário de Início.');
      return;
    }

    if (usuario?.nivel_acesso === 'MASTER' && !congregacaoId) {
      mostrarDialogo('Atenção', 'O Master deve selecionar obrigatoriamente uma congregação.');
      return;
    }

    setCarregando(true);
    try {
      const resposta = await authenticatedFetch('/eventos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          titulo, 
          congregacao_id: congregacaoId, 
          legenda, 
          data_inicio: dataInicio,
          data_fim: dataFim || dataInicio,
          horario,
          confirmar_conflito: confirmarConflito,
        })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        mostrarDialogo('Sucesso', 'Evento criado com sucesso!', [
          { text: 'OK', onPress: () => router.back() }
        ]);
      } else if (resposta.status === 409 && dados.codigo === 'CONFLITO_AGENDA' && dados.podeConfirmar) {
        const encontrados = (dados.eventosConflitantes || []).slice(0, 3)
          .map((ev: any) => '• ' + ev.titulo).join('\n');
        const aviso = 'Há eventos da mesma congregação neste horário:\n' + encontrados +
          '\n\nDeseja criar o evento mesmo assim?';
        mostrarDialogo('Conflito de agenda', aviso, [
          { text: 'Voltar e revisar', style: 'cancel' },
          { text: 'Criar mesmo assim', onPress: () => void criarEvento(true) },
        ]);
      } else {
        const avisoErro = dados.erro || 'Falha ao criar evento.';
        mostrarDialogo('Erro', avisoErro);
      }
    } catch {
      mostrarDialogo('Erro', 'Não foi possível conectar ao servidor.');
    } finally {
      setCarregando(false);
    }
  };

  const mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#F7F5EC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Novo Evento</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.formContainer} contentContainerStyle={{ paddingBottom: 40 }}>
        
        <Text style={styles.label}>Título do Evento *</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Ex: Congresso de Jovens" 
          placeholderTextColor="#999"
          value={titulo} 
          onChangeText={setTitulo} 
        />

        {/* CONGREGAÇÃO (Regra Master vs Admin) */}
        <Text style={styles.label}>Congregação *</Text>
        {usuario?.nivel_acesso === 'MASTER' ? (
          <TouchableOpacity style={styles.selectorButton} onPress={() => setModalCongregacaoVisivel(true)}>
            <Ionicons name="business-outline" size={20} color="#2A4B4C" />
            <Text style={styles.selectorText}>{nomeCongregacaoSelecionada}</Text>
            <Ionicons name="chevron-down" size={18} color="#666" />
          </TouchableOpacity>
        ) : (
          <View style={styles.lockedSelector}>
            <Ionicons name="lock-closed" size={18} color="#666" style={{ marginRight: 8 }} />
            <Text style={styles.lockedSelectorText}>{congregacaoNomeAdmin || 'Minha Congregação'}</Text>
          </View>
        )}

        <Text style={styles.label}>Período do Evento *</Text>
        <TouchableOpacity style={styles.selectorButton} onPress={() => setModalCalendarioVisivel(true)}>
          <Ionicons name="calendar-outline" size={20} color="#2A4B4C" />
          <Text style={styles.selectorText}>
            {dataInicio 
              ? `${formatarDataExibicao(dataInicio)} ${dataFim && dataFim !== dataInicio ? `até ${formatarDataExibicao(dataFim)}` : '(1 dia)'}` 
              : 'Selecione a data inicial e final'}
          </Text>
        </TouchableOpacity>

        {/* HORÁRIO DE INÍCIO */}
        <Text style={styles.label}>Horário de Início *</Text>
        <TouchableOpacity style={styles.selectorButton} onPress={() => setModalHorarioVisivel(true)}>
          <Ionicons name="time-outline" size={20} color="#2A4B4C" />
          <Text style={styles.selectorText}>🕐 {horario}</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Descrição / Legenda</Text>
        <TextInput 
          style={[styles.input, styles.descInput]} 
          placeholder="Detalhes sobre o evento..." 
          placeholderTextColor="#999"
          value={legenda} 
          onChangeText={setLegenda} 
          multiline 
          numberOfLines={4} 
        />

        <TouchableOpacity style={[styles.postButton, carregando && styles.buttonDisabled]} onPress={() => void criarEvento()} disabled={carregando}>
          {carregando ? <ActivityIndicator color="#F7F5EC" /> : <Text style={styles.postButtonText}>CRIAR EVENTO</Text>}
        </TouchableOpacity>

      </ScrollView>

      {/* MODAL DE SELEÇÃO DE CONGREGAÇÃO (MASTER) */}
      <Modal visible={modalCongregacaoVisivel} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Selecionar Congregação</Text>
            <ScrollView style={{ maxHeight: 250 }}>
              {congregacoes.map((c) => (
                <TouchableOpacity 
                  key={c.id} 
                  style={styles.modalOption} 
                  onPress={() => {
                    setCongregacaoId(c.id);
                    setNomeCongregacaoSelecionada(c.nome);
                    setModalCongregacaoVisivel(false);
                  }}
                >
                  <Text style={styles.modalOptionText}>{c.nome}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.closeModalBtn} onPress={() => setModalCongregacaoVisivel(false)}>
              <Text style={styles.closeModalText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL DO CALENDÁRIO */}
      <Modal visible={modalCalendarioVisivel} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.calendarContainer}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity onPress={() => {
                let m = mesAtual - 1; let a = anoAtual;
                if (m < 0) { m = 11; a--; }
                setMesAtual(m); setAnoAtual(a);
              }}>
                <Ionicons name="chevron-back" size={24} color="#2A4B4C" />
              </TouchableOpacity>
              <Text style={styles.calendarTitle}>{mesesNomes[mesAtual]} {anoAtual}</Text>
              <TouchableOpacity onPress={() => {
                let m = mesAtual + 1; let a = anoAtual;
                if (m > 11) { m = 0; a++; }
                setMesAtual(m); setAnoAtual(a);
              }}>
                <Ionicons name="chevron-forward" size={24} color="#2A4B4C" />
              </TouchableOpacity>
            </View>

            <View style={styles.weekDaysContainer}>
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d, index) => (
                <Text key={index} style={styles.weekDayText}>{d}</Text>
              ))}
            </View>

            <View style={styles.daysGrid}>
              {(() => {
                const primeiroDiaIndex = new Date(anoAtual, mesAtual, 1).getDay();
                const totalDias = new Date(anoAtual, mesAtual + 1, 0).getDate();
                const dias = [];
                for (let i = 0; i < primeiroDiaIndex; i++) dias.push(null);
                for (let i = 1; i <= totalDias; i++) {
                  const mStr = String(mesAtual + 1).padStart(2, '0');
                  const dStr = String(i).padStart(2, '0');
                  dias.push(`${anoAtual}-${mStr}-${dStr}`);
                }

                return dias.map((diaStr, index) => {
                  if (!diaStr) return <View key={index} style={styles.dayBoxEmpty} />;
                  const isInicio = diaStr === dataInicio;
                  const isFim = diaStr === dataFim;
                  const isInRange = dataInicio && dataFim && diaStr > dataInicio && diaStr < dataFim;

                  return (
                    <TouchableOpacity 
                      key={index} 
                      style={[styles.dayBox, (isInicio || isFim) && styles.dayBoxSelected, isInRange && styles.dayBoxInRange]} 
                      onPress={() => selecionarDiaCalendario(diaStr)}
                    >
                      <Text style={[styles.dayText, (isInicio || isFim) && styles.dayTextSelected]}>
                        {parseInt(diaStr.split('-')[2])}
                      </Text>
                    </TouchableOpacity>
                  );
                });
              })()}
            </View>

            <View style={styles.calendarActions}>
              <TouchableOpacity style={styles.cancelButtonModal} onPress={() => setModalCalendarioVisivel(false)}>
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButtonModal} onPress={confirmarDatas}>
                <Text style={styles.confirmButtonText}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL DE SELEÇÃO DE HORÁRIO */}
      <Modal visible={modalHorarioVisivel} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Selecionar Horário de Início</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginVertical: 20 }}>
              <TextInput 
                style={styles.timeInput} 
                keyboardType="numeric" 
                maxLength={2} 
                value={horaTemp} 
                onChangeText={setHoraTemp} 
              />
              <Text style={{ fontSize: 24, fontWeight: 'bold', marginHorizontal: 10 }}>:</Text>
              <TextInput 
                style={styles.timeInput} 
                keyboardType="numeric" 
                maxLength={2} 
                value={minTemp} 
                onChangeText={setMinTemp} 
              />
            </View>
            <TouchableOpacity style={styles.confirmButtonModal} onPress={confirmarHorario}>
              <Text style={styles.confirmButtonText}>Confirmar Horário</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5EC' },
  header: { backgroundColor: '#2A4B4C', paddingTop: 50, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  backButton: { padding: 5 },
  headerTitle: { color: '#F7F5EC', fontSize: 20, fontWeight: 'bold' },
  formContainer: { padding: 20, flex: 1 },
  label: { fontSize: 14, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#C4C2B7', padding: 15, borderRadius: 8, fontSize: 16, color: '#333', marginBottom: 20 },
  descInput: { minHeight: 90, textAlignVertical: 'top' },
  selectorButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#C4C2B7', padding: 15, borderRadius: 8, marginBottom: 20 },
  selectorText: { marginLeft: 10, fontSize: 15, color: '#333', fontWeight: '500', flex: 1 },
  lockedSelector: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EBEAE4', borderWidth: 1, borderColor: '#D4D2C9', padding: 15, borderRadius: 8, marginBottom: 20 },
  lockedSelectorText: { marginLeft: 8, fontSize: 15, color: '#666', fontWeight: '500' },
  postButton: { backgroundColor: '#2A4B4C', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 10, elevation: 2 },
  buttonDisabled: { opacity: 0.7 },
  postButtonText: { color: '#F7F5EC', fontSize: 18, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', backgroundColor: '#fff', borderRadius: 20, padding: 20, elevation: 5 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 15, textAlign: 'center' },
  modalOption: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  modalOptionText: { fontSize: 16, color: '#333', textAlign: 'center' },
  closeModalBtn: { marginTop: 15, alignItems: 'center' },
  closeModalText: { color: '#E63946', fontWeight: 'bold' },
  timeInput: { width: 60, height: 60, backgroundColor: '#F0F0F0', borderRadius: 10, textAlign: 'center', fontSize: 24, fontWeight: 'bold', color: '#2A4B4C' },
  calendarContainer: { width: '100%', backgroundColor: '#fff', borderRadius: 20, padding: 20, elevation: 5 },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  calendarTitle: { fontSize: 18, fontWeight: 'bold', color: '#2A4B4C' },
  weekDaysContainer: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  weekDayText: { fontWeight: 'bold', color: '#666', width: 35, textAlign: 'center' },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
  dayBoxEmpty: { width: '14.2%', height: 40 },
  dayBox: { width: '14.2%', height: 40, justifyContent: 'center', alignItems: 'center', marginVertical: 2 },
  dayBoxSelected: { backgroundColor: '#2A4B4C', borderRadius: 20 },
  dayBoxInRange: { backgroundColor: '#E2EAE9' },
  dayText: { fontSize: 15, color: '#333' },
  dayTextSelected: { color: '#fff', fontWeight: 'bold' },
  calendarActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 15 },
  cancelButtonModal: { paddingVertical: 10, paddingHorizontal: 20, marginRight: 10 },
  cancelButtonText: { color: '#666', fontWeight: 'bold' },
  confirmButtonModal: { backgroundColor: '#2A4B4C', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, alignItems: 'center' },
  confirmButtonText: { color: '#fff', fontWeight: 'bold' }
});
