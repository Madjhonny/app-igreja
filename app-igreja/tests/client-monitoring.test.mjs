import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClientMonitor } from '../services/client-monitoring.ts';

test('agrega apenas categorias permitidas e limita contadores', async () => {
  const reports = [];
  const monitor = createClientMonitor('web', async report => reports.push(report));
  for (let i = 0; i < 120; i++) monitor.record('network');
  monitor.record('senha@privada');
  monitor.record('timeout');
  await monitor.flush();
  assert.deepEqual(reports, [{ platform: 'web', events: [{ category: 'network', count: 100 }, { category: 'timeout', count: 1 }] }]);
});

test('limita frequência, não envia vazio e mantém eventos novos durante envio', async () => {
  let now = 0, release;
  const reports = [];
  const monitor = createClientMonitor('android', report => { reports.push(report); return new Promise(resolve => { release = resolve; }); }, () => now);
  await monitor.flush();
  monitor.record('server');
  const sending = monitor.flush();
  monitor.record('render');
  await monitor.flush();
  release(); await sending;
  now = 59_999; await monitor.flush();
  assert.equal(reports.length, 1);
  now = 60_000; const next = monitor.flush(); release(); await next;
  assert.deepEqual(reports[1], { platform: 'android', events: [{ category: 'render', count: 1 }] });
});

test('falha no envio não lança erro nem repete lote ambíguo', async () => {
  let calls = 0, now = 0;
  const monitor = createClientMonitor('private-id', async report => { calls++; assert.equal(report.platform, 'other'); throw Error('offline'); }, () => now);
  monitor.record('network'); await monitor.flush();
  now = 60_000; await monitor.flush();
  assert.equal(calls, 1);
});
