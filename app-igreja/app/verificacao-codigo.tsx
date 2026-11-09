import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TelaVerificacaoCodigo() {
  const { tipo } = useLocalSearchParams(); // Recebe se é 'email' ou 'celular'
  const [novoValor, setNovoValor] = useState('');
  const [codigoEnviado, setCodigoEnviado] = useState(false);
  const [codigoDigitado, setCodigoDigitado] = useState('');

  // Exemplo mascarado do e-mail atual do usuário para exibição
  const emailMascarado = '*****ao@email.com.br';

  const enviarCodigo = () => {
    if (!novoValor) {
      Alert.alert('Atenção', `Por favor, informe o novo ${tipo === 'email' ? 'e-mail' : 'número de celular'}.`);
      return;
    }
    setCodigoEnviado(true);
  };

  const confirmarCodigo = () => {
    if (codigoDigitado.length < 6) {
      Alert.alert('Erro', 'Digite o código completo de 6 dígitos.');
      return;
    }
    Alert.alert('Sucesso!', `${tipo === 'email' ? 'E-mail' : 'Celular'} alterado com sucesso!`, [
      { text: 'OK', onPress: () => router.replace('/(tabs)/perfil') }
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backIcon}>
          <Ionicons name="arrow-back" size={24} color="#F7F5EC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Verificação de Segurança</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.card}>
        {!codigoEnviado ? (
          <>
            <Text style={styles.label}>
              Novo {tipo === 'email' ? 'E-mail' : 'Número de Celular'}
            </Text>
            <TextInput 
              style={styles.input} 
              placeholder={tipo === 'email' ? 'novo@email.com' : '(00) 00000-0000'} 
              value={novoValor}
              onChangeText={setNovoValor}
              keyboardType={tipo === 'email' ? 'email-address' : 'phone-pad'}
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.button} onPress={enviarCodigo}>
              <Text style={styles.buttonText}>Avançar e Enviar Código</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.infoText}>
              Código enviado para <Text style={{ fontWeight: 'bold' }}>{emailMascarado}</Text>
            </Text>

            <Text style={styles.label}>Código de 6 dígitos</Text>
            <TextInput 
              style={[styles.input, styles.codeInput]} 
              placeholder="000000" 
              maxLength={6}
              keyboardType="numeric"
              value={codigoDigitado}
              onChangeText={setCodigoDigitado}
            />

            <TouchableOpacity style={styles.button} onPress={confirmarCodigo}>
              <Text style={styles.buttonText}>Confirmar e Alterar</Text>
            </TouchableOpacity>
          </>
        )}
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
  label: { fontSize: 14, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 5 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 15, fontSize: 15 },
  codeInput: { textAlign: 'center', fontSize: 24, letterSpacing: 8, fontWeight: 'bold' },
  infoText: { fontSize: 14, color: '#555', marginBottom: 20, lineHeight: 20, textAlign: 'center' },
  button: { backgroundColor: '#2A4B4C', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#F7F5EC', fontSize: 16, fontWeight: 'bold' }
});