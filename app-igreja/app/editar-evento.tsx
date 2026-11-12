import { useAppDialog } from '@/components/app-dialog';
import { apiFetch, authenticatedFetch } from '@/services/session';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Modal, FlatList } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

function primeiroParametro(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function criarDataInicial(data?: string, horario?: string) {
  const partesData = data?.split('T')[0].split('-').map(Number);
  const partesHora = horario?.split(':').map(Number);
  if (partesData?.length === 3 && partesHora && partesHora.length >= 2) {
    const resultado = new Date(partesData[0], partesData[1] - 1, partesData[2], partesHora[0], partesHora[1]);
    if (!Number.isNaN(resultado.getTime())) return resultado;
  }
  return new Date();
}

function formatarDataBanco(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

export default function TelaEditarEvento() {
  const { alert: mostrarDialogo } = useAppDialog();
  // Recebe os dados que vieram da tela de Agenda
  const params = useLocalSearchParams(); 
  
  const dataInicioOriginal = primeiroParametro(params.data_inicio);
  const dataFimOriginal = primeiroParametro(params.data_fim) || dataInicioOriginal;
  const horarioOriginal = primeiroParametro(params.horario);
  const eventoId = primeiroParametro(params.id);
  const duracaoDias = useMemo(() => {
    if (!dataInicioOriginal || !dataFimOriginal) return 0;
    const inicio = new Date(`${dataInicioOriginal.split('T')[0]}T12:00:00`);
    const fim = new Date(`${dataFimOriginal.split('T')[0]}T12:00:00`);
    return Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 86_400_000));
  }, [dataFimOriginal, dataInicioOriginal]);

  const [titulo, setTitulo] = useState(primeiroParametro(params.titulo) || '');
  
  // === ESTADOS DE DATA E HORA ===
  const [dataEvento, setDataEvento] = useState(() => criarDataInicial(dataInicioOriginal, horarioOriginal));
  const [mostrarCalendario, setMostrarCalendario] = useState(false);
  const [mostrarRelogio, setMostrarRelogio] = useState(false);
  
  // === ESTADOS DA CONGREGAÇÃO ===
  const [congregacao, setCongregacao] = useState(primeiroParametro(params.congregacao) || 'Selecione o local');
  const [congregacaoId, setCongregacaoId] = useState(primeiroParametro(params.congregacao_id) || '');
  const [modalVisivel, setModalVisivel] = useState(false);
  const [listaCongregacoes, setListaCongregacoes] = useState<{ id: number; nome: string }[]>([]);

  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    let ativo = true;
    void Promise.resolve().then(async () => {
      try {
        const resposta = await apiFetch('/congregacoes');
        const dados = await resposta.json();
        if (ativo && resposta.ok && Array.isArray(dados)) setListaCongregacoes(dados);
      } catch {
        if (ativo) mostrarDialogo('Erro', 'Não foi possível carregar as congregações.');
      }
    });
    return () => { ativo = false; };
  }, []);

  // === FUNÇÕES DO CALENDÁRIO E RELÓGIO ===
  const aoMudarData = (event: any, dataSelecionada?: Date) => {
    setMostrarCalendario(false); 
    if (dataSelecionada) {
      const novaData = new Date(dataEvento);
      novaData.setFullYear(dataSelecionada.getFullYear());
      novaData.setMonth(dataSelecionada.getMonth());
      novaData.setDate(dataSelecionada.getDate());
      setDataEvento(novaData);
    }
  };

  const aoMudarHora = (event: any, horaSelecionada?: Date) => {
    setMostrarRelogio(false); 
    if (horaSelecionada) {
      const novaData = new Date(dataEvento);
      novaData.setHours(horaSelecionada.getHours());
      novaData.setMinutes(horaSelecionada.getMinutes());
      setDataEvento(novaData);
    }
  };

  const textoDataVisivel = dataEvento.toLocaleDateString('pt-BR');
  const textoHoraVisivel = dataEvento.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // === FUNÇÃO PARA SALVAR (ATUALIZAR) ===
  const salvarEdicao = async (confirmarConflito = false) => {
    if (!eventoId || !titulo.trim() || !congregacaoId) {
      mostrarDialogo("Atenção", "Por favor, preencha o título e selecione a congregação.");
      return;
    }

    const dataFormatadaDB = formatarDataBanco(dataEvento);
    const dataFim = new Date(dataEvento);
    dataFim.setDate(dataFim.getDate() + duracaoDias);

    const horas = String(dataEvento.getHours()).padStart(2, '0');
    const minutos = String(dataEvento.getMinutes()).padStart(2, '0');
    const horarioDB = `${horas}:${minutos}`;

    setCarregando(true);
    try {
      const resposta = await authenticatedFetch(`/eventos/${encodeURIComponent(eventoId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: titulo.trim(),
          data_inicio: dataFormatadaDB,
          data_fim: formatarDataBanco(dataFim),
          horario: horarioDB,
          congregacao_id: Number(congregacaoId),
          legenda: primeiroParametro(params.legenda) || '',
          confirmar_conflito: confirmarConflito,
        })
      });

      const dados = await resposta.json().catch(() => ({}));
      if (resposta.ok) {
        mostrarDialogo("Sucesso!", "Evento atualizado com sucesso.", [
          { text: "Voltar à agenda", onPress: () => router.back() },
        ]); 
      } else if (resposta.status === 409 && dados.codigo === 'CONFLITO_AGENDA' && dados.podeConfirmar) {
        const encontrados = (dados.eventosConflitantes || []).slice(0, 3)
          .map((ev: any) => '• ' + ev.titulo).join('\n');
        const aviso = 'Há eventos da mesma congregação neste horário:\n' + encontrados +
          '\n\nDeseja salvar a alteração mesmo assim?';
        mostrarDialogo('Conflito de agenda', aviso, [
          { text: 'Voltar e revisar', style: 'cancel' },
          { text: 'Salvar mesmo assim', onPress: () => void salvarEdicao(true) },
        ]);
      } else {
        const avisoErro = dados.erro || "Não foi possível atualizar o evento.";
        mostrarDialogo("Erro", avisoErro);
      }
    } catch {
      mostrarDialogo("Erro de Conexão", "Não foi possível conectar ao servidor.");
    } finally {
      setCarregando(false);
    }
  };

  // === FUNÇÃO PARA EXCLUIR ===
  const confirmarExclusao = () => {
    mostrarDialogo("Excluir Evento", "Tem certeza que deseja apagar este evento da agenda?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: excluirEvento }
    ]);
  };

  const excluirEvento = async () => {
    if (!eventoId) return;
    setCarregando(true);
    try {
      const resposta = await authenticatedFetch(`/eventos/${encodeURIComponent(eventoId)}`, { method: 'DELETE' });

      if (resposta.ok) {
        mostrarDialogo("Excluído", "O evento foi apagado.", [
          { text: "Voltar à agenda", onPress: () => router.back() },
        ]); 
      } else {
        mostrarDialogo("Erro", "Não foi possível excluir o evento.");
      }
    } catch {
      mostrarDialogo("Erro de Conexão", "Não foi possível conectar ao servidor.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>❮ Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Editar Evento</Text>
      </View>

      <ScrollView style={styles.formContainer}>
        <Text style={styles.label}>Título do Evento</Text>
        <TextInput 
          style={styles.input} 
          value={titulo}
          onChangeText={setTitulo}
        />

        <Text style={styles.label}>Data</Text>
        <TouchableOpacity style={styles.selectInput} onPress={() => setMostrarCalendario(true)}>
          <Text style={styles.selectTextFilled}>📅 {textoDataVisivel}</Text>
        </TouchableOpacity>
        
        {mostrarCalendario && (
          <DateTimePicker value={dataEvento} mode="date" display="default" onChange={aoMudarData} />
        )}

        <Text style={styles.label}>Horário</Text>
        <TouchableOpacity style={styles.selectInput} onPress={() => setMostrarRelogio(true)}>
          <Text style={styles.selectTextFilled}>⏰ {textoHoraVisivel}</Text>
        </TouchableOpacity>
        
        {mostrarRelogio && (
          <DateTimePicker value={dataEvento} mode="time" display="default" onChange={aoMudarHora} />
        )}

        <Text style={styles.label}>Congregação / Local</Text>
        <TouchableOpacity style={styles.selectInput} onPress={() => setModalVisivel(true)}>
          <Text style={styles.selectTextFilled}>{congregacao}</Text>
          <Text style={styles.selectArrow}>▼</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.saveButton, carregando && styles.buttonDisabled]} 
          onPress={() => void salvarEdicao()}
          disabled={carregando}
        >
          {carregando ? <ActivityIndicator color="#F7F5EC" /> : <Text style={styles.saveButtonText}>ATUALIZAR EVENTO</Text>}
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.deleteButton, carregando && styles.buttonDisabled]} 
          onPress={confirmarExclusao}
          disabled={carregando}
        >
          <Text style={styles.deleteButtonText}>EXCLUIR EVENTO</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal transparent={true} visible={modalVisivel} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalVisivel(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Escolha a Congregação</Text>
            <FlatList 
              data={listaCongregacoes}
              keyExtractor={(item) => String(item.id)}
              renderItem={({item}) => (
                <TouchableOpacity style={styles.modalOption} onPress={() => { setCongregacao(item.nome); setCongregacaoId(String(item.id)); setModalVisivel(false); }}>
                  <Text style={styles.modalOptionText}>{item.nome}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5EC' },
  header: { backgroundColor: '#2A4B4C', paddingTop: 50, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  backButton: { marginRight: 20 },
  backButtonText: { color: '#F7F5EC', fontSize: 16, fontWeight: 'bold' },
  headerTitle: { color: '#F7F5EC', fontSize: 20, fontWeight: 'bold' },
  
  formContainer: { padding: 20 },
  label: { fontSize: 16, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 8, marginTop: 15 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#C4C2B7', padding: 15, borderRadius: 8, fontSize: 16, color: '#333' },
  
  selectInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#C4C2B7', padding: 15, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectTextFilled: { color: '#333', fontSize: 16, fontWeight: '500' },
  selectArrow: { color: '#2A4B4C', fontSize: 16 },

  saveButton: { backgroundColor: '#2A4B4C', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 30, elevation: 2 },
  deleteButton: { backgroundColor: '#E63946', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 15, elevation: 2, marginBottom: 40 },
  buttonDisabled: { opacity: 0.7 },
  saveButtonText: { color: '#F7F5EC', fontSize: 16, fontWeight: 'bold' },
  deleteButtonText: { color: '#F7F5EC', fontSize: 16, fontWeight: 'bold' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#fff', width: '80%', maxHeight: '70%', borderRadius: 15, padding: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 15, textAlign: 'center' },
  modalOption: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  modalOptionText: { fontSize: 18, color: '#333', textAlign: 'center' }
});
