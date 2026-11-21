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
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
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

  // Teste de upload real no navegador, sem publicar nem usar dados de produção.
  await page.addInitScript(() => localStorage.setItem('userToken', 'token-teste'));
  await page.route('http://localhost:3000/sessao', route => route.fulfill({ status: 200,
    contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization' },
    body: JSON.stringify({ usuario: { id: 1, nivel_acesso: 'MASTER', status_conta: 'APROVADO', congregacao_id: 1 } }) }));
  await page.goto(`http://127.0.0.1:${server.address().port}/criar-post`);
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400; canvas.height = 1200;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2A4B4C'; context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await page.getByText('Toque para anexar uma foto', { exact: true }).click();
  await (await picker).setFiles({ name: 'foto-teste.png', mimeType: 'image/png', buffer: Buffer.from(fixture, 'base64') });
  const preview = page.locator('img[src^="data:image/jpeg;base64,"]').first();
  await preview.waitFor({ state: 'attached', timeout: 20_000 });
  await page.waitForFunction(() => [...document.images].some(image => image.src.startsWith('data:image/jpeg;base64,') && image.naturalWidth === 1600 && image.naturalHeight === 800));
  const uri = await preview.getAttribute('src');
  assert.ok(Buffer.from(uri.split(',')[1], 'base64').length <= 1_500_000);
  console.log('OK: seleção de imagem real, redimensionamento proporcional e limite de upload.');
} finally {
  await browser?.close();
  server.close();
}
