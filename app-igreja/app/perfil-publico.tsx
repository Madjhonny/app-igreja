import { authenticatedFetch } from '@/services/session';
import React, { useCallback, useState, useEffect } from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TelaPerfilPublico() {
  const { id } = useLocalSearchParams(); // Recebe o ID do usuário clicado
  const [perfil, setPerfil] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const perfilId = Array.isArray(id) ? id[0] : id;

  const buscarPerfilPublico = useCallback(async () => {
    if (!perfilId) return;
    setCarregando(true);
    setErro('');
    try {
      const resposta = await authenticatedFetch(`/usuarios/${encodeURIComponent(perfilId)}/perfil-publico`);
      const dados = await resposta.json();
      if (resposta.ok) {
        setPerfil(dados);
      } else {
        setErro(dados.erro || 'Não foi possível carregar o perfil.');
      }
    } catch {
      setErro('Falha de conexão com o servidor.');
    } finally {
      setCarregando(false);
    }
  }, [perfilId]);

  useEffect(() => {
    void Promise.resolve().then(buscarPerfilPublico);
  }, [buscarPerfilPublico]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Voltar">
          <Ionicons name="arrow-back" size={24} color="#F7F5EC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Perfil do Usuário</Text>
        <View style={{ width: 24 }} />
      </View>

      {carregando ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2A4B4C" />
        </View>
      ) : erro ? (
        <View style={styles.loadingContainer}>
          <Text accessibilityRole="alert" style={styles.errorText}>{erro}</Text>
          <TouchableOpacity onPress={() => void buscarPerfilPublico()} style={styles.retryButton} accessibilityRole="button">
            <Text style={styles.retryText}>Tentar novamente</Text>
          </TouchableOpacity>
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

          <Text style={styles.nome}>{perfil?.nome_exibicao || 'Usuário'}</Text>
          
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
  bioText: { fontSize: 15, color: '#444', lineHeight: 22 },
  errorText: { color: '#8B1E2D', textAlign: 'center', marginHorizontal: 24, marginBottom: 16 },
  retryButton: { backgroundColor: '#2A4B4C', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: 'bold' },
});
