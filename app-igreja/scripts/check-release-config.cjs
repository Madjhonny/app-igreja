const fs = require('node:fs');
const app = require('../app.json').expo;

const environments = {
  preview: 'https://agenda-adp-api-homologacao.onrender.com',
  production: 'https://app-igreja-eks0.onrender.com',
  'production-apk': 'https://app-igreja-eks0.onrender.com',
};

function checkReleaseConfig(env, readFile = filename => fs.readFileSync(filename, 'utf8')) {
  const profile = env.EAS_BUILD_PROFILE;
  if (!Object.hasOwn(environments, profile)) return;
  if (env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') !== environments[profile]) {
    throw Error(`EXPO_PUBLIC_API_URL não corresponde ao perfil ${profile}.`);
  }
  const enabled = env.EXPO_PUBLIC_PUSH_ENABLED;
  if (enabled !== undefined && !['true', 'false'].includes(enabled)) throw Error('EXPO_PUBLIC_PUSH_ENABLED deve ser true ou false.');
  // O próximo APK preview precisa efetivamente testar a entrega de notificações.
  if (profile === 'preview' && enabled !== 'true') throw Error('Ative EXPO_PUBLIC_PUSH_ENABLED=true no ambiente preview para homologar notificações.');
  if (env.EAS_BUILD_PLATFORM !== 'android') return;
  if (!env.GOOGLE_SERVICES_JSON) {
    if (enabled === 'true') throw Error('GOOGLE_SERVICES_JSON ausente; configure a variável de arquivo do EAS.');
    return;
  }
  let config;
  try { config = JSON.parse(readFile(env.GOOGLE_SERVICES_JSON)); }
  catch { throw Error('GOOGLE_SERVICES_JSON não contém um arquivo JSON Android legível.'); }
  if (config?.type === 'service_account' || config?.private_key || config?.private_key_id) throw Error('GOOGLE_SERVICES_JSON não pode ser uma chave privada de conta de serviço.');
  if (config?.project_info?.project_id !== 'agenda-adp') throw Error('GOOGLE_SERVICES_JSON deve pertencer ao projeto Firebase agenda-adp.');
  const matching = Array.isArray(config.client) && config.client.some(client =>
    client?.client_info?.android_client_info?.package_name === app.android.package &&
    typeof client.client_info.mobilesdk_app_id === 'string' && client.client_info.mobilesdk_app_id.length > 0 &&
    Array.isArray(client.api_key) && client.api_key.some(key => typeof key?.current_key === 'string' && key.current_key.length > 0));
  if (!matching) throw Error('GOOGLE_SERVICES_JSON não contém a configuração do aplicativo Android br.com.agendaadp.app.');
}

if (require.main === module) {
  try { checkReleaseConfig(process.env); console.log('Configuração de release verificada.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkReleaseConfig };
