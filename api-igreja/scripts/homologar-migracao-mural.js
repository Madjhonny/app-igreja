// Homologação round-trip: migra somente na branch isolada, compara o conteúdo
// e restaura as imagens originais. Backup local exclusivo permanece para recuperação.
const fs = require('node:fs/promises');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const { createCloudinaryMedia } = require('../services/cloudinary-media');
const { createMigration, makeEntry, validateEntry, sha256 } = require('../services/migrate-mural-media');

const HOST = 'ep-withered-sound-b62ra3xx.c-2.sa-east-1.aws.neon.tech';
const CLOUD = 'us1snykz';
const safeError = message => Object.assign(new Error(message), { safeMessage: message });
const check = (condition, message) => { if (!condition) throw safeError(message); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const [envFile, backupFile, mode] = process.argv.slice(2);
  check(envFile && backupFile && ['--homologar', '--restore'].includes(mode), 'Informe .env, arquivo de backup e --homologar ou --restore.');
  const cfg = dotenv.parse(await fs.readFile(envFile));
  const password = process.env.AGENDA_TEST_DB_PASSWORD || cfg.DB_PASSWORD;
  check(cfg.DB_USER && cfg.DB_NAME && password, 'Credenciais do banco ausentes.');
  const media = createCloudinaryMedia({ env: {
    CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY: process.env.AGENDA_CLOUDINARY_TEST_KEY,
    CLOUDINARY_API_SECRET: process.env.AGENDA_CLOUDINARY_TEST_SECRET,
  } });
  const pool = new Pool({ host: HOST, port: 5432, user: cfg.DB_USER, password,
    database: cfg.DB_NAME, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000, statement_timeout: 20000 });
  const migration = createMigration({ pool, media, cloud: CLOUD });
  const posts = async () => (await pool.query(`SELECT id, md5(midia) AS imagem,
    md5((to_jsonb(m)-'midia')::text) AS metadados FROM mural_eventos m ORDER BY id`)).rows;
  const assets = async () => (await pool.query('SELECT public_id, post_id FROM mural_cloudinary_assets ORDER BY public_id')).rows;
  const readBackup = async () => {
    const data = JSON.parse(await fs.readFile(backupFile, 'utf8'));
    check(data.version === 1 && data.host === HOST && data.database === cfg.DB_NAME && data.cloud === CLOUD && Array.isArray(data.entries), 'Backup não pertence a esta homologação.');
    check(data.entries.length <= 100 && new Set(data.entries.map(r => r.id)).size === data.entries.length && new Set(data.entries.map(r => r.publicId)).size === data.entries.length, 'Backup duplicado ou acima do limite.');
    for (const entry of data.entries) validateEntry(entry, media);
    return data;
  };
  try {
    const verified = await pool.query(`SELECT EXISTS (SELECT 1 FROM schema_migrations
      WHERE filename='20261119_mural_cloudinary_assets.sql') AS ready`);
    check(verified.rows[0]?.ready, 'Migração estrutural ainda não aplicada.');
    console.log('OK: banco de homologação confirmado.');
    if (mode === '--restore') {
      const data = await readBackup();
      for (const entry of [...data.entries].reverse()) await migration.restore(entry);
      check(equal(await posts(), data.before) && equal(await assets(), data.assetsBefore), 'Estado final diverge do backup.');
      console.log('RESTAURACAO APROVADA!');
      return;
    }
    const count = await pool.query("SELECT count(*)::int AS total FROM mural_eventos WHERE tipo_midia='imagem' AND LEFT(midia,5)='data:'");
    const total = count.rows[0].total;
    check(total > 0 && total <= 100, 'Não há imagens legadas ou o lote supera 100.');
    const rows = (await pool.query("SELECT id, midia FROM mural_eventos WHERE tipo_midia='imagem' AND LEFT(midia,5)='data:' ORDER BY id LIMIT 101")).rows;
    check(rows.length === total, 'O conjunto de imagens mudou durante a leitura.');
    const entries = rows.map(row => makeEntry(row, media));
    const before = await posts();
    const assetsBefore = await assets();
    const data = { version: 1, host: HOST, database: cfg.DB_NAME, cloud: CLOUD, before, assetsBefore, entries };
    const serialized = JSON.stringify(data);
    const file = await fs.open(backupFile, 'wx', 0o600);
    try { await file.writeFile(serialized, 'utf8'); await file.sync(); } finally { await file.close(); }
    const saved = await fs.readFile(backupFile, 'utf8');
    check(sha256(saved) === sha256(serialized), 'Backup não conferiu após gravação.');
    await readBackup();
    console.log(`OK: backup validado de ${entries.length} imagens; arquivo: ${backupFile}`);
    console.log(`SHA256 do backup: ${sha256(saved)}`);
    let migrated = false;
    try {
      for (const entry of entries) {
        const url = await migration.migrate(entry);
        const stored = await pool.query(`SELECT m.midia, a.public_id FROM mural_eventos m
          JOIN mural_cloudinary_assets a ON a.post_id=m.id WHERE m.id=$1`, [entry.id]);
        check(stored.rowCount === 1 && stored.rows[0].midia === url && stored.rows[0].public_id === entry.publicId, 'URL ou vínculo não confirmados no banco.');
        console.log(`OK: post ${entry.id} migrado; conteúdo SHA256 conferido.`);
      }
      const after = await posts();
      check(equal(after.map(({ id, metadados }) => ({ id, metadados })), before.map(({ id, metadados }) => ({ id, metadados }))), 'Metadados dos posts foram alterados.');
      const left = await pool.query("SELECT count(*)::int AS total FROM mural_eventos WHERE tipo_midia='imagem' AND LEFT(midia,5)='data:'");
      check(left.rows[0].total === 0, 'Ainda existem imagens legadas não migradas.');
      console.log('OK: todos os posts legados migrados sem alterar seus metadados.');
      migrated = true;
    } finally {
      // Também executa se o provedor falhar. O backup permanece em disco.
      let failures = 0;
      for (const entry of [...entries].reverse()) {
        try { await migration.restore(entry); }
        catch { failures++; console.error(`Restauração pendente para o post ${entry.id}.`); }
      }
      check(failures === 0, 'Restauração incompleta; preserve o arquivo de backup e use --restore.');
      check(equal(await posts(), before) && equal(await assets(), assetsBefore), 'Estado final diverge do backup.');
      console.log('OK: originais restaurados, metadados preservados e imagens temporárias removidas.');
    }
    check(migrated, 'Migração não concluída.');
    console.log('HOMOLOGACAO DA MIGRACAO APROVADA!');
  } finally { await pool.end(); }
}

main().catch(error => {
  console.error('HOMOLOGACAO DA MIGRACAO REPROVADA:', error.safeMessage || error.code || error.name);
  process.exitCode = 1;
});
