/* global window, navigator, document */
// A falha do registro jamais deve impedir o uso normal da versão web.
if (window.isSecureContext && 'serviceWorker' in navigator) {
  const register = () => {
    navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).catch(() => {
      // A instalação pode não estar disponível neste navegador.
    });
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}
