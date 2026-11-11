import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, clearSession } from '@/services/session';

const verde = '#2A4B4C';
const fundo = '#F7F5EC';
const senhaForte = (valor: string) => valor.length >= 10 && valor.length <= 128 &&
  /[a-z]/.test(valor) && /[A-Z]/.test(valor) && /\d/.test(valor);

export default function RecuperarSenha() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [codigo, setCodigo] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [etapa, setEtapa] = useState<'email' | 'codigo'>('email');
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);

  const solicitarCodigo = async () => {
    if (processando) return;
    setErro(''); setMensagem('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErro('Informe um e-mail válido.');
      return;
    }
    setProcessando(true);
    try {
      const resposta = await apiFetch('/senha/solicitar-recuperacao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        setErro(dados.erro || 'Não foi possível solicitar o código.');
        return;
      }
      setEtapa('codigo');
      setMensagem(dados.mensagem || 'Se o e-mail estiver cadastrado, você receberá um código.');
    } catch {
      setErro('Não foi possível conectar ao servidor.');
    } finally {
      setProcessando(false);
    }
  };

  const redefinirSenha = async () => {
    if (processando) return;
    setErro('');
    if (!/^\d{8}$/.test(codigo.trim())) {
      setErro('Informe os 8 dígitos do código recebido por e-mail.');
      return;
    }
    if (!senhaForte(novaSenha)) {
      setErro('Use 10 a 128 caracteres, com letra maiúscula, minúscula e número.');
      return;
    }
    if (novaSenha !== confirmacao) {
      setErro('As senhas não coincidem.');
      return;
    }
    setProcessando(true);
    try {
      const resposta = await apiFetch('/senha/redefinir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), codigo: codigo.trim(), nova_senha: novaSenha }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        setErro(dados.erro || 'Não foi possível redefinir sua senha.');
        return;
      }
      setCodigo(''); setNovaSenha(''); setConfirmacao('');
      await clearSession();
      router.replace({ pathname: '/login', params: { motivo: 'Senha redefinida com sucesso. Entre novamente.' } });
    } catch {
      setErro('Não foi possível conectar ao servidor.');
    } finally {
      setProcessando(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar ao login" onPress={() => router.replace('/login')}>
          <Ionicons name="arrow-back" color={fundo} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Recuperar senha</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Ionicons name="shield-checkmark-outline" size={42} color={verde} style={{ alignSelf: 'center', marginBottom: 12 }} />
          <Text style={styles.title}>{etapa === 'email' ? 'Esqueceu sua senha?' : 'Confira seu e-mail'}</Text>
          <Text style={styles.info}>
            {etapa === 'email'
              ? 'Informe o e-mail da conta. Se estiver cadastrado, enviaremos um código de 8 dígitos que expira em 15 minutos.'
              : 'Digite o código recebido e escolha uma nova senha. Por segurança, o código vale uma única vez.'}
          </Text>
          {!!mensagem && <Text accessibilityRole="alert" style={styles.success}>{mensagem}</Text>}
          {!!erro && <Text accessibilityRole="alert" style={styles.error}>{erro}</Text>}
          <Text style={styles.label}>E-mail da conta</Text>
          <TextInput
            style={[styles.input, etapa === 'codigo' && styles.readonly]}
            value={email} onChangeText={setEmail} editable={etapa === 'email' && !processando}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
            autoComplete="email" placeholder="seu@email.com" accessibilityLabel="E-mail"
          />
          {etapa === 'codigo' ? (
            <>
              <Text style={styles.label}>Código de 8 dígitos</Text>
              <TextInput style={styles.input} value={codigo}
                onChangeText={valor => setCodigo(valor.replace(/\D/g, ''))}
                maxLength={8} keyboardType="number-pad" placeholder="00000000"
                accessibilityLabel="Código de recuperação" editable={!processando} />
              <Text style={styles.label}>Nova senha</Text>
              <View style={styles.passwordRow}>
                <TextInput style={styles.passwordInput} value={novaSenha} onChangeText={setNovaSenha}
                  secureTextEntry={!mostrarSenha} autoComplete="new-password"
                  placeholder="Mínimo 10 caracteres" accessibilityLabel="Nova senha"
                  autoCapitalize="none" editable={!processando} />
                <TouchableOpacity accessibilityLabel="Mostrar ou ocultar senha" onPress={() => setMostrarSenha(!mostrarSenha)}>
                  <Ionicons name={mostrarSenha ? 'eye-off' : 'eye'} size={21} color={verde} />
                </TouchableOpacity>
              </View>
              <Text style={styles.label}>Confirmar nova senha</Text>
              <TextInput style={styles.input} value={confirmacao} onChangeText={setConfirmacao}
                secureTextEntry={!mostrarSenha} autoComplete="new-password" autoCapitalize="none"
                placeholder="Repita a senha" accessibilityLabel="Confirmar nova senha" editable={!processando} />
            </>
          ) : null}
          <TouchableOpacity accessibilityRole="button" style={[styles.button, processando && styles.disabled]}
            disabled={processando} onPress={etapa === 'email' ? solicitarCodigo : redefinirSenha}>
            {processando ? <ActivityIndicator color="#FFFFFF" /> :
              <Text style={styles.buttonText}>{etapa === 'email' ? 'Enviar código' : 'Redefinir senha'}</Text>}
          </TouchableOpacity>
          {etapa === 'codigo' ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => {
              if (!processando) { setEtapa('email'); setCodigo(''); setErro(''); setMensagem(''); }
            }}>
              <Text style={styles.link}>Voltar e solicitar novo código</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity accessibilityRole="button" onPress={() => router.replace('/login')}>
              <Text style={styles.link}>Voltar ao login</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: fundo },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: verde, paddingTop: 50, paddingBottom: 20, paddingHorizontal: 20 },
  headerTitle: { fontSize: 20, color: fundo, fontWeight: '700' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  card: { backgroundColor: '#FFFFFF', padding: 22, borderRadius: 18, maxWidth: 520, width: '100%', alignSelf: 'center' },
  title: { fontSize: 21, fontWeight: '800', textAlign: 'center', color: verde, marginBottom: 9 },
  info: { fontSize: 14, lineHeight: 21, color: '#516161', textAlign: 'center', marginBottom: 18 },
  label: { fontSize: 13, color: verde, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#C4C2B7', borderRadius: 11, padding: 13, backgroundColor: '#FFFFFF', color: '#253B3B' },
  readonly: { backgroundColor: '#F1F2EF' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#C4C2B7',
    borderRadius: 11, paddingHorizontal: 12, backgroundColor: '#FFFFFF' },
  passwordInput: { flex: 1, paddingVertical: 13, color: '#253B3B' },
  button: { backgroundColor: verde, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  disabled: { opacity: 0.6 }, buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  link: { marginTop: 18, color: verde, textAlign: 'center', fontWeight: '700' },
  error: { backgroundColor: '#FFE9E9', color: '#9C2834', borderRadius: 9, padding: 11, marginBottom: 10 },
  success: { backgroundColor: '#E2EAE9', color: verde, borderRadius: 9, padding: 11, marginBottom: 10 },
});
