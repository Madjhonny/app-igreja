import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const publicFile = (name) => new URL('../public/' + name, import.meta.url);
const origin = 'https://app.example';
const workerSource = readFileSync(publicFile('sw.js'), 'utf8');

function worker(fetchImpl) {
  const listeners = {};
  let activated = false;
  let installed = false;
  vm.runInNewContext(workerSource, {
    URL,
    Response,
    fetch: fetchImpl,
    self: {
      location: { origin },
      addEventListener: (name, listener) => { listeners[name] = listener; },
      skipWaiting: async () => { installed = true; },
      clients: { claim: async () => { activated = true; } },
    },
  });
  return {
    async runLifecycle() {
      for (const type of ['install', 'activate']) {
        let done;
        listeners[type]({ waitUntil: (promise) => { done = promise; } });
        await done;
      }
      assert.ok(installed);
      assert.ok(activated);
    },
    request(options = {}) {
      let response;
      listeners.fetch({
        request: { method: 'GET', mode: 'navigate', url: origin + '/login', ...options },
        respondWith: (promise) => { response = promise; },
      });
      return response;
    },
  };
}

test('manifest e ícones instaláveis, com identidade e tamanhos corretos', () => {
  const manifest = JSON.parse(readFileSync(publicFile('manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'Agenda ADP');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, '/');
  for (const size of [180, 192, 512]) {
    const file = readFileSync(publicFile('pwa/icon-' + size + '.png'));
    assert.equal(file.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(file.readUInt32BE(16), size);
    assert.equal(file.readUInt32BE(20), size);
    if (size !== 180) {
      assert.ok(manifest.icons.some((icon) =>
        icon.src === '/pwa/icon-' + size + '.png' &&
        icon.sizes === size + 'x' + size &&
        icon.type === 'image/png'));
    }
  }
});

test('worker ativa e obtém páginas pela rede sem cache', async () => {
  const w = worker(async (request, opts) => {
    assert.equal(request.url, origin + '/login');
    assert.equal(opts.cache, 'no-store');
    return new Response('online');
  });
  await w.runLifecycle();
  assert.equal(await (await w.request()).text(), 'online');
});

test('offline responde apenas com uma página genérica sem dados de usuário', async () => {
  const w = worker(async () => { throw new TypeError('offline'); });
  const response = await w.request({ url: origin + '/perfil?token=segredo-ficticio' });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.match(body, /Você está sem conexão/);
  assert.doesNotMatch(body, /segredo-ficticio/);
});

test('worker não intercepta API, upload, fotos ou recursos externos', () => {
  const w = worker(() => { throw new Error('não deve buscar'); });
  assert.equal(w.request({ url: origin + '/session', mode: 'cors' }), undefined);
  assert.equal(w.request({ url: origin + '/mural', method: 'POST' }), undefined);
  assert.equal(w.request({ url: origin + '/perfil', mode: 'no-cors' }), undefined);
  assert.equal(w.request({ url: 'https://api.example/session' }), undefined);
  assert.equal(w.request({ url: 'https://res.cloudinary.com/image' }), undefined);
});

test('erros HTTP permanecem visíveis em vez de simular offline', async () => {
  for (const status of [401, 403, 404, 500]) {
    const w = worker(async () => new Response('erro', { status }));
    assert.equal((await w.request()).status, status);
  }
});

test('registro do worker é limitado ao contexto seguro e não bloqueia o app', async () => {
  const source = readFileSync(publicFile('pwa-register.js'), 'utf8');
  for (const secure of [true, false]) {
    let calls = 0;
    vm.runInNewContext(source, {
      window: { isSecureContext: secure },
      navigator: {
        serviceWorker: {
          register: (path, options) => {
            calls++;
            assert.equal(path, '/sw.js');
            assert.equal(options.scope, '/');
            assert.equal(options.updateViaCache, 'none');
            return Promise.reject(new Error('indisponível'));
          },
        },
      },
      document: { readyState: 'complete' },
    });
    assert.equal(calls, secure ? 1 : 0);
  }
});
