import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG_TTL_MS, loadSubscriptionCatalog, parseSubscriptionModels } from '../src/subscription-catalog.js';
import { pickerModels, writeHostCatalog } from '../src/catalog.js';
import { readSettings } from '../src/config.js';

const model = (id: string, context = 262144) => ({ id, display_name: `Name ${id}`, limit: { context },
  reasoning: { type: 'only', effort: { valid: ['low', 'high', 'max'], default: 'max' } },
  modalities: { input: ['text', 'image'] }, tools: { dynamic_load: true } });
const response = (...models: unknown[]) => new Response(JSON.stringify({ data: models, has_more: false }));

test('live catalog replaces retired models, refreshes metadata, and excludes API models by default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-live-catalog-'));
  const sourceConfig = join(dir, 'source.toml');
  try {
    writeFileSync(sourceConfig, `default_model = "kimi-code/old"
[providers."managed:kimi-code"]
type = "kimi"
[providers.external]
type = "kimi"
base_url = "https://external.invalid/v1"
api_key = "external-secret"
[models."kimi-code/old"]
provider = "managed:kimi-code"
model = "old"
max_context_size = 1048576
[models."external/paid"]
provider = "external"
model = "paid"
max_context_size = 262144
`);
    const options = { dataDir: dir, baseUrl: 'https://api.kimi.com/coding/v1', key: 'subscription-secret' };
    const first = await loadSubscriptionCatalog({ ...options, now: 1000, fetchImpl: async () => response(model('old')) });
    const second = await loadSubscriptionCatalog({ ...options, now: 1000 + CATALOG_TTL_MS, fetchImpl: async () => response(model('new', 524288)) });
    assert.deepEqual(Object.keys(first.models), ['kimi-code/old']);
    assert.deepEqual(Object.keys(second.models), ['kimi-code/new']);
    const catalog = writeHostCatalog(readSettings({ sourceConfig }), dir, second);
    assert.deepEqual(Object.keys(catalog.models), ['kimi-code/new']);
    assert.equal(catalog.models['kimi-code/new'].max_context_size, 524288);
    assert.deepEqual(catalog.models['kimi-code/new'].support_efforts, ['low', 'high', 'max']);
    assert.equal(catalog.models['kimi-code/new'].default_effort, 'max');
    assert.equal(catalog.defaultModel, 'kimi-code/new');
    assert.match(pickerModels(catalog)[0].displayName, /подписка Kimi Code/);
    assert.doesNotMatch(readFileSync(join(dir, 'kimi-home/config.toml'), 'utf8'), /external-secret|subscription-secret/);
    const external = writeHostCatalog(readSettings({ sourceConfig, includeExternalModels: true }), dir, second);
    assert.match(external.models['external/paid'].display_name, /API \(external\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('offline refresh preserves the last good catalog and timestamp, throttles retries, and isolates accounts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-cache-'));
  try {
    const options = { dataDir: dir, baseUrl: 'https://api.kimi.com/coding/v1', key: 'private-key' };
    let calls = 0;
    const first = await loadSubscriptionCatalog({ ...options, now: 1000, fetchImpl: async () => { calls++; return response(model('known')); } });
    const cached = await loadSubscriptionCatalog({ ...options, now: 2000, fetchImpl: async () => { throw new Error('must not fetch'); } });
    assert.deepEqual(cached, first);
    const failedFetch = async () => { calls++; throw new Error('private-key / account-id'); };
    const stale = await loadSubscriptionCatalog({ ...options, now: 3000, refreshAfter: 3000, fetchImpl: failedFetch });
    assert.equal(stale.stale, true);
    assert.equal(stale.fetchedAt, 1000);
    assert.deepEqual(stale.models, first.models);
    assert.doesNotMatch(JSON.stringify(stale), /private-key|account-id/);
    assert.match(pickerModels(writeHostCatalog(readSettings({ sourceConfig: 'none' }), dir, stale))[0].displayName, /кеш/);
    await loadSubscriptionCatalog({ ...options, now: 3001, refreshAfter: 3000, fetchImpl: failedFetch });
    assert.equal(calls, 2);
    await assert.rejects(loadSubscriptionCatalog({ ...options, key: 'another-account', now: 3001, fetchImpl: failedFetch }), /No saved catalog/);
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) assert.doesNotMatch(readFileSync(join(dir, name), 'utf8'), /private-key|account-id|another-account/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('incomplete or malformed responses do not retire models; an authoritative empty catalog does', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-empty-'));
  try {
    const options = { dataDir: dir, baseUrl: 'https://api.kimi.com/coding/v1', key: 'fixture-key' };
    await loadSubscriptionCatalog({ ...options, now: 1000, fetchImpl: async () => response(model('known')) });
    const bad = await loadSubscriptionCatalog({ ...options, now: 2000, refreshAfter: 2000,
      fetchImpl: async () => new Response(JSON.stringify({ data: [model('new')], has_more: true })) });
    assert.deepEqual(Object.keys(bad.models), ['kimi-code/known']);
    assert.equal(bad.stale, true);
    const empty = await loadSubscriptionCatalog({ ...options, now: 3000, refreshAfter: 3000, fetchImpl: async () => response() });
    assert.deepEqual(empty.models, {});
    assert.equal(empty.stale, false);
    assert.throws(() => parseSubscriptionModels({ data: [{ id: 'missing-context' }] }), /context/);
    assert.throws(() => parseSubscriptionModels({ data: [model('same'), model('same')] }), /Duplicate/);
    assert.throws(() => parseSubscriptionModels({ data: [model('bad\nidentifier')] }), /model ID/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('concurrent catalog loads share one request and never follow redirects with the subscription key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-singleflight-'));
  try {
    let calls = 0;
    const options = { dataDir: dir, baseUrl: 'https://api.kimi.com/coding/v1', key: 'fixture-key', now: 1000,
      fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
        calls++; assert.equal(url, 'https://api.kimi.com/coding/v1/models');
        assert.equal(init?.redirect, 'error');
        assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fixture-key');
        return response(model('known'));
      },
    };
    const results = await Promise.all([loadSubscriptionCatalog(options), loadSubscriptionCatalog(options)]);
    assert.equal(calls, 1);
    assert.deepEqual(results[0], results[1]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
