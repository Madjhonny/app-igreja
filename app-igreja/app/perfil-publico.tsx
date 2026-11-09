import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function TelaPerfilPublico() {
  const { id } = useLocalSearchParams(); // Recebe o ID do usuário clicado
  const [perfil, setPerfil] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (id) buscarPerfilPublico();
  }, [id]);

  const buscarPerfilPublico = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      // ⚠️ ATENÇÃO: TROQUE PELO SEU IP REAL SE NECESSÁRIO
      const resposta = await fetch(`http://192.168.1.71:3000/usuarios/${id}/perfil-publico`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const dados = await resposta.json();
      if (resposta.ok) {
        setPerfil(dados);
      } else {
        Alert.alert('Erro', dados.erro || 'Não foi possível carregar o perfil.');
        router.back();
      }
    } catch (error) {
      Alert.alert('Erro', 'Falha de conexão com o servidor.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#F7F5EC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Perfil do Usuário</Text>
        <View style={{ width: 24 }} />
      </View>

      {carregando ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2A4B4C" />
        </View>
      ) : (
        <View style={styles.profileContainer}>
          {perfil?.foto_perfil ? (
            <Image source={{ uri: perfil.foto_perfil }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={60} color="#777" />
            </View>
          )}

          <Text style={styles.nome}>{perfil?.nome_completo}</Text>
          
          <View style={styles.bioBox}>
            <Text style={styles.bioTitle}>Sobre</Text>
            <Text style={styles.bioText}>{perfil?.bio || 'Este usuário ainda não adicionou uma biografia.'}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5EC' },
  header: { backgroundColor: '#2A4B4C', paddingTop: 50, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  backButton: { padding: 5 },
  headerTitle: { color: '#F7F5EC', fontSize: 20, fontWeight: 'bold' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  profileContainer: { alignItems: 'center', padding: 30 },
  avatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: '#2A4B4C', marginBottom: 20 },
  avatarPlaceholder: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#E2EAE9', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#2A4B4C', marginBottom: 20 },
  nome: { fontSize: 22, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 20, textAlign: 'center' },
  bioBox: { width: '100%', backgroundColor: '#fff', padding: 20, borderRadius: 15, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, elevation: 2 },
  bioTitle: { fontSize: 14, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 8 },
  bioText: { fontSize: 15, color: '#444', lineHeight: 22 }
});