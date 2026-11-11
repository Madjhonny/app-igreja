import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Text, TouchableOpacity, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { canManage, getSessionToken, refreshSession, subscribeSession, type SessionUser } from '@/services/session';

const managerRoutes = new Set(['/criar-evento', '/editar-evento', '/criar-post', '/gestao-usuarios', '/usuarios-congregacao']);
const publicRoutes = new Set(['/', '/login', '/registro']);

function semAcessoARota(pathname: string, user: SessionUser) {
  if (pathname === '/gestao-datas') {
    return user.nivel_acesso !== 'MASTER' || !canManage(user);
  }
  return managerRoutes.has(pathname) && !canManage(user);
}

export function SessionMonitor() {
  const pathname = usePathname();
  const path = useRef(pathname);
  useEffect(() => { path.current = pathname; }, [pathname]);
  const [warning, setWarning] = useState('');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(false);
  const check = useCallback(async () => {
    if (publicRoutes.has(path.current)) return;
    if (mounted.current) setChecking(true);
    try {
      if (!await getSessionToken()) {
        if (mounted.current) {
          setUser(null);
          router.replace('/login');
        }
        return;
      }
      const refreshedUser = await refreshSession();
      if (!mounted.current) return;
      setWarning('');
      setUser(refreshedUser);
      if (!refreshedUser) {
        router.replace('/login');
        return;
      }
      if (semAcessoARota(path.current, refreshedUser)) {
        router.replace('/(tabs)/agenda');
      }
    } catch {
      if (mounted.current) setWarning('Não foi possível conferir sua sessão. Verifique a conexão e tente novamente.');
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeSession(event => {
      setUser(event.user);
      if (event.user && semAcessoARota(path.current, event.user)) {
        router.replace('/(tabs)/agenda');
      }
      if (event.reason) {
        setWarning('');
        router.replace({ pathname: '/login', params: { motivo: event.reason } });
      }
    });
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    if (Platform.OS === 'web') window.addEventListener('focus', check);
    return () => {
      mounted.current = false;
      unsubscribe(); subscription.remove();
      if (Platform.OS === 'web') window.removeEventListener('focus', check);
    };
  }, [check]);
  useEffect(() => { void Promise.resolve().then(check); }, [pathname, check]);
  const pending = !publicRoutes.has(pathname) && user?.status_conta === 'PENDENTE';
  if (!warning && !pending) return null;
  return <SafeAreaView
    edges={['top']}
    style={{ backgroundColor: warning ? '#F7F5EC' : '#E2EAE9' }}
  >
    {!!warning && <View style={{ backgroundColor: '#F7F5EC', padding: 12 }}>
      <Text accessibilityRole="alert" style={{ color: '#2A4B4C' }}>{warning}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Tentar conferir a sessão novamente" onPress={() => void check()} style={{ paddingVertical: 8 }}>
        <Text style={{ color: '#2A4B4C', fontWeight: 'bold' }}>Tentar novamente</Text>
      </TouchableOpacity>
    </View>}
    {pending && <View
      accessibilityLiveRegion="polite"
      style={{ backgroundColor: '#E2EAE9', borderBottomColor: '#C4C2B7', borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 12 }}
    >
      <Text accessibilityRole="alert" style={{ color: '#2A4B4C', fontSize: 14, fontWeight: 'bold' }}>
        Sua conta está aguardando aprovação.
      </Text>
      <Text style={{ color: '#2A4B4C', fontSize: 13, lineHeight: 18, marginTop: 4 }}>
        Você está acessando o Agenda ADP como convidado. Para liberar todas as funcionalidades de membro, entre em contato com o secretário da sua congregação.
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Verificar se a conta já foi aprovada"
        accessibilityState={{ busy: checking, disabled: checking }}
        disabled={checking}
        onPress={() => void check()}
        style={{ alignSelf: 'flex-start', paddingVertical: 8 }}
      >
        <Text style={{ color: '#2A4B4C', fontSize: 13, fontWeight: 'bold' }}>
          {checking ? 'Verificando aprovação…' : 'Verificar aprovação'}
        </Text>
      </TouchableOpacity>
    </View>}
  </SafeAreaView>;
}
