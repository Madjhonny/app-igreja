import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { useSessionUser } from '@/hooks/use-session-user';
import { API_URL, getSessionToken, getStoredUser } from '@/services/session';
import { pushAvailable, pushPreference } from '@/services/push-native';
import { createPushOnboarding } from '@/services/push-onboarding';

const offer = createPushOnboarding({
    available: pushAvailable && Platform.OS === 'android',
    seen: async key => (await AsyncStorage.getItem(key)) === 'true',
    remember: key => AsyncStorage.setItem(key, 'true'),
    status: pushPreference.status,
    confirm: () => new Promise(resolve => Alert.alert(
      'Receber notificações?',
      'Receba avisos sobre novos eventos da sua congregação. Você pode alterar esta opção no Perfil a qualquer momento.',
      [{ text: 'Agora não', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Ativar notificações', onPress: () => resolve(true) }],
      { cancelable: true, onDismiss: () => resolve(false) },
    )),
    currentAuth: async id => {
      const stored = await getStoredUser();
      if (stored?.id !== id || stored.status_conta !== 'APROVADO') return null;
      return getSessionToken();
    },
    enable: pushPreference.enable,
    failed: () => Alert.alert('Notificações', 'Não foi possível ativar. Confira as permissões do Android e tente novamente pelo Perfil.'),
});

export function PushOnboarding() {
  const [user] = useSessionUser();
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === '/agenda' || pathname === '/(tabs)/agenda') void offer(API_URL, user);
  }, [pathname, user]);
  return null;
}
