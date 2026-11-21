import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = resolve(process.argv[2]);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, `.${path === '/' ? '/index.html' : extname(path) ? path : `${path}.html`}`);
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  let calls = 0, unavailable = true;
  const reports = [];
  await page.route('http://localhost:3000/telemetria', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      assert.equal(request.headers().authorization, undefined);
      reports.push(request.postDataJSON());
    }
    await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' } });
  });
  await page.route('http://localhost:3000/congregacoes', async route => {
    calls++;
    await route.fulfill({ status: unavailable ? 503 : 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: unavailable ? '{}' : JSON.stringify([{ id: 1, nome: 'Sede Teste' }]) });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/registro`);
  const banner = page.getByText('Conexão instável com o servidor.', { exact: false });
  await banner.waitFor({ timeout: 20_000 });
  assert.equal(calls, 2, 'deve repetir somente uma vez');
  unavailable = false;
  const diagnostic = page.waitForResponse(response => response.url().endsWith('/telemetria') && response.request().method() === 'POST');
  await page.getByText('Toque para tentar novamente.', { exact: false }).click();
  await banner.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Selecionar congregação' }).click();
  await page.getByText('Sede Teste', { exact: true }).waitFor();
  assert.equal(calls, 3);
  await diagnostic;
  assert.deepEqual(reports, [{ platform: 'web', events: [{ category: 'server', count: 1 }] }]);
  console.log('OK: falha 503, retry, aviso de conexão, recuperação e seleção de congregação.');
} finally {
  await browser?.close();
  server.close();
}
