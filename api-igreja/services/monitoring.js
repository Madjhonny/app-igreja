const { performance } = require('node:perf_hooks');

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function requestMonitoring({ logger = console, now = () => performance.now(), slowMs = 1000 } = {}) {
  return (req, res, next) => {
    const start = now();
    let recorded = false;
    const record = (aborted) => {
      if (recorded) return;
      recorded = true;
      const duration = Math.max(0, Math.round(now() - start));
      const status = aborted ? 499 : res.statusCode;
      // Express route.path vem da definição da rota, não da URL do cliente.
      // Nunca registrar URL, query, parâmetros, corpo, headers ou identidade.
      const route = typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      if (route === '/health' && status === 200 && duration < slowMs) return;
      const level = status >= 500 ? 'error' : aborted || status === 429 || duration >= slowMs ? 'warn' : 'info';
      try {
        logger[level](JSON.stringify({
          event: 'http_request', method: METHODS.has(req.method) ? req.method : 'OTHER',
          route, status, duration_ms: duration, slow: duration >= slowMs, aborted,
        }));
      } catch { /* A observabilidade nunca impede uma resposta. */ }
    };
    res.once('finish', () => record(false));
    res.once('close', () => record(!res.writableFinished));
    next();
  };
}

function healthHandler(pool, { timeoutMs = 2000, cacheMs = 5000, now = Date.now } = {}) {
  let pending;
  let last;
  return async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (last && now() < last.expires) {
      return res.status(last.ok ? 200 : 503).json({ status: last.ok ? 'ok' : 'unavailable' });
    }
    if (!pending) {
      const check = Promise.resolve().then(() => pool.query({ text: 'SELECT 1', query_timeout: timeoutMs }))
        .then(() => true, () => false);
      pending = check;
      void check.then(ok => {
        last = { ok, expires: now() + cacheMs };
        pending = undefined;
      });
    }
    let timer;
    try {
      const ok = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
      return res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { requestMonitoring, healthHandler };
