import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2];
assert.ok(dist, 'Informe o diretório gerado pelo expo export.');
for (const route of ['index.html', 'login.html']) {
  const html = readFileSync(join(dist, route), 'utf8');
  assert.match(html, /rel="manifest"[^>]*href="\/manifest\.json"/);
  assert.match(html, /rel="apple-touch-icon"[^>]*href="\/pwa\/icon-180\.png"/);
  assert.match(html, /src="\/pwa-register\.js"/);
}
for (const path of ['manifest.json', 'sw.js', 'pwa-register.js', 'pwa/icon-180.png', 'pwa/icon-192.png', 'pwa/icon-512.png']) {
  assert.ok(readFileSync(join(dist, path)).length > 0, path);
}
console.log('PWA exportada: manifesto, ícones e service worker presentes.');
