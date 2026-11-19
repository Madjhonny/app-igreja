// Migração definitiva: execute somente após backup geral e homologação do deploy.
// Sem --apply-production ou --restore-production, apenas consulta contagens.
const fs = require('node:fs/promises');
const { Pool } = require('pg');
const { parse } = require('dotenv');
const { createCloudinaryMedia } = require('../services/cloudinary-media');
const { createCloudinaryProfileMedia } = require('../services/cloudinary-profile-media');
const mural = require('../services/migrate-mural-media');
const profile = require('../services/migrate-profile-media');

const HOST = 'ep-odd-cloud-b6vjrv0e.c-2.sa-east-1.aws.neon.tech';
const DATABASE = 'neondb';
const CLOUD = 'us1snykz';
const check = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { safeMessage: message }); };

async function main() {
  const [envFile, kind, mode = '--plan', backupFile] = process.argv.slice(2);
  check(envFile && ['mural', 'perfil'].includes(kind) && ['--plan','--apply-production','--restore-production'].includes(mode), 'Uso: .env mural|perfil --plan|--apply-production|--restore-production [backup.json]');
  check(mode === '--plan' || backupFile, 'Arquivo local de backup obrigatório.');
  const cfg = parse(await fs.readFile(envFile));
  // A senha pode ser fornecida em ambiente, sem editar o arquivo .env.
  const password = process.env.AGENDA_PROD_DB_PASSWORD || cfg.DB_PASSWORD;
  check(cfg.DB_USER && cfg.DB_NAME === DATABASE && password, 'Configuração de produção ausente ou banco diferente do esperado.');
  const pool = new Pool({ host: HOST, port: 5432, database: DATABASE, user: cfg.DB_USER, password,
    ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000, statement_timeout: 20000 });
  const isProfile = kind === 'perfil';
  const service = isProfile ? profile : mural;
  const table = isProfile ? 'usuarios' : 'mural_eventos';
  const column = isProfile ? 'foto_perfil' : 'midia';
  const assetTable = isProfile ? 'profile_cloudinary_assets' : 'mural_cloudinary_assets';
  const ownerColumn = isProfile ? 'user_id' : 'post_id';
  const filter = isProfile ? "LEFT(foto_perfil,5)='data:'" : "tipo_midia='imagem' AND LEFT(midia,5)='data:'";
  const migrationFile = isProfile ? '20261119_profile_cloudinary_assets.sql' : '20261119_mural_cloudinary_assets.sql';
  const count = async () => (await pool.query(`SELECT count(*)::int AS total FROM ${table} WHERE ${filter}`)).rows[0].total;
  try {
    const ready = await pool.query('SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE filename=$1) AS ready', [migrationFile]);
    const originalCount = await count();
    console.log(`Produção confirmada; ${kind}: ${originalCount} imagens legadas; schema ${ready.rows[0]?.ready ? 'pronto' : 'pendente'}.`);
    if (mode === '--plan') return;
    check(ready.rows[0]?.ready, 'Aplique primeiro a migração estrutural homologada.');
    const key = process.env.AGENDA_CLOUDINARY_PROD_KEY;
    const secret = process.env.AGENDA_CLOUDINARY_PROD_SECRET;
    check(key && secret, 'Credenciais Cloudinary de produção ausentes.');
    const env = { CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret };
    const media = isProfile ? createCloudinaryProfileMedia({ env }) : createCloudinaryMedia({ env });
    const migration = service.createMigration({ pool, media, cloud: CLOUD });
    const validateBackup = data => {
      check(data.version === 1 && data.kind === kind && data.host === HOST && data.database === DATABASE && data.cloud === CLOUD && Array.isArray(data.entries), 'Backup pertence a outro destino.');
      check(data.entries.length <= 100 && new Set(data.entries.map(r => r.id)).size === data.entries.length && new Set(data.entries.map(r => r.publicId)).size === data.entries.length, 'Backup inválido ou acima do limite.');
      for (const entry of data.entries) service.validateEntry(entry, media);
      return data;
    };
    const restore = async data => {
      let failures = 0;
      for (const entry of [...data.entries].reverse()) {
        try { await migration.restore(entry); }
        catch { failures++; console.error(`Restauração pendente do registro ${entry.id}; preserve o backup.`); }
      }
      check(failures === 0, 'Restauração incompleta; não desative o serviço de leitura das fotos protegidas.');
    };
    if (mode === '--restore-production') {
      await restore(validateBackup(JSON.parse(await fs.readFile(backupFile, 'utf8'))));
      console.log('RESTAURACAO DE PRODUCAO APROVADA!');
      return;
    }
    check(originalCount <= 100, 'Lote acima do limite de 100 imagens; planeje lotes separados.');
    if (!originalCount) { console.log('Nenhuma imagem legada pendente.'); return; }
    const rows = (await pool.query(`SELECT id,${column} FROM ${table} WHERE ${filter} ORDER BY id LIMIT 101`)).rows;
    check(rows.length === originalCount, 'Conjunto de imagens alterado; repita o planejamento.');
    const entries = rows.map(row => service.makeEntry(row, media));
    const existing = await pool.query(`SELECT 1 FROM ${assetTable} WHERE ${ownerColumn}=ANY($1::int[])`, [entries.map(e => e.id)]);
    check(existing.rowCount === 0, 'Uma imagem legada já possui vínculo; migração interrompida.');
    const data = validateBackup({ version: 1, kind, host: HOST, database: DATABASE, cloud: CLOUD, entries });
    const serialized = JSON.stringify(data);
    const file = await fs.open(backupFile, 'wx', 0o600);
    try { await file.writeFile(serialized, 'utf8'); await file.sync(); } finally { await file.close(); }
    const saved = await fs.readFile(backupFile, 'utf8');
    check(service.sha256(saved) === service.sha256(serialized), 'Backup não conferiu após gravação.');
    validateBackup(JSON.parse(saved));
    console.log(`Backup local validado: ${backupFile}; SHA256: ${service.sha256(saved)}`);
    try {
      for (const entry of entries) {
        const url = await migration.migrate(entry);
        const result = await pool.query(`SELECT t.${column} AS media,a.public_id FROM ${table} t JOIN ${assetTable} a ON a.${ownerColumn}=t.id WHERE t.id=$1`, [entry.id]);
        check(result.rowCount === 1 && result.rows[0].media === url && result.rows[0].public_id === entry.publicId, 'Vínculo não confirmado.');
        if (isProfile) {
          const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
          await res.body?.cancel();
          check([401,403,404].includes(res.status), 'Foto não bloqueou acesso anônimo.');
        }
        console.log(`OK: registro ${entry.id}; conteúdo e vínculo conferidos.`);
      }
    } catch (error) {
      await restore(data);
      console.error('Lote restaurado após falha; backup preservado.');
      throw error;
    }
    const remaining = await count();
    check(remaining === 0, `${remaining} imagens legadas ainda existem; mantenha o backup e reavalie antes de declarar conclusão.`);
    console.log('MIGRACAO DE PRODUCAO APROVADA! Restantes no banco: 0.');
  } finally { await pool.end(); }
}
main().catch(error => {
  console.error('MIGRACAO DE PRODUCAO REPROVADA:', error.safeMessage || error.code || error.name);
  process.exitCode = 1;
});
