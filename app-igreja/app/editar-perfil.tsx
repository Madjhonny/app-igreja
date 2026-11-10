import { authenticatedFetch, getStoredUser, storeSessionUser } from '@/services/session';
import React, { useCallback, useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

export default function TelaEditarPerfil() {
  const [nomeExibicao, setNomeExibicao] = useState('');
  const [bio, setBio] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregarDadosIniciais = useCallback(async () => {
    try {
      const usuario = await getStoredUser();
      if (usuario) {
        setNomeExibicao(usuario.nome_exibicao || usuario.nome_completo || '');
        setBio(usuario.bio || '');
        setFoto(usuario.foto_perfil || null);
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar seu perfil.');
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(carregarDadosIniciais);
  }, [carregarDadosIniciais]);

  const escolherFoto = async () => {
    const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissao.granted) {
      Alert.alert('Permissão negada', 'Precisamos de acesso à galeria para alterar a foto.');
      return;
    }

    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });

    if (!resultado.canceled && resultado.assets[0]) {
      const asset = resultado.assets[0];
      if (asset.base64) {
        const tamanhoAproximado = Math.ceil(asset.base64.length * 0.75);
        if (tamanhoAproximado > 1_500_000) {
          Alert.alert('Imagem muito grande', 'Escolha uma imagem de até 1,5 MB.');
          return;
        }
        setFoto(`data:image/jpeg;base64,${asset.base64}`);
      } else {
        Alert.alert('Imagem inválida', 'Não foi possível preparar a imagem para envio.');
      }
    }
  };

  const removerFoto = () => {
    setFoto(null);
  };

  const salvarPerfil = async () => {
    const nomeLimpo = nomeExibicao.trim();
    if (nomeLimpo.length < 2 || nomeLimpo.length > 80 || bio.trim().length > 500) {
      Alert.alert('Atenção', 'Use um nome entre 2 e 80 caracteres e uma biografia de até 500 caracteres.');
      return;
    }
    setCarregando(true);
    try {
      const resposta = await authenticatedFetch('/usuarios/perfil', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          nome_exibicao: nomeLimpo,
          bio: bio.trim(),
          foto_perfil: foto
        })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        await storeSessionUser(dados.usuario);
        Alert.alert('Sucesso', 'Perfil atualizado com sucesso!', [
          { text: 'OK', onPress: () => router.back() }
        ]);
      } else {
        Alert.alert('Erro', dados.erro || 'Não foi possível atualizar o perfil.');
      }
    } catch {
      Alert.alert('Erro', 'Falha de conexão com o servidor.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Voltar">
          <Ionicons name="arrow-back" size={24} color="#F7F5EC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Editar Perfil</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.formContainer}>
        
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={escolherFoto} accessibilityRole="button" accessibilityLabel="Escolher foto do perfil">
            {foto ? (
              <Image source={{ uri: foto }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={50} color="#777" />
              </View>
            )}
          </TouchableOpacity>
          <View style={styles.photoActions}>
            <TouchableOpacity style={styles.photoButton} onPress={escolherFoto}>
              <Text style={styles.photoButtonText}>Alterar foto</Text>
            </TouchableOpacity>
            {foto && (
              <TouchableOpacity style={[styles.photoButton, styles.removeButton]} onPress={removerFoto}>
                <Text style={styles.removeButtonText}>Remover</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.label}>Nome de Exibição</Text>
        <TextInput 
          style={styles.input} 
          value={nomeExibicao} 
          onChangeText={setNomeExibicao} 
          placeholder="Como deseja ser chamado no app"
          placeholderTextColor="#999"
          accessibilityLabel="Nome de exibição"
        />

        <Text style={styles.label}>Biografia (BIO)</Text>
        <TextInput 
          style={[styles.input, styles.bioInput]} 
          placeholder="Escreva um pouco sobre você..." 
          placeholderTextColor="#999"
          value={bio} 
          onChangeText={setBio} 
          multiline 
          numberOfLines={4} 
          accessibilityLabel="Biografia"
        />

        <TouchableOpacity style={styles.saveButton} onPress={salvarPerfil} disabled={carregando} accessibilityRole="button" accessibilityLabel="Salvar alterações do perfil">
          {carregando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Salvar Alterações</Text>
          )}
        </TouchableOpacity>

      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5EC' },
  header: { backgroundColor: '#2A4B4C', paddingTop: 50, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  backButton: { padding: 5 },
  headerTitle: { color: '#F7F5EC', fontSize: 20, fontWeight: 'bold' },
  formContainer: { padding: 20 },
  avatarSection: { alignItems: 'center', marginBottom: 25 },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: '#2A4B4C', marginBottom: 10 },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#E2EAE9', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#2A4B4C', marginBottom: 10 },
  photoActions: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  photoButton: { backgroundColor: '#E2EAE9', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#2A4B4C' },
  photoButtonText: { color: '#2A4B4C', fontSize: 12, fontWeight: 'bold' },
  removeButton: { backgroundColor: '#FDE8E8', borderColor: '#E63946' },
  removeButtonText: { color: '#E63946', fontSize: 12, fontWeight: 'bold' },
  label: { fontSize: 14, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#C4C2B7', padding: 15, borderRadius: 8, fontSize: 16, color: '#333', marginBottom: 20 },
  bioInput: { minHeight: 100, textAlignVertical: 'top' },
  saveButton: { backgroundColor: '#2A4B4C', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 10, elevation: 2 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
