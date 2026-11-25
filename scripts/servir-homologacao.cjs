const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createServer, request } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { isIPv4 } = require('node:net');
const { join, resolve, extname, sep } = require('node:path');

const apiRoot = resolve(__dirname, '../api-igreja');
const apiRequire = createRequire(join(apiRoot, 'package.json'));
const { validarBancoLocal } = apiRequire('./scripts/banco-local-de-teste');
const { Pool } = apiRequire('pg');
const bcrypt = apiRequire('bcryptjs');
const schema = 'homologacao_perfis';
const senhaTeste = 'AgendaADP-Teste15!';
const imagem = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=';

async function prepararDados(pool) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const existe = await cliente.query("SELECT 1 FROM usuarios WHERE email = 'master@homologacao.test'");
    if (!existe.rowCount) {
      const { rows: [sede, jardim] } = await cliente.query(`INSERT INTO congregacoes (nome)
        VALUES ('Sede de Homologação'), ('Jardim de Homologação') RETURNING id`);
      const hash = await bcrypt.hash(senhaTeste, 8);
      const ids = {};
      for (const [i, [conta, papel, status, congregacao]] of [
        ['master', 'MASTER', 'APROVADO', sede.id], ['admin', 'ADMIN', 'APROVADO', sede.id],
        ['membro', 'MEMBRO', 'APROVADO', sede.id], ['pendente', 'MEMBRO', 'PENDENTE', sede.id],
        ['pendente-jardim', 'MEMBRO', 'PENDENTE', jardim.id], ['membro-jardim', 'MEMBRO', 'APROVADO', jardim.id],
        ['bloqueado', 'MEMBRO', 'BLOQUEADO', sede.id], ['recusado', 'MEMBRO', 'RECUSADO', jardim.id],
      ].entries()) {
        const { rows: [usuario] } = await cliente.query(`INSERT INTO usuarios
          (nome_completo,nome_exibicao,email,senha_hash,cpf,nivel_acesso,status_conta,congregacao_id)
          VALUES ($1,$1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [`Perfil ${conta}`, `${conta}@homologacao.test`, hash, String(51000000001 + i), papel, status, congregacao]);
        ids[conta] = usuario.id;
      }
      await cliente.query(`INSERT INTO eventos (titulo,data_inicio,data_fim,horario,congregacao_id,criado_por_usuario_id)
        VALUES ('Encontro da Sede',CURRENT_DATE,CURRENT_DATE,'18:00',$1,$3),
        ('Encontro do Jardim',CURRENT_DATE,CURRENT_DATE,'19:00',$2,$3)`, [sede.id, jardim.id, ids.master]);
      await cliente.query(`INSERT INTO gestao_datas_rascunho (master_id,titulo,data_inicio,data_fim,horario,congregacao_id)
        VALUES ($1,'Planejamento da Sede',CURRENT_DATE + 2,CURRENT_DATE + 2,'19:00',$2)`, [ids.master, sede.id]);
      const { rows: [post] } = await cliente.query(`INSERT INTO mural_eventos
        (usuario_id,congregacao_id,titulo,descricao,tipo_midia,midia,data_inicio,data_fim)
        VALUES ($1,$2,'Publicação da Sede','Conteúdo fictício para teste.','imagem',$4,CURRENT_DATE,CURRENT_DATE + 30),
        ($1,$3,'Publicação do Jardim','Conteúdo fictício de outra congregação.','imagem',$4,CURRENT_DATE,CURRENT_DATE + 30)
        RETURNING id`, [ids.master, sede.id, jardim.id, imagem]);
      await cliente.query('INSERT INTO mural_comentarios (post_id,usuario_id,texto) VALUES ($1,$2,$3)',
        [post.id, ids.membro, 'Comentário fictício do membro da Sede.']);
      await cliente.query('INSERT INTO mural_interesses (usuario_id,post_id) VALUES ($1,$2)', [ids.membro, post.id]);
    }
    await cliente.query('COMMIT');
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
}

async function iniciar() {
  const [host = '127.0.0.1', pastaWeb] = process.argv.slice(2);
  assert.ok(isIPv4(host) && (host === '127.0.0.1' || /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(host)),
    'Escolha o endereço IPv4 privado da interface de homologação.');
  const porta = 4150;
  const origem = `http://${host}:${porta}`;
  const web = resolve(pastaWeb);
  await readFile(join(web, 'login.html'));
  const url = validarBancoLocal(process.env.HOMOLOGACAO_DATABASE_URL, 'agenda_homologacao');
  const ambiente = {
    DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: 'agenda_homologacao',
    DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password), DB_SSL: 'false',
    PGOPTIONS: `-c search_path=${schema}`,
  };
  const pasta = resolve(__dirname, '../app-igreja/dist/artefatos-teste/15/runtime');
  await mkdir(pasta, { recursive: true });
  const pool = new Pool({ connectionString: url.href, options: ambiente.PGOPTIONS, ssl: false });
  try {
    assert.equal((await pool.query('SELECT current_database() AS nome')).rows[0].nome, ambiente.DB_NAME);
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    execFileSync(process.execPath, [join(apiRoot, 'scripts/migrate.js')], { cwd: pasta, env: ambiente, stdio: 'inherit' });
    await prepararDados(pool);
  } finally {
    await pool.end();
  }

  const bootstrap = `
    const server = require('node:http').Server.prototype;
    const listen = server.listen;
    server.listen = function(porta, callback) { return listen.call(this, porta, '127.0.0.1', callback); };
    global.fetch = async () => { throw new Error('Rede externa desativada na homologação.'); };
    require(process.argv[1]);
  `;
  const api = spawn(process.execPath, ['-e', bootstrap, join(apiRoot, 'server.js')], {
    cwd: pasta, env: { ...ambiente, PORT: '0', NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex'),
      CORS_ORIGINS: origem, PUSH_NOTIFICATIONS_ENABLED: 'false', RESEND_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

  try {
    const portaAPI = await new Promise((resolvePorta, reject) => {
      let linhas = '';
      api.once('error', reject);
      api.once('exit', codigo => reject(new Error(`A API encerrou (${codigo}).`)));
      api.stdout.setEncoding('utf8');
      api.stdout.on('data', texto => {
        process.stdout.write(texto);
        linhas = (linhas + texto).slice(-1024);
        const portaEscutada = /rodando na porta (\d+)!/.exec(linhas);
        if (portaEscutada) resolvePorta(Number(portaEscutada[1]));
      });
    });
    const servidor = createServer(async (req, res) => {
      try {
        const requisicao = new URL(req.url, origem);
        const caminho = decodeURIComponent(requisicao.pathname);
        if (caminho.startsWith('/api/')) {
          const proxied = request({ hostname: '127.0.0.1', port: portaAPI, method: req.method,
            path: requisicao.pathname.slice(4) + requisicao.search, headers: req.headers }, resposta => {
            res.writeHead(resposta.statusCode, resposta.headers);
            resposta.pipe(res);
          });
          proxied.on('error', () => res.destroy());
          req.pipe(proxied);
          return;
        }
        const arquivo = resolve(web, `.${caminho === '/' ? '/index.html' : extname(caminho) ? caminho : `${caminho}.html`}`);
        if (!arquivo.startsWith(web + sep)) { res.writeHead(403).end(); return; }
        const corpo = await readFile(arquivo);
        res.writeHead(200, { 'Content-Type': tipos[extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(corpo);
      } catch {
        if (!res.headersSent) res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolveListen, reject) => {
      servidor.once('error', reject);
      servidor.listen(porta, host, resolveListen);
    });
    await writeFile(join(pasta, 'endereco.json'), JSON.stringify({ origem, api: `${origem}/api`, pid: process.pid }));
    console.log(`Homologação local disponível em ${origem}/login`);
    api.once('exit', () => servidor.close());
    for (const sinal of ['SIGINT', 'SIGTERM']) process.once(sinal, () => { servidor.close(); api.kill(); });
  } catch (erro) {
    api.kill();
    throw erro;
  }
}

iniciar().catch(erro => {
  console.error(erro.message);
  process.exitCode = 1;
});
