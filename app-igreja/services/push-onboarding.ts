type Dependencies = {
  available: boolean;
  seen: (key: string) => Promise<boolean>;
  remember: (key: string) => Promise<void>;
  status: (userId: number) => Promise<'active' | 'pending' | 'off'>;
  confirm: () => Promise<boolean>;
  currentAuth: (userId: number) => Promise<string | null>;
  enable: (api: string, userId: number, auth: string) => Promise<boolean>;
  failed: () => void;
};

export const pushOfferKey = (api: string, userId: number) => `agenda-adp-push-offer-v1:${api}:${userId}`;

export function createPushOnboarding(deps: Dependencies) {
  let busy = false;
  const offered = new Set<string>();
  return async (api: string, user: { id: number; status_conta: string } | null) => {
    if (!deps.available || busy || !user || user.status_conta !== 'APROVADO') return;
    const key = pushOfferKey(api, user.id);
    if (offered.has(key)) return;
    busy = true;
    try {
      if (await deps.seen(key)) return;
      if (await deps.status(user.id) !== 'off') { await deps.remember(key); return; }
      const auth = await deps.currentAuth(user.id);
      if (!auth) return;
      offered.add(key);
      const accepted = await deps.confirm();
      await deps.remember(key);
      if (!accepted || await deps.currentAuth(user.id) !== auth) return;
      if (!await deps.enable(api, user.id, auth)) deps.failed();
    } catch { deps.failed(); }
    finally { busy = false; }
  };
}
