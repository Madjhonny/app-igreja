type Period = { data_inicio?: string | null; data_fim?: string | null };

// Índice por dia: O(eventos + dias do mês), preservando o vínculo apenas
// quando o mesmo evento inclui os dois dias consecutivos.
export function monthMarks(year: number, month: number, events: Period[]) {
  const total = new Date(year, month + 1, 0).getDate();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const first = `${prefix}01`;
  const last = `${prefix}${total}`;
  const coverage = new Int32Array(total + 2);
  const links = new Int32Array(total + 2);
  for (const event of events) {
    const start = typeof event?.data_inicio === 'string' ? event.data_inicio.slice(0, 10) : '';
    const end = typeof event.data_fim === 'string' && event.data_fim ? event.data_fim.slice(0, 10) : start;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end || start > last || end < first) continue;
    const from = start <= first ? 1 : Number(start.slice(8));
    const to = end >= last ? total : Number(end.slice(8));
    if (from < 1 || to > total || from > to) continue;
    coverage[from]++; coverage[to + 1]--;
    if (from < to) { links[from + 1]++; links[to + 1]--; }
  }
  const marked = Array<boolean>(total + 1).fill(false);
  const connected = Array<boolean>(total + 1).fill(false);
  let count = 0, linkCount = 0;
  for (let day = 1; day <= total; day++) {
    count += coverage[day]; linkCount += links[day];
    marked[day] = count > 0;
    connected[day] = linkCount > 0;
  }
  return { marked, connected };
}

export function createLatestMonthRequest() {
  let current: AbortController | undefined;
  return {
    start() {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return { signal: controller.signal, isCurrent: () => current === controller && !controller.signal.aborted };
    },
    cancel() { current?.abort(); current = undefined; },
  };
}

export function monthEvents<T>(result: { month: number; events: T[] } | null, month: number, empty: T[]) {
  return result?.month === month ? result.events : empty;
}
