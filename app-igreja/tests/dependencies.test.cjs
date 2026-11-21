const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createFingerprintAsync } = require('@expo/fingerprint');

test('ngrok continua gerando UUID v4 com a dependência corrigida', () => {
  const requireNgrok = createRequire(require.resolve('@expo/ngrok'));
  const uuid = requireNgrok('uuid');
  assert.match(uuid.v4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('Expo consegue gerar fingerprint Android com minimatch corrigido', async () => {
  const fingerprint = await createFingerprintAsync(process.cwd(), { platforms: ['android'] });
  assert.ok(fingerprint.hash);
});
// A configuração de release é validada antes do build remoto, sem usar credenciais reais.
const { checkReleaseConfig } = require('../scripts/check-release-config.cjs');
const { execFileSync } = require('node:child_process');
const preview = { EAS_BUILD_PROFILE: 'preview', EAS_BUILD_PLATFORM: 'android',
  EXPO_PUBLIC_API_URL: 'https://agenda-adp-api-homologacao.onrender.com', EXPO_PUBLIC_PUSH_ENABLED: 'true', GOOGLE_SERVICES_JSON: 'fixture.json' };
const firebase = { project_info: { project_id: 'agenda-adp' }, client: [{
  client_info: { mobilesdk_app_id: 'fake-test-app', android_client_info: { package_name: 'br.com.agendaadp.app' } }, api_key: [{ current_key: 'test-only' }],
}] };
const file = value => () => JSON.stringify(value);

test('release Android preview aceita exclusivamente a configuração esperada', () => {
  assert.doesNotThrow(() => checkReleaseConfig(preview, file(firebase)));
  assert.throws(() => checkReleaseConfig({ ...preview, EXPO_PUBLIC_API_URL: 'https://app-igreja-eks0.onrender.com' }, file(firebase)), /API_URL/);
  assert.throws(() => checkReleaseConfig({ ...preview, EXPO_PUBLIC_API_URL: undefined }, file(firebase)), /API_URL/);
  assert.throws(() => checkReleaseConfig({ ...preview, EXPO_PUBLIC_PUSH_ENABLED: 'false' }, file(firebase)), /Ative/);
  assert.throws(() => checkReleaseConfig({ ...preview, EXPO_PUBLIC_PUSH_ENABLED: 'yes' }, file(firebase)), /true ou false/);
});

test('release Android rejeita arquivo Firebase ausente, inválido ou de outro app', () => {
  assert.throws(() => checkReleaseConfig({ ...preview, GOOGLE_SERVICES_JSON: undefined }, file(firebase)), /ausente/);
  assert.throws(() => checkReleaseConfig(preview, () => '{'), /legível/);
  assert.throws(() => checkReleaseConfig(preview, file({ type: 'service_account', private_key: 'test-only' })), /chave privada/);
  assert.throws(() => checkReleaseConfig(preview, file({ ...firebase, project_info: { project_id: 'other' } })), /projeto Firebase/);
  assert.throws(() => checkReleaseConfig(preview, file({ ...firebase, client: [] })), /aplicativo Android/);
});

test('release iOS não depende de Firebase Android e produção não aceita URL de homologação', () => {
  assert.doesNotThrow(() => checkReleaseConfig({ ...preview, EAS_BUILD_PLATFORM: 'ios', GOOGLE_SERVICES_JSON: undefined }));
  for (const profile of ['production', 'production-apk']) {
    assert.throws(() => checkReleaseConfig({ ...preview, EAS_BUILD_PROFILE: profile }, file(firebase)), /API_URL/);
    assert.doesNotThrow(() => checkReleaseConfig({ ...preview, EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_API_URL: 'https://app-igreja-eks0.onrender.com', EXPO_PUBLIC_PUSH_ENABLED: 'false', GOOGLE_SERVICES_JSON: undefined }));
  }
});

test('configuração nativa remove câmera e microfone, preserva galeria e notificações', () => {
  const config = JSON.parse(execFileSync(process.execPath, [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'], {
    encoding: 'utf8', env: { ...process.env, EXPO_OFFLINE: '1', GOOGLE_SERVICES_JSON: '' }, maxBuffer: 10 * 1024 * 1024,
  }));
  assert.equal(config.android.package, 'br.com.agendaadp.app');
  assert.equal(config.ios.bundleIdentifier, 'br.com.agendaadp.app');
  const permissions = config._internal.modResults.android.manifest.manifest['uses-permission'];
  for (const permission of ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO']) {
    assert.ok(permissions.some(item => item.$['android:name'] === permission && item.$['tools:node'] === 'remove'));
    assert.ok(!config.android.permissions.includes(permission));
  }
  assert.match(config.ios.infoPlist.NSPhotoLibraryUsageDescription, /Agenda ADP/);
  assert.equal(config.ios.infoPlist.NSMicrophoneUsageDescription, undefined);
  assert.equal(config.ios.infoPlist.NSCameraUsageDescription, undefined);
  assert.ok(config.ios.entitlements['aps-environment']);
});
