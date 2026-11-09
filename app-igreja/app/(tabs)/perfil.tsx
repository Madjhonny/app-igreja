import React, { useState, useCallback } from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

export default function TelaPerfil() {
  const [usuario, setUsuario] = useState<any>(null);

  useFocusEffect(
    useCallback(() => {
      carregarDadosUsuario();
    }, [])
  );

  const carregarDadosUsuario = async () => {
    const userData = await AsyncStorage.getItem('userData');
    if (userData) {
      setUsuario(JSON.parse(userData));
    }
  };

  const fazerLogout = () => {
    Alert.alert(
      'Sair da Conta',
      'Tem certeza de que deseja desconectar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Sair', 
          style: 'destructive', 
          onPress: async () => {
            await AsyncStorage.removeItem('userToken');
            await AsyncStorage.removeItem('userData');
            router.replace('/');
          } 
        }
      ]
    );
  };

  const nomeExibicaoFinal = usuario?.nome_exibicao || usuario?.nome_completo || 'Usuário';
  const ehAdminOuMaster = usuario && (usuario.nivel_acesso === 'MASTER' || usuario.nivel_acesso === 'ADMIN');

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.headerProfile}>
        {usuario?.foto_perfil ? (
          <Image source={{ uri: usuario.foto_perfil }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Ionicons name="person" size={50} color="#777" />
          </View>
        )}
        <Text style={styles.nome}>{nomeExibicaoFinal}</Text>
        <Text style={styles.bioText} numberOfLines={2}>
          {usuario?.bio || 'Nenhuma biografia adicionada.'}
        </Text>
      </View>

      <View style={styles.menuContainer}>
        {/* PAINEL DE GESTÃO (Exibido apenas para ADMIN e MASTER) */}
        {ehAdminOuMaster && (
          <TouchableOpacity 
            style={[styles.menuCard, { backgroundColor: '#EFECE6', borderColor: '#2A4B4C', borderWidth: 1 }]} 
            onPress={() => router.push('/gestao-usuarios' as any)}
          >
            <View style={styles.menuIconContainer}>
              <Ionicons name="settings-outline" size={24} color="#2A4B4C" />
            </View>
            <View style={styles.menuTextContainer}>
              <Text style={styles.menuTitle}>Painel de Gestão</Text>
              <Text style={styles.menuSubtitle}>Gerencie contas, membros e congregações.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#2A4B4C" />
          </TouchableOpacity>
        )}

        {/* Opção 1: Editar Perfil (Público) */}
        <TouchableOpacity 
          style={styles.menuCard} 
          onPress={() => router.push('/editar-perfil' as any)}
        >
          <View style={styles.menuIconContainer}>
            <Ionicons name="create-outline" size={24} color="#2A4B4C" />
          </View>
          <View style={styles.menuTextContainer}>
            <Text style={styles.menuTitle}>Editar Perfil</Text>
            <Text style={styles.menuSubtitle}>Personalize sua foto, nome de exibição e bio.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#999" />
        </TouchableOpacity>

        {/* Opção 2: Dados e Segurança (Privado/Cadastral) */}
        <TouchableOpacity 
          style={styles.menuCard} 
          onPress={() => router.push('/dados-seguranca' as any)}
        >
          <View style={styles.menuIconContainer}>
            <Ionicons name="shield-checkmark-outline" size={24} color="#2A4B4C" />
          </View>
          <View style={styles.menuTextContainer}>
            <Text style={styles.menuTitle}>Dados e Segurança</Text>
            <Text style={styles.menuSubtitle}>Consulte seus dados cadastrais e configurações da conta.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#999" />
        </TouchableOpacity>

        {/* Botão de Desconectar / Sair da Conta */}
        <TouchableOpacity style={styles.logoutButton} onPress={fazerLogout}>
          <Ionicons name="log-out-outline" size={20} color="#E63946" style={{ marginRight: 8 }} />
          <Text style={styles.logoutButtonText}>Desconectar da Conta</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5EC', padding: 20 },
  headerProfile: { alignItems: 'center', marginBottom: 30, marginTop: 40 },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: '#2A4B4C', marginBottom: 12 },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#E2EAE9', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#2A4B4C', marginBottom: 12 },
  nome: { fontSize: 22, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 5, textAlign: 'center' },
  bioText: { fontSize: 14, color: '#666', textAlign: 'center', paddingHorizontal: 20 },
  
  menuContainer: { width: '100%' },
  menuCard: { backgroundColor: '#fff', padding: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 15, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  menuIconContainer: { width: 45, height: 45, borderRadius: 22.5, backgroundColor: '#E2EAE9', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  menuTextContainer: { flex: 1 },
  menuTitle: { fontSize: 16, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 3 },
  menuSubtitle: { fontSize: 12, color: '#666' },

  logoutButton: { backgroundColor: '#FDE8E8', borderWidth: 1, borderColor: '#E63946', padding: 16, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 15, elevation: 1 },
  logoutButtonText: { color: '#E63946', fontSize: 16, fontWeight: 'bold' }
});