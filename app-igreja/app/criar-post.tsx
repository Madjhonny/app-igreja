import { useAppAlert } from '@/components/app-dialog';
import { authenticatedFetch } from '@/services/session';
import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Image, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

export default function TelaCriarPost() {
  const Alert = useAppAlert();
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [local, setLocal] = useState('');
  const [midia, setMidia] = useState<string | null>(null);
  const [tipoMidia, setTipoMidia] = useState<'imagem' | null>(null);
  const [carregando, setCarregando] = useState(false);

  // Estados do Calendário e Datas
  const [modalCalendarioVisivel, setModalCalendarioVisivel] = useState(false);
  const [dataInicio, setDataInicio] = useState<string | null>(null);
  const [dataFim, setDataFim] = useState<string | null>(null);
  const [mesAtual, setMesAtual] = useState(new Date().getMonth());
  const [anoAtual, setAnoAtual] = useState(new Date().getFullYear());

  const escolherMidia = async () => {
    const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissao.granted) {
      Alert.alert('Permissão negada', 'Precisamos de acesso à galeria para anexar uma imagem.');
      return;
    }

    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });

    if (!resultado.canceled && resultado.assets[0]) {
      const asset = resultado.assets[0];
      if (!asset.base64) {
        Alert.alert('Imagem inválida', 'Não foi possível preparar a imagem para envio.');
        return;
      }
      const tamanhoAproximado = Math.ceil(asset.base64.length * 0.75);
      if (tamanhoAproximado > 1_500_000) {
        Alert.alert('Imagem muito grande', 'Escolha uma imagem de até 1,5 MB.');
        return;
      }
      setTipoMidia('imagem');
      setMidia(`data:image/jpeg;base64,${asset.base64}`);
    }
  };

  const selecionarDiaCalendario = (diaStr: string) => {
    if (!dataInicio || (dataInicio && dataFim)) {
      setDataInicio(diaStr);
      setDataFim(null);
    } else if (dataInicio && !dataFim) {
      if (diaStr < dataInicio) {
        setDataInicio(diaStr);
      } else {
        setDataFim(diaStr);
      }
    }
  };

  const confirmarDatas = () => {
    if (!dataInicio) {
      Alert.alert("Atenção", "Selecione pelo menos a data de início do evento.");
      return;
    }
    if (!dataFim) {
      setDataFim(dataInicio);
    }
    setModalCalendarioVisivel(false);
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

  const obterDiasDoMes = () => {
    const primeiroDiaIndex = new Date(anoAtual, mesAtual, 1).getDay();
    const totalDias = new Date(anoAtual, mesAtual + 1, 0).getDate();
    const dias = [];

    for (let i = 0; i < primeiroDiaIndex; i++) {
      dias.push(null);
    }
    for (let i = 1; i <= totalDias; i++) {
      const mesStr = String(mesAtual + 1).padStart(2, '0');
      const diaStr = String(i).padStart(2, '0');
      dias.push(`${anoAtual}-${mesStr}-${diaStr}`);
    }
    return dias;
  };

  const formatarDataExibicao = (dataStr: string | null) => {
    if (!dataStr) return 'Toque para selecionar as datas';
    const [ano, mes, dia] = dataStr.split('-');
    return `${dia}/${mes}/${ano}`;
  };

  const publicarPost = async () => {
    if (!titulo || !midia || !dataInicio) {
      return Alert.alert('Atenção', 'Preencha o Título, selecione uma Mídia e defina as Datas do Evento.');
    }

    const fimFinal = dataFim || dataInicio;

    setCarregando(true);
    try {
      const resposta = await authenticatedFetch('/mural', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          titulo, 
          descricao, 
          local, 
          tipo_midia: tipoMidia,
          midia,
          data_inicio: dataInicio,
          data_fim: fimFinal
        })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        Alert.alert('Sucesso', 'Publicação criada com sucesso!', [
          { text: 'OK', onPress: () => router.back() }
        ]);
      } else {
        Alert.alert('Erro', dados.erro || 'Falha ao publicar no mural.');
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível conectar ao servidor.');
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
        <Text style={styles.headerTitle}>Criar Publicação</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.formContainer} contentContainerStyle={{ paddingBottom: 60 }}>
          
          <TouchableOpacity style={styles.uploadArea} onPress={escolherMidia}>
            {midia ? (
              <View style={styles.midiaPreviewContainer}>
                <Image source={{ uri: midia }} style={styles.midiaPreview} />
                <View style={styles.changeMidiaButton}>
                  <Ionicons name="pencil" size={16} color="#fff" />
                  <Text style={styles.changeMidiaText}>Trocar</Text>
                </View>
              </View>
            ) : (
              <View style={styles.uploadPlaceholder}>
                <Ionicons name="cloud-upload-outline" size={50} color="#2A4B4C" />
                <Text style={styles.uploadText}>Toque para anexar Foto ou Vídeo</Text>
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.label}>Título da Publicação *</Text>
          <TextInput style={styles.input} placeholder="Ex: Culto de Celebração" value={titulo} onChangeText={setTitulo} />

          <Text style={styles.label}>Local / Congregação</Text>
          <TextInput style={styles.input} placeholder="Ex: Matriz" value={local} onChangeText={setLocal} />

          <Text style={styles.label}>Período do Evento *</Text>
          <TouchableOpacity style={styles.dateSelectorButton} onPress={() => setModalCalendarioVisivel(true)}>
            <Ionicons name="calendar-outline" size={20} color="#2A4B4C" />
            <Text style={styles.dateSelectorText}>
              {dataInicio ? `${formatarDataExibicao(dataInicio)} ${dataFim && dataFim !== dataInicio ? `até ${formatarDataExibicao(dataFim)}` : '(1 dia)'}` : 'Selecionar data de início e término'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.label}>Descrição / Legenda</Text>
          <TextInput style={[styles.input, styles.descInput]} placeholder="Escreva algo sobre este evento..." value={descricao} onChangeText={setDescricao} multiline numberOfLines={4} />

          <TouchableOpacity style={[styles.postButton, carregando && styles.buttonDisabled]} onPress={publicarPost} disabled={carregando}>
            {carregando ? <ActivityIndicator color="#F7F5EC" /> : <Text style={styles.postButtonText}>PUBLICAR NO MURAL</Text>}
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={modalCalendarioVisivel} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.calendarContainer}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity onPress={() => mudarMes(-1)}>
                <Ionicons name="chevron-back" size={24} color="#2A4B4C" />
              </TouchableOpacity>
              <Text style={styles.calendarTitle}>{mesesNomes[mesAtual]} {anoAtual}</Text>
              <TouchableOpacity onPress={() => mudarMes(1)}>
                <Ionicons name="chevron-forward" size={24} color="#2A4B4C" />
              </TouchableOpacity>
            </View>

            <View style={styles.weekDaysContainer}>
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d, index) => (
                <Text key={index} style={styles.weekDayText}>{d}</Text>
              ))}
            </View>

            <View style={styles.daysGrid}>
              {obterDiasDoMes().map((diaStr, index) => {
                if (!diaStr) return <View key={index} style={styles.dayBoxEmpty} />;

                const isInicio = diaStr === dataInicio;
                const isFim = diaStr === dataFim;
                const isInRange = dataInicio && dataFim && diaStr > dataInicio && diaStr < dataFim;

                return (
                  <TouchableOpacity 
                    key={index} 
                    style={[
                      styles.dayBox, 
                      isInicio && styles.dayBoxSelected,
                      isFim && styles.dayBoxSelected,
                      isInRange && styles.dayBoxInRange
                    ]} 
                    onPress={() => selecionarDiaCalendario(diaStr)}
                  >
                    <Text style={[
                      styles.dayText, 
                      (isInicio || isFim) && styles.dayTextSelected
                    ]}>
                      {parseInt(diaStr.split('-')[2])}
                    </Text>
                  </TouchableOpacity>
                );
              })}
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

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5EC' },
  header: { backgroundColor: '#2A4B4C', paddingTop: 50, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  backButton: { padding: 5 },
  headerTitle: { color: '#F7F5EC', fontSize: 20, fontWeight: 'bold' },
  formContainer: { padding: 20, flex: 1 },
  
  uploadArea: { backgroundColor: '#E2EAE9', borderRadius: 15, height: 220, justifyContent: 'center', alignItems: 'center', marginBottom: 20, borderWidth: 2, borderColor: '#C4C2B7', borderStyle: 'dashed', overflow: 'hidden' },
  uploadPlaceholder: { alignItems: 'center', padding: 20 },
  uploadText: { fontSize: 15, color: '#2A4B4C', fontWeight: 'bold', marginTop: 10, textAlign: 'center' },
  
  midiaPreviewContainer: { width: '100%', height: '100%', position: 'relative' },
  midiaPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  playIconOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', alignItems: 'center' },
  changeMidiaButton: { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignItems: 'center' },
  changeMidiaText: { color: '#fff', marginLeft: 5, fontSize: 12, fontWeight: 'bold' },

  label: { fontSize: 14, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#C4C2B7', padding: 15, borderRadius: 8, fontSize: 16, color: '#333', marginBottom: 20 },
  descInput: { minHeight: 90, textAlignVertical: 'top' },
  
  dateSelectorButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#C4C2B7', padding: 15, borderRadius: 8, marginBottom: 20 },
  dateSelectorText: { marginLeft: 10, fontSize: 15, color: '#333', fontWeight: '500' },

  postButton: { backgroundColor: '#2A4B4C', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10, elevation: 2, marginBottom: 40 },
  buttonDisabled: { opacity: 0.7 },
  postButtonText: { color: '#F7F5EC', fontSize: 18, fontWeight: 'bold' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
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
  confirmButtonModal: { backgroundColor: '#2A4B4C', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  confirmButtonText: { color: '#fff', fontWeight: 'bold' }
});
