import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Text, TouchableOpacity, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { canManage, getSessionToken, refreshSession, subscribeSession } from '@/services/session';

const managerRoutes = new Set(['/criar-evento', '/editar-evento', '/criar-post', '/gestao-usuarios', '/usuarios-congregacao']);
const publicRoutes = new Set(['/', '/login', '/registro']);

export function SessionMonitor() {
  const pathname = usePathname();
  const path = useRef(pathname);
  useEffect(() => { path.current = pathname; }, [pathname]);
  const [warning, setWarning] = useState('');
  const mounted = useRef(false);
  const check = useCallback(async () => {
    if (publicRoutes.has(path.current)) return;
    try {
      if (!await getSessionToken()) {
        if (mounted.current) router.replace('/login');
        return;
      }
      const user = await refreshSession();
      if (!mounted.current) return;
      setWarning('');
      if (!user) {
        router.replace('/login');
        return;
      }
      if ((path.current === '/gestao-datas' && user.nivel_acesso !== 'MASTER') ||
          (managerRoutes.has(path.current) && !canManage(user))) {
        router.replace('/(tabs)/agenda');
      }
    } catch {
      if (mounted.current) setWarning('Não foi possível conferir sua sessão. Verifique a conexão e tente novamente.');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeSession(event => {
      if (event.user && ((path.current === '/gestao-datas' && event.user.nivel_acesso !== 'MASTER') ||
          (managerRoutes.has(path.current) && !canManage(event.user)))) {
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
  if (!warning) return null;
  return <View style={{ backgroundColor: '#F7F5EC', padding: 12 }}>
    <Text accessibilityRole="alert" style={{ color: '#2A4B4C' }}>{warning}</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Tentar conferir a sessão novamente" onPress={() => void check()} style={{ paddingVertical: 8 }}>
      <Text style={{ color: '#2A4B4C', fontWeight: 'bold' }}>Tentar novamente</Text>
    </TouchableOpacity>
  </View>;
}
