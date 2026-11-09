import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

export default function TelaEditarPerfil() {
  const [token, setToken] = useState('');
  const [nomeExibicao, setNomeExibicao] = useState('');
  const [bio, setBio] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    carregarDadosIniciais();
  }, []);

  const carregarDadosIniciais = async () => {
    try {
      const userToken = await AsyncStorage.getItem('userToken');
      const userData = await AsyncStorage.getItem('userData');
      
      if (userToken) setToken(userToken);
      
      if (userData) {
        const usuario = JSON.parse(userData);
        setNomeExibicao(usuario.nome_exibicao || usuario.nome_completo || '');
        setBio(usuario.bio || '');
        setFoto(usuario.foto_perfil || null);
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    }
  };

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
        setFoto(`data:image/jpeg;base64,${asset.base64}`);
      } else {
        setFoto(asset.uri);
      }
    }
  };

  const removerFoto = () => {
    setFoto(null);
  };

  const salvarPerfil = async () => {
    setCarregando(true);
    try {
      const resposta = await fetch('http://192.168.1.71:3000/usuarios/perfil', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          nome_exibicao: nomeExibicao,
          bio,
          foto_perfil: foto
        })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        await AsyncStorage.setItem('userData', JSON.stringify(dados.usuario));
        Alert.alert('Sucesso', 'Perfil atualizado com sucesso!', [
          { text: 'OK', onPress: () => router.back() }
        ]);
      } else {
        Alert.alert('Erro', dados.erro || 'Não foi possível atualizar o perfil.');
      }
    } catch (error) {
      Alert.alert('Erro', 'Falha de conexão com o servidor.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#F7F5EC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Editar Perfil</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.formContainer}>
        
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={escolherFoto}>
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
        />

        <TouchableOpacity style={styles.saveButton} onPress={salvarPerfil} disabled={carregando}>
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