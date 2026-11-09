import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);

  // Novo estado para o Checkbox
  const [manterConectado, setManterConectado] = useState(false);

  // Estado puramente visual: qual campo está com foco
  const [campoFocado, setCampoFocado] = useState<'email' | 'senha' | null>(null);

  useEffect(() => {
    verificarLoginSalvo();
  }, []);

  const verificarLoginSalvo = async () => {
    const token = await AsyncStorage.getItem('userToken');
    const manter = await AsyncStorage.getItem('manterConectado');

    if (token) {
      if (manter === 'true') {
        // Se escolheu manter conectado, pula direto pra Agenda
        router.replace('/(tabs)/agenda'); 
      } else {
        // Se NÃO escolheu manter conectado, limpa a sessão antiga por segurança
        await AsyncStorage.removeItem('userToken');
        await AsyncStorage.removeItem('userData');
        await AsyncStorage.removeItem('manterConectado');
      }
    }
  };

  const fazerLogin = async () => {
    if (!email || !senha) {
      Alert.alert('Atenção', 'Preencha e-mail e senha.');
      return;
    }

    setCarregando(true);
    try {
      const resposta = await fetch('http://192.168.1.71:3000/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        // Salva o Token e os dados do usuário no celular
        await AsyncStorage.setItem('userToken', dados.token);
        await AsyncStorage.setItem('userData', JSON.stringify(dados.usuario));
        
        // Salva a preferência de manter conectado (converte boolean para string)
        await AsyncStorage.setItem('manterConectado', manterConectado ? 'true' : 'false');
        
        router.replace('/(tabs)/agenda');
      } else {
        Alert.alert('Erro', dados.erro || 'Falha ao fazer login.');
      }
    } catch (error) {
      Alert.alert('Erro de Conexão', 'Não foi possível conectar ao servidor.');
    } finally {
      setCarregando(false);
    }
  };

  const entrarComoConvidado = async () => {
    await AsyncStorage.removeItem('userToken');
    await AsyncStorage.removeItem('userData');
    await AsyncStorage.removeItem('manterConectado');
    router.replace('/(tabs)/agenda');
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
              disabled={carregando}
              activeOpacity={0.85}
            >
              {carregando ? <ActivityIndicator color={cores.bege} /> : <Text style={styles.loginButtonText}>ENTRAR</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.registerButton} onPress={() => router.push('/registro' as any)}>
              <Text style={styles.registerButtonText}>
                Não tem uma conta?{' '}
                <Text style={styles.registerButtonLink}>Cadastre-se</Text>
              </Text>
            </TouchableOpacity>

            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OU</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity style={styles.guestButton} onPress={entrarComoConvidado} activeOpacity={0.8}>
              <Text style={styles.guestButtonText}>Entrar como Convidado</Text>
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

  dividerContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 28 },
  dividerLine: { flex: 1, height: 1, backgroundColor: cores.neutro },
  dividerText: { marginHorizontal: 14, color: cores.verdeSutil, fontSize: 12, fontWeight: '600', letterSpacing: 1 },

  guestButton: {
    height: 54,
    backgroundColor: cores.suave,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: cores.neutro,
  },
  guestButtonText: { color: cores.verde, fontSize: 16, fontWeight: '600' },
});