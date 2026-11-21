const categories = ['network', 'timeout', 'server', 'render'] as const;
export type ClientIssue = typeof categories[number];
export type ClientReport = { platform: 'web' | 'android' | 'ios' | 'other'; events: { category: ClientIssue; count: number }[] };

// In-memory only: no identifiers, messages, URLs, stack traces or storage.
export function createClientMonitor(platform: string, send: (report: ClientReport) => Promise<void>, now = Date.now) {
  const counts = new Map<ClientIssue, number>();
  const safePlatform = platform === 'android' || platform === 'ios' || platform === 'web' ? platform : 'other';
  let lastAttempt = -Infinity;
  let sending = false;
  return {
    record(category: ClientIssue) {
      if (categories.includes(category)) counts.set(category, Math.min(100, (counts.get(category) ?? 0) + 1));
    },
    async flush() {
      if (sending || !counts.size || now() - lastAttempt < 60_000) return;
      sending = true;
      lastAttempt = now();
      const events = Array.from(counts, ([category, count]) => ({ category, count }));
      counts.clear();
      // Best effort: never retry an ambiguous POST or block the user's action.
      try { await send({ platform: safePlatform, events }); } catch { /* diagnostics are optional */ }
      finally { sending = false; }
    },
  };
}
