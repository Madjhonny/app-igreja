
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  canManage,
  getSessionToken,
  isGuestMode,
  refreshSession,
  subscribeSession,
  type SessionUser,
} from '@/services/session';

// Telas que exigem permissões administrativas.
const managerRoutes = new Set([
  '/criar-evento',
  '/editar-evento',
  '/criar-post',
  '/gestao-usuarios',
  '/usuarios-congregacao',
]);

// Telas que podem ser acessadas antes de entrar no aplicativo.
const publicRoutes = new Set([
  '/',
  '/login',
  '/registro',
  '/recuperar-senha',
]);

// Telas permitidas para convidados sem cadastro.
const guestRoutes = new Set([
  '/agenda',
  '/explore',
  '/perfil',
  '/(tabs)/agenda',
  '/(tabs)/explore',
  '/(tabs)/perfil',
]);

// Verifica as permissões das contas autenticadas.
function semAcessoARota(pathname: string, user: SessionUser) {
  if (pathname === '/gestao-datas') {
    return user.nivel_acesso !== 'MASTER' || !canManage(user);
  }

  return managerRoutes.has(pathname) && !canManage(user);
}

export function SessionMonitor() {
  const pathname = usePathname();

  const path = useRef(pathname);

  useEffect(() => {
    path.current = pathname;
  }, [pathname]);

  const [warning, setWarning] = useState('');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(false);

  const mounted = useRef(false);

  // Verifica a sessão atual e o modo convidado.
  const check = useCallback(async () => {
    if (publicRoutes.has(path.current)) return;

    if (mounted.current) {
      setChecking(true);
    }

    try {
      const token = await getSessionToken();

      // ==========================================
      // ACESSO SEM AUTENTICAÇÃO
      // ==========================================
      if (!token) {
        const convidado = await isGuestMode();

        if (!mounted.current) return;

        setUser(null);
        setWarning('');

        if (convidado) {
          // Convidados só podem acessar
          // as telas explicitamente permitidas.
          if (!guestRoutes.has(path.current)) {
            router.replace('/(tabs)/agenda');
          }
        } else {
          // Quem não está autenticado e não escolheu
          // entrar como convidado volta ao login.
          router.replace('/login');
        }

        return;
      }

      // ==========================================
      // ACESSO COM AUTENTICAÇÃO
      // ==========================================
      const refreshedUser = await refreshSession();

      if (!mounted.current) return;

      setWarning('');
      setUser(refreshedUser);

      // Sessão inválida ou expirada.
      if (!refreshedUser) {
        router.replace('/login');
        return;
      }

      // Confere permissões administrativas.
      if (semAcessoARota(path.current, refreshedUser)) {
        router.replace('/(tabs)/agenda');
      }
    } catch {
      if (mounted.current) {
        setWarning(
          'Não foi possível conferir sua sessão. Verifique a conexão e tente novamente.'
        );
      }
    } finally {
      if (mounted.current) {
        setChecking(false);
      }
    }
  }, []);

  // ==========================================
  // MONITORAMENTO DE ALTERAÇÕES DA SESSÃO
  // ==========================================
  useEffect(() => {
    mounted.current = true;

    const unsubscribe = subscribeSession(event => {
      setUser(event.user);

      // Impede que um usuário sem permissão
      // permaneça em uma tela administrativa.
      if (
        event.user &&
        semAcessoARota(path.current, event.user)
      ) {
        router.replace('/(tabs)/agenda');
      }

      // Notifica quando a sessão é encerrada
      // por expiração ou perda de acesso.
      if (event.reason) {
        setWarning('');

        router.replace({
          pathname: '/login',
          params: {
            motivo: event.reason,
          },
        });
      }
    });

    // Revalida ao retornar ao aplicativo.
    const subscription = AppState.addEventListener(
      'change',
      state => {
        if (state === 'active') {
          void check();
        }
      }
    );

    // Revalida quando a janela recebe foco.
    if (Platform.OS === 'web') {
      window.addEventListener('focus', check);
    }

    return () => {
      mounted.current = false;

      unsubscribe();
      subscription.remove();

      if (Platform.OS === 'web') {
        window.removeEventListener('focus', check);
      }
    };
  }, [check]);

  // Verifica novamente quando a rota muda.
  useEffect(() => {
    void Promise.resolve().then(check);
  }, [pathname, check]);

  // ==========================================
  // AVISO PARA CONTAS PENDENTES
  // ==========================================
  const pending =
    !publicRoutes.has(pathname) &&
    user?.status_conta === 'PENDENTE';

  if (!warning && !pending) {
    return null;
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={{
        backgroundColor: warning
          ? '#F7F5EC'
          : '#E2EAE9',
      }}
    >
      {!!warning && (
        <View
          style={{
            backgroundColor: '#F7F5EC',
            padding: 12,
          }}
        >
          <Text
            accessibilityRole="alert"
            style={{ color: '#2A4B4C' }}
          >
            {warning}
          </Text>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Tentar conferir a sessão novamente"
            onPress={() => void check()}
            style={{ paddingVertical: 8 }}
          >
            <Text
              style={{
                color: '#2A4B4C',
                fontWeight: 'bold',
              }}
            >
              Tentar novamente
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {pending && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            backgroundColor: '#E2EAE9',
            borderBottomColor: '#C4C2B7',
            borderBottomWidth: 1,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <Text
            accessibilityRole="alert"
            style={{
              color: '#2A4B4C',
              fontSize: 14,
              fontWeight: 'bold',
            }}
          >
            Sua conta está aguardando aprovação.
          </Text>

          <Text
            style={{
              color: '#2A4B4C',
              fontSize: 13,
              lineHeight: 18,
              marginTop: 4,
            }}
          >
            Você está acessando o Agenda ADP como convidado.
            Para liberar todas as funcionalidades de membro,
            entre em contato com o secretário da sua congregação.
          </Text>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Verificar se a conta já foi aprovada"
            accessibilityState={{
              busy: checking,
              disabled: checking,
            }}
            disabled={checking}
            onPress={() => void check()}
            style={{
              alignSelf: 'flex-start',
              paddingVertical: 8,
            }}
          >
            <Text
              style={{
                color: '#2A4B4C',
                fontSize: 13,
                fontWeight: 'bold',
              }}
            >
              {checking
                ? 'Verificando aprovação…'
                : 'Verificar aprovação'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}
