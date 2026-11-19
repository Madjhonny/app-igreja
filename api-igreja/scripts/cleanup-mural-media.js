// Execução manual. Por padrão apenas informa a quantidade elegível.
// Para limpar: node scripts/cleanup-mural-media.js --apply
const { Pool } = require('pg');
const { createCloudinaryMedia } = require('../services/cloudinary-media');
const { createMuralStorage } = require('../services/mural-media');
require('dotenv').config();

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER) {
    throw new Error('Configure explicitamente o banco de dados correto.');
  }
  const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD, port: Number(process.env.DB_PORT || 5432),
    ssl: process.env.DB_SSL === 'true' ? {
      rejectUnauthorized: true,
      ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}),
    } : undefined,
  });
  try {
    const storage = createMuralStorage({ pool, media: apply ? createCloudinaryMedia() : null });
    const pending = await storage.listPending(100);
    console.log(`Imagens elegíveis nesta execução: ${pending.length}`);
    if (!apply) return;
    let removed = 0;
    let failed = 0;
    for (const id of pending) {
      try { if (await storage.cleanupOne(id)) removed++; }
      catch { failed++; }
    }
    console.log(`Limpeza: ${removed} removidas, ${failed} pendentes de nova tentativa.`);
    if (failed) process.exitCode = 1;
  } finally { await pool.end(); }
}

main().catch(() => {
  console.error('Falha na limpeza de mídia: confira a configuração e a migração do banco.');
  process.exitCode = 1;
});
