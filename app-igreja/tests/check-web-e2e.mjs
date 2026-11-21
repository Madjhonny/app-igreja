import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

// Não permite apontar o teste para a infraestrutura real.
const db = new URL(process.env.WEB_TEST_DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(db.hostname) && db.pathname === '/agenda_web_test');
const require = createRequire(new URL('../../api-igreja/package.json', import.meta.url));
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const pool = new Pool({ connectionString: db.href });
const root = resolve(process.argv[2]);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, `.${path === '/' ? '/index.html' : extname(path) ? path : `${path}.html`}`);
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
let api, browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const name of ['001_initial_schema.sql', '003_password_recovery.sql', '20261120_push_notifications.sql']) {
    await pool.query(await readFile(new URL(`../../api-igreja/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const congregation = (await pool.query("INSERT INTO congregacoes(nome) VALUES ('Sede E2E') RETURNING id")).rows[0].id;
  const password = 'TesteWeb123!';
  const hash = await bcrypt.hash(password, 4);
  const users = {};
  for (const [name, role, status, cpf] of [['Membro', 'MEMBRO', 'APROVADO', '30000000001'], ['Pendente', 'MEMBRO', 'PENDENTE', '30000000002'], ['Admin', 'ADMIN', 'APROVADO', '30000000003'], ['Master', 'MASTER', 'APROVADO', '30000000004']]) {
    users[name] = (await pool.query(`INSERT INTO usuarios(nome_completo,nome_exibicao,email,senha_hash,congregacao_id,cpf,nivel_acesso,status_conta)
      VALUES($1,$1,$2,$3,$4,$5,$6,$7) RETURNING id`, [name, `${name.toLowerCase()}@example.test`, hash, congregation, cpf, role, status])).rows[0].id;
  }
  const month = new Date().toISOString().slice(0, 7);
  const date = day => `${month}-${day}`;
  await pool.query("INSERT INTO eventos(titulo,data_inicio,data_fim,horario,congregacao_id,criado_por_usuario_id) VALUES('Evento público E2E',$1,$1,'10:00',$2,$3)", [date('10'), congregation, users.Master]);
  await pool.query("INSERT INTO gestao_datas_rascunho(master_id,titulo,data_inicio,data_fim,horario,congregacao_id) VALUES($1,'Rascunho E2E',$2,$2,'11:00',$3)", [users.Master, date('20'), congregation]);
  const postId = (await pool.query(`INSERT INTO mural_eventos(usuario_id,congregacao_id,titulo,tipo_midia,midia,data_inicio,data_fim)
    VALUES($1,$2,'Mural E2E','imagem',$3,CURRENT_DATE,CURRENT_DATE+30) RETURNING id`, [users.Master, congregation, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII='])).rows[0].id;
  // Sem segredos herdados e sem chamadas HTTP externas do backend.
  api = spawn(process.execPath, ['-e', 'global.fetch=async()=>{throw Error("Rede externa bloqueada")};require(process.argv[1])', resolve(new URL('../../api-igreja/server.js', import.meta.url).pathname)], {
    cwd: resolve(new URL('./', import.meta.url).pathname),
    env: { PORT: '3000', DB_HOST: db.hostname, DB_PORT: db.port || '5432', DB_NAME: 'agenda_web_test', DB_USER: decodeURIComponent(db.username), DB_PASSWORD: decodeURIComponent(db.password), DB_SSL: 'false', JWT_SECRET: 'browser-e2e-only', CORS_ORIGINS: origin, NODE_ENV: 'test', PUSH_NOTIFICATIONS_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`API não iniciou: ${logs}`)), 10000);
    api.once('error', err => { clearTimeout(timer); reject(err); });
    api.once('exit', code => { clearTimeout(timer); reject(Error(`API encerrou (${code}): ${logs}`)); });
    api.stderr.on('data', data => { logs += data; });
    api.stdout.on('data', data => { logs += data; if (logs.includes('rodando na porta 3000!')) { clearTimeout(timer); resolve(); } });
  });
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  // Nenhuma chamada do navegador pode sair do ambiente de teste.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return [origin, 'http://localhost:3000'].includes(url.origin) || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const visible = async (text) => page.getByText(text, { exact: true }).waitFor();
  const tab = async name => page.getByLabel(name, { exact: true }).click();
  const login = async name => {
    await page.goto(`${origin}/login`);
    await page.getByLabel('E-mail', { exact: true }).fill(`${name.toLowerCase()}@example.test`);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    const response = page.waitForResponse(res => res.url().endsWith('/login') && res.request().method() === 'POST');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.waitForURL('**/agenda');
    await visible('Evento público E2E');
  };
  const logout = async () => {
    await tab('Perfil');
    await page.getByRole('button', { name: 'Desconectar da conta' }).click();
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await page.waitForURL('**/login');
    await page.getByLabel('E-mail', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('userToken')), null);
  };
  await page.goto(`${origin}/login`);
  await page.getByRole('button', { name: 'Entrar como convidado' }).click();
  await page.waitForURL('**/agenda');
  await visible('Evento público E2E');
  assert.equal(await page.getByText('Novo Evento', { exact: true }).count(), 0);
  await tab('Eventos');
  await visible('Mural E2E');
  assert.equal(await page.getByRole('button', { name: 'Curtir publicação' }).count(), 0);
  await page.getByRole('button', { name: 'Ver comentários' }).click();
  await visible('Acesso restrito');
  await page.getByRole('button', { name: 'Entendi', exact: true }).click();
  await tab('Perfil');
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click();
  await page.waitForURL('**/login');
  console.log('OK E2E: convidado lê agenda e mural, mas não interage.');

  await login('Pendente');
  await page.getByText('Sua conta está aguardando aprovação.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Novo Evento', { exact: true }).count(), 0);
  await tab('Eventos');
  await visible('Mural E2E');
  assert.equal(await page.getByRole('button', { name: 'Curtir publicação' }).count(), 0);
  await logout();
  console.log('OK E2E: cadastro pendente permanece restrito e logout limpa sessão.');

  await login('Membro');
  await tab('Eventos');
  await visible('Mural E2E');
  const liked = page.waitForResponse(res => res.url().endsWith(`/mural/${postId}/curtir`) && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Curtir publicação' }).click();
  assert.equal((await liked).status(), 200);
  assert.equal((await pool.query('SELECT * FROM mural_curtidas WHERE post_id=$1 AND usuario_id=$2', [postId, users.Membro])).rowCount, 1);
  await page.getByRole('button', { name: 'Ver comentários' }).click();
  await page.getByPlaceholder('Escreva um comentário...').fill('Comentário E2E');
  const commented = page.waitForResponse(res => res.url().endsWith(`/mural/${postId}/comentarios`) && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Enviar comentário' }).click();
  assert.equal((await commented).status(), 201);
  await visible('Comentário E2E');
  await page.getByRole('button', { name: 'Excluir comentário de Membro' }).click();
  const deleted = page.waitForResponse(res => /\/comentarios\/\d+$/.test(res.url()) && res.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Excluir', exact: true }).click();
  assert.equal((await deleted).status(), 200);
  await page.getByText('Comentário excluído com sucesso.', { exact: true }).waitFor();
  assert.equal((await pool.query('SELECT * FROM mural_comentarios WHERE post_id=$1', [postId])).rowCount, 0);
  await page.goto(`${origin}/perfil`);
  await logout();
  console.log('OK E2E: membro curte, comenta e exclui o próprio comentário no banco real.');

  await login('Admin');
  await page.getByText('Novo Evento', { exact: true }).click();
  await page.getByPlaceholder('Ex: Congresso de Jovens').fill('Evento criado E2E');
  await page.getByText('Selecione a data inicial e final', { exact: true }).click();
  await page.getByText('15', { exact: true }).last().click();
  await page.getByText('Confirmar', { exact: true }).click();
  const created = page.waitForResponse(res => res.url().endsWith('/eventos') && res.request().method() === 'POST');
  await page.getByText('CRIAR EVENTO', { exact: true }).click();
  assert.equal((await created).status(), 201);
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForURL('**/agenda');
  await visible('Evento criado E2E');
  assert.equal((await pool.query("SELECT * FROM eventos WHERE titulo='Evento criado E2E' AND congregacao_id=$1", [congregation])).rowCount, 1);
  await logout();
  console.log('OK E2E: administrador cria evento pela interface e ele aparece na agenda.');

  await login('Master');
  await tab('Perfil');
  await page.getByText('Painel de Gestão', { exact: true }).click();
  await page.getByText('Gestão de Datas', { exact: true }).click();
  await visible('1 evento(s) no planejamento');
  await page.getByText('Publicar na Agenda Geral', { exact: true }).click();
  const published = page.waitForResponse(res => res.url().endsWith('/gestao-datas/publicar') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Verificar e publicar' }).click();
  assert.equal((await published).status(), 200);
  await visible('0 evento(s) no planejamento');
  assert.equal((await pool.query("SELECT * FROM eventos WHERE titulo='Rascunho E2E'", [])).rowCount, 1);
  await page.goto(`${origin}/agenda`);
  await visible('Rascunho E2E');
  await logout();
  console.log('OK E2E: MASTER publica planejamento e evento aparece na agenda.');
} finally {
  await browser?.close();
  if (api && api.exitCode === null && api.signalCode === null) { const closed = once(api, 'exit'); api.kill(); await closed; }
  server.close();
  await pool.end();
}
