import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthMarks, createLatestMonthRequest, monthEvents } from '../services/agenda-month.ts';

test('marca períodos que atravessam meses, ano e fevereiro bissexto', () => {
  const events = [{ data_inicio: '2023-12-29', data_fim: '2024-01-03' }, { data_inicio: '2024-02-28T00:00:00.000Z', data_fim: '2024-03-02' }];
  const jan = monthMarks(2024, 0, events);
  assert.deepEqual(jan.marked.flatMap((value, day) => value ? [day] : []), [1, 2, 3]);
  const feb = monthMarks(2024, 1, events);
  assert.deepEqual(feb.marked.flatMap((value, day) => value ? [day] : []), [28, 29]);
  assert.equal(feb.connected[29], true);
  assert.equal(feb.connected[28], false);
});

test('dias adjacentes de eventos independentes não ganham ligação indevida', () => {
  const { marked, connected } = monthMarks(2026, 10, [
    { data_inicio: '2026-11-01', data_fim: '2026-11-03' },
    { data_inicio: '2026-11-04' }, { data_inicio: '2026-11-04', data_fim: '2026-11-06' },
    { data_inicio: '2026-11-05', data_fim: '2026-11-08' }, { data_inicio: null },
  ]);
  assert.deepEqual(marked.slice(1, 9), Array(8).fill(true));
  assert.deepEqual(connected.slice(1, 9), [false, true, true, false, true, true, true, true]);
  assert.equal(marked[9], false);
});

test('índice reproduz o cálculo anterior para 2000 eventos com sobreposições', () => {
  const events = Array.from({ length: 2000 }, (_, i) => {
    const start = (i * 7 % 30) + 1;
    const end = Math.min(30, start + i % 8);
    return { data_inicio: `2026-11-${String(start).padStart(2, '0')}`, data_fim: `2026-11-${String(end).padStart(2, '0')}` };
  });
  const date = day => `2026-11-${String(day).padStart(2, '0')}`;
  const { marked, connected } = monthMarks(2026, 10, events);
  for (let day = 1; day <= 30; day++) {
    assert.equal(marked[day], events.some(e => e.data_inicio <= date(day) && e.data_fim >= date(day)));
    assert.equal(connected[day], day > 1 && events.some(e => e.data_inicio <= date(day - 1) && e.data_fim >= date(day)));
  }
});

test('troca de mês cancela pedido anterior e impede resposta atrasada', () => {
  const requests = createLatestMonthRequest();
  const first = requests.start();
  const next = requests.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(next.isCurrent(), true);
  requests.cancel();
  assert.equal(next.signal.aborted, true);
  assert.equal(next.isCurrent(), false);
});

test('resultado de outro mês nunca aparece na lista selecionada', () => {
  const empty = [];
  const events = [{ id: 1 }];
  assert.equal(monthEvents({ month: 24320, events }, 24321, empty), empty);
  assert.equal(monthEvents({ month: 24320, events }, 24320, empty), events);
  assert.equal(monthEvents(null, 24320, empty), empty);
});
