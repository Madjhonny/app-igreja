/* global self, fetch, Response, URL */
// Sem cache de HTML, API, sessão, imagens, dados de perfil ou outros recursos.
// Somente navegações GET na própria origem recebem uma página offline sintética.
const OFFLINE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#2A4B4C">
  <title>Sem conexão | Agenda ADP</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;background:#F7F5EC;color:#2A4B4C;font:16px system-ui,sans-serif;padding:24px}
    main{max-width:420px;width:100%;text-align:center;padding:32px 24px;background:white;border:1px solid #E2EAE9;border-radius:24px}
    .brand{font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:13px}
    h1{font-size:26px;margin:20px 0 12px}p{line-height:1.6}
    a{display:inline-block;background:#2A4B4C;color:white;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:600;margin:12px 0 4px}
    a:focus-visible{outline:3px solid #2A4B4C;outline-offset:4px}
  </style>
</head>
<body>
  <main>
    <div class="brand">Agenda ADP</div>
    <h1>Você está sem conexão</h1>
    <p>Conecte-se à internet para acessar a agenda, os eventos e seu perfil.</p>
    <a href="/">Tentar novamente</a>
  </main>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate' ||
      new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Use sempre a rede; erros HTTP devem continuar visíveis normalmente.
  event.respondWith(fetch(request, { cache: 'no-store' }).catch(() =>
    new Response(OFFLINE_HTML, {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  ));
});
