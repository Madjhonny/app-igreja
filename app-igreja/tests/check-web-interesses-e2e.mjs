import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { verificarResponsividade } from './check-web-responsividade.mjs';
import { criarMonitorJavaScript, verificarHidratacao } from './check-web-hidratacao.mjs';
import { verificarAcessibilidade } from './check-web-acessibilidade.mjs';
import { verificarPerfis } from './check-web-perfis.mjs';
import { verificarPlataformas } from './check-web-plataformas.mjs';

const require = createRequire(new URL('../../api-igreja/package.json', import.meta.url));
const { validarBancoLocal } = require('./scripts/banco-local-de-teste');
const db = validarBancoLocal(process.env.WEB_TEST_DATABASE_URL, 'agenda_web_test');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const schema = `web_interesses_${randomBytes(8).toString('hex')}`;

const pool = new Pool({
  connectionString: db.href,
  options: `-c search_path=${schema}`,
});

const tempDir = await mkdtemp(join(tmpdir(), 'agenda-web-test-'));
const root = resolve(process.argv[2]);
const diretorioArtefatos = resolve(process.argv[3] ?? 'dist/artefatos-teste/13.15');
const monitorJavaScript = criarMonitorJavaScript();
let revisaoWorker;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, `.${path === '/' ? '/index.html' : extname(path) ? path : `${path}.html`}`);
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    if (path === '/sw.js' && revisaoWorker) {
      body = `${body}\nself.addEventListener('message', event => {\n` +
        `  if (event.data === 'revisao-teste') event.ports[0].postMessage(${JSON.stringify(revisaoWorker)});\n});\n`;
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
let api, browser, erroCenario;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const database = await pool.query('SELECT current_database() AS nome');
  assert.equal(database.rows[0].nome, 'agenda_web_test');

  await pool.query(`CREATE SCHEMA "${schema}"`);

  for (const name of [
    '001_initial_schema.sql',
    '003_password_recovery.sql',
    '20261120_push_notifications.sql',
    '20261124_mural_interesses.sql'
  ]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await readFile(
        new URL(`../../api-igreja/migrations/${name}`, import.meta.url),
        'utf8'
      ));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const congregation = (await pool.query("INSERT INTO congregacoes(nome) VALUES ('Sede E2E') RETURNING id")).rows[0].id;
  const password = 'TesteWeb123!';
  const hash = await bcrypt.hash(password, 4);
  const users = {};
  for (const [name, role, status, cpf] of [['Membro', 'MEMBRO', 'APROVADO', '30000000001'], ['Pendente', 'MEMBRO', 'PENDENTE', '30000000002'], ['Admin', 'ADMIN', 'APROVADO', '30000000003'], ['Master', 'MASTER', 'APROVADO', '30000000004']]) {
    users[name] = (await pool.query(`INSERT INTO usuarios(nome_completo,nome_exibicao,email,senha_hash,congregacao_id,cpf,nivel_acesso,status_conta)
      VALUES($1,$1,$2,$3,$4,$5,$6,$7) RETURNING id`, [name, `${name.toLowerCase()}@example.test`, hash, congregation, cpf, role, status])).rows[0].id;
  }
  const hoje = new Date();
  const month = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const date = day => `${month}-${day}`;
  await pool.query("INSERT INTO eventos(titulo,data_inicio,data_fim,horario,congregacao_id,criado_por_usuario_id) VALUES('Evento público E2E',$1,$1,'10:00',$2,$3)", [date('10'), congregation, users.Master]);
  await pool.query("INSERT INTO gestao_datas_rascunho(master_id,titulo,data_inicio,data_fim,horario,congregacao_id) VALUES($1,'Rascunho E2E',$2,$2,'11:00',$3)", [users.Master, date('20'), congregation]);
  const imagem = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=';
  const criarPublicacao = async (titulo, congregacaoId, diasAteInicio, horasDesdeCriacao) => {
    const resultado = await pool.query(
      `INSERT INTO mural_eventos(usuario_id,congregacao_id,titulo,tipo_midia,midia,data_inicio,data_fim,criado_em)
       VALUES($1,$2,$3,'imagem',$4,CURRENT_DATE+$5::integer,CURRENT_DATE+30,
         CURRENT_TIMESTAMP - make_interval(hours => $6)) RETURNING id`,
      [users.Master, congregacaoId, titulo, imagem, diasAteInicio, horasDesdeCriacao]
    );
    return resultado.rows[0].id;
  };
  const tituloOriginal = 'Mural E2E';
  const postId = await criarPublicacao(tituloOriginal, congregation, 0, 3);
  // Sem segredos herdados e sem chamadas HTTP externas do backend.
  const bootstrap = `
    global.fetch = async () => {
      throw Error('Rede externa bloqueada');
    };

    const pg = require(process.argv[2]);
    const OriginalPool = pg.Pool;

    pg.Pool = class extends OriginalPool {
      constructor(config) {
        super({
          ...config,
          options: '-c search_path=' + process.argv[3]
        });
      }
    };

    require(process.argv[1]);
  `;

  api = spawn(process.execPath, [
    '-e',
    bootstrap,
    fileURLToPath(new URL('../../api-igreja/server.js', import.meta.url)),
    require.resolve('pg'),
    schema
  ], {
    cwd: tempDir,
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
  const prepararContexto = async contexto => {
    monitorJavaScript.acompanhar(contexto);
    // O service worker da PWA só processa navegações na origem local.
    await contexto.route('**/*', route => {
      const url = new URL(route.request().url());
      return [origin, 'http://localhost:3000'].includes(url.origin) || ['data:', 'blob:'].includes(url.protocol)
        ? route.continue()
        : route.abort();
    });
    return contexto;
  };
  const novoContexto = async (options, navegador = browser) => prepararContexto(await navegador.newContext({
    serviceWorkers: 'block', viewport: { width: 390, height: 844 }, ...options,
  }));
  const context = await novoContexto();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  page.on('response', response => {
    const url = new URL(response.url());

    if (
      url.origin === 'http://localhost:3000' &&
      (
        url.pathname === '/sessao' ||
        url.pathname.includes('/interesse')
      )
    ) {
      console.log(
        'DIAGNOSTICO API:',
        response.request().method(),
        url.pathname,
        response.status()
      );
    }
  });

  const visible = (text, alvo = page) => alvo.getByText(text, { exact: true }).waitFor();
  const tab = (name, alvo = page) => alvo.getByLabel(name, { exact: true }).click();
  const login = async (name, alvo = page, { manter = false, teclado = false } = {}) => {
    await alvo.goto(`${origin}/login`);
    await alvo.waitForFunction(() => {
      const botao = document.querySelector('button[aria-label="Entrar"]');
      return botao && !botao.disabled && botao.getAttribute('aria-disabled') !== 'true';
    });
    const campos = [['E-mail', `${name.toLowerCase()}@example.test`], ['Senha', password]];
    for (const [nome, valor] of campos) {
      const campo = alvo.getByLabel(nome, { exact: true });
      if (teclado) await campo.pressSequentially(valor);
      else await campo.fill(valor);
    }
    if (manter) await alvo.getByLabel('Manter conectado', { exact: true }).click();
    const response = alvo.waitForResponse(res => res.url().endsWith('/login') && res.request().method() === 'POST');
    await alvo.getByRole('button', { name: 'Entrar', exact: true }).click();
    assert.equal((await response).status(), 200);
    await alvo.waitForURL('**/agenda');
    await visible('Evento público E2E', alvo);
  };
  const logout = async (alvo = page) => {
    await tab('Perfil', alvo);
    await alvo.getByRole('button', { name: 'Desconectar da conta' }).click();
    await alvo.getByRole('button', { name: 'Sair', exact: true }).click();
    await alvo.waitForURL('**/login');
    await alvo.getByLabel('E-mail', { exact: true }).waitFor();
    assert.equal(await alvo.evaluate(() => localStorage.getItem('userToken') === null), true);
  };
  const marcador = (id = postId, alvo = page) => alvo.getByTestId(`interesse-feed-${id}`);
  const filtroInteresses = (alvo = page) => alvo.getByTestId('filtro-interesses');

  const verificarBanco = async (usuario, esperado, id = postId) => {
    const resultado = await pool.query(
      'SELECT post_id FROM mural_interesses WHERE usuario_id=$1 AND post_id=$2',
      [users[usuario], id]
    );
    assert.equal(resultado.rowCount, esperado ? 1 : 0);
  };

  const verificarMarcador = async (marcado, id = postId, estado = 'pronto', alvo = page) => {
    await marcador(id, alvo).waitFor({ state: 'visible' });

    await alvo.waitForFunction(({ id, selecionado, estado }) => {
      const elemento = document.querySelector(
        `[data-testid="interesse-feed-${id}"]`
      );

      if (!elemento || elemento.getAttribute('aria-label') !== 'Interesse na publicação' ||
        elemento.getAttribute('aria-pressed') !== String(selecionado)) return false;
      const desabilitado = elemento.disabled || elemento.getAttribute('aria-disabled') === 'true';
      const ocupado = elemento.getAttribute('aria-busy') === 'true';
      return (estado !== 'pronto') === Boolean(desabilitado) && (estado === 'pendente') === ocupado;
    }, { id, selecionado: marcado, estado });
  };

  const alterarInteresse = async (usuario, marcado, id = postId, alvo = page) => {
    await verificarMarcador(!marcado, id, 'pronto', alvo);

    const resposta = alvo.waitForResponse(res =>
      res.url().endsWith(`/mural/${id}/interesse`) &&
      res.request().method() === (marcado ? 'PUT' : 'DELETE')
    );

    await marcador(id, alvo).click();

    assert.equal((await resposta).status(), 200);
    await verificarMarcador(marcado, id, 'pronto', alvo);
    await verificarBanco(usuario, marcado, id);
  };

  await page.goto(`${origin}/login`);
  await page.getByRole('button', { name: 'Entrar como convidado' }).click();
  await page.waitForURL('**/agenda');
  await visible('Evento público E2E');
  assert.equal(await page.getByText('Novo Evento', { exact: true }).count(), 0);
  await tab('Eventos');
  await visible('Mural E2E');
  assert.equal(await page.getByRole('button', { name: 'Curtir publicação' }).count(), 0);
  await page.getByLabel('Ver comentários', { exact: true }).click();
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
  await page.getByLabel('Ver comentários', { exact: true }).click();
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
  const armazenamentoMaster = await context.storageState();
  await tab('Perfil');
  await page.getByText('Painel de Gestão', { exact: true }).click();
  await page.getByText('Gestão de Datas', { exact: true }).click();
  await visible('1 evento(s) no planejamento');
  await page.reload();
  await visible('1 evento(s) no planejamento');
  await page.getByText('Publicar na Agenda Geral', { exact: true }).click();
  const published = page.waitForResponse(res => res.url().endsWith('/gestao-datas/publicar') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Verificar e publicar' }).click();
  assert.equal((await published).status(), 200);
  await visible('0 evento(s) no planejamento');
  assert.equal((await pool.query("SELECT * FROM eventos WHERE titulo='Rascunho E2E'", [])).rowCount, 1);
  await page.goto(`${origin}/agenda`);
  await visible('Rascunho E2E');
  await page.reload();
  await visible('Rascunho E2E');
  await logout();
  console.log('OK E2E: MASTER publica planejamento e evento aparece na agenda.');

  // Interesses: permissoes, persistencia e privacidade.
  await page.goto(`${origin}/login`);
  await page.getByRole('button', { name: 'Entrar como convidado' }).click();
  await page.waitForURL('**/agenda');
  await tab('Eventos');
  await visible('Mural E2E');

  assert.equal(await marcador().count(), 0);
  assert.equal(await filtroInteresses().count(), 0);

  await tab('Perfil');
  await page.getByRole('button', { name: 'Entrar na minha conta' }).click();
  await page.waitForURL('**/login');

  console.log('OK INTERESSES: convidado sem acesso.');

  await login('Pendente');
  await tab('Eventos');
  await visible('Mural E2E');

  assert.equal(await marcador().count(), 0);
  assert.equal(await filtroInteresses().count(), 0);

  await logout();

  console.log('OK INTERESSES: pendente sem acesso.');

  for (const usuario of ['Master', 'Admin', 'Membro']) {
    await login(usuario);
    await tab('Eventos');
    await visible('Mural E2E');

    await verificarMarcador(false);
    await verificarBanco(usuario, false);

    await alterarInteresse(usuario, true);

    await filtroInteresses().click();
    await visible('Mural E2E');

    await logout();

    await login(usuario);
    await tab('Eventos');
    await visible('Mural E2E');
    await verificarMarcador(true);
    await verificarBanco(usuario, true);

    await logout();

    console.log(`OK INTERESSES: ${usuario} marca e preserva interesse apos novo login.`);
  }

  // Cada conta possui seu proprio registro.
  const registros = await pool.query(
    'SELECT usuario_id FROM mural_interesses WHERE post_id=$1',
    [postId]
  );

  assert.deepEqual(
    registros.rows.map(row => row.usuario_id).sort((a,b) => a-b),
    [users.Master, users.Admin, users.Membro].sort((a,b) => a-b)
  );

  await login('Membro');
  await tab('Eventos');
  await visible('Mural E2E');
  await alterarInteresse('Membro', false);

  await filtroInteresses().click();
  await visible('Você ainda não marcou nenhuma publicação com interesse.');

  await verificarBanco('Master', true);
  await verificarBanco('Admin', true);
  await verificarBanco('Membro', false);

  await logout();

  console.log('OK INTERESSES: remocao individual, filtro vazio e privacidade entre contas.');

  for (const usuario of ['Master', 'Admin']) {
    await login(usuario);
    await tab('Eventos');
    await visible('Mural E2E');
    await alterarInteresse(usuario, false);
    await logout();

    console.log(`OK INTERESSES: ${usuario} remove interesse.`);
  }

  const restantes = await pool.query(
    'SELECT post_id FROM mural_interesses WHERE post_id=$1',
    [postId]
  );

  assert.equal(restantes.rowCount, 0);

  console.log('OK INTERESSES: todos os registros removidos corretamente.');

  // Sincronizacao entre feed e fullscreen.
  await login('Membro');
  await tab('Eventos');
  await visible('Mural E2E');

  const marcadorFullscreen = (id = postId, alvo = page) =>
    alvo.getByTestId(`interesse-fullscreen-${id}`);

  const abrirFullscreen = async (titulo = tituloOriginal, id = postId, alvo = page) => {
    await alvo.getByRole('button', {
      name: `Ampliar publicação: ${titulo}`,
      exact: true
    }).click();

    await marcadorFullscreen(id, alvo).waitFor({ state: 'visible' });
  };

  const verificarFullscreen = async (marcado, id = postId, alvo = page) => {
    await alvo.waitForFunction(({ id, marcado }) => {
      const elemento = document.querySelector(
        `[data-testid="interesse-fullscreen-${id}"]`
      );

      return elemento &&
        elemento.getAttribute('aria-label') === 'Interesse na publicação' &&
        elemento.getAttribute('aria-pressed') === String(marcado) &&
        elemento.getAttribute('aria-disabled') !== 'true' &&
        elemento.getAttribute('aria-busy') !== 'true' &&
        !elemento.disabled;
    }, { id, marcado });
  };

  const alterarFullscreen = async (marcado, id = postId) => {
    await verificarFullscreen(!marcado, id);

    const resposta = page.waitForResponse(res =>
      res.url().endsWith(`/mural/${id}/interesse`) &&
      res.request().method() === (marcado ? 'PUT' : 'DELETE')
    );

    await marcadorFullscreen(id).click();

    assert.equal((await resposta).status(), 200);
    await verificarBanco('Membro', marcado, id);
  };

  // Marcar no feed e verificar no fullscreen.
  await alterarInteresse('Membro', true);
  await abrirFullscreen();
  await verificarFullscreen(true);

  console.log('OK FULLSCREEN: interesse marcado no feed aparece no fullscreen.');

  // Remover no fullscreen e verificar no feed.
  await alterarFullscreen(false);
  await verificarFullscreen(false);
  await page.getByTestId('voltar-fullscreen').click();
  await verificarMarcador(false);

  console.log('OK FULLSCREEN: remocao sincronizada com o feed.');

  // Marcar no fullscreen e verificar no feed.
  await abrirFullscreen();
  await alterarFullscreen(true);
  await verificarFullscreen(true);
  await page.getByTestId('voltar-fullscreen').click();
  await verificarMarcador(true);

  console.log('OK FULLSCREEN: interesse marcado no fullscreen aparece no feed.');

  // Remover pelo fullscreen com filtro de interesses ativo.
  await filtroInteresses().click();
  await visible('Mural E2E');
  await abrirFullscreen();
  await alterarFullscreen(false);

  await marcadorFullscreen().waitFor({ state: 'hidden' });

  await visible(
    'Você ainda não marcou nenhuma publicação com interesse.'
  );

  assert.equal(await marcador().count(), 0);
  await verificarBanco('Membro', false);

  console.log('OK FULLSCREEN: remocao no filtro fecha fullscreen e atualiza lista.');

  await logout();

  // A publicação original mantém os cenários acima com um único card.
  const outraCongregacao = (await pool.query(
    "INSERT INTO congregacoes(nome) VALUES ('Outra congregação E2E') RETURNING id"
  )).rows[0].id;
  const tituloCongregacao = 'Mural da congregação E2E';
  const tituloExterno = 'Mural de outra congregação E2E';
  // Mesmo dia de início: o post externo mais recente deve vir primeiro.
  const congregacaoPostId = await criarPublicacao(tituloCongregacao, congregation, 1, 2);
  const externoPostId = await criarPublicacao(tituloExterno, outraCongregacao, 1, 1);

  const verificarFeedNo = async (alvo, ...ids) => {
    const marcadores = alvo.getByTestId(/^interesse-feed-\d+$/);
    await alvo.waitForFunction(esperados => {
      const atuais = Array.from(
        document.querySelectorAll('[data-testid^="interesse-feed-"]'),
        elemento => elemento.getAttribute('data-testid')
      );
      return JSON.stringify(atuais) === JSON.stringify(esperados);
    }, ids.map(id => `interesse-feed-${id}`)).catch(async error => {
      const atuais = await marcadores.evaluateAll(elementos =>
        elementos.map(elemento => elemento.getAttribute('data-testid'))
      );
      throw new Error(`Esperava o feed [${ids}]. Marcadores encontrados: [${atuais}].`, { cause: error });
    });
  };
  const verificarFeed = (...ids) => verificarFeedNo(page, ...ids);

  const verificarRegistros = async (...ids) => {
    const { rows } = await pool.query(
      'SELECT usuario_id, post_id FROM mural_interesses ORDER BY post_id'
    );
    assert.deepEqual(rows, ids.sort((a, b) => a - b).map(id => ({
      usuario_id: users.Membro,
      post_id: id,
    })));
  };

  const verificarSlideNaTela = async id => {
    await page.waitForFunction(id => {
      const marcador = document.querySelector(`[data-testid="interesse-fullscreen-${id}"]`);
      if (!marcador) return false;

      const slide = marcador.closest(`[data-testid="mural-slide-${id}"]`);
      const quadro = slide?.getBoundingClientRect();
      if (!quadro || Math.abs(quadro.top) > 1 || Math.abs(quadro.bottom - innerHeight) > 1) return false;

      const { x, y, width, height } = marcador.getBoundingClientRect();
      const elementoNaTela = document.elementFromPoint(x + width / 2, y + height / 2);
      return marcador.contains(elementoNaTela);
    }, id).catch(async error => {
      const slides = await page.getByTestId(/^mural-slide-/).evaluateAll(elementos => elementos.map(slide => {
        const { top, bottom } = slide.getBoundingClientRect();
        return { slide: slide.getAttribute('data-testid'), top, bottom };
      }));
      throw new Error(`Slide esperado ${id}. Posições: ${JSON.stringify(slides)}`, { cause: error });
    });
    await verificarFullscreen(true, id);
  };

  await login('Membro');
  await tab('Eventos');
  await verificarFeed(postId, externoPostId, congregacaoPostId);
  await verificarRegistros();
  console.log('OK 13.10: Todos exibe as três publicações na ordem do mural.');

  await alterarInteresse('Membro', true, externoPostId);
  await filtroInteresses().click();
  await verificarFeed(externoPostId);
  await verificarRegistros(externoPostId);
  console.log('OK 13.10: Interesses exibe exclusivamente a publicação marcada.');

  const filtroTodos = page.getByText('Todos', { exact: true });
  const filtroCongregacao = page.getByText('Minha congregação', { exact: true });
  await filtroCongregacao.click();
  await verificarFeed(postId, congregacaoPostId);
  await alterarInteresse('Membro', true, congregacaoPostId);
  await filtroTodos.click();
  await verificarFeed(postId, externoPostId, congregacaoPostId);
  await filtroInteresses().click();
  // Marcar depois não muda a ordem em que o feed exibe as publicações.
  await verificarFeed(externoPostId, congregacaoPostId);
  await verificarRegistros(externoPostId, congregacaoPostId);
  console.log('OK 13.10: alternância entre os três filtros e ordem após a segunda marcação.');

  await abrirFullscreen(tituloCongregacao, congregacaoPostId);
  await page.getByLabel('Eventos', { exact: true }).waitFor({ state: 'hidden' });
  await verificarSlideNaTela(congregacaoPostId);
  const { width, height } = page.viewportSize();
  await page.mouse.move(width / 2, height / 2);
  await page.mouse.wheel(0, -height);
  await verificarSlideNaTela(externoPostId);
  await page.mouse.wheel(0, height);
  await verificarSlideNaTela(congregacaoPostId);
  console.log('OK 13.10: fullscreen abre na segunda publicação e navega nos dois sentidos.');

  await alterarFullscreen(false, congregacaoPostId);
  await verificarFeed(externoPostId);
  await verificarMarcador(true, externoPostId);
  await verificarRegistros(externoPostId);
  await filtroTodos.click();
  await verificarFeed(postId, externoPostId, congregacaoPostId);
  await verificarMarcador(false, postId);
  await verificarMarcador(false, congregacaoPostId);
  await verificarMarcador(true, externoPostId);
  console.log('OK 13.10: remoção no fullscreen preserva o outro interesse no feed e no PostgreSQL.');

  const apiLocal = 'http://localhost:3000';
  const rotaLista = `${apiLocal}/mural/interesses`;
  const rotaInteresse = id => `${apiLocal}/mural/${id}/interesse`;
  const atualizarInteresses = () => page.getByRole('button', { name: 'Atualizar interesses' });
  const erroAlteracao = 'Não foi possível confirmar a alteração. Toque para atualizar.';
  const erroReconciliacao = 'Atualize seus interesses antes de tentar novamente. Toque para atualizar.';
  const requisicaoInteresse = (id, metodo) => request =>
    request.url() === rotaInteresse(id) && request.method() === metodo;
  const responder500 = route => route.fulfill({
    status: 500,
    json: { erro: 'Falha simulada' },
    headers: { 'access-control-allow-origin': origin },
  });
  const esperarLista = (alvo = page) => alvo.waitForResponse(res =>
    res.url() === rotaLista && res.request().method() === 'GET' && res.status() === 200
  );
  const aguardar = async (promise, descricao) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Tempo esgotado: ${descricao}`)), 15000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  // A rota fica pendente até o teste liberar a resposta ou encerrar a sessão.
  const suspender = async (url, metodo, tratar, alvo = page) => {
    const recebida = Promise.withResolvers();
    const liberar = Promise.withResolvers();
    const finalizada = Promise.withResolvers();
    let total = 0;
    const handler = async route => {
      if (route.request().method() !== metodo) return route.fallback();
      total++;
      recebida.resolve();
      await liberar.promise;
      try {
        await tratar(route);
        finalizada.resolve();
      } catch (error) {
        finalizada.resolve(error);
      }
    };
    await alvo.route(url, handler);
    return {
      recebida: () => aguardar(recebida.promise, `${metodo} ${url} chegar ao Playwright`),
      async concluir() {
        liberar.resolve();
        const erro = await aguardar(finalizada.promise, `concluir ${metodo} ${url}`);
        await alvo.unroute(url, handler);
        if (erro) throw erro;
        assert.equal(total, 1, `${metodo} ${url} deve ser enviado uma única vez`);
      },
    };
  };

  // PUT falha antes de alcançar o servidor. Retenha o GET para observar a reversão.
  const mutacoes = [];
  const registrarMutacao = request => {
    if (/\/mural\/\d+\/interesse$/.test(request.url()) && ['PUT', 'DELETE'].includes(request.method())) {
      mutacoes.push([request.method(), request.url()]);
    }
  };
  page.on('request', registrarMutacao);
  const putOffline = await suspender(rotaInteresse(postId), 'PUT', route => route.abort('internetdisconnected'));
  const listaPendente = await suspender(rotaLista, 'GET', route => route.continue());
  await marcador().click();
  await putOffline.recebida();
  await verificarMarcador(true, postId, 'pendente');
  assert.equal(await marcador(externoPostId).getAttribute('aria-disabled'), 'true');
  await marcador().dispatchEvent('click');
  await marcador(externoPostId).dispatchEvent('click');
  await filtroInteresses().click();
  await verificarFeed(postId, externoPostId);
  await putOffline.concluir();
  await listaPendente.recebida();
  await verificarFeed(externoPostId);
  await verificarRegistros(externoPostId);
  const listaReconciliada = esperarLista();
  await listaPendente.concluir();
  await listaReconciliada;
  await visible(erroAlteracao);
  await filtroTodos.click();
  await verificarMarcador(false);
  await verificarMarcador(true, externoPostId);
  await verificarMarcador(false, congregacaoPostId);
  assert.deepEqual(mutacoes, [['PUT', rotaInteresse(postId)]]);
  console.log('OK 13.11: PUT sem conexão reverte o filtro e rejeita cliques rápidos e concorrentes.');

  // DELETE falha offline e as duas tentativas de leitura também falham.
  let leiturasOffline = 0;
  const abortarLista = route => {
    if (route.request().method() !== 'GET') return route.fallback();
    leiturasOffline++;
    return route.abort('internetdisconnected');
  };
  const deleteOffline = await suspender(rotaInteresse(externoPostId), 'DELETE', route => route.abort('internetdisconnected'));
  await page.route(rotaLista, abortarLista);
  await abrirFullscreen(tituloExterno, externoPostId);
  await marcadorFullscreen(externoPostId).click();
  await deleteOffline.recebida();
  await page.waitForFunction(id => document.querySelector(
    `[data-testid="interesse-fullscreen-${id}"][aria-pressed="false"][aria-busy="true"]`
  ) !== null, externoPostId);
  await deleteOffline.concluir();
  await visible(erroReconciliacao);
  assert.equal(leiturasOffline, 2);
  assert.equal(await marcadorFullscreen(externoPostId).getAttribute('aria-pressed'), 'true');
  assert.equal(await marcadorFullscreen(externoPostId).getAttribute('aria-disabled'), 'true');
  await verificarRegistros(externoPostId);

  await page.unroute(rotaLista, abortarLista);
  const leituraRecuperada = esperarLista();
  await atualizarInteresses().click();
  await leituraRecuperada;
  await verificarFullscreen(true, externoPostId);
  await atualizarInteresses().waitFor({ state: 'hidden' });
  await page.getByTestId('voltar-fullscreen').filter({ visible: true }).and(
    marcadorFullscreen(externoPostId).locator('../..').getByTestId('voltar-fullscreen')
  ).click();
  await filtroInteresses().click();
  await verificarFeed(externoPostId);
  await verificarRegistros(externoPostId);
  console.log('OK 13.11: DELETE offline reverte no fullscreen e se recupera quando a conexão retorna.');

  // O 500 chega ao navegador sem alterar o banco.
  const delete500 = await suspender(rotaInteresse(externoPostId), 'DELETE', responder500);
  const resposta500 = page.waitForResponse(res => requisicaoInteresse(externoPostId, 'DELETE')(res.request()));
  await abrirFullscreen(tituloExterno, externoPostId);
  await marcadorFullscreen(externoPostId).click();
  await delete500.recebida();
  await filtroInteresses().waitFor({ state: 'visible' });
  await verificarFeed();
  await delete500.concluir();
  assert.equal((await resposta500).status(), 500);
  await verificarFeed(externoPostId);
  await verificarMarcador(true, externoPostId);
  await visible(erroAlteracao);
  await verificarRegistros(externoPostId);
  console.log('OK 13.11: HTTP 500 restaura o interesse no filtro após remoção pelo fullscreen.');

  // O Express grava o interesse, mas o Chromium perde a resposta.
  await filtroTodos.click();
  const respostaPerdida = await suspender(rotaInteresse(postId), 'PUT', async route => {
    const resposta = await route.fetch({ maxRetries: 0 });
    assert.equal(resposta.status(), 200);
    await verificarRegistros(postId, externoPostId);
    await route.abort('connectionreset');
  });
  await marcador().click();
  await respostaPerdida.recebida();
  await verificarMarcador(true, postId, 'pendente');
  const confirmacao = esperarLista();
  await respostaPerdida.concluir();
  await confirmacao;
  await verificarMarcador(true);
  await atualizarInteresses().waitFor({ state: 'hidden' });
  await filtroInteresses().click();
  await verificarFeed(postId, externoPostId);
  await verificarRegistros(postId, externoPostId);
  console.log('OK 13.11: resposta perdida é reconciliada com a gravação real, sem repetir a mutação.');

  // Mantém a conexão aberta até o temporizador real de escrita cancelar o fetch.
  const timeout = await suspender(rotaInteresse(postId), 'DELETE', route => route.abort('aborted'));
  const [cancelada] = await Promise.all([
    page.waitForEvent('requestfailed', { predicate: requisicaoInteresse(postId, 'DELETE'), timeout: 75000 }),
    (async () => {
      await marcador().click();
      await timeout.recebida();
      await verificarFeed(externoPostId);
    })(),
  ]);
  assert.equal(cancelada.failure()?.errorText, 'net::ERR_ABORTED');
  await timeout.concluir();
  await verificarFeed(postId, externoPostId);
  await verificarMarcador(true);
  await verificarRegistros(postId, externoPostId);
  console.log('OK 13.11: timeout cancela a escrita pendente e restaura o filtro a partir do PostgreSQL.');

  // A sessão do membro termina com a resposta de uma gravação ainda pendente.
  const gravada = Promise.withResolvers();
  const entregar = Promise.withResolvers();
  const respostaEntregue = Promise.withResolvers();
  const respostaAntiga = async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const resposta = await route.fetch({ maxRetries: 0 });
    gravada.resolve(resposta.status());
    await entregar.promise;
    await route.fulfill({ response: resposta });
    respostaEntregue.resolve();
  };
  await page.route(rotaInteresse(congregacaoPostId), respostaAntiga);
  await filtroTodos.click();
  const canceladaNoLogout = page.waitForEvent('requestfailed', {
    predicate: requisicaoInteresse(congregacaoPostId, 'PUT'),
  });
  await marcador(congregacaoPostId).click();
  assert.equal(await aguardar(gravada.promise, 'gravar interesse antes do logout'), 200);
  await verificarMarcador(true, congregacaoPostId, 'pendente');
  await verificarRegistros(postId, externoPostId, congregacaoPostId);
  await logout();
  assert.equal((await canceladaNoLogout).failure()?.errorText, 'net::ERR_ABORTED');

  // O novo usuário começa com erro de consulta e tenta novamente com o próprio token.
  const falhaInicial = await suspender(rotaLista, 'GET', responder500);
  await login('Admin');
  await tab('Eventos');
  await falhaInicial.recebida();
  entregar.resolve();
  await aguardar(respostaEntregue.promise, 'entregar a resposta da sessão encerrada');
  await page.unroute(rotaInteresse(congregacaoPostId), respostaAntiga);
  await falhaInicial.concluir();
  await visible('Não foi possível consultar seus interesses. Toque para atualizar.');
  await verificarMarcador(false, congregacaoPostId, 'bloqueado');
  await filtroInteresses().click();
  await visible('Não foi possível carregar seus interesses.');
  await verificarFeed();
  const leituraAdmin = esperarLista();
  await atualizarInteresses().click();
  assert.deepEqual(await (await leituraAdmin).json(), { post_ids: [] });
  await visible('Você ainda não marcou nenhuma publicação com interesse.');
  await filtroTodos.click();
  await verificarMarcador(false);
  await verificarMarcador(false, externoPostId);
  await verificarMarcador(false, congregacaoPostId);
  await verificarRegistros(postId, externoPostId, congregacaoPostId);
  await logout();
  assert.deepEqual(mutacoes, [
    ['PUT', rotaInteresse(postId)],
    ['DELETE', rotaInteresse(externoPostId)],
    ['DELETE', rotaInteresse(externoPostId)],
    ['PUT', rotaInteresse(postId)],
    ['DELETE', rotaInteresse(postId)],
    ['PUT', rotaInteresse(congregacaoPostId)],
  ]);
  page.off('request', registrarMutacao);
  console.log('OK 13.11: logout cancela a requisição e preserva o registro na conta original.');
  console.log('OK 13.11: falha inicial permite nova consulta privada, sem revelar interesses ao ADMIN.');

  await pool.query('DELETE FROM mural_interesses WHERE usuario_id = $1', [users.Membro]);
  await verificarRegistros();
  const contextoB = await novoContexto({ serviceWorkers: 'allow', viewport: { width: 1280, height: 800 } });
  const paginaB = await contextoB.newPage();
  paginaB.setDefaultTimeout(15000);
  const botaoSincronizar = alvo => alvo.getByRole('button', { name: 'Sincronizar interesses', exact: true });
  const contarConsultas = alvo => {
    let total = 0;
    alvo.on('request', request => {
      if (request.url() === rotaLista && request.method() === 'GET') total++;
    });
    return () => total;
  };
  const consultasA = contarConsultas(page);
  const consultasB = contarConsultas(paginaB);
  const verificarTotalConsultas = async (consultas, esperado) => {
    // Observa eventos agrupados e possíveis consultas extras após a resposta.
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(consultas(), esperado, 'Quantidade de consultas de interesses');
  };
  const simularDocumento = async (alvo, visibilidade) => {
    await alvo.evaluate(estado => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: estado });
      document.dispatchEvent(new Event('visibilitychange'));
      if (estado === 'visible') {
        window.dispatchEvent(new Event('focus'));
        delete document.visibilityState;
      }
    }, visibilidade);
  };

  await login('Membro');
  assert.deepEqual((await contextoB.storageState()).origins, []);
  await login('Membro', paginaB);
  await paginaB.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'));
  await Promise.all([tab('Eventos'), tab('Eventos', paginaB)]);
  await Promise.all([verificarMarcador(false), verificarMarcador(false, postId, 'pronto', paginaB)]);
  await Promise.all([verificarTotalConsultas(consultasA, 1), verificarTotalConsultas(consultasB, 1)]);
  console.log('OK 13.12: dois contextos autenticam a mesma conta, com uma leitura inicial em cada e service worker ativo em B.');

  await alterarInteresse('Membro', true);
  await verificarRegistros(postId);
  assert.equal(await marcador(postId, paginaB).getAttribute('aria-pressed'), 'false');
  const manualB = esperarLista(paginaB);
  await botaoSincronizar(paginaB).click();
  assert.deepEqual(await (await manualB).json(), { post_ids: [postId] });
  await verificarMarcador(true, postId, 'pronto', paginaB);
  await filtroInteresses(paginaB).click();
  await verificarFeedNo(paginaB, postId);
  await verificarTotalConsultas(consultasB, 2);
  console.log('OK 13.12: B recupera pela atualização manual o interesse que A gravou no PostgreSQL.');

  await tab('Agenda');
  await page.waitForURL('**/agenda');
  const consultasAntesDeVoltar = consultasA();
  const remocaoB = paginaB.waitForResponse(res => requisicaoInteresse(postId, 'DELETE')(res.request()));
  await marcador(postId, paginaB).click();
  assert.equal((await remocaoB).status(), 200);
  await visible('Você ainda não marcou nenhuma publicação com interesse.', paginaB);
  await verificarFeedNo(paginaB);
  await verificarRegistros();
  await verificarTotalConsultas(consultasA, consultasAntesDeVoltar);
  const retornoEventos = esperarLista();
  await tab('Eventos');
  assert.deepEqual(await (await retornoEventos).json(), { post_ids: [] });
  await verificarMarcador(false);
  await verificarTotalConsultas(consultasA, consultasAntesDeVoltar + 1);
  console.log('OK 13.12: remoção em B aparece automaticamente quando A volta à aba Eventos.');

  // O Chromium headless emula todas as páginas com foco. Emita a transição real de eventos do DOM.
  await simularDocumento(page, 'hidden');
  const consultasAntesDaJanela = consultasA();
  await paginaB.getByText('Todos', { exact: true }).click();
  await alterarInteresse('Membro', true, postId, paginaB);
  await verificarRegistros(postId);
  await verificarTotalConsultas(consultasA, consultasAntesDaJanela);
  assert.equal(await marcador().getAttribute('aria-pressed'), 'false');
  const retornoJanela = esperarLista();
  await simularDocumento(page, 'visible');
  assert.deepEqual(await (await retornoJanela).json(), { post_ids: [postId] });
  await verificarMarcador(true);
  await verificarTotalConsultas(consultasA, consultasAntesDaJanela + 1);
  console.log('OK 13.12: visibilitychange e focus agrupados fazem uma única leitura ao voltar à janela.');

  const reterResposta = async (url, metodo, alvo = page) => {
    const capturada = Promise.withResolvers();
    const liberar = Promise.withResolvers();
    const finalizada = Promise.withResolvers();
    let reteve = false;
    const handler = async route => {
      if (route.request().method() !== metodo || reteve) return route.fallback();
      reteve = true;
      try {
        const resposta = await route.fetch({ maxRetries: 0 });
        capturada.resolve({ resposta });
        await liberar.promise;
        await route.fulfill({ response: resposta });
        finalizada.resolve();
      } catch (erro) {
        capturada.resolve({ erro });
        finalizada.resolve(erro);
      }
    };
    await alvo.route(url, handler);
    return {
      async capturar() {
        const { resposta, erro } = await aguardar(capturada.promise, `capturar ${metodo} ${url}`);
        if (erro) throw erro;
        return resposta;
      },
      async entregar() {
        liberar.resolve();
        const erro = await aguardar(finalizada.promise, `entregar ${metodo} ${url}`);
        await alvo.unroute(url, handler);
        if (erro) throw erro;
      },
    };
  };

  const snapshotAntigo = await reterResposta(rotaLista, 'GET');
  const consultasAntesDoSnapshot = consultasA();
  const snapshotCancelado = page.waitForEvent('requestfailed', {
    predicate: request => request.url() === rotaLista && request.method() === 'GET',
  });
  await botaoSincronizar(page).click();
  const snapshot = await snapshotAntigo.capturar();
  assert.equal(snapshot.status(), 200);
  assert.deepEqual(await snapshot.json(), { post_ids: [postId] });
  await alterarInteresse('Membro', false, postId, paginaB);
  const estadoRecente = esperarLista();
  await simularDocumento(page, 'visible');
  assert.equal((await snapshotCancelado).failure()?.errorText, 'net::ERR_ABORTED');
  assert.deepEqual(await (await estadoRecente).json(), { post_ids: [] });
  await verificarMarcador(false);
  await snapshotAntigo.entregar();
  await verificarTotalConsultas(consultasA, consultasAntesDoSnapshot + 2);
  await verificarMarcador(false);
  await verificarRegistros();
  console.log('OK 13.12: resposta antiga da mesma conta é cancelada e não substitui a leitura mais recente.');

  const putA = await suspender(rotaInteresse(postId), 'PUT', route => route.continue());
  const putB = await suspender(rotaInteresse(postId), 'PUT', route => route.continue(), paginaB);
  const respostasConcorrentes = [page, paginaB].map(alvo => alvo.waitForResponse(res =>
    requisicaoInteresse(postId, 'PUT')(res.request())
  ));
  await Promise.all([marcador().click(), marcador(postId, paginaB).click()]);
  await Promise.all([putA.recebida(), putB.recebida()]);
  await Promise.all([
    verificarMarcador(true, postId, 'pendente'), verificarMarcador(true, postId, 'pendente', paginaB),
  ]);
  await verificarRegistros();
  await Promise.all([putA.concluir(), putB.concluir()]);
  assert.deepEqual((await Promise.all(respostasConcorrentes)).map(res => res.status()), [200, 200]);
  await Promise.all([verificarMarcador(true), verificarMarcador(true, postId, 'pronto', paginaB)]);
  await verificarRegistros(postId);
  console.log('OK 13.12: duas marcações concorrentes da mesma conta convergem para um único registro.');

  // B ainda vê a marcação removida em A. Segure a resposta do DELETE de B até A marcar de novo.
  await alterarInteresse('Membro', false);
  await verificarMarcador(true, postId, 'pronto', paginaB);
  const deleteAtrasadoB = await reterResposta(rotaInteresse(postId), 'DELETE', paginaB);
  await marcador(postId, paginaB).click();
  const respostaDeleteB = await deleteAtrasadoB.capturar();
  assert.equal(respostaDeleteB.status(), 200);
  await verificarMarcador(false, postId, 'pendente', paginaB);
  await alterarInteresse('Membro', true);
  const consultasDuranteEscrita = consultasB();
  await simularDocumento(paginaB, 'visible');
  await verificarTotalConsultas(consultasB, consultasDuranteEscrita);
  const consultaAdiada = esperarLista(paginaB);
  await deleteAtrasadoB.entregar();
  assert.deepEqual(await (await consultaAdiada).json(), { post_ids: [postId] });
  await verificarMarcador(true, postId, 'pronto', paginaB);
  await verificarTotalConsultas(consultasB, consultasDuranteEscrita + 1);
  await verificarRegistros(postId);
  console.log('OK 13.12: escritas opostas convergem para o último estado gravado após uma única consulta adiada.');

  await abrirFullscreen(tituloOriginal, postId, paginaB);
  await verificarFullscreen(true, postId, paginaB);
  const consultasAntesDoOffline = consultasB();
  await contextoB.setOffline(true);
  assert.equal(await paginaB.evaluate(() => navigator.onLine), false);
  await simularDocumento(paginaB, 'visible');
  await visible('Não foi possível consultar seus interesses. Toque para atualizar.', paginaB);
  const avisoSessaoB = paginaB.getByRole('button', { name: 'Tentar conferir a sessão novamente' });
  await avisoSessaoB.waitFor({ state: 'visible' });
  assert.equal(consultasB(), consultasAntesDoOffline + 2);
  await alterarInteresse('Membro', false);
  await verificarRegistros();

  const reconexaoB = esperarLista(paginaB);
  await contextoB.setOffline(false);
  assert.deepEqual(await (await reconexaoB).json(), { post_ids: [] });
  await avisoSessaoB.waitFor({ state: 'hidden' });
  await verificarFullscreen(false, postId, paginaB);
  await marcadorFullscreen(postId, paginaB).locator('../..').getByTestId('voltar-fullscreen').click();
  await verificarMarcador(false, postId, 'pronto', paginaB);
  await filtroInteresses(paginaB).click();
  await visible('Você ainda não marcou nenhuma publicação com interesse.', paginaB);
  await verificarFeedNo(paginaB);
  await verificarTotalConsultas(consultasB, consultasAntesDoOffline + 3);
  console.log('OK 13.12: a reconexão atualiza automaticamente fullscreen, feed e filtro, sem repetir a mutação.');

  await alterarInteresse('Membro', true, externoPostId);
  await logout(paginaB);
  assert.equal(await page.evaluate(() => !!localStorage.getItem('userToken')), true);
  await login('Admin', paginaB);
  await tab('Eventos', paginaB);
  await verificarMarcador(false, externoPostId, 'pronto', paginaB);
  await filtroInteresses(paginaB).click();
  await visible('Você ainda não marcou nenhuma publicação com interesse.', paginaB);
  await paginaB.getByText('Todos', { exact: true }).click();
  await alterarInteresse('Admin', true, postId, paginaB);
  await verificarMarcador(false);
  await verificarMarcador(true, externoPostId);
  await verificarBanco('Admin', false, externoPostId);
  await verificarBanco('Membro', false);

  // Revoga somente a permissão aprovada do membro no banco isolado.
  await pool.query("UPDATE usuarios SET status_conta = 'PENDENTE' WHERE id = $1", [users.Membro]);
  await simularDocumento(page, 'visible');
  await visible('Sua conta está aguardando aprovação.');
  await filtroInteresses().waitFor({ state: 'hidden' });
  await marcador(externoPostId).waitFor({ state: 'hidden' });
  const statusRevogado = await page.evaluate(async url => {
    const token = localStorage.getItem('userToken');
    const resposta = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    return resposta.status;
  }, rotaLista);
  assert.equal(statusRevogado, 403);
  await verificarMarcador(true, postId, 'pronto', paginaB);
  const { rows: registrosFinais } = await pool.query('SELECT usuario_id, post_id FROM mural_interesses ORDER BY post_id');
  assert.deepEqual(registrosFinais, [
    { usuario_id: users.Admin, post_id: postId },
    { usuario_id: users.Membro, post_id: externoPostId },
  ]);
  await Promise.all([logout(), logout(paginaB)]);
  await contextoB.close();
  console.log('OK 13.12: logout local, troca de conta e revogação preservam o isolamento e os registros de cada conta.');

  await login('Master');
  const rotaMural = 'http://localhost:3000/mural?midia=link';
  const leituraAntiga = await suspender(rotaMural, 'GET', async () => {});
  await tab('Eventos');
  await leituraAntiga.recebida();
  const [consultaMuralCancelada] = await Promise.all([
    page.waitForEvent('requestfailed', {
      predicate: requisicao => requisicao.method() === 'GET' && requisicao.url() === rotaMural,
    }),
    tab('Agenda'),
  ]);
  assert.equal(consultaMuralCancelada.failure()?.errorText, 'net::ERR_ABORTED');
  await leituraAntiga.concluir();
  await tab('Eventos');
  await visible(tituloOriginal);
  await logout();
  console.log('OK 14: sair de Eventos cancela a consulta ao mural e retornar carrega as publicações.');

  await verificarHidratacao({ novoContexto, origin, armazenamentoMaster, diretorio: diretorioArtefatos });

  const comentarioAcessivel = await pool.query(
    'INSERT INTO mural_comentarios(post_id,usuario_id,texto) VALUES($1,$2,$3) RETURNING id',
    [postId, users.Master, 'Comentário para o teste de teclado.']
  );
  const contextoAcessibilidade = await novoContexto({ viewport: { width: 1280, height: 800 } });
  const paginaAcessibilidade = await contextoAcessibilidade.newPage();
  paginaAcessibilidade.setDefaultTimeout(10000);
  await verificarAcessibilidade({
    page: paginaAcessibilidade, pool, users, postId, externoPostId,
    login: perfil => login(perfil, paginaAcessibilidade), tab: nome => tab(nome, paginaAcessibilidade),
    logout: () => logout(paginaAcessibilidade),
    suspender: (url, metodo, responder) => suspender(url, metodo, responder, paginaAcessibilidade),
    responder500, rotaLista, diretorio: diretorioArtefatos,
  });
  await contextoAcessibilidade.close();
  await pool.query('DELETE FROM mural_comentarios WHERE id=$1', [comentarioAcessivel.rows[0].id]);

  const contextoVisual = await novoContexto({ serviceWorkers: 'allow' });
  const paginaVisual = await contextoVisual.newPage();
  paginaVisual.setDefaultTimeout(15000);
  await paginaVisual.goto(origin + '/login');
  await paginaVisual.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'));
  await verificarResponsividade({
    page: paginaVisual, pool, users, congregation, postIds: [postId, congregacaoPostId, externoPostId],
    origin, login: perfil => login(perfil, paginaVisual), tab: nome => tab(nome, paginaVisual),
    logout: () => logout(paginaVisual), suspender: (url, metodo, responder) => suspender(url, metodo, responder, paginaVisual),
    responder500, rotaLista, diretorioCapturas: join(diretorioArtefatos, 'responsividade'),
  });
  await contextoVisual.close();

  await verificarPerfis({ novoContexto, origin, pool, users, congregation, postId, login, tab, logout, diretorio: diretorioArtefatos });
  if (process.env.AGENDA_E2E_PLATAFORMAS === '1') {
    await verificarPlataformas({
      novoContexto, prepararContexto, browser, origin, pool, users, postId, login, tab, logout,
      diretorio: join(diretorioArtefatos, 'plataformas'),
      mudarWorker: revisao => { revisaoWorker = revisao; },
    });
  }

} catch (erro) {
  erroCenario = erro;
} finally {
  await browser?.close();
  if (api && api.exitCode === null && api.signalCode === null) { const closed = once(api, 'exit'); api.kill(); await closed; }
  server.close();
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await pool.end();
    await rm(tempDir, { recursive: true, force: true });
  }
}

try {
  await monitorJavaScript.verificar(diretorioArtefatos);
} catch (erro) {
  if (erroCenario) throw new AggregateError([erroCenario, erro], 'Falhas de cenário e de JavaScript no E2E');
  throw erro;
}
if (erroCenario) throw erroCenario;
