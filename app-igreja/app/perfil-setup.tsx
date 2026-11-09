import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Modal, Pressable, Image, Alert } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker'; // Biblioteca para pegar foto da galeria

export default function TelaPerfilSetup() {
  const [nomePublico, setNomePublico] = useState('');
  const [congregacao, setCongregacao] = useState('Matriz');
  const [bio, setBio] = useState('');
  const [fotoUri, setFotoUri] = useState<string | null>(null); // Guarda a foto escolhida
  
  const [modalCongregacaoVisivel, setModalCongregacaoVisivel] = useState(false);

  const listaCongregacoes = [
    'Matriz', 'Monan', 'Sapê', 'Viradouro', 'Maceió', 'Matapaca', 'Morro da Vitória', 'Fazendinha', 'Paineiras', 'Cafubá'
  ];

  // Função para abrir a galeria do celular
  const escolherFoto = async () => {
    // Pede permissão para acessar a galeria
    const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissao.granted) {
      Alert.alert('Permissão negada', 'Precisamos de permissão para acessar sua galeria!');
      return;
    }

    // Abre a galeria
    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!resultado.canceled) {
      setFotoUri(resultado.assets[0].uri);
    }
  };

  // Gerencia o clique no ícone da foto com base em ter foto ou não
  const lidarComCliqueFoto = () => {
    if (!fotoUri) {
      // Caso não tenha foto
      escolherFoto();
    } else {
      // Caso já tenha foto, dá opções de atualizar ou remover
      Alert.alert(
        'Foto de Perfil',
        'Escolha o que deseja fazer:',
        [
          { text: 'Atualizar foto', onPress: escolherFoto },
          { text: 'Remover foto', onPress: () => setFotoUri(null), style: 'destructive' },
          { text: 'Cancelar', style: 'cancel' }
        ]
      );
    }
  };

  const finalizarCadastro = () => {
    router.replace('/(tabs)/agenda');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <Text style={styles.headerTitle}>Personalize seu Perfil</Text>
      <Text style={styles.headerSubtitle}>Deixe a comunidade te conhecer melhor</Text>

      <View style={styles.card}>
        
        {/* Bloco da Foto Interativo */}
        <TouchableOpacity style={styles.avatarContainer} onPress={lidarComCliqueFoto} activeOpacity={0.8}>
          <View style={styles.avatarCircle}>
            {fotoUri ? (
              <Image source={{ uri: fotoUri }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="camera" size={32} color="#2A4B4C" />
            )}
          </View>
          <Text style={styles.changePhotoText}>
            {!fotoUri ? 'Adicionar foto de perfil' : 'Alterar ou remover foto'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.label}>Nome visível para outros usuários</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Como quer ser chamado?" 
          value={nomePublico}
          onChangeText={setNomePublico}
        />

        <Text style={styles.label}>Sua Congregação</Text>
        <TouchableOpacity 
          style={styles.selectButton} 
          onPress={() => setModalCongregacaoVisivel(true)}
        >
          <Text style={styles.selectButtonText}>{congregacao}</Text>
          <Ionicons name="chevron-down" size={20} color="#2A4B4C" />
        </TouchableOpacity>

        <Text style={styles.label}>Biografia / O que você faz na igreja</Text>
        <TextInput 
          style={[styles.input, styles.bioInput]} 
          placeholder="Ex: Membro do coral, voluntário..." 
          multiline={true}
          numberOfLines={3}
          value={bio}
          onChangeText={setBio}
        />

        <TouchableOpacity style={styles.button} onPress={finalizarCadastro}>
          <Text style={styles.buttonText}>Concluir e Entrar no App</Text>
        </TouchableOpacity>

      </View>

      {/* MODAL DE CONGREGAÇÃO */}
      <Modal visible={modalCongregacaoVisivel} transparent={true} animationType="slide" onRequestClose={() => setModalCongregacaoVisivel(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setModalCongregacaoVisivel(false)}>
          <Pressable style={styles.modalContentLarge}>
            <Text style={styles.modalTitle}>Selecione sua Congregação</Text>
            <ScrollView style={styles.filterScroll} showsVerticalScrollIndicator={false}>
              {listaCongregacoes.map((item, index) => (
                <TouchableOpacity 
                  key={index} 
                  style={[styles.filterOption, congregacao === item && styles.optionSelected]}
                  onPress={() => { setCongregacao(item); setModalCongregacaoVisivel(false); }}
                >
                  <Text style={[styles.filterOptionText, congregacao === item && styles.optionTextSelected]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#2A4B4C', alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  headerTitle: { fontSize: 24, color: '#F7F5EC', fontWeight: 'bold', marginBottom: 5 },
  headerSubtitle: { fontSize: 14, color: '#D8D4C5', marginBottom: 20 },
  card: { backgroundColor: '#F7F5EC', width: '90%', borderRadius: 20, padding: 25, elevation: 8 },
  avatarContainer: { alignItems: 'center', marginBottom: 20 },
  avatarCircle: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#E0DCD3', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#2A4B4C', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  changePhotoText: { color: '#2A4B4C', fontWeight: 'bold', marginTop: 8, fontSize: 13 },
  label: { fontSize: 14, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 5 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 15, fontSize: 15 },
  selectButton: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectButtonText: { fontSize: 15, color: '#333', fontWeight: '500' },
  bioInput: { height: 80, textAlignVertical: 'top' },
  button: { backgroundColor: '#2A4B4C', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#F7F5EC', fontSize: 16, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContentLarge: { backgroundColor: '#F7F5EC', width: '90%', maxHeight: '75%', borderRadius: 20, padding: 20, alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 15 },
  optionSelected: { backgroundColor: '#2A4B4C', borderColor: '#2A4B4C' },
  optionTextSelected: { color: '#F7F5EC' },
  filterScroll: { width: '100%' },
  filterOption: { width: '100%', paddingVertical: 12, alignItems: 'center', borderRadius: 10, marginBottom: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  filterOptionText: { color: '#4A4A4A', fontWeight: 'bold', fontSize: 15 }
});