
import { useAppDialog } from '@/components/app-dialog';
import {
  clearSession,
  canManage,
  getStoredUser,
  isGuestMode,
} from '@/services/session';
import { useSessionUser } from '@/hooks/use-session-user';

import React, { useCallback, useState } from 'react';

import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';

import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const cores = {
  verde: '#2A4B4C',
  bege: '#F7F5EC',
  suave: '#E2EAE9',
  branco: '#FFFFFF',
  erro: '#E63946',
};

export default function TelaPerfil() {
  const { alert: mostrarDialogo } = useAppDialog();

  const [usuario, setUsuario] = useSessionUser();

  const [convidado, setConvidado] = useState(false);
  const [carregandoPerfil, setCarregandoPerfil] = useState(true);
  const [navegando, setNavegando] = useState(false);

  // ==========================================
  // CARREGAR PERFIL OU MODO CONVIDADO
  // ==========================================

  useFocusEffect(
    useCallback(() => {
      let active = true;

      setCarregandoPerfil(true);

      const carregarPerfil = async () => {
        try {
          const modoConvidado = await isGuestMode();

          const user = modoConvidado
            ? null
            : await getStoredUser();

          if (!active) return;

          setConvidado(modoConvidado);
          setUsuario(user);
        } catch {
          if (!active) return;

          setConvidado(false);
          setUsuario(null);
        } finally {
          if (active) {
            setCarregandoPerfil(false);
          }
        }
      };

      void carregarPerfil();

      return () => {
        active = false;
      };
    }, [setUsuario])
  );

  // ==========================================
  // SAIR DO MODO CONVIDADO
  // ==========================================

  const abrirAutenticacao = async (
    destino: 'login' | 'cadastro'
  ) => {
    if (navegando) return;

    setNavegando(true);

    try {
      // Encerra o modo convidado.
      await clearSession();

      if (destino === 'cadastro') {
        router.replace('/registro' as any);
      } else {
        router.replace('/login');
      }
    } catch {
      mostrarDialogo(
        'Erro',
        'Não foi possível sair do modo convidado. Tente novamente.'
      );
    } finally {
      setNavegando(false);
    }
  };

  // ==========================================
  // LOGOUT DE USUÁRIO AUTENTICADO
  // ==========================================

  const fazerLogout = () => {
    const sair = async () => {
      try {
        await clearSession();
        router.replace('/login');
      } catch {
        mostrarDialogo(
          'Erro',
          'Não foi possível desconectar. Tente novamente.'
        );
      }
    };

    mostrarDialogo(
      'Sair da Conta',
      'Tem certeza de que deseja desconectar?',
      [
        {
          text: 'Cancelar',
          style: 'cancel',
        },
        {
          text: 'Sair',
          style: 'destructive',
          onPress: sair,
        },
      ]
    );
  };

  const nomeExibicaoFinal =
    usuario?.nome_exibicao ||
    usuario?.nome_completo ||
    'Usuário';

  const ehAdminOuMaster =
    !!usuario && canManage(usuario);

  // ==========================================
  // CARREGAMENTO
  // ==========================================

  if (carregandoPerfil || (!usuario && !convidado)) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator
          size="large"
          color={cores.verde}
        />

        <Text style={styles.loadingText}>
          Carregando perfil...
        </Text>
      </View>
    );
  }

  // ==========================================
  // PERFIL DO CONVIDADO
  // ==========================================

  if (convidado) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, Platform.OS === 'web' && styles.scrollContentWeb]}
      >
        <View style={styles.headerProfile}>
          <View style={styles.avatarPlaceholder}>
            <Ionicons
              name="person-outline"
              size={50}
              color={cores.verde}
            />
          </View>

          <Text style={styles.nome}>
            Convidado
          </Text>

          <Text style={styles.bioText}>
            Você está navegando na Agenda ADP
            sem uma conta autenticada.
          </Text>
        </View>

        <View style={styles.guestInfo}>
          <Ionicons
            name="information-circle-outline"
            size={25}
            color={cores.verde}
          />

          <Text style={styles.guestInfoText}>
            Como convidado, você pode consultar
            a agenda e visualizar as publicações
            disponíveis. Para acessar recursos
            exclusivos de membros, entre na sua
            conta ou faça seu cadastro.
          </Text>
        </View>

        <View style={styles.menuContainer}>
          <TouchableOpacity
            style={styles.guestLoginButton}
            onPress={() =>
              void abrirAutenticacao('login')
            }
            disabled={navegando}
            accessibilityRole="button"
            accessibilityLabel="Entrar na minha conta"
          >
            {navegando ? (
              <ActivityIndicator color={cores.bege} />
            ) : (
              <>
                <Ionicons
                  name="log-in-outline"
                  size={22}
                  color={cores.bege}
                  style={{ marginRight: 10 }}
                />

                <Text style={styles.guestLoginText}>
                  Entrar na minha conta
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.guestRegisterButton}
            onPress={() =>
              void abrirAutenticacao('cadastro')
            }
            disabled={navegando}
            accessibilityRole="button"
            accessibilityLabel="Criar uma conta"
          >
            <Ionicons
              name="person-add-outline"
              size={22}
              color={cores.verde}
              style={{ marginRight: 10 }}
            />

            <Text style={styles.guestRegisterText}>
              Criar uma conta
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // ==========================================
  // PERFIL DE USUÁRIO AUTENTICADO
  // ==========================================

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, Platform.OS === 'web' && styles.scrollContentWeb]}
    >
      <View style={styles.headerProfile}>
        {usuario?.foto_perfil ? (
          <Image
            source={{ uri: usuario.foto_perfil }}
            style={styles.avatar}
          />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Ionicons
              name="person"
              size={50}
              color="#777"
            />
          </View>
        )}

        <Text style={styles.nome}>
          {nomeExibicaoFinal}
        </Text>

        <Text
          style={styles.bioText}
          numberOfLines={2}
        >
          {usuario?.bio ||
            'Nenhuma biografia adicionada.'}
        </Text>
      </View>

      <View style={styles.menuContainer}>

        {/* PAINEL DE GESTÃO */}

        {ehAdminOuMaster && (
          <TouchableOpacity
            style={[
              styles.menuCard,
              styles.managementCard,
            ]}
            onPress={() =>
              router.push('/gestao-usuarios' as any)
            }
            accessibilityRole="button"
            accessibilityLabel="Abrir painel de gestão"
          >
            <View style={styles.menuIconContainer}>
              <Ionicons
                name="settings-outline"
                size={24}
                color={cores.verde}
              />
            </View>

            <View style={styles.menuTextContainer}>
              <Text style={styles.menuTitle}>
                Painel de Gestão
              </Text>

              <Text style={styles.menuSubtitle}>
                Gerencie contas, membros e congregações.
              </Text>
            </View>

            <Ionicons
              name="chevron-forward"
              size={20}
              color={cores.verde}
            />
          </TouchableOpacity>
        )}

        {/* EDITAR PERFIL */}

        <TouchableOpacity
          style={styles.menuCard}
          onPress={() =>
            router.push('/editar-perfil' as any)
          }
          accessibilityRole="button"
          accessibilityLabel="Editar perfil"
        >
          <View style={styles.menuIconContainer}>
            <Ionicons
              name="create-outline"
              size={24}
              color={cores.verde}
            />
          </View>

          <View style={styles.menuTextContainer}>
            <Text style={styles.menuTitle}>
              Editar Perfil
            </Text>

            <Text style={styles.menuSubtitle}>
              Personalize sua foto, nome de exibição e bio.
            </Text>
          </View>

          <Ionicons
            name="chevron-forward"
            size={20}
            color="#999"
          />
        </TouchableOpacity>

        {/* DADOS E SEGURANÇA */}

        <TouchableOpacity
          style={styles.menuCard}
          onPress={() =>
            router.push('/dados-seguranca' as any)
          }
          accessibilityRole="button"
          accessibilityLabel="Consultar dados e segurança"
        >
          <View style={styles.menuIconContainer}>
            <Ionicons
              name="shield-checkmark-outline"
              size={24}
              color={cores.verde}
            />
          </View>

          <View style={styles.menuTextContainer}>
            <Text style={styles.menuTitle}>
              Dados e Segurança
            </Text>

            <Text style={styles.menuSubtitle}>
              Consulte seus dados cadastrais
              e configurações da conta.
            </Text>
          </View>

          <Ionicons
            name="chevron-forward"
            size={20}
            color="#999"
          />
        </TouchableOpacity>

        {/* DESCONECTAR */}

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={fazerLogout}
          accessibilityRole="button"
          accessibilityLabel="Desconectar da conta"
        >
          <Ionicons
            name="log-out-outline"
            size={20}
            color={cores.erro}
            style={{ marginRight: 8 }}
          />

          <Text style={styles.logoutButtonText}>
            Desconectar da Conta
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ==========================================
// ESTILOS
// ==========================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: cores.bege,
    padding: 20,
  },

  // Na web todo o conteúdo do perfil (inclusive os botões) fica centralizado.
  scrollContent: {
    paddingBottom: 40,
    width: '100%',
  },

  scrollContentWeb: {
    maxWidth: 640,
    alignSelf: 'center',
  },

  loadingContainer: {
    flex: 1,
    backgroundColor: cores.bege,
    justifyContent: 'center',
    alignItems: 'center',
  },

  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: cores.verde,
  },

  headerProfile: {
    alignItems: 'center',
    marginBottom: 30,
    marginTop: 40,
  },

  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: cores.verde,
    marginBottom: 12,
  },

  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: cores.suave,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: cores.verde,
    marginBottom: 12,
  },

  nome: {
    fontSize: 22,
    fontWeight: 'bold',
    color: cores.verde,
    marginBottom: 5,
    textAlign: 'center',
  },

  bioText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 21,
  },

  menuContainer: {
    width: '100%',
  },

  menuCard: {
    backgroundColor: cores.branco,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },

  managementCard: {
    backgroundColor: '#EFECE6',
    borderColor: cores.verde,
    borderWidth: 1,
  },

  menuIconContainer: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: cores.suave,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },

  menuTextContainer: {
    flex: 1,
  },

  menuTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: cores.verde,
    marginBottom: 3,
  },

  menuSubtitle: {
    fontSize: 12,
    color: '#666',
  },

  logoutButton: {
    backgroundColor: '#FDE8E8',
    borderWidth: 1,
    borderColor: cores.erro,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
    elevation: 1,
  },

  logoutButtonText: {
    color: cores.erro,
    fontSize: 16,
    fontWeight: 'bold',
  },

  guestInfo: {
    backgroundColor: cores.suave,
    borderRadius: 14,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 24,
  },

  guestInfoText: {
    flex: 1,
    color: cores.verde,
    fontSize: 14,
    lineHeight: 21,
    marginLeft: 12,
  },

  guestLoginButton: {
    backgroundColor: cores.verde,
    height: 54,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },

  guestLoginText: {
    color: cores.bege,
    fontSize: 16,
    fontWeight: '700',
  },

  guestRegisterButton: {
    backgroundColor: cores.suave,
    borderWidth: 1,
    borderColor: cores.verde,
    height: 54,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },

  guestRegisterText: {
    color: cores.verde,
    fontSize: 16,
    fontWeight: '700',
  },
});
