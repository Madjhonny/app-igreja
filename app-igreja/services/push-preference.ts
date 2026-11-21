export type PushRecord = { api: string; key: string; token: string; userId: number; active: boolean; renewedAt: number };
type Dependencies = {
  read: () => Promise<PushRecord | null>;
  write: (record: PushRecord) => Promise<void>;
  remove: () => Promise<void>;
  getToken: (ask: boolean) => Promise<string | null>;
  generateKey: () => Promise<string>;
  register: (api: string, auth: string, record: PushRecord) => Promise<boolean>;
  revoke: (api: string, key: string) => Promise<boolean>;
  now?: () => number;
};

export function createPushPreference(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(action: () => Promise<T>) {
    const task = pending.then(action, action);
    pending = task.catch(() => undefined);
    return task;
  }
  async function revoke(api: string, record: PushRecord) {
    await deps.write({ ...record, active: false });
    if (!await deps.revoke(record.api || api, record.key)) return false;
    await deps.remove();
    return true;
  }
  async function activate(api: string, userId: number, auth: string, ask: boolean) {
    let record = await deps.read();
    if (record && (!record.active || record.userId !== userId || record.api !== api)) {
      if (!await revoke(api, record)) return false;
      record = null;
    }
    const token = await deps.getToken(ask);
    if (!token) { if (record) await revoke(api, record); return false; }
    if (record && record.token !== token) {
      if (!await revoke(api, record)) return false;
      record = null;
    }
    const next = { api, key: record?.key ?? await deps.generateKey(), token, userId, active: false, renewedAt: 0 };
    // Persist capability before contacting the server, so even a lost response can be revoked.
    await deps.write(next);
    if (!await deps.register(api, auth, next)) return false;
    await deps.write({ ...next, active: true, renewedAt: now() });
    return true;
  }
  return {
    status: async (userId: number) => {
      const record = await deps.read();
      return record?.active && record.userId === userId ? 'active' as const : record ? 'pending' as const : 'off' as const;
    },
    enable: (api: string, userId: number, auth: string) => serial(() => activate(api, userId, auth, true)),
    disable: (api: string) => serial(async () => { const record = await deps.read(); return !record || revoke(api, record); }),
    reconcile: (api: string, userId: number | null, auth: string | null) => serial(async () => {
      const record = await deps.read();
      if (!record) return;
      if (!record.active || record.userId !== userId || record.api !== api || !auth) { await revoke(api, record); return; }
      if (now() - record.renewedAt >= 24 * 60 * 60 * 1000) await activate(api, userId, auth, false);
    }),
  };
}
