import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function TelaDadosSeguranca() {
  const [usuario, setUsuario] = useState<any>(null);

  useEffect(() => {
    carregarDados();
  }, []);

  const carregarDados = async () => {
    try {
      const userData = await AsyncStorage.getItem('userData');
      if (userData) {
        setUsuario(JSON.parse(userData));
      }
    } catch (error) {
      console.error('Erro ao carregar dados cadastrais:', error);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#F7F5EC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Dados e Segurança</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionDescription}>
          Estes são os dados cadastrais informados na criação da sua conta e as configurações de segurança. Eles não aparecem publicamente no aplicativo.
        </Text>

        <View style={styles.card}>
          <View style={styles.infoGroup}>
            <Text style={styles.label}>Nome Completo Cadastral</Text>
            <Text style={styles.value}>{usuario?.nome_completo || 'Não informado'}</Text>
          </View>

          <View style={styles.infoGroup}>
            <Text style={styles.label}>E-mail</Text>
            <Text style={styles.value}>{usuario?.email || 'Não informado'}</Text>
          </View>

          <View style={styles.infoGroup}>
            <Text style={styles.label}>Telefone / WhatsApp</Text>
            <Text style={styles.value}>{usuario?.telefone || 'Não informado'}</Text>
          </View>

          <View style={styles.infoGroup}>
            <Text style={styles.label}>CPF</Text>
            <Text style={styles.value}>{usuario?.cpf || 'Não informado'}</Text>
          </View>

          <View style={styles.infoGroup}>
            <Text style={styles.label}>Nível de Acesso (Interno)</Text>
            <Text style={styles.value}>{usuario?.nivel_acesso || 'Membro'}</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5EC' },
  header: { backgroundColor: '#2A4B4C', paddingTop: 50, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  backButton: { padding: 5 },
  headerTitle: { color: '#F7F5EC', fontSize: 20, fontWeight: 'bold' },
  content: { padding: 20 },
  sectionDescription: { fontSize: 13, color: '#666', marginBottom: 20, lineHeight: 18 },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  infoGroup: { marginBottom: 18, borderBottomWidth: 1, borderBottomColor: '#F0F0F0', paddingBottom: 12 },
  label: { fontSize: 12, fontWeight: 'bold', color: '#888', textTransform: 'uppercase', marginBottom: 4 },
  value: { fontSize: 16, color: '#333', fontWeight: '500' }
});