import React, { useState, useCallback } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router, useFocusEffect, Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

export default function TelaGestaoUsuarios() {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [usuarioLogado, setUsuarioLogado] = useState<any>(null);

  useFocusEffect(useCallback(() => { carregarDados(); }, []));

  const carregarDados = async () => {
    setCarregando(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      const userData = await AsyncStorage.getItem('userData');
      if (!token || !userData) return router.replace('/');

      const parsedUser = JSON.parse(userData);
      setUsuarioLogado(parsedUser);

      const resposta = await fetch('http://192.168.1.71:3000/usuarios', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (resposta.ok) {
        const dados = await resposta.json();
        setUsuarios(dados);

        // Se for ADMIN, redireciona automaticamente para a congregação dele
        if (parsedUser.nivel_acesso === 'ADMIN' && dados.length > 0) {
          const nomeCongregacaoAdmin = dados[0].congregacao;
          if (nomeCongregacaoAdmin) {
            router.replace({ pathname: '/usuarios-congregacao', params: { congregacaoNome: nomeCongregacaoAdmin } } as any);
          }
        }
      } else {
        router.back();
      }
    } catch (error) {
      Alert.alert('Erro', 'Falha na conexão com o servidor.');
    } finally {
      setCarregando(false);
    }
  };

  // Extrai dinamicamente as congregações e conta os membros/pendentes
  const congregacoesUnicas = Array.from(new Set(usuarios.map(u => u.congregacao))).map(nome => {
    const totalUsuarios = usuarios.filter(u => u.congregacao === nome).length;
    const totalPendentes = usuarios.filter(u => u.congregacao === nome && u.status_conta === 'PENDENTE').length;
    return { nome, totalUsuarios, totalPendentes };
  });

  const renderCongregacaoCard = (item: any, index: number) => (
    <TouchableOpacity 
      key={index}
      style={styles.folderCard} 
      onPress={() => router.push({ pathname: '/usuarios-congregacao', params: { congregacaoNome: item.nome } } as any)}
    >
      <View style={styles.folderIconContainer}>
        <Ionicons name="business" size={32} color="#2A4B4C" />
      </View>
      <View style={styles.folderContent}>
        <Text style={styles.folderTitle}>{item.nome}</Text>
        <Text style={styles.folderSubText}>{item.totalUsuarios} {item.totalUsuarios === 1 ? 'membro cadastrado' : 'membros cadastrados'}</Text>
      </View>
      {item.totalPendentes > 0 && (
        <View style={styles.folderBadge}>
          <Text style={styles.folderBadgeText}>{item.totalPendentes} pendente{item.totalPendentes > 1 ? 's' : ''}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={20} color="#999" style={{ marginLeft: 10 }} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#F7F5EC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Gestão de Contas</Text>
      </View>

      {carregando ? (
        <ActivityIndicator size="large" color="#2A4B4C" style={{ marginTop: 50 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.listContainer}>
          {/* Botão de Gestão de Datas (Exclusivo Master) */}
          {usuarioLogado?.nivel_acesso === 'MASTER' && (
            <TouchableOpacity 
              style={styles.folderCard} 
              onPress={() => router.push('/gestao-datas' as any)}
            >
              <View style={styles.folderIconContainer}>
                <Ionicons name="calendar-number" size={32} color="#2A4B4C" />
              </View>
              <View style={styles.folderContent}>
                <Text style={styles.folderTitle}>Gestão de Datas</Text>
                <Text style={styles.folderSubText}>Planejamento anual e organização de datas do campo</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#999" style={{ marginLeft: 10 }} />
            </TouchableOpacity>
          )}

          <Text style={styles.hubSubtitle}>Selecione uma congregação para gerenciar os membros:</Text>

          {congregacoesUnicas.map((item, index) => renderCongregacaoCard(item, index))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5EC' },
  header: { backgroundColor: '#2A4B4C', paddingTop: 50, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  backButton: { marginRight: 15 },
  headerTitle: { color: '#F7F5EC', fontSize: 20, fontWeight: 'bold' },
  listContainer: { padding: 15 },
  hubSubtitle: { fontSize: 14, color: '#666', marginBottom: 15, marginTop: 5, fontWeight: '500' },
  folderCard: { backgroundColor: '#fff', padding: 18, borderRadius: 12, marginBottom: 15, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, elevation: 3 },
  folderIconContainer: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#E2EAE9', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  folderContent: { flex: 1 },
  folderTitle: { fontSize: 18, fontWeight: 'bold', color: '#2A4B4C' },
  folderSubText: { fontSize: 13, color: '#666', marginTop: 3 },
  folderBadge: { backgroundColor: '#E63946', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, marginRight: 5 },
  folderBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' }
});