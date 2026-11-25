const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { validarBancoLocal } = require('./banco-local-de-teste');

async function consultarBancos() {
  const estado = {};
  for (const [variavel, banco, schemas] of [
    ['INTERESSES_TEST_DATABASE_URL', 'agenda_interesses_test', '^(interesses(_http)?|migrations_check)_[0-9a-f]{16}$'],
    ['WEB_TEST_DATABASE_URL', 'agenda_web_test', '^web_interesses_[0-9a-f]{16}$'],
    ['PUSH_TEST_DATABASE_URL', 'agenda_push_test', '^push_(fila|http)_[0-9a-f]{16}$'],
  ]) {
    const url = validarBancoLocal(process.env[variavel], banco);
    const pool = new Pool({ connectionString: url.href, ssl: false, connectionTimeoutMillis: 5000 });
    try {
      const { rows: [conexao] } = await pool.query(`SELECT current_database() AS banco,
        has_database_privilege(current_database(), 'CREATE') AS pode_criar_schema`);
      assert.equal(conexao.banco, banco);
      assert.ok(conexao.pode_criar_schema, `A conta de teste precisa criar schemas em ${banco}.`);
      const { rows } = await pool.query('SELECT nspname FROM pg_namespace WHERE nspname ~ $1 ORDER BY nspname', [schemas]);
      estado[banco] = { schemas: rows.map(linha => linha.nspname) };
      if (banco !== 'agenda_push_test') continue;

      const contagens = {};
      for (const tabela of ['congregacoes', 'usuarios', 'eventos', 'mural_eventos', 'push_jobs', 'push_devices']) {
        const nome = `public.${tabela}`;
        if (!(await pool.query('SELECT to_regclass($1) AS tabela', [nome])).rows[0].tabela) continue;
        contagens[tabela] = (await pool.query(`SELECT count(*) AS total FROM ${nome}`)).rows[0].total;
      }
      estado[banco].registrosPublic = contagens;
    } finally {
      await pool.end();
    }
  }
  console.log(JSON.stringify(estado));
}

consultarBancos().catch(erro => {
  console.error(erro.message);
  process.exitCode = 1;
});
