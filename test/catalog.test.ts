import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { bridgeOptions, readSettings } from '../src/config.js';
import { prepareHostOptions } from '../src/credentials.js';
import { seedSubscription } from './fixtures/subscription.js';

test('catalog keeps subscription and optional external provider credentials separate without changing the source', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-catalog-'));
  const envFile = join(dir, '.env');
  const sourceConfig = join(dir, 'source.toml');
  const original = `default_model = "kimi-code/k3"
[providers."managed:kimi-code"]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
api_key = "old-oauth-token"
[providers."managed:kimi-code".oauth]
access_token = "oauth-private"
[providers.moonshot-cn]
type = "kimi"
base_url = "https://api.moonshot.cn/v1"
api_key = "external-key"
[models."kimi-code/k3"]
provider = "managed:kimi-code"
model = "k3"
display_name = "K3"
max_context_size = 1048576
support_efforts = ["low", "high", "max"]
default_effort = "high"
[models."moonshot-cn/kimi-k3"]
provider = "moonshot-cn"
model = "kimi-k3"
max_context_size = 1048576
`;
  try {
    writeFileSync(envFile, 'KIMI_API_KEY=subscription-test-key\n');
    writeFileSync(sourceConfig, original);
    await seedSubscription(dir, 'subscription-test-key');
    const options = bridgeOptions(readSettings({ envFile, sourceConfig, includeExternalModels: true }));
    const prepared = await prepareHostOptions(options, dir);
    const snapshotPath = join(dir, 'kimi-home/config.toml');
    const text = readFileSync(snapshotPath, 'utf8');
    const snapshot = parse(text) as any;
    assert.equal(Object.keys(snapshot.models).length, 7);
    assert.deepEqual(snapshot.models['kimi-code/k3'].support_efforts, ['low', 'high', 'max']);
    assert.equal(snapshot.models['kimi-code/k3'].max_context_size, 1048576);
    assert.equal(snapshot.default_model, 'kimi-code/k3');
    assert.equal(snapshot.providers['managed:kimi-code'].api_key, undefined);
    assert.equal(snapshot.providers['managed:kimi-code'].oauth, undefined);
    assert.equal(snapshot.providers['managed:kimi-code'].api_key_env, 'BB_KIMI_CODE_API_KEY');
    assert.equal(snapshot.providers['moonshot-cn'].api_key, 'external-key');
    assert.equal(snapshot.providers['moonshot-cn'].base_url, 'https://api.moonshot.cn/v1');
    assert.equal(prepared.acpLaunchSpec.env.BB_KIMI_CODE_API_KEY, 'subscription-test-key');
    assert.equal(text.includes('subscription-test-key'), false);
    assert.equal(text.includes('oauth-private'), false);
    assert.equal(JSON.stringify(options).includes('external-key'), false);
    assert.equal(statSync(snapshotPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(sourceConfig, 'utf8'), original);
    // An unchanged snapshot does not trigger the CLI's config watcher on every turn.
    const modified = statSync(snapshotPath).mtimeMs;
    await prepareHostOptions(options, dir);
    assert.equal(statSync(snapshotPath).mtimeMs, modified);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('API-key-only setup uses subscription catalog metadata and accepts model IDs as default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-catalog-'));
  try {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'KIMI_API_KEY=test-key\n');
    await seedSubscription(dir, 'test-key');
    const prepared = await prepareHostOptions(bridgeOptions(readSettings({ envFile, sourceConfig: 'none', model: 'k3-256k' })), dir);
    const snapshot = parse(readFileSync(join(dir, 'kimi-home/config.toml'), 'utf8')) as any;
    assert.equal(Object.keys(snapshot.models).length, 6);
    assert.equal(prepared.kimiDefaultModel, 'kimi-code/k3-256k');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('K3.1 Pro catalog metadata supports thinking-only, native multimodal tools, and model-ID selection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-k31-'));
  try {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'KIMI_API_KEY=test-key\n');
    await seedSubscription(dir, 'test-key');
    for (const model of ['k3.1-pro', 'k3.1-pro-highspeed']) {
      const prepared = await prepareHostOptions(bridgeOptions(readSettings({ envFile, sourceConfig: 'none', model })), dir);
      const snapshot = parse(readFileSync(join(dir, 'kimi-home/config.toml'), 'utf8')) as any;
      const alias = `kimi-code/${model}`;
      assert.equal(prepared.kimiDefaultModel, alias);
      assert.equal(snapshot.models[alias].model, model);
      assert.equal(snapshot.models[alias].max_context_size, 1048576);
      assert.deepEqual(snapshot.models[alias].support_efforts, ['low', 'high', 'max']);
      assert.equal(snapshot.models[alias].default_effort, 'high');
      for (const capability of ['thinking', 'always_thinking', 'image_in', 'video_in', 'tool_use', 'dynamically_loaded_tools']) {
        assert.ok(snapshot.models[alias].capabilities.includes(capability));
      }
      assert.equal(snapshot.models[alias].provider, 'managed:kimi-code');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
