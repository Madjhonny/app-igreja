const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtemp, readdir, rmdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { abrirSchemaDeTeste } = require('./banco-local-de-teste');

async function verificar() {
  const pasta = await mkdtemp(join(tmpdir(), 'agenda-migrations-test-'));
  try {
    const { pool, ambiente, fechar } = await abrirSchemaDeTeste(
      process.env.INTERESSES_TEST_DATABASE_URL, 'agenda_interesses_test', 'migrations_check',
    );
    try {
      const arquivos = (await readdir(join(__dirname, '../migrations')))
        .filter(nome => /^\d+.*\.sql$/.test(nome)).sort();
      const aplicar = () => execFileSync(process.execPath, [join(__dirname, 'migrate.js')], {
        cwd: pasta, env: ambiente, encoding: 'utf8', timeout: 120_000,
      });
      const lerHistorico = async () => (await pool.query(
        'SELECT filename, applied_at FROM schema_migrations ORDER BY filename',
      )).rows;

      aplicar();
      const historico = await lerHistorico();
      assert.deepEqual(historico.map(linha => linha.filename), arquivos);
      assert.ok(!aplicar().includes('Migração aplicada:'));
      assert.deepEqual(await lerHistorico(), historico);

      const { rows: [tabelas] } = await pool.query(`SELECT
        to_regclass('mural_interesses') IS NOT NULL AS interesses,
        to_regclass('push_jobs') IS NOT NULL AS jobs,
        to_regclass('push_devices') IS NOT NULL AS dispositivos`);
      assert.deepEqual(tabelas, { interesses: true, jobs: true, dispositivos: true });
      console.log(`OK: ${arquivos.length} migrações aplicadas e reexecução sem alterações no histórico.`);
    } finally {
      await fechar();
    }
  } finally {
    await rmdir(pasta);
  }
}

verificar().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
