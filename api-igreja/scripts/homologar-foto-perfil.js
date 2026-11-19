// Somente homologação. Conta e imagens sintéticas são criadas e removidas.
const { randomBytes, randomUUID, randomInt } = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const HOST = 'ep-withered-sound-b62ra3xx.c-2.sa-east-1.aws.neon.tech';
const CLOUD = 'us1snykz';
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
const bytes = Buffer.from(IMAGE.split(',')[1], 'base64');
const check = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { safeMessage: message }); };

if (process.argv[2] === '--api-child') {
  assert.equal(process.env.DB_HOST, HOST);
  assert.equal(process.env.CLOUDINARY_PROFILE_ENABLED, 'true');
  const express = require('express');
  const listen = express.application.listen;
  express.application.listen = function () {
    const server = listen.call(this, Number(process.env.PORT), '127.0.0.1', () => process.send({ ready: true }));
    return server;
  };
  require('../server');
} else main().catch(error => {
  console.error('HOMOLOGACAO DE PERFIL REPROVADA:', error.safeMessage || error.code || error.name);
  process.exitCode = 1;
});

async function main() {
  const { Pool } = require('pg');
  const { parse } = require('dotenv');
  const { createCloudinaryProfileMedia, newProfilePublicId } = require('../services/cloudinary-profile-media');
  const { createProfileLinks, createProfileStorage } = require('../services/profile-photo-storage');
  const cfg = parse(readFileSync(process.argv[2]));
  const dbPassword = process.env.AGENDA_TEST_DB_PASSWORD || cfg.DB_PASSWORD;
  const key = process.env.AGENDA_CLOUDINARY_TEST_KEY;
  const secret = process.env.AGENDA_CLOUDINARY_TEST_SECRET;
  check(cfg.DB_USER && cfg.DB_NAME && dbPassword && key && secret, 'Configuração de teste ausente.');
  const pool = new Pool({ host: HOST, port: 5432, user: cfg.DB_USER, password: dbPassword, database: cfg.DB_NAME,
    ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000, statement_timeout: 15000 });
  const media = createCloudinaryProfileMedia({ env: { CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } });
  const jwtSecret = randomBytes(48).toString('hex');
  const email = `homologacao-${randomUUID()}@example.invalid`;
  const senha = `AgendaTeste${randomBytes(16).toString('hex')}1`;
  const cpf = `9${randomInt(1000000000, 9999999999)}`;
  const snapshot = async () => (await pool.query('SELECT id, md5(to_jsonb(u)::text) AS hash FROM usuarios u ORDER BY id')).rows;
  const assets = async () => (await pool.query('SELECT public_id,user_id FROM profile_cloudinary_assets ORDER BY public_id')).rows;
  let child, base, token, userId, before, beforeAssets, storage;
  async function api(route, method = 'GET', body, expected = 200, auth = true) {
    const res = await fetch(base + route, { method, headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(90000) });
    check(res.status === expected, `${method} ${route.split('?')[0]}: HTTP ${res.status}, esperado ${expected}.`);
    return res.json();
  }
  async function photo(link, expected = 200) {
    const res = await fetch(link, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    check(res.status === expected, `Foto: HTTP ${res.status}, esperado ${expected}.`);
    if (expected === 200) check(res.headers.get('content-type') === 'image/png' && Buffer.from(await res.arrayBuffer()).equals(bytes), 'Conteúdo de foto difere.');
    else await res.body?.cancel();
  }
  try {
    const ready = await pool.query("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE filename='20261119_profile_cloudinary_assets.sql') AS ready");
    check(ready.rows[0]?.ready, 'Migração de perfil ausente.');
    console.log('OK: banco de homologação confirmado.');
    before = await snapshot(); beforeAssets = await assets();
    // Testa o provedor sem enviar nenhuma foto real.
    const probe = newProfilePublicId();
    try {
      const ref = await media.upload(IMAGE, probe);
      check((await media.read(ref)).bytes.equals(bytes), 'Leitura autenticada diverge.');
      const denied = await fetch(ref, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      check([401, 403, 404].includes(denied.status), 'Cloudinary permitiu acesso sem assinatura.');
      await denied.body?.cancel();
      console.log('OK: foto sintética protegida no Cloudinary; acesso sem assinatura bloqueado.');
    } finally { await media.remove(probe); }
    const socket = createServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    base = `http://127.0.0.1:${port}`;
    storage = createProfileStorage({ pool, media, links: createProfileLinks({ media, jwtSecret, origin: base }) });
    child = fork(__filename, ['--api-child'], { cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(port), DB_HOST: HOST, DB_PORT: '5432',
      DB_USER: cfg.DB_USER, DB_NAME: cfg.DB_NAME, DB_PASSWORD: dbPassword, DB_SSL: 'true', JWT_SECRET: jwtSecret,
      CLOUDINARY_PROFILE_ENABLED: 'true', PROFILE_MEDIA_BASE_URL: base, CLOUDINARY_CLOUD_NAME: CLOUD,
      CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret, RESEND_API_KEY: '', EMAIL_FROM: '', TRUST_PROXY_HOPS: '0',
    } });
    let timeout;
    try {
      await Promise.race([once(child, 'message'), once(child, 'exit').then(() => check(false, 'API não iniciou.')),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Timeout')), 30000); })]);
    } finally { clearTimeout(timeout); }
    const congregacao = (await pool.query('SELECT id FROM congregacoes ORDER BY id LIMIT 1')).rows[0];
    check(congregacao, 'Congregação de teste não encontrada.');
    const created = await api('/cadastro', 'POST', { nome_completo: 'Homologacao perfil', email, senha, cpf, telefone: '21999999999', congregacao_id: congregacao.id, foto_perfil: IMAGE }, 201, false);
    userId = created.usuario.id;
    const login = await api('/login', 'POST', { email, senha }, 200, false);
    token = login.token;
    const link = login.usuario.foto_perfil;
    check(link.startsWith(`${base}/usuarios/${userId}/foto?`), 'Login não devolveu link temporário.');
    await photo(link);
    const raw = (await pool.query('SELECT foto_perfil FROM usuarios WHERE id=$1', [userId])).rows[0].foto_perfil;
    const asset = media.parse(raw);
    check(asset && (await pool.query('SELECT 1 FROM profile_cloudinary_assets WHERE user_id=$1 AND public_id=$2', [userId, asset.publicId])).rowCount === 1, 'Vínculo da foto não registrado.');
    console.log('OK: cadastro, login e sessão com URL privada e vínculo no banco.');
    const session = await api('/sessao'); await photo(session.usuario.foto_perfil);
    await photo(`${base}/usuarios/${userId}/foto`, 403);
    const tampered = new URL(link); tampered.searchParams.set('sig', '0'.repeat(64)); await photo(tampered.href, 403);
    const publicProfile = await api(`/usuarios/${userId}/perfil-publico`); await photo(publicProfile.foto_perfil);
    await api(`/usuarios/${userId}/perfil-publico`, 'GET', undefined, 401, false);
    const mural = await api('/publico/mural', 'GET', undefined, 200, false);
    check(mural.every(post => !Object.hasOwn(post, 'autor_foto')), 'Mural público expôs foto de perfil.');
    console.log('OK: link adulterado e acesso anônimo bloqueados; mural público sem foto de perfil.');
    const update = { nome_exibicao: 'Homologacao perfil', bio: 'Teste', foto_perfil: link };
    const retain = await api('/usuarios/perfil', 'PUT', update); await photo(retain.usuario.foto_perfil);
    check((await pool.query('SELECT foto_perfil FROM usuarios WHERE id=$1', [userId])).rows[0].foto_perfil === raw, 'Alterar biografia substituiu a foto.');
    await api('/usuarios/perfil', 'PUT', { ...update, foto_perfil: raw }, 400);
    const replace = await api('/usuarios/perfil', 'PUT', { ...update, foto_perfil: IMAGE });
    await photo(replace.usuario.foto_perfil);
    await photo(link, 404);
    check(!(await pool.query('SELECT 1 FROM profile_cloudinary_assets WHERE public_id=$1', [asset.publicId])).rowCount, 'Foto antiga pendente de exclusão.');
    console.log('OK: edição sem trocar foto e substituição com revogação da antiga.');
    await api('/usuarios/perfil', 'PUT', { ...update, foto_perfil: null });
    await photo(replace.usuario.foto_perfil, 404);
    check(!(await pool.query('SELECT 1 FROM profile_cloudinary_assets WHERE user_id=$1', [userId])).rowCount, 'Foto não desvinculada.');
    console.log('OK: remoção da foto revoga o link.');
  } finally {
    try {
      // Não usa ID fornecido pelo cliente: localiza somente o e-mail sintético desta execução.
      if (storage) {
        const found = await pool.query('SELECT id FROM usuarios WHERE email=$1', [email]);
        for (const row of found.rows) {
          const linked = (await pool.query('SELECT public_id FROM profile_cloudinary_assets WHERE user_id=$1', [row.id])).rows;
          await pool.query('DELETE FROM usuarios WHERE id=$1 AND email=$2', [row.id, email]);
          for (const a of linked) await storage.cleanup(a.public_id);
        }
      }
      if (before) check(JSON.stringify(await snapshot()) === JSON.stringify(before) && JSON.stringify(await assets()) === JSON.stringify(beforeAssets), 'Dados antigos divergentes ou imagens pendentes de limpeza.');
      if (before) console.log('OK: conta sintética removida e perfis existentes preservados.');
    } finally { if (child) child.kill(); await pool.end(); }
  }
  console.log('HOMOLOGACAO DE PERFIL APROVADA!');
}
