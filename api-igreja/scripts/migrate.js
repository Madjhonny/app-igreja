const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
  ssl: process.env.DB_SSL === 'true'
    ? {
        rejectUnauthorized: true,
        ...(process.env.DB_SSL_CA
          ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') }
          : {}),
      }
    : undefined,
});

async function migrate() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter(file => /^\d+.*\.sql$/.test(file))
    .sort();

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    for (const filename of files) {
      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('api-igreja-migrations'))");
        const applied = await client.query(
          'SELECT 1 FROM schema_migrations WHERE filename = $1',
          [filename]
        );
        if (!applied.rowCount) {
          const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
          console.log(`Migração aplicada: ${filename}`);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(error => {
  console.error('Falha ao executar migrações:', error.message);
  process.exitCode = 1;
});
