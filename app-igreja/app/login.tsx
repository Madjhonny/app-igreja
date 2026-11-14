
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';

import type { TextInputInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  apiFetch,
  clearSession,
  enterGuestMode,
  getSessionToken,
  isGuestMode,
  refreshSession,
  saveSession,
  shouldKeepSignedIn,
} from '@/services/session';
import { Ionicons } from '@expo/vector-icons';

// Paleta visual da Agenda ADP
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
  const [mostrarSenha, setMostrarSenha] = useState(false);

  // Estados de carregamento
  const [carregando, setCarregando] = useState(false);
  const [entrandoConvidado, setEntrandoConvidado] = useState(false);

  const senhaRef = useRef<TextInputInstance>(null);

  const [manterConectado, setManterConectado] = useState(false);

  // Campo atualmente em foco
  const [campoFocado, setCampoFocado] =
    useState<'email' | 'senha' | null>(null);

  // ==========================================
  // VERIFICAR SESSÃO SALVA
  // ==========================================

  const verificarLoginSalvo = useCallback(async () => {
    setVerificandoSessao(true);

    try {
      const [token, manter, convidado] = await Promise.all([
        getSessionToken(),
        shouldKeepSignedIn(),
        isGuestMode(),
      ]);

      setManterConectado(manter);

      // Restaura o acesso de visitante apos reiniciar o Expo.
      // Convidado nao possui token de autenticacao.
      if (convidado && !token) {
        router.replace('/(tabs)/agenda');
        return;
      }

      if (token && manter) {
        const usuarioAtual = await refreshSession();

        if (usuarioAtual) {
          router.replace('/(tabs)/agenda');
        }
      } else if (token) {
        await clearSession(token);
      }
    } catch {
      setMensagem(
        'Não foi possível conferir sua sessão. Verifique a conexão e tente novamente.'
      );
    } finally {
      setVerificandoSessao(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(verificarLoginSalvo);
  }, [verificarLoginSalvo]);

  // ==========================================
  // LOGIN DE USUÁRIO CADASTRADO
  // ==========================================

  const fazerLogin = async () => {
    if (
      carregando ||
      entrandoConvidado ||
      verificandoSessao
    ) {
      return;
    }

    setMensagem('');

    if (!email.trim() || !senha) {
      setMensagem('Preencha e-mail e senha.');
      return;
    }

    setCarregando(true);

    try {
      const resposta = await apiFetch('/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          senha,
        }),
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        await saveSession(
          dados.token,
          dados.usuario,
          manterConectado
        );

        router.replace('/(tabs)/agenda');
      } else {
        setMensagem(
          dados.erro || 'Falha ao fazer login.'
        );
      }
    } catch {
      setMensagem(
        'Não foi possível conectar ao servidor. Tente novamente.'
      );
    } finally {
      setCarregando(false);
    }
  };

  // ==========================================
  // ENTRAR COMO CONVIDADO
  // ==========================================

  const entrarComoConvidado = async () => {
    if (
      entrandoConvidado ||
      carregando ||
      verificandoSessao
    ) {
      return;
    }

    setEntrandoConvidado(true);
    setMensagem('');

    try {
      // Encerra eventual sessão anterior e
      // ativa o modo convidado sem autenticação.
      await enterGuestMode();

      // Abre a agenda em modo de consulta.
      router.replace('/(tabs)/agenda');
    } catch {
      setMensagem(
        'Não foi possível entrar como convidado. Tente novamente.'
      );
    } finally {
      setEntrandoConvidado(false);
    }
  };

  // ==========================================
  // INTERFACE
  // ==========================================

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
        {/* CABEÇALHO */}

        <View style={styles.logoContainer}>
          <View style={styles.logoMark}>
            <Image
              source={require('../assets/images/logo.jpg')}
              style={styles.logoMarkImage}
              resizeMode="cover"
              accessible={false}
            />
          </View>

          <Text style={styles.logoText}>
            Agenda ADP
          </Text>

          {verificandoSessao && (
            <ActivityIndicator
              color={cores.bege}
              style={styles.sessionIndicator}
            />
          )}

          {!!aviso && (
            <View
              style={{
                padding: 12,
                marginVertical: 12,
                backgroundColor: cores.suave,
                borderRadius: 10,
              }}
            >
              <Text
                accessibilityRole="alert"
                style={{ color: cores.verde }}
              >
                {aviso}
              </Text>

              <TouchableOpacity
                onPress={verificarLoginSalvo}
                disabled={
                  verificandoSessao ||
                  carregando ||
                  entrandoConvidado
                }
                style={{ paddingTop: 10 }}
              >
                <Text
                  style={{
                    color: cores.verde,
                    fontWeight: 'bold',
                  }}
                >
                  Conferir sessão novamente
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* FORMULÁRIO */}

        <View style={styles.formContainer}>
          <View style={styles.formInner}>

            {/* E-MAIL */}

            <View style={styles.campo}>
              <Text style={styles.label}>
                E-mail
              </Text>

              <TextInput
                style={[
                  styles.input,
                  email.length > 0 && styles.inputPreenchido,
                  campoFocado === 'email' &&
                    styles.inputFocado,
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

            {/* SENHA */}

            <View style={styles.campo}>
              <Text style={styles.label}>
                Senha
              </Text>

              <View
                collapsable={false}
                style={styles.passwordField}
              >
                <TextInput
                  ref={senhaRef}
                  style={[
                    styles.input,
                    styles.passwordInput,
                    senha.length > 0 &&
                      styles.inputPreenchido,
                    campoFocado === 'senha' &&
                      styles.inputFocado,
                  ]}
                  placeholder="Digite sua senha"
                  placeholderTextColor={cores.verdeSutil}
                  selectionColor={cores.verde}
                  secureTextEntry={!mostrarSenha}
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Senha"
                  value={senha}
                  onChangeText={setSenha}
                  onFocus={() => setCampoFocado('senha')}
                  onBlur={() => setCampoFocado(null)}
                />

                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => {
                    setMostrarSenha(atual => !atual);

                    requestAnimationFrame(() =>
                      senhaRef.current?.focus()
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    mostrarSenha
                      ? 'Ocultar senha'
                      : 'Mostrar senha'
                  }
                >
                  <Ionicons
                    name={
                      mostrarSenha
                        ? 'eye-off'
                        : 'eye'
                    }
                    size={22}
                    color={cores.verdeTexto}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* RECUPERAÇÃO DE SENHA */}

            <TouchableOpacity
              style={{
                alignSelf: 'flex-end',
                marginBottom: 12,
                paddingVertical: 8,
              }}
              accessibilityRole="button"
              accessibilityLabel="Esqueci minha senha"
              onPress={() =>
                router.push({
                  pathname: '/recuperar-senha',
                  params: {
                    email: email.trim(),
                  },
                })
              }
            >
              <Text
                style={{
                  color: cores.verde,
                  fontSize: 14,
                  fontWeight: '700',
                }}
              >
                Esqueci minha senha
              </Text>
            </TouchableOpacity>

            {/* MANTER CONECTADO */}

            <TouchableOpacity
              style={styles.checkboxContainer}
              onPress={() =>
                setManterConectado(atual => !atual)
              }
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityLabel="Manter conectado"
              accessibilityState={{
                checked: manterConectado,
              }}
            >
              <Ionicons
                name={
                  manterConectado
                    ? 'checkbox'
                    : 'square-outline'
                }
                size={22}
                color={cores.verde}
              />

              <Text style={styles.checkboxText}>
                Manter conectado
              </Text>
            </TouchableOpacity>

            {/* BOTÃO DE LOGIN */}

            <TouchableOpacity
              style={[
                styles.loginButton,
                (carregando || entrandoConvidado) &&
                  styles.buttonDisabled,
              ]}
              onPress={fazerLogin}
              disabled={
                carregando ||
                entrandoConvidado ||
                verificandoSessao
              }
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Entrar"
            >
              {carregando ? (
                <ActivityIndicator
                  color={cores.bege}
                />
              ) : (
                <Text style={styles.loginButtonText}>
                  ENTRAR
                </Text>
              )}
            </TouchableOpacity>

            {/* CADASTRO */}

            <TouchableOpacity
              style={styles.registerButton}
              onPress={() =>
                router.push('/registro' as any)
              }
              accessibilityRole="button"
              accessibilityLabel="Cadastre-se"
            >
              <Text style={styles.registerButtonText}>
                Não tem uma conta?{' '}
                <Text style={styles.registerButtonLink}>
                  Cadastre-se
                </Text>
              </Text>
            </TouchableOpacity>

            {/* BOTÃO ENTRAR COMO CONVIDADO */}

            <TouchableOpacity
              style={[
                styles.loginButton,
                styles.guestButton,
                (entrandoConvidado || carregando) &&
                  styles.buttonDisabled,
              ]}
              onPress={entrarComoConvidado}
              disabled={
                entrandoConvidado ||
                carregando ||
                verificandoSessao
              }
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Entrar como convidado"
            >
              {entrandoConvidado ? (
                <ActivityIndicator
                  color={cores.verde}
                />
              ) : (
                <Text style={styles.guestButtonText}>
                  ENTRAR COMO CONVIDADO
                </Text>
              )}
            </TouchableOpacity>

          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ==========================================
// ESTILOS
// ==========================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.verde,
  },

  scrollContent: {
    flexGrow: 1,
  },

  // Cabeçalho
  logoContainer: {
    alignItems: 'center',
    paddingTop: 56,
    paddingBottom: 36,
    paddingHorizontal: 24,
  },

  logoMark: {
    width: 132,
    height: 132,
    borderRadius: 66,
    overflow: 'hidden',
    backgroundColor: cores.bege,
  },

  logoMarkImage: {
    width: '100%',
    height: '100%',
    transform: [{ scale: 1.9 }],
  },

  logoText: {
    marginTop: 14,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: cores.bege,
  },

  sessionIndicator: {
    marginTop: 12,
  },

  // Painel do formulário
  formContainer: {
    flexGrow: 1,
    backgroundColor: cores.bege,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 40,
  },

  formInner: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },

  // Campos
  campo: {
    marginBottom: 18,
  },

  label: {
    fontSize: 13,
    fontWeight: '600',
    color: cores.verde,
    marginBottom: 8,
    marginLeft: 2,
  },

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

  inputPreenchido: {
    borderColor: cores.verdeSutil,
  },

  inputFocado: {
    borderColor: cores.verde,
    shadowColor: cores.verde,
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },

  // Campo de senha
  passwordField: {
    position: 'relative',
  },

  passwordInput: {
    paddingRight: 60,
  },

  eyeButton: {
    position: 'absolute',
    right: 5,
    top: 5,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Checkbox
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 26,
  },

  checkboxText: {
    fontSize: 15,
    color: cores.verdeTexto,
    marginLeft: 10,
  },

  // Botão principal
  loginButton: {
    height: 54,
    backgroundColor: cores.verde,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: cores.verde,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    elevation: 3,
  },

  buttonDisabled: {
    opacity: 0.7,
  },

  loginButtonText: {
    color: cores.bege,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1.2,
  },

  // Cadastro
  registerButton: {
    marginTop: 22,
    alignItems: 'center',
    paddingVertical: 4,
  },

  registerButtonText: {
    color: cores.verdeTexto,
    fontSize: 14,
  },

  registerButtonLink: {
    color: cores.verde,
    fontWeight: '700',
  },

  // Botão de convidado
  guestButton: {
    backgroundColor: cores.suave,
    borderWidth: 1,
    borderColor: cores.neutro,
    marginTop: 20,
    shadowOpacity: 0,
    elevation: 0,
  },

  guestButtonText: {
    color: cores.verde,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
});
