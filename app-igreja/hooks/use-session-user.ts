import { useEffect, useState } from 'react';
import { subscribeSession, type SessionUser } from '@/services/session';

// Existing screen loaders can still set user data; server refreshes update every mounted screen.
export function useSessionUser() {
  const state = useState<SessionUser | null>(null);
  const setUser = state[1];
  useEffect(() => subscribeSession(event => setUser(event.user)), [setUser]);
  return state;
}
