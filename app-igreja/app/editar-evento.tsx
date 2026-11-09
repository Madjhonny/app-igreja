import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal, FlatList } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

export default function TelaEditarEvento() {
  // Recebe os dados que vieram da tela de Agenda
  const params = useLocalSearchParams(); 
  
  const [titulo, setTitulo] = useState(params.titulo as string || '');
  
  // === ESTADOS DE DATA E HORA ===
  const [dataEvento, setDataEvento] = useState(new Date()); 
  const [mostrarCalendario, setMostrarCalendario] = useState(false);
  const [mostrarRelogio, setMostrarRelogio] = useState(false);
  
  // === ESTADOS DA CONGREGAÇÃO ===
  const [congregacao, setCongregacao] = useState(params.congregacao as string || 'Selecione o local');
  const [modalVisivel, setModalVisivel] = useState(false);
  
  const listaCongregacoes = [
    'Matriz', 'Monan', 'Sapê', 'Matapaca', 'Areia Grossa', 
    'Maceió', 'Morro da Vitória', 'Paineiras', 'Fazendinha', 
    'Cafubá', 'Viradouro'
  ];

  const [carregando, setCarregando] = useState(false);

  // Inicializa a data e hora corretas que vieram do banco
  useEffect(() => {
    if (params.data_inicio && params.horario) {
      const dataString = (params.data_inicio as string).split('T')[0];
      const [ano, mes, dia] = dataString.split('-');
      const [hora, minuto] = (params.horario as string).split(':');
      
      const dataFormatada = new Date(Number(ano), Number(mes) - 1, Number(dia), Number(hora), Number(minuto));
      setDataEvento(dataFormatada);
    }
  }, [params.data_inicio, params.horario]);

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
  const salvarEdicao = async () => {
    if (!titulo || congregacao === 'Selecione o local') {
      Alert.alert("Atenção", "Por favor, preencha o título e selecione a congregação.");
      return;
    }

    const ano = dataEvento.getFullYear();
    const mes = String(dataEvento.getMonth() + 1).padStart(2, '0');
    const dia = String(dataEvento.getDate()).padStart(2, '0');
    const dataFormatadaDB = `${ano}-${mes}-${dia}`;

    const horas = String(dataEvento.getHours()).padStart(2, '0');
    const minutos = String(dataEvento.getMinutes()).padStart(2, '0');
    const horarioDB = `${horas}:${minutos}`;

    setCarregando(true);
    try {
      // ⚠️ TROQUE SEU_IP_AQUI
      const resposta = await fetch(`http://192.168.1.69:3000/eventos/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: titulo,
          data_inicio: dataFormatadaDB,
          data_fim: null,
          horario: horarioDB,
          congregacao: congregacao,
          legenda: "",
          banner_url: ""
        })
      });

      if (resposta.ok) {
        Alert.alert("Sucesso!", "Evento atualizado com sucesso.");
        router.back(); 
      } else {
        Alert.alert("Erro", "Não foi possível atualizar o evento.");
      }
    } catch (error) {
      Alert.alert("Erro de Conexão", "Não foi possível conectar ao servidor.");
    } finally {
      setCarregando(false);
    }
  };

  // === FUNÇÃO PARA EXCLUIR ===
  const confirmarExclusao = () => {
    Alert.alert("Excluir Evento", "Tem certeza que deseja apagar este evento da agenda?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: excluirEvento }
    ]);
  };

  const excluirEvento = async () => {
    setCarregando(true);
    try {
      // ⚠️ TROQUE SEU_IP_AQUI
      const resposta = await fetch(`http://192.168.1.69:3000/eventos/${params.id}`, {
        method: 'DELETE',
      });

      if (resposta.ok) {
        Alert.alert("Excluído", "O evento foi apagado.");
        router.back(); 
      } else {
        Alert.alert("Erro", "Não foi possível excluir o evento.");
      }
    } catch (error) {
      Alert.alert("Erro de Conexão", "Não foi possível conectar ao servidor.");
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
          onPress={salvarEdicao}
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
              keyExtractor={(item) => item}
              renderItem={({item}) => (
                <TouchableOpacity style={styles.modalOption} onPress={() => { setCongregacao(item); setModalVisivel(false); }}>
                  <Text style={styles.modalOptionText}>{item}</Text>
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