// Teste manual de integração real. Não é executado pelo CI nem em produção.
// Usa apenas a branch temporária dedicada e apaga apenas o post desta execução.
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const HOST = 'ep-withered-sound-b62ra3xx.c-2.sa-east-1.aws.neon.tech';
const CLOUD = 'us1snykz';
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

// A API real roda em um subprocesso de vida curta, exclusivamente em loopback.
if (process.argv[2] === '--api-child') {
  assert.equal(process.env.DB_HOST, HOST);
  assert.equal(process.env.CLOUDINARY_MURAL_ENABLED, 'true');
  const express = require('express');
  const listen = express.application.listen;
  express.application.listen = function () {
    const server = listen.call(this, 0, '127.0.0.1', () => {
      process.send({ port: server.address().port });
    });
    return server;
  };
  require('../server');
} else {
  main().catch(error => {
    // Não imprime respostas HTTP, strings de conexão, configuração ou tokens.
    console.error('HOMOLOGACAO REPROVADA:', error.safeMessage || error.code || error.name);
    process.exitCode = 1;
  });
}

function check(condition, message) {
  if (!condition) {
    const error = new Error('Falha de homologação');
    error.safeMessage = message;
    throw error;
  }
}

async function main() {
  const { Pool } = require('pg');
  const jwt = require('jsonwebtoken');
  const dotenv = require('dotenv');
  check(process.argv.length === 3, 'Informe o caminho do .env local existente.');
  const original = dotenv.parse(readFileSync(process.argv[2]));
  const secret = process.env.AGENDA_CLOUDINARY_TEST_SECRET;
  const apiKey = process.env.AGENDA_CLOUDINARY_TEST_KEY;
  check(secret && !/\s/.test(secret), 'Informe o API Secret da chave Backend V2.');
  check(/^\d+$/.test(apiKey || ''), 'Informe a API Key da chave Backend V2.');
  const user = original.DB_USER;
  const password = process.env.AGENDA_TEST_DB_PASSWORD || original.DB_PASSWORD;
  check(user && password && original.DB_NAME, 'Credenciais do banco ausentes no .env local.');
  const config = {
    host: HOST, port: 5432, user, password, database: original.DB_NAME,
    ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
  };
  const pool = new Pool(config);
  const title = `HOMOLOGACAO CLOUDINARY ${randomUUID()}`;
  const jwtSecret = randomBytes(48).toString('hex');
  let child, base, token, testId, publicId, before, assetsBefore;
  let testPassed = false;
  let cleanupPassed = false;
  async function api(route, { method = 'GET', body, auth = true, status = 200 } = {}) {
    const res = await fetch(`${base}${route}`, {
      method, headers: {
        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      }, body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    check(res.status === status, `${method} ${route.split('?')[0]}: HTTP ${res.status}, esperado ${status}.`);
    return res.json();
  }
  const snapshot = async () => (await pool.query(
    'SELECT id, md5(midia) AS hash FROM mural_eventos ORDER BY id'
  )).rows;
  const assetsSnapshot = async () => (await pool.query(
    'SELECT public_id, post_id FROM mural_cloudinary_assets ORDER BY public_id'
  )).rows;
  try {
    const guard = await pool.query(`SELECT EXISTS (SELECT 1 FROM schema_migrations
      WHERE filename = '20261119_mural_cloudinary_assets.sql') AS ready`);
    check(guard.rows[0]?.ready, 'Migração de homologação não encontrada.');
    console.log('OK: conexão com banco de homologação e migração.');
    const manager = (await pool.query(`SELECT id, token_version FROM usuarios
      WHERE nivel_acesso = 'MASTER' AND status_conta = 'APROVADO' ORDER BY id LIMIT 1`)).rows[0];
    check(manager, 'Não existe MASTER aprovado na cópia de homologação.');
    token = jwt.sign({ id: Number(manager.id), token_version: Number(manager.token_version || 0) }, jwtSecret, { expiresIn: '10m' });
    before = await snapshot();
    assetsBefore = await assetsSnapshot();
    const activeLegacy = (await pool.query(`SELECT id, midia FROM mural_eventos
      WHERE data_fim >= CURRENT_DATE AND LEFT(midia, 5) = 'data:'`)).rows;
    // Não herda o JWT nem o host de produção nem configurações de e-mail.
    child = fork(__filename, ['--api-child'], {
      cwd: path.resolve(__dirname, '..'),
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        DB_HOST: HOST, DB_PORT: '5432', DB_USER: user, DB_PASSWORD: password,
        DB_NAME: original.DB_NAME, DB_SSL: 'true', JWT_SECRET: jwtSecret,
        CLOUDINARY_MURAL_ENABLED: 'true', CLOUDINARY_CLOUD_NAME: CLOUD,
        CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: secret,
        RESEND_API_KEY: '', EMAIL_FROM: '', TRUST_PROXY_HOPS: '0' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let timeout;
    try {
      const [{ port }] = await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(() => { check(false, 'API local não iniciou.'); }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Timeout API local')), 30000); }),
      ]);
      check(Number.isInteger(port) && port > 0, 'Porta local inválida.');
      base = `http://127.0.0.1:${port}`;
    } finally { clearTimeout(timeout); }
    const oldList = await api('/mural');
    const oldLight = await api('/mural?midia=link');
    for (const legacy of activeLegacy) {
      check(oldList.find(p => p.id === legacy.id)?.midia === legacy.midia, 'Cliente antigo perdeu a imagem original.');
      const link = oldLight.find(p => p.id === legacy.id)?.midia;
      check(typeof link === 'string' && link.startsWith(`/mural/${legacy.id}/imagem?`), 'Cliente atual não recebeu o link legado.');
      const response = await fetch(base + link, { signal: AbortSignal.timeout(30000), redirect: 'error' });
      check(response.ok && response.headers.get('content-type')?.startsWith('image/'), 'Imagem legada não pôde ser carregada.');
      await response.arrayBuffer();
    }
    console.log(`OK: listagens do mural; ${activeLegacy.length} imagens legadas ativas conferidas.`);
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const body = { titulo: title, descricao: 'Teste automático isolado', local: 'Homologação', tipo_midia: 'imagem', midia: IMAGE, data_inicio: today, data_fim: end };
    await api('/mural', { method: 'POST', body: { ...body, midia: 'data:image/png;base64,YWJj' }, status: 400 });
    console.log('OK: imagem inválida rejeitada.');
    const created = await api('/mural', { method: 'POST', body, status: 201 });
    testId = created.post?.id;
    check(Number.isInteger(testId), 'ID do post de teste não retornado.');
    const stored = (await pool.query(`SELECT m.midia, a.public_id FROM mural_eventos m
      JOIN mural_cloudinary_assets a ON a.post_id=m.id WHERE m.id=$1 AND m.titulo=$2`, [testId, title])).rows[0];
    publicId = stored?.public_id;
    check(publicId && stored.midia === created.post.midia && stored.midia.startsWith(`https://res.cloudinary.com/${CLOUD}/image/upload/`), 'Post não armazenou URL e vínculo Cloudinary.');
    const cdn = await fetch(stored.midia, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    check(cdn.ok && cdn.headers.get('content-type')?.startsWith('image/') && (await cdn.arrayBuffer()).byteLength > 0, 'Imagem do Cloudinary indisponível.');
    console.log('OK: upload real, URL no banco, registro e leitura da imagem no CDN.');
    for (const [route, auth] of [['/mural', true], ['/mural?midia=link', true], ['/publico/mural', false]]) {
      const posts = await api(route, { auth });
      check(posts.find(p => p.id === testId)?.midia === stored.midia, 'Listagem não retornou a imagem Cloudinary.');
    }
    console.log('OK: mural antigo, atual e público exibem a nova imagem.');
    testPassed = true;
  } finally {
    try {
      if (base && token) {
        const found = await pool.query('SELECT id FROM mural_eventos WHERE titulo=$1', [title]);
        for (const post of found.rows) {
          const media = await pool.query('SELECT public_id FROM mural_cloudinary_assets WHERE post_id=$1', [post.id]);
          publicId ||= media.rows[0]?.public_id;
          await api(`/mural/${post.id}`, { method: 'DELETE' });
          const stillExists = await pool.query('SELECT 1 FROM mural_eventos WHERE id=$1', [post.id]);
          check(!stillExists.rowCount, 'O post de teste ainda existe.');
        }
        if (publicId) {
          const remaining = await pool.query('SELECT 1 FROM mural_cloudinary_assets WHERE public_id=$1', [publicId]);
          check(!remaining.rowCount, 'Imagem de teste pendente de limpeza no Cloudinary.');
        }
        check(JSON.stringify(await snapshot()) === JSON.stringify(before), 'As publicações anteriores divergem do estado inicial.');
        check(JSON.stringify(await assetsSnapshot()) === JSON.stringify(assetsBefore), 'Há uma reserva de imagem pendente; aguarde orientação para a limpeza.');
        cleanupPassed = true;
        console.log('OK: limpeza apenas do teste e publicações anteriores preservadas.');
      }
    } finally {
      if (child) child.kill();
      await pool.end();
    }
  }
  check(testPassed && cleanupPassed, 'Teste ou limpeza incompletos.');
  console.log('HOMOLOGACAO CLOUDINARY APROVADA!');
}
