import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bridgeOptions, readSettings } from '../src/config.js';
import { prepareHostOptions } from '../src/credentials.js';
import { seedSubscription } from './fixtures/subscription.js';

test('only host options contain the key; dotenv is parsed as data, and unrelated variables are ignored', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-test-'));
  const envFile = join(dir, '.env');
  try {
    writeFileSync(envFile, 'export KIMI_API_KEY="test-$(do-not-execute)-key"\nANTHROPIC_BASE_URL=https://wrong.invalid\nOPENAI_API_KEY=unrelated\n');
    await seedSubscription(dir, 'test-$(do-not-execute)-key');
    const inherited = { ...process.env };
    const options = bridgeOptions(readSettings({ sourceConfig: 'none', envFile }));
    assert.equal(JSON.stringify(options).includes('test-$(do-not-execute)-key'), false);
    const prepared = await prepareHostOptions(options, dir);
    const env = prepared.acpLaunchSpec.env;
    assert.equal(env.BB_KIMI_CODE_API_KEY, 'test-$(do-not-execute)-key');
    assert.equal(env.KIMI_MODEL_NAME, '');
    assert.equal(env.KIMI_CODE_HOME, join(dir, 'kimi-home'));
    assert.equal(env.KIMI_LOOP_MAX_ATTEMPTS_PER_STEP, '1');
    assert.equal(env.BB_KIMI_EXECUTABLE, 'kimi');
    assert.equal(prepared.acpLaunchSpec.command, process.execPath);
    const healthSpec = (await prepareHostOptions(options, dir, false)).acpLaunchSpec;
    assert.equal(healthSpec.command, 'kimi', 'maintenance must probe the CLI, not the Node launcher');
    assert.deepEqual(healthSpec.args, ['acp']);
    assert.equal(env.ANTHROPIC_BASE_URL, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(JSON.stringify({ ...process.env }) === JSON.stringify(inherited), true, 'parent environment must remain unchanged');
    assert.deepEqual(options.acpLaunchSpec.env, {});
    writeFileSync(envFile, 'KIMI_API_KEY=rotated\n');
    await seedSubscription(dir, 'rotated');
    assert.equal((await prepareHostOptions(options, dir)).acpLaunchSpec.env.BB_KIMI_CODE_API_KEY, 'rotated');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('missing, malformed, and oversized credentials fail without exposing file contents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-test-'));
  const envFile = join(dir, '.env');
  try {
    const options = bridgeOptions(readSettings({ sourceConfig: 'none', envFile }));
    await assert.rejects(() => prepareHostOptions(options, dir), /Cannot read/);
    writeFileSync(envFile, 'OTHER=secret-file-content');
    await assert.rejects(() => prepareHostOptions(options, dir), /must contain/);
    writeFileSync(envFile, 'KIMI_API_KEY="one\ntwo"');
    await assert.rejects(() => prepareHostOptions(options, dir), /single-line/);
    writeFileSync(envFile, 'KIMI_API_KEY=' + 'x'.repeat(65536));
    await assert.rejects(() => prepareHostOptions(options, dir), /Cannot read/);
    await assert.rejects(() => prepareHostOptions(bridgeOptions(readSettings({})), dir), /Set the Kimi/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('configuration rejects relative credentials and non-HTTPS endpoints', async () => {
  assert.throws(() => readSettings({ sourceConfig: 'none', envFile: '.env' }), /absolute/);
  assert.throws(() => readSettings({ baseUrl: 'http://example.com' }), /HTTPS/);
  assert.throws(() => readSettings({ baseUrl: 'https://user:secret@example.com' }), /HTTPS/);
  assert.throws(() => readSettings({ maxContextSize: 'NaN' }), /maxContextSize/);
});
