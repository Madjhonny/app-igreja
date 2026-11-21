import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { ApiTimeoutError, fetchWithResilience } from './network';
import { createClientMonitor } from './client-monitoring';
import { createPublicCache } from './public-cache';
import { pushPreference } from './push-native';

const DEFAULT_API_URL = 'https://app-igreja-eks0.onrender.com';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, '');
const publicCache = createPublicCache(API_URL, fetchWithResilience);
export const clientMonitor = createClientMonitor(Platform.OS, async report => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(`${API_URL}/telemetria`, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report), signal: controller.signal,
    });
  } finally { clearTimeout(timer); }
});

export type SessionUser = {
  id: number;
  nivel_acesso: 'MASTER' | 'ADMIN' | 'MEMBRO';
  status_conta: string;
  congregacao_id: number | null;
  [key: string]: any;
};

type SessionEvent = { user: SessionUser | null; reason?: string };
const listeners = new Set<(event: SessionEvent) => void>();
const TOKEN_KEY = 'userToken';
const USER_KEY = 'userData';
const KEEP_KEY = 'manterConectado';
const GUEST_KEY = 'guestMode';

export function subscribeSession(listener: (event: SessionEvent) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(event: SessionEvent) {
  listeners.forEach(listener => listener(event));
}

function usuarioPersistivel(user: SessionUser) {
  const { cpf: _cpf, telefone: _telefone, ...safeUser } = user;
  return safeUser as SessionUser;
}

export async function getSessionToken() {
  if (Platform.OS === 'web') return AsyncStorage.getItem(TOKEN_KEY);
  const secureToken = await SecureStore.getItemAsync(TOKEN_KEY);
  if (secureToken) return secureToken;

  // Migra silenciosamente sessões da versão anterior, que usava AsyncStorage.
  const legacyToken = await AsyncStorage.getItem(TOKEN_KEY);
  if (legacyToken) {
    await SecureStore.setItemAsync(TOKEN_KEY, legacyToken);
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
  if (!legacyToken) void pushPreference.reconcile(API_URL, null, null).catch(() => undefined);
  return legacyToken;
}

export async function storeSessionUser(user: SessionUser) {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(usuarioPersistivel(user)));
  emit({ user });
}

export async function isGuestMode() {
  return (await AsyncStorage.getItem(GUEST_KEY)) === 'true';
}

export async function enterGuestMode() {
  await clearSession();
  await AsyncStorage.setItem(GUEST_KEY, 'true');
}

export async function saveSession(token: string, user: SessionUser, keepSignedIn: boolean) {
  publicCache.clear();
  if (Platform.OS === 'web') await AsyncStorage.setItem(TOKEN_KEY, token);
  else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
  await AsyncStorage.setItem(KEEP_KEY, keepSignedIn ? 'true' : 'false');
  await AsyncStorage.removeItem(GUEST_KEY);
  await storeSessionUser(user);
  void pushPreference.reconcile(API_URL, user.status_conta === 'APROVADO' ? user.id : null, token).catch(() => undefined);
}

export async function shouldKeepSignedIn() {
  return (await AsyncStorage.getItem(KEEP_KEY)) === 'true';
}

export function apiUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_URL}/${pathOrUrl.replace(/^\/+/, '')}`;
}

export async function clearSession(expectedToken?: string, reason?: string) {
  if (expectedToken && await getSessionToken() !== expectedToken) return;
  await pushPreference.disable(API_URL).catch(() => false);
  if (expectedToken && await getSessionToken() !== expectedToken) return;
  publicCache.clear();
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(TOKEN_KEY);
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, KEEP_KEY, GUEST_KEY]);
  emit({ user: null, reason });
}

export function canManage(user: SessionUser | null) {
  return !!user && user.status_conta === 'APROVADO' &&
    ['MASTER', 'ADMIN'].includes(user.nivel_acesso);
}

export function canInteract(user: SessionUser | null) {
  return !!user && user.status_conta === 'APROVADO';
}

export async function apiFetch(pathOrUrl: string, init?: RequestInit): Promise<Response> {
  const url = apiUrl(pathOrUrl);
  const authorization = new Headers(init?.headers).get('Authorization');
  const sentToken = authorization?.match(/^Bearer (\S+)$/i)?.[1];
  const firstParty = url.startsWith(`${API_URL}/`);
  let response: Response;
  try {
    response = await publicCache.request(url, init);
  } catch (error) {
    if (firstParty && !init?.signal?.aborted) {
      if (error instanceof ApiTimeoutError) clientMonitor.record('timeout');
      else if (error instanceof TypeError) clientMonitor.record('network');
    }
    throw error;
  }
  if (firstParty) {
    if (response.status >= 500) clientMonitor.record('server');
    else if (response.ok) void clientMonitor.flush();
  }

  if (url.startsWith(`${API_URL}/`) && sentToken) {
    let reason: string | undefined;
    if (response.status === 401) reason = 'Sua sessão expirou. Entre novamente.';
    if (response.status === 403) {
      const data = await response.clone().json().catch(() => ({}));
      if (data.codigo === 'CONTA_SEM_ACESSO') reason = data.erro;
    }
    if (reason) await clearSession(sentToken, reason);
    else if (response.status === 403 && url !== `${API_URL}/sessao` &&
             await getSessionToken() === sentToken) {
      await refreshSession().catch(() => null);
    }
  }
  return response;
}

export async function authenticatedFetch(pathOrUrl: string, init?: RequestInit): Promise<Response> {
  const token = await getSessionToken();
  if (!token) {
    await clearSession(undefined, 'Entre na sua conta para continuar.');
    throw new Error('AUTH_REQUIRED');
  }
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return apiFetch(pathOrUrl, { ...init, headers });
}

export async function getStoredUser(): Promise<SessionUser | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as SessionUser;
    return Number.isSafeInteger(user?.id) ? user : null;
  } catch {
    return null;
  }
}

let pending: { token: string; promise: Promise<SessionUser | null> } | null = null;

export async function refreshSession(): Promise<SessionUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  if (pending?.token === token) return pending.promise;

  const promise = (async () => {
    const response = await apiFetch('/sessao', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error('Não foi possível conferir sua sessão. Tente novamente.');
    const data = await response.json();
    if (!data.usuario?.id) throw new Error('Resposta de sessão inválida.');
    if (await getSessionToken() !== token) return null;
    await storeSessionUser(data.usuario);
    void pushPreference.reconcile(API_URL, data.usuario.status_conta === 'APROVADO' ? data.usuario.id : null, token).catch(() => undefined);
    return data.usuario;
  })();

  pending = { token, promise };
  try {
    return await promise;
  } finally {
    if (pending?.promise === promise) pending = null;
  }
}
