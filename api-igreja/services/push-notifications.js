const { createHash } = require('node:crypto');

const validToken = token => typeof token === 'string' && /^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(token);
const validKey = key => typeof key === 'string' && /^[0-9a-f]{64}$/.test(key);
const hashKey = key => createHash('sha256').update(key).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));

function createPushNotifications({ pool, accessToken, fetchImpl = fetch, logger = console, now = Date.now }) {
  if (!accessToken || /\s/.test(accessToken)) throw new Error('Credencial de push ausente ou inválida.');
  const log = code => { try { logger.warn(JSON.stringify({ event: 'push_delivery', code })); } catch {} };

  async function register(user, body) {
    if (user.status_conta !== 'APROVADO' || !user.congregacao_id || !exact(body, ['token', 'key', 'platform']) ||
      !validToken(body.token) || !validKey(body.key) || !['android', 'ios'].includes(body.platform)) return false;
    await pool.query(`INSERT INTO push_devices (usuario_id, token, revoke_hash, platform, token_version)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT (token) DO UPDATE SET usuario_id = EXCLUDED.usuario_id,
      revoke_hash = EXCLUDED.revoke_hash, platform = EXCLUDED.platform, token_version = EXCLUDED.token_version, expires_at = NOW() + INTERVAL '30 days'`,
    [user.id, body.token, hashKey(body.key), body.platform, Number(user.token_version || 0)]);
    return true;
  }

  async function revoke(body) {
    if (!exact(body, ['key']) || !validKey(body.key)) return false;
    await pool.query('DELETE FROM push_devices WHERE revoke_hash = $1', [hashKey(body.key)]);
    return true;
  }

  // Called inside the event publication transaction: one generic message per device/congregation per batch.
  async function enqueue(client, congregationIds) {
    const ids = [...new Set(congregationIds.map(Number))];
    if (!ids.length) return;
    await client.query(`INSERT INTO push_jobs (device_id, revoke_hash, congregacao_id)
      SELECT d.id, d.revoke_hash, u.congregacao_id FROM push_devices d JOIN usuarios u ON u.id = d.usuario_id
      WHERE u.status_conta = 'APROVADO' AND u.token_version = d.token_version AND u.congregacao_id = ANY($1::integer[]) AND d.expires_at > NOW()`, [ids]);
  }

  async function expo(path, body) {
    const result = await fetchImpl(`https://exp.host/--/api/v2/push/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!result.ok) throw new Error('provider unavailable');
    const data = await result.json();
    return data.data;
  }

  async function removeJob(job, result) {
    if (result?.details?.error === 'DeviceNotRegistered') {
      await pool.query('DELETE FROM push_devices WHERE id = $1 AND revoke_hash = $2', [job.device_id, job.revoke_hash]);
    }
    await pool.query('DELETE FROM push_jobs WHERE id = $1', [job.id]);
  }

  async function sendBatch() {
    const { rows } = await pool.query(`WITH candidates AS (
      SELECT j.id FROM push_jobs j JOIN push_devices d ON d.id = j.device_id AND d.revoke_hash = j.revoke_hash
      JOIN usuarios u ON u.id = d.usuario_id WHERE j.state = 'queued' AND j.due_at <= NOW()
      AND j.created_at > NOW() - INTERVAL '24 hours' AND d.expires_at > NOW()
      AND u.status_conta = 'APROVADO' AND u.token_version = d.token_version AND u.congregacao_id = j.congregacao_id
      ORDER BY j.id LIMIT 100 FOR UPDATE OF j SKIP LOCKED
    ) UPDATE push_jobs j SET state = 'sending', due_at = NOW() + INTERVAL '2 minutes'
      FROM candidates c, push_devices d WHERE j.id = c.id AND d.id = j.device_id
      RETURNING j.id, j.device_id, j.revoke_hash, d.token`);
    if (!rows.length) return 0;
    let tickets;
    try {
      tickets = await expo('send', rows.map(row => ({ to: row.token, title: 'Agenda ADP',
        body: 'Há novidades na agenda. Abra o aplicativo para conferir.', channelId: 'agenda', ttl: 3600 })));
      if (!Array.isArray(tickets) || tickets.length !== rows.length) throw new Error('unexpected tickets');
    } catch {
      // Não reenviar um POST de resultado ambíguo: evita avisos duplicados.
      log('send_uncertain');
      await pool.query('DELETE FROM push_jobs WHERE id = ANY($1::bigint[])', [rows.map(row => row.id)]);
      return rows.length;
    }
    for (let i = 0; i < rows.length; i++) {
      const job = rows[i], ticket = tickets[i];
      if (ticket?.status === 'ok' && typeof ticket.id === 'string' && ticket.id.length <= 200) {
        await pool.query("UPDATE push_jobs SET state = 'receipt', ticket_id = $2, due_at = NOW() + INTERVAL '15 minutes' WHERE id = $1", [job.id, ticket.id]);
      } else { await removeJob(job, ticket); log('ticket_error'); }
    }
    return rows.length;
  }

  async function receipts() {
    const { rows } = await pool.query(`WITH candidates AS (SELECT id FROM push_jobs WHERE state = 'receipt' AND due_at <= NOW()
      ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED) UPDATE push_jobs j SET due_at = NOW() + INTERVAL '15 minutes'
      FROM candidates c WHERE j.id = c.id RETURNING j.id, j.device_id, j.revoke_hash, j.ticket_id`);
    if (!rows.length) return;
    try {
      // A consulta de recibos é idempotente; os ausentes serão consultados de novo enquanto válidos.
      const data = await expo('getReceipts', { ids: rows.map(row => row.ticket_id) });
      for (const row of rows) if (data?.[row.ticket_id]) await removeJob(row, data[row.ticket_id]);
    } catch { log('receipt_unavailable'); }
  }

  let running = false, queued = false, last = -Infinity;
  async function drain() {
    await pool.query("DELETE FROM push_devices WHERE expires_at <= NOW()");
    await pool.query("DELETE FROM push_jobs WHERE created_at <= NOW() - INTERVAL '24 hours' OR (state = 'sending' AND due_at <= NOW())");
    await receipts();
    for (let i = 0; i < 10; i++) if (await sendBatch() < 100) break;
  }
  function kick(force = false) {
    if (running) { if (force) queued = true; return; }
    if (!force && now() - last < 60_000) return;
    last = now(); running = true;
    void drain().catch(() => log('queue_unavailable')).finally(() => {
      running = false;
      if (queued) { queued = false; kick(true); }
    });
  }
  return { register, revoke, enqueue, drain, kick };
}

module.exports = { createPushNotifications, validToken, validKey };
