import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { observarToquesNaAgenda } from './push-agenda';
import { createPushPreference, type PushRecord } from './push-preference';

const STORAGE_KEY = 'agenda-adp-push-registration';
export const pushAvailable = (Platform.OS === 'android' || Platform.OS === 'ios') &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient && process.env.EXPO_PUBLIC_PUSH_ENABLED === 'true';

export function observarAberturaDaAgenda(podeAbrir: () => Promise<boolean>, abrir: () => void) {
  if (!pushAvailable) return () => {};
  return observarToquesNaAgenda({
    acaoPadrao: Notifications.DEFAULT_ACTION_IDENTIFIER,
    ultimaResposta: Notifications.getLastNotificationResponse,
    limparResposta: Notifications.clearLastNotificationResponse,
    inscrever: Notifications.addNotificationResponseReceivedListener,
    podeAbrir,
    abrir,
  });
}

if (pushAvailable) Notifications.setNotificationHandler({ handleNotification: async () => ({
  shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
}) });

async function post(api: string, path: string, body: object, auth?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${api}${path}`, { method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: JSON.stringify(body), signal: controller.signal });
    return response.status === 204;
  } catch { return false; } finally { clearTimeout(timer); }
}

export const pushPreference = createPushPreference({
  read: async () => { const raw = await SecureStore.getItemAsync(STORAGE_KEY); return raw ? JSON.parse(raw) as PushRecord : null; },
  write: record => SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(record)),
  remove: () => SecureStore.deleteItemAsync(STORAGE_KEY),
  generateKey: async () => Array.from(await Crypto.getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, '0')).join(''),
  getToken: async ask => {
    if (!pushAvailable) return null;
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('agenda', { name: 'Agenda', importance: Notifications.AndroidImportance.DEFAULT });
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && ask) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return null;
    const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return null;
    const token = Notifications.getExpoPushTokenAsync({ projectId });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([token.then(value => value.data), new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 15_000); })]);
    } finally { clearTimeout(timeout); }
  },
  register: (api, auth, record) => post(api, '/notificacoes/dispositivo', { token: record.token, key: record.key, platform: Platform.OS }, auth),
  revoke: (api, key) => post(api, '/notificacoes/desativar', { key }),
});
