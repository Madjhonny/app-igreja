import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TelaSeguranca() {
  const irParaVerificacao = (tipo: 'email' | 'celular') => {
    router.push({
      pathname: '/verificacao-codigo',
      params: { tipo }
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backIcon}>
          <Ionicons name="arrow-back" size={24} color="#F7F5EC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Segurança da Conta</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.card}>
        <Text style={styles.description}>
          Para sua segurança, alterações de e-mail e número de celular exigem confirmação por código de verificação.
        </Text>

        <TouchableOpacity style={styles.optionButton} onPress={() => irParaVerificacao('email')}>
          <Ionicons name="mail-outline" size={22} color="#2A4B4C" />
          <Text style={styles.optionText}>Alterar E-mail</Text>
          <Ionicons name="chevron-forward" size={20} color="#888" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.optionButton} onPress={() => irParaVerificacao('celular')}>
          <Ionicons name="phone-portrait-outline" size={22} color="#2A4B4C" />
          <Text style={styles.optionText}>Alterar Celular</Text>
          <Ionicons name="chevron-forward" size={20} color="#888" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#2A4B4C', paddingVertical: 40, alignItems: 'center' },
  topBar: { flexDirection: 'row', width: '90%', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  backIcon: { padding: 5 },
  headerTitle: { fontSize: 20, color: '#F7F5EC', fontWeight: 'bold' },
  card: { backgroundColor: '#F7F5EC', width: '90%', borderRadius: 20, padding: 25, elevation: 8 },
  description: { fontSize: 14, color: '#555', marginBottom: 20, lineHeight: 20 },
  optionButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: '#ddd' },
  optionText: { flex: 1, marginLeft: 12, fontSize: 16, fontWeight: 'bold', color: '#2A4B4C' }
});