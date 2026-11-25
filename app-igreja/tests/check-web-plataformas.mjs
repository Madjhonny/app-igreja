import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const api = 'http://localhost:3000';
const agenda = 'Evento público E2E';
const texto = (page, nome) => page.getByText(nome, { exact: true }).filter({ visible: true });

async function selecionarArquivo(page, acionador, arquivos, simularDialogo) {
  const campo = page.getByTestId('file-input');
  if (simularDialogo) {
    // O Firefox do Playwright cancela o diálogo headless antes de entregar os arquivos.
    // Deixamos o campo real do app receber o arquivo e os eventos DOM pelo Playwright.
    await page.evaluate(() => {
      const clicar = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.dataset.testid === 'file-input') {
          HTMLInputElement.prototype.click = clicar;
          return;
        }
        clicar.call(this);
      };
    });
    await acionador.click();
    if (Array.isArray(arquivos) && !arquivos.length) await campo.dispatchEvent('cancel');
    else await campo.setInputFiles(arquivos);
  } else {
    const [seletor] = await Promise.all([page.waitForEvent('filechooser'), acionador.click()]);
    await seletor.setFiles(arquivos);
  }
  await campo.waitFor({ state: 'detached' });
}

async function esperarImagem(page) {
  try {
    await page.waitForFunction(() => [...document.images].some(i => i.src.startsWith('data:image/jpeg;base64,') &&
      i.naturalWidth > 0 && i.naturalWidth === 2 * i.naturalHeight));
  } catch (erro) {
    const diagnostico = await page.evaluate(() => ({
      texto: document.body.innerText,
      imagens: [...document.images].map(i => ({ largura: i.naturalWidth, altura: i.naturalHeight, tipo: i.src.split(';')[0].slice(0, 25) })),
      eventos: window.eventosSeletorAgenda,
    }));
    throw new Error(`Imagem proporcional indisponível em ${new URL(page.url()).pathname}. ${JSON.stringify(diagnostico)}`, { cause: erro });
  }
}

async function verificarNavegador(page, origem, { login, tab, logout, postId, pool, users }, { simularDialogo, teclado }) {
  await page.addInitScript(() => {
    window.eventosSeletorAgenda = [];
    for (const evento of ['cancel', 'input', 'change']) {
      document.addEventListener(evento, e => {
        if (e.target?.type === 'file') window.eventosSeletorAgenda.push([evento, e.target.files?.length]);
      }, true);
    }
  });
  const { rows: [{ titulo: mural }] } = await pool.query('SELECT titulo FROM mural_eventos WHERE id=$1', [postId]);
  await login('Master', page, { manter: true, teclado });
  await page.reload();
  await texto(page, agenda).waitFor();
  assert.equal(await page.evaluate(() => !!localStorage.getItem('userToken')), true);
  await tab('Eventos', page);
  const card = page.getByTestId(`mural-card-${postId}`);
  await card.getByText(mural, { exact: true }).waitFor();
  const interesse = page.getByTestId(`interesse-feed-${postId}`);
  await page.waitForFunction(id => document.querySelector(`[data-testid="interesse-feed-${id}"]`)?.getAttribute('aria-disabled') !== 'true' &&
    document.querySelector(`[data-testid="interesse-feed-${id}"]`)?.getAttribute('aria-pressed') === 'false', postId);
  await interesse.click();
  await page.waitForFunction(id => document.querySelector(`[data-testid="interesse-feed-${id}"]`)?.getAttribute('aria-pressed') === 'true', postId);
  await page.getByTestId('filtro-interesses').click();
  await card.getByText(mural, { exact: true }).waitFor();
  await card.getByRole('button', { name: `Abrir publicação: ${mural}` }).click();
  const voltar = page.getByTestId(`mural-slide-${postId}`).getByTestId('voltar-fullscreen');
  await voltar.click();
  const [removido] = await Promise.all([
    page.waitForResponse(r => r.url() === `${api}/mural/${postId}/interesse` && r.request().method() === 'DELETE'),
    interesse.click(),
  ]);
  assert.equal(removido.status(), 200);
  await texto(page, 'Você ainda não marcou nenhuma publicação com interesse.').waitFor();
  assert.equal((await pool.query('SELECT 1 FROM mural_interesses WHERE usuario_id=$1 AND post_id=$2', [users.Master, postId])).rowCount, 0);
  await page.getByTestId('filtro-todos').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Nova publicação' }).click();
  await page.waitForURL('**/criar-post');
  const imagem = await page.evaluate(() => {
    const tela = document.createElement('canvas');
    tela.width = 120;
    tela.height = 60;
    const desenho = tela.getContext('2d');
    desenho.fillStyle = '#2A4B4C';
    desenho.fillRect(0, 0, tela.width, tela.height);
    return tela.toDataURL('image/png').split(',')[1];
  });
  const arquivo = { name: 'plataforma.png', mimeType: 'image/png', buffer: Buffer.from(imagem, 'base64') };
  const anexar = texto(page, 'Toque para anexar uma foto');
  await selecionarArquivo(page, anexar, [], simularDialogo);
  await anexar.waitFor();
  await selecionarArquivo(page, anexar, arquivo, simularDialogo);
  await esperarImagem(page);
  await page.goto(origem + '/agenda');
  await texto(page, agenda).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await tab('Perfil', page);
  await page.getByRole('button', { name: 'Editar perfil' }).click();
  await selecionarArquivo(page, page.getByRole('button', { name: 'Escolher foto do perfil' }), arquivo, simularDialogo);
  await esperarImagem(page);
  await page.goto(origem + '/agenda');
  await logout(page);
  await page.goto(origem + '/registro');
  await selecionarArquivo(page, texto(page, 'Adicionar Foto'), arquivo, simularDialogo);
  await esperarImagem(page);
}

async function verificarPwa(contexto, origem, { login, tab, logout, pool, users, postId, diretorio, mudarWorker }) {
  const page = await contexto.newPage();
  page.setDefaultTimeout(15000);
  await login('Master', page, { manter: true });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'));
  const cdp = await contexto.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors, []);
  const manifesto = await page.evaluate(async () => (await fetch('/manifest.json')).json());
  assert.equal(manifesto.display, 'standalone');
  assert.deepEqual(manifesto.icons.map(icon => icon.sizes), ['192x192', '512x512']);
  console.log('OK 16: manifesto e ícones são reconhecidos como instaláveis pelo Chromium.');

  await tab('Perfil', page);
  await texto(page, 'Master').waitFor();
  await contexto.setOffline(true);
  try {
    const offline = await page.goto(origem + '/perfil?teste=sem-exposicao');
    assert.equal(offline.status(), 503);
    assert.equal((await offline.allHeaders())['cache-control'], 'no-store');
    await page.getByRole('heading', { name: 'Você está sem conexão' }).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /Master|teste=sem-exposicao|Mural E2E/);
    assert.deepEqual(await page.evaluate(() => caches.keys()), []);
    await page.screenshot({ path: join(diretorio, 'pwa-offline.png') });
  } finally {
    await contexto.setOffline(false);
  }
  await page.getByRole('link', { name: 'Tentar novamente' }).click();
  await texto(page, agenda).waitFor();
  await tab('Perfil', page);
  await texto(page, 'Master').waitFor();
  await logout(page);
  await login('Admin', page, { manter: true });
  await page.goto(origem + '/perfil');
  await texto(page, 'Admin').waitFor();
  assert.equal(await texto(page, 'Master').count(), 0);
  assert.deepEqual(await page.evaluate(() => caches.keys()), []);
  const interesses = await page.evaluate(async url => {
    const resposta = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('userToken')}` }, cache: 'no-store' });
    return { status: resposta.status, ids: (await resposta.json()).post_ids };
  }, `${api}/mural/interesses`);
  assert.equal(interesses.status, 200);
  const { rows } = await pool.query('SELECT post_id FROM mural_interesses WHERE usuario_id=$1', [users.Admin]);
  assert.deepEqual(interesses.ids.sort(), rows.map(linha => linha.post_id).sort());
  assert.ok(interesses.ids.includes(postId));
  console.log('OK 16: PWA offline mostra aviso genérico, recupera sessão e mantém cache vazio na troca de contas.');

  mudarWorker('16-revisao-b');
  const revisao = await page.evaluate(async () => {
    const anterior = navigator.serviceWorker.controller;
    const registro = await navigator.serviceWorker.ready;
    const novo = new Promise((resolve, reject) => {
      const limite = setTimeout(() => reject(new Error('Worker atualizado não assumiu controle.')), 10000);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        clearTimeout(limite);
        resolve(navigator.serviceWorker.controller);
      }, { once: true });
    });
    const [controller] = await Promise.all([novo, registro.update()]);
    if (!controller || controller === anterior) throw new Error('Controlador não foi substituído.');
    return new Promise((resolve, reject) => {
      const canal = new MessageChannel();
      const limite = setTimeout(() => reject(new Error('Worker atualizado não respondeu.')), 3000);
      canal.port1.onmessage = evento => { clearTimeout(limite); canal.port1.close(); resolve(evento.data); };
      controller.postMessage('revisao-teste', [canal.port2]);
    });
  });
  assert.equal(revisao, '16-revisao-b');
  assert.deepEqual(await page.evaluate(() => caches.keys()), []);
  await page.reload();
  await texto(page, 'Admin').waitFor();
  console.log('OK 16: atualização do Service Worker assume controle, mantém a sessão e não cria caches.');
}

async function tentarInstalacao(origem, prepararContexto) {
  // O Playwright cria o perfil descartável e o limpa ao encerrar o navegador.
  // O teste instala e abre a PWA sem depender da desinstalação pelo Chrome headless.
  const contexto = await chromium.launchPersistentContext('', { channel: 'chrome', headless: true });
  const manifestId = origem + '/';
  try {
    await prepararContexto(contexto);
    const page = await contexto.newPage();
    await page.goto(origem + '/login');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cdp = await contexto.newCDPSession(page);
    try {
      await cdp.send('PWA.install', { manifestId, installUrlOrBundleUrl: origem + '/' });
    } catch (erro) {
      if (!/not supported|wasn't found|disabled|not available/i.test(erro.message)) throw erro;
      return { status: 'indisponível no Chrome headless', detalhe: erro.message };
    }
    await cdp.send('PWA.getOsAppState', { manifestId });
    await cdp.send('PWA.changeAppUserSettings', { manifestId, displayMode: 'standalone' });
    const [janela] = await Promise.all([contexto.waitForEvent('page', { timeout: 10000 }), cdp.send('PWA.launch', { manifestId })]);
    await janela.waitForURL(origem + '/**');
    await janela.waitForLoadState('domcontentloaded');
    await janela.waitForFunction(() => matchMedia('(display-mode: standalone)').matches);
    await janela.close();
    console.log('OK 16: Chrome instala e abre a PWA em modo standalone em perfil isolado.');
    return { status: 'standalone verificado' };
  } finally {
    await contexto.close();
  }
}

export async function verificarPlataformas({ novoContexto, prepararContexto, browser, origin, diretorio, ...fluxo }) {
  await mkdir(diretorio, { recursive: true });
  const navegadores = [];
  const casos = [
    ['Chrome', chromium, { channel: 'chrome' }], ['Edge', chromium, { channel: 'msedge' }],
    ['Firefox', firefox, {}], ['WebKit', webkit, {}],
  ];
  for (const [nome, motor, opcoes] of casos) {
    if (motor !== chromium && !existsSync(motor.executablePath())) {
      navegadores.push({ nome, status: 'binário indisponível' });
      continue;
    }
    let navegador;
    try {
      navegador = await motor.launch({ ...opcoes, timeout: 30000 });
    } catch (erro) {
      if (motor !== firefox || erro.name !== 'TimeoutError') throw erro;
      navegadores.push({ nome, status: 'inicialização indisponível', detalhe: erro.message.split('\n')[0] });
      console.log('INDISPONÍVEL 16: o Firefox não iniciou dentro do limite.');
      continue;
    }
    try {
      const contexto = await novoContexto({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'allow' }, navegador);
      const page = await contexto.newPage();
      page.setDefaultTimeout(15000);
      const falhasDeRede = [];
      page.on('requestfailed', req => falhasDeRede.push({ metodo: req.method(), rota: new URL(req.url()).pathname, erro: req.failure()?.errorText }));
      try {
        await verificarNavegador(page, origin, fluxo, { simularDialogo: motor === firefox, teclado: motor === webkit });
      } catch (erro) {
        await writeFile(join(diretorio, `${nome.toLowerCase()}-falha.json`), JSON.stringify({
          rota: new URL(page.url()).pathname, texto: await page.locator('body').innerText(), falhasDeRede,
        }, null, 2));
        throw erro;
      }
      await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'));
      navegadores.push({ nome, versao: navegador.version(), status: 'aprovado', serviceWorker: 'ativo',
        selecao: motor === firefox ? 'arquivo inserido no input; diálogo do sistema simulado' : 'filechooser do Playwright' });
      console.log(`OK 16: ${nome} em desktop e viewport móvel, com sessão, rotas, interesses, imagens e Service Worker.`);
    } finally {
      await navegador.close();
    }
  }
  const contexto = await novoContexto({ serviceWorkers: 'allow' }, browser);
  try { await verificarPwa(contexto, origin, { ...fluxo, diretorio }); }
  finally { await contexto.close(); fluxo.mudarWorker(undefined); }
  const instalacao = await tentarInstalacao(origin, prepararContexto);
  await writeFile(join(diretorio, 'resultados.json'), JSON.stringify({ navegadores, instalacao }, null, 2));
}
