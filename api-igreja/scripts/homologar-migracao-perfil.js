// Exclusivamente homologação: nunca aponta para o DB_HOST do .env.
const fs = require('node:fs/promises');
const { Pool } = require('pg');
const { parse } = require('dotenv');
const { createCloudinaryProfileMedia } = require('../services/cloudinary-profile-media');
const { makeEntry, validateEntry, createMigration, sha256 } = require('../services/migrate-profile-media');

const HOST = 'ep-withered-sound-b62ra3xx.c-2.sa-east-1.aws.neon.tech';
const CLOUD = 'us1snykz';
const check = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { safeMessage: message }); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const [envFile, backupFile, mode] = process.argv.slice(2);
  check(envFile && backupFile && ['--homologar', '--restore'].includes(mode), 'Informe .env, arquivo de backup e --homologar ou --restore.');
  const cfg = parse(await fs.readFile(envFile));
  const password = process.env.AGENDA_TEST_DB_PASSWORD || cfg.DB_PASSWORD;
  const key = process.env.AGENDA_CLOUDINARY_TEST_KEY;
  const secret = process.env.AGENDA_CLOUDINARY_TEST_SECRET;
  check(cfg.DB_USER && cfg.DB_NAME && password && key && secret, 'Configuração de homologação ausente.');
  const media = createCloudinaryProfileMedia({ env: { CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } });
  const pool = new Pool({ host: HOST, port: 5432, user: cfg.DB_USER, password, database: cfg.DB_NAME,
    ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000, statement_timeout: 20000 });
  const migration = createMigration({ pool, media });
  const users = async () => (await pool.query(`SELECT id, md5(foto_perfil) AS foto,
    md5((to_jsonb(u)-'foto_perfil')::text) AS metadados FROM usuarios u ORDER BY id`)).rows;
  const assets = async () => (await pool.query('SELECT public_id,user_id FROM profile_cloudinary_assets ORDER BY public_id')).rows;
  const readBackup = async () => {
    const data = JSON.parse(await fs.readFile(backupFile, 'utf8'));
    check(data.version === 1 && data.kind === 'profile-media' && data.host === HOST && data.database === cfg.DB_NAME && data.cloud === CLOUD && Array.isArray(data.entries) && Array.isArray(data.before) && Array.isArray(data.assetsBefore), 'Backup não pertence a esta homologação.');
    check(data.entries.length > 0 && data.entries.length <= 100 && new Set(data.entries.map(r => r.id)).size === data.entries.length && new Set(data.entries.map(r => r.publicId)).size === data.entries.length, 'Backup duplicado ou acima do limite.');
    for (const entry of data.entries) validateEntry(entry, media);
    return data;
  };
  const restore = async data => {
    let failures = 0;
    for (const entry of [...data.entries].reverse()) {
      try { await migration.restore(entry); }
      catch { failures++; console.error(`Restauração pendente para o perfil ${entry.id}.`); }
    }
    check(failures === 0, 'Restauração incompleta; preserve o backup e execute --restore.');
    check(equal(await users(), data.before) && equal(await assets(), data.assetsBefore), 'Estado final diverge do backup.');
    console.log('OK: fotos originais restauradas, perfis preservados e imagens temporárias removidas.');
  };
  try {
    const ready = await pool.query("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE filename='20261119_profile_cloudinary_assets.sql') AS ready");
    check(ready.rows[0]?.ready, 'Migração estrutural de perfil ausente.');
    console.log('OK: banco de homologação confirmado.');
    if (mode === '--restore') {
      await restore(await readBackup());
      console.log('RESTAURACAO DE PERFIL APROVADA!');
      return;
    }
    const total = (await pool.query("SELECT count(*)::int AS total FROM usuarios WHERE LEFT(foto_perfil,5)='data:'")).rows[0].total;
    check(total > 0 && total <= 100, 'Não há fotos legadas ou o lote supera 100.');
    const rows = (await pool.query("SELECT id,foto_perfil FROM usuarios WHERE LEFT(foto_perfil,5)='data:' ORDER BY id LIMIT 101")).rows;
    check(rows.length === total, 'Conjunto de fotos alterado durante a leitura.');
    const entries = rows.map(row => makeEntry(row, media));
    const before = await users(), assetsBefore = await assets();
    check(!assetsBefore.some(asset => entries.some(entry => asset.user_id === entry.id)), 'Foto legada já possui vínculo; migração interrompida.');
    const data = { version: 1, kind: 'profile-media', host: HOST, database: cfg.DB_NAME, cloud: CLOUD, before, assetsBefore, entries };
    const serialized = JSON.stringify(data);
    const file = await fs.open(backupFile, 'wx', 0o600);
    try { await file.writeFile(serialized, 'utf8'); await file.sync(); } finally { await file.close(); }
    const saved = await fs.readFile(backupFile, 'utf8');
    check(sha256(saved) === sha256(serialized), 'Backup não conferiu após gravação.');
    await readBackup();
    console.log(`OK: backup validado de ${entries.length} fotos; arquivo: ${backupFile}`);
    console.log(`SHA256 do backup: ${sha256(saved)}`);
    let migrated = false;
    try {
      for (const entry of entries) {
        const url = await migration.migrate(entry);
        const stored = await pool.query('SELECT u.foto_perfil,a.public_id FROM usuarios u JOIN profile_cloudinary_assets a ON a.user_id=u.id WHERE u.id=$1', [entry.id]);
        check(stored.rowCount === 1 && stored.rows[0].foto_perfil === url && stored.rows[0].public_id === entry.publicId, 'URL ou vínculo não confirmado.');
        const denied = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
        await denied.body?.cancel();
        check([401,403,404].includes(denied.status), 'Foto não está protegida contra acesso anônimo.');
        console.log(`OK: perfil ${entry.id} migrado; conteúdo idêntico e acesso anônimo bloqueado.`);
      }
      const after = await users();
      check(equal(after.map(({ id, metadados }) => ({ id, metadados })), before.map(({ id, metadados }) => ({ id, metadados }))), 'Dados dos perfis foram alterados.');
      check(equal(after.filter(row => !entries.some(entry => entry.id === row.id)), before.filter(row => !entries.some(entry => entry.id === row.id))), 'Perfil não selecionado foi alterado.');
      const left = (await pool.query("SELECT count(*)::int AS total FROM usuarios WHERE LEFT(foto_perfil,5)='data:'")).rows[0].total;
      check(left === 0, 'Ainda existem fotos legadas não migradas.');
      migrated = true;
      console.log('OK: fotos legadas migradas; demais dados intactos.');
    } finally { await restore(data); }
    check(migrated, 'Migração não concluída.');
    console.log('HOMOLOGACAO DA MIGRACAO DE PERFIL APROVADA!');
  } finally { await pool.end(); }
}
main().catch(error => {
  console.error('HOMOLOGACAO DA MIGRACAO DE PERFIL REPROVADA:', error.safeMessage || error.code || error.name);
  process.exitCode = 1;
});
