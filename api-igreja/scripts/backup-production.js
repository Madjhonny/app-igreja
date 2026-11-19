// Backup completo somente leitura, em destino explícito. Não imprime dados nem credenciais.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { rootCertificates } = require('node:tls');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { parse } = require('dotenv');

const HOST = 'ep-odd-cloud-b6vjrv0e.c-2.sa-east-1.aws.neon.tech';
const DATABASE = 'neondb';
const check = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { safeMessage: message }); };

function locate(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return process.env.AGENDA_PG_BIN ? path.join(process.env.AGENDA_PG_BIN, exe) : exe;
}
function run(name, args, env) {
  const result = spawnSync(locate(name), args, { env, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 600000 });
  check(!result.error && result.status === 0, `${name} falhou. Confira instalação, versão, conexão e credenciais; nenhum backup incompleto será aprovado.`);
  return result.stdout;
}

async function main() {
  const [envFile, outputFile] = process.argv.slice(2);
  check(envFile && outputFile && path.extname(outputFile) === '.backup', 'Informe o .env e um novo arquivo .backup.');
  const cfg = parse(await fs.readFile(envFile));
  const password = process.env.AGENDA_PROD_DB_PASSWORD || cfg.DB_PASSWORD;
  check(cfg.DB_USER && cfg.DB_NAME === DATABASE && password, 'Credenciais de produção ausentes ou banco incorreto.');
  // Não reutiliza DB_HOST ou variáveis PG* externas: alvo fixo verificado no Neon.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^PG/i.test(name)));
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'agenda-adp-ca-'));
  const ca = path.join(temp, 'ca.pem');
  try {
  await fs.writeFile(ca, rootCertificates.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  Object.assign(env, { PGPASSWORD: password, PGSSLMODE: 'verify-full', PGSSLROOTCERT: ca, PGCONNECT_TIMEOUT: '15' });
  run('pg_dump', ['--version'], env);
  run('pg_restore', ['--version'], env);
  const file = await fs.open(outputFile, 'wx', 0o600);
  await file.close();
  run('pg_dump', ['--host', HOST, '--port', '5432', '--username', cfg.DB_USER, '--dbname', DATABASE,
    '--no-password', '--format=custom', '--file', outputFile], env);
  const listing = run('pg_restore', ['--list', outputFile], env);
  check(['usuarios', 'mural_eventos', 'schema_migrations'].every(table => listing.includes(` TABLE DATA public ${table} `)), 'Arquivo não contém as tabelas esperadas.');
  // Percorre o arquivo inteiro para verificar a leitura, sem restaurar no banco.
  run('pg_restore', ['--file', process.platform === 'win32' ? 'NUL' : '/dev/null', outputFile], env);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(outputFile)) hash.update(chunk);
  const size = (await fs.stat(outputFile)).size;
  check(size > 0, 'Backup vazio.');
  console.log('BACKUP DE PRODUCAO VALIDADO!');
  console.log(`Arquivo: ${outputFile}\nTamanho: ${size} bytes\nSHA256: ${hash.digest('hex')}`);
  } finally {
    await fs.unlink(ca).catch(() => {});
    await fs.rmdir(temp).catch(() => {});
  }
}
main().catch(error => {
  console.error('BACKUP REPROVADO:', error.safeMessage || error.code || error.name);
  process.exitCode = 1;
});
