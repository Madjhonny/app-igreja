const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');

function validarBancoLocal(valor, banco) {
  // URL inválida pode aparecer na exceção nativa com as credenciais.
  const url = URL.parse(valor || '');
  assert.ok(
    url && ['postgresql:', 'postgres:'].includes(url.protocol) &&
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
    url.pathname === `/${banco}` && !url.search && !url.hash &&
    url.username && !/%(?![\da-f]{2})/i.test(url.username + url.password),
    `Configure uma URL local para ${banco}.`,
  );
  return url;
}

async function abrirSchemaDeTeste(valor, banco, prefixo) {
  assert.match(prefixo, /^[a-z][a-z_]{0,30}$/);
  const url = validarBancoLocal(valor, banco);
  const schema = `${prefixo}_${randomBytes(8).toString('hex')}`;
  const options = `-c search_path=${schema}`;
  const ambiente = {
    DB_HOST: url.hostname,
    DB_PORT: url.port || '5432',
    DB_NAME: banco,
    DB_USER: decodeURIComponent(url.username),
    DB_PASSWORD: decodeURIComponent(url.password),
    DB_SSL: 'false',
    PGOPTIONS: options,
  };
  const pool = new Pool({ connectionString: url.href, options, ssl: false, connectionTimeoutMillis: 5000 });
  try {
    assert.equal((await pool.query('SELECT current_database() AS banco')).rows[0].banco, banco);
    await pool.query(`CREATE SCHEMA "${schema}"`);
  } catch (erro) {
    await pool.end();
    throw erro;
  }

  async function fechar() {
    try { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await pool.end(); }
  }

  return { pool, ambiente, fechar };
}

module.exports = { abrirSchemaDeTeste, validarBancoLocal };
