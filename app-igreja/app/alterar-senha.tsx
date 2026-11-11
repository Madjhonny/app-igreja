import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authenticatedFetch, clearSession } from '@/services/session';

const verde = '#2A4B4C';
const bege = '#F7F5EC';

export default function AlterarSenha() {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [mostrando, setMostrando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const alterar = async () => {
    if (salvando) return;
    setErro('');
    if (!senhaAtual || novaSenha.length < 10 || novaSenha.length > 128 ||
        !/[A-Z]/.test(novaSenha) || !/[a-z]/.test(novaSenha) || !/\d/.test(novaSenha)) {
      setErro('Informe a senha atual e uma nova senha de 10 a 128 caracteres com maiúscula, minúscula e número.');
      return;
    }
    if (senhaAtual === novaSenha) {
      setErro('A nova senha deve ser diferente da atual.');
      return;
    }
    if (novaSenha !== confirmacao) {
      setErro('A confirmação não corresponde à nova senha.');
      return;
    }
    setSalvando(true);
    try {
      const resposta = await authenticatedFetch('/senha/alterar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha_atual: senhaAtual, nova_senha: novaSenha }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        setErro(dados.erro || 'Não foi possível alterar a senha.');
        return;
      }
      setSenhaAtual(''); setNovaSenha(''); setConfirmacao('');
      await clearSession();
      router.replace({ pathname: '/login', params: {
        motivo: 'Senha alterada com sucesso. Entre novamente com a nova senha.',
      } });
    } catch {
      setErro('Não foi possível conectar ao servidor.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => router.back()}>
          <Ionicons name="arrow-back" color={bege} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Alterar senha</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Ionicons name="lock-closed-outline" size={40} color={verde} style={{ alignSelf: 'center' }} />
          <Text style={styles.title}>Proteja sua conta</Text>
          <Text style={styles.description}>
            Informe a senha atual e escolha uma nova. Ao salvar, suas sessões serão encerradas em todos os dispositivos.
          </Text>
          {!!erro && <Text accessibilityRole="alert" style={styles.error}>{erro}</Text>}
          <Text style={styles.label}>Senha atual</Text>
          <TextInput style={styles.input} value={senhaAtual} onChangeText={setSenhaAtual}
            secureTextEntry={!mostrando} autoComplete="current-password" autoCapitalize="none"
            editable={!salvando} accessibilityLabel="Senha atual" placeholder="Digite a senha atual" />
          <Text style={styles.label}>Nova senha</Text>
          <TextInput style={styles.input} value={novaSenha} onChangeText={setNovaSenha}
            secureTextEntry={!mostrando} autoComplete="new-password" autoCapitalize="none"
            editable={!salvando} accessibilityLabel="Nova senha" placeholder="Mínimo de 10 caracteres" />
          <Text style={styles.label}>Confirmar nova senha</Text>
          <TextInput style={styles.input} value={confirmacao} onChangeText={setConfirmacao}
            secureTextEntry={!mostrando} autoComplete="new-password" autoCapitalize="none"
            editable={!salvando} accessibilityLabel="Confirme a nova senha" placeholder="Digite novamente" />
          <TouchableOpacity style={styles.toggle} accessibilityRole="button" onPress={() => setMostrando(!mostrando)}>
            <Ionicons name={mostrando ? 'eye-off-outline' : 'eye-outline'} size={20} color={verde} />
            <Text style={styles.toggleText}>{mostrando ? 'Ocultar senhas' : 'Mostrar senhas'}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={[styles.button, salvando && { opacity: 0.6 }]}
            disabled={salvando} onPress={() => void alterar()}>
            {salvando ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Salvar nova senha</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: bege },
  header: { backgroundColor: verde, paddingTop: 50, paddingBottom: 20, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 20, color: bege, fontWeight: '700' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  card: { padding: 22, borderRadius: 17, backgroundColor: '#FFFFFF', alignSelf: 'center', maxWidth: 520, width: '100%' },
  title: { fontSize: 21, fontWeight: '800', color: verde, textAlign: 'center', marginTop: 12 },
  description: { fontSize: 14, lineHeight: 22, color: '#516161', textAlign: 'center', marginVertical: 14 },
  label: { fontWeight: '700', fontSize: 13, color: verde, marginTop: 13, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#C4C2B7', borderRadius: 11, padding: 12, color: '#263F40' },
  error: { backgroundColor: '#FFE8E9', color: '#9C2834', padding: 11, borderRadius: 9, marginTop: 10 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 15 },
  toggleText: { color: verde, fontWeight: '600', fontSize: 13 },
  button: { marginTop: 24, backgroundColor: verde, minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
