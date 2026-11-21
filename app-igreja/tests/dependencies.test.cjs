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
