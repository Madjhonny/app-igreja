import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { apiFetch, clearSession, getSessionToken, refreshSession, saveSession, shouldKeepSignedIn } from '@/services/session';
import { Ionicons } from '@expo/vector-icons'; // Importado para usar o ícone de checkbox

// Tokens visuais (somente aparência)
const cores = {
  verde: '#2A4B4C',
  bege: '#F7F5EC',
  neutro: '#C4C2B7',
  suave: '#E2EAE9',
  branco: '#FFFFFF',
  verdeTexto: 'rgba(42, 75, 76, 0.72)',
  verdeSutil: 'rgba(42, 75, 76, 0.45)',
};

export default function TelaLogin() {
  const { motivo } = useLocalSearchParams<{ motivo?: string }>();
  const [mensagem, setMensagem] = useState('');
  const [verificandoSessao, setVerificandoSessao] = useState(true);
  const aviso = mensagem || motivo;
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);

  // Novo estado para o Checkbox
  const [manterConectado, setManterConectado] = useState(false);

  // Estado puramente visual: qual campo está com foco
  const [campoFocado, setCampoFocado] = useState<'email' | 'senha' | null>(null);

  const verificarLoginSalvo = useCallback(async () => {
    setVerificandoSessao(true);
    try {
      const [token, manter] = await Promise.all([getSessionToken(), shouldKeepSignedIn()]);
      setManterConectado(manter);
      if (token && manter) {
        const usuarioAtual = await refreshSession();
        if (usuarioAtual) router.replace('/(tabs)/agenda');
      } else if (token) {
        await clearSession(token);
      }
    } catch {
      setMensagem('Não foi possível conferir sua sessão. Verifique a conexão e tente novamente.');
    } finally {
      setVerificandoSessao(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(verificarLoginSalvo); }, [verificarLoginSalvo]);

  const fazerLogin = async () => {
    if (carregando || verificandoSessao) return;
    setMensagem('');
    if (!email || !senha) {
      setMensagem('Preencha e-mail e senha.');
      return;
    }

    setCarregando(true);
    try {
      const resposta = await apiFetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), senha })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        await saveSession(dados.token, dados.usuario, manterConectado);
        router.replace('/(tabs)/agenda');
      } else {
        setMensagem(dados.erro || 'Falha ao fazer login.');
      }
    } catch {
      setMensagem('Não foi possível conectar ao servidor. Tente novamente.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
      >
        <View style={styles.logoContainer}>
          {/* LOGO: quando o arquivo da logo estiver no projeto, substitua os dois textos abaixo por:
              <Image source={require('../assets/logo.png')} style={styles.logoImage} resizeMode="contain" />
              (lembre de importar Image de 'react-native' e ajustar o caminho) */}
          <Text style={styles.logoText}>Agenda ADP</Text>
          <View style={styles.logoTraco} />
          <Text style={styles.subLogoText}>Igreja Matriz & Congregações</Text>
          {verificandoSessao && <ActivityIndicator color={cores.verde} />}
          {!!aviso && <View style={{ padding: 12, marginVertical: 12, backgroundColor: cores.suave, borderRadius: 10 }}>
            <Text accessibilityRole="alert" style={{ color: cores.verde }}>{aviso}</Text>
            <TouchableOpacity onPress={verificarLoginSalvo} disabled={verificandoSessao || carregando} style={{ paddingTop: 10 }}>
              <Text style={{ color: cores.verde, fontWeight: 'bold' }}>Conferir sessão novamente</Text>
            </TouchableOpacity>
          </View>}
        </View>

        <View style={styles.formContainer}>
          <View style={styles.formInner}>
            <View style={styles.campo}>
              <Text style={styles.label}>E-mail</Text>
              <TextInput 
                style={[
                  styles.input,
                  email.length > 0 && styles.inputPreenchido,
                  campoFocado === 'email' && styles.inputFocado,
                ]} 
                placeholder="Digite seu e-mail"
                placeholderTextColor={cores.verdeSutil}
                selectionColor={cores.verde}
                keyboardType="email-address"
                autoComplete="email"
                accessibilityLabel="E-mail"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                onFocus={() => setCampoFocado('email')}
                onBlur={() => setCampoFocado(null)}
              />
            </View>

            <View style={styles.campo}>
              <Text style={styles.label}>Senha</Text>
              <TextInput 
                style={[
                  styles.input,
                  senha.length > 0 && styles.inputPreenchido,
                  campoFocado === 'senha' && styles.inputFocado,
                ]} 
                placeholder="Digite sua senha"
                placeholderTextColor={cores.verdeSutil}
                selectionColor={cores.verde}
                secureTextEntry
                autoComplete="current-password"
                accessibilityLabel="Senha"
                value={senha}
                onChangeText={setSenha}
                onFocus={() => setCampoFocado('senha')}
                onBlur={() => setCampoFocado(null)}
              />
            </View>

            {/* === NOVO BOTÃO DE MANTER CONECTADO === */}
            <TouchableOpacity 
              style={styles.checkboxContainer} 
              onPress={() => setManterConectado(!manterConectado)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityLabel="Manter conectado"
              accessibilityState={{ checked: manterConectado }}
            >
              <Ionicons 
                name={manterConectado ? "checkbox" : "square-outline"} 
                size={22} 
                color={cores.verde} 
              />
              <Text style={styles.checkboxText}>Manter conectado</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.loginButton, carregando && styles.buttonDisabled]} 
              onPress={fazerLogin}
              disabled={carregando || verificandoSessao}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Entrar"
            >
              {carregando ? <ActivityIndicator color={cores.bege} /> : <Text style={styles.loginButtonText}>ENTRAR</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.registerButton} onPress={() => router.push('/registro' as any)}>
              <Text style={styles.registerButtonText}>
                Não tem uma conta?{' '}
                <Text style={styles.registerButtonLink}>Cadastre-se</Text>
              </Text>
            </TouchableOpacity>

          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.verde },
  scrollContent: { flexGrow: 1 },

  // Cabeçalho da marca
  logoContainer: { alignItems: 'center', paddingTop: 80, paddingBottom: 44, paddingHorizontal: 24 },
  logoText: { fontSize: 34, fontWeight: '700', letterSpacing: 0.4, color: cores.bege },
  logoTraco: { width: 32, height: 2, borderRadius: 1, backgroundColor: cores.neutro, marginVertical: 12 },
  subLogoText: { fontSize: 15, letterSpacing: 0.6, color: cores.neutro, textAlign: 'center' },
  logoImage: { width: 200, height: 80 },

  // Painel do formulário (sheet claro sobre o fundo verde)
  formContainer: {
    flexGrow: 1,
    backgroundColor: cores.bege,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 40,
  },
  formInner: { width: '100%', maxWidth: 440, alignSelf: 'center' },

  campo: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '600', color: cores.verde, marginBottom: 8, marginLeft: 2 },
  input: {
    height: 54,
    backgroundColor: cores.branco,
    borderWidth: 1,
    borderColor: cores.neutro,
    paddingHorizontal: 16,
    borderRadius: 14,
    fontSize: 16,
    color: cores.verde,
  },
  inputPreenchido: { borderColor: cores.verdeSutil },
  inputFocado: {
    borderColor: cores.verde,
    shadowColor: cores.verde,
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },

  // Estilos do Checkbox
  checkboxContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 2, marginBottom: 26 },
  checkboxText: { fontSize: 15, color: cores.verdeTexto, marginLeft: 10 },

  loginButton: {
    height: 54,
    backgroundColor: cores.verde,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: cores.verde,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  buttonDisabled: { opacity: 0.7 },
  loginButtonText: { color: cores.bege, fontSize: 16, fontWeight: '700', letterSpacing: 1.2 },

  registerButton: { marginTop: 22, alignItems: 'center', paddingVertical: 4 },
  registerButtonText: { color: cores.verdeTexto, fontSize: 14 },
  registerButtonLink: { color: cores.verde, fontWeight: '700' },

});
