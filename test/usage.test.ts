import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerUsageResultSchema } from '@get-bb/plugin-sdk/provider-bridge';
import { bridgeOptions, readSettings } from '../src/config.js';
import { parseUsage, loadHostUsage, formatUsage } from '../src/usage.js';

const payload = { usages: {
  limit_5h: { used_ratio: 0.0089, reset_time: '2026-11-19T18:22:26Z' },
  limit_7d: { used_ratio: '0.7822', reset_time: '2026-11-23T12:22:27Z' },
} };

test('quota windows show subscription percentages and reset times, without interpreting units as tokens', () => {
  const usage = parseUsage({ ...payload, private_account_id: 'private', booster_wallet: { secret: 'private' } });
  const result = providerUsageResultSchema.parse({ supported: true, usage });
  assert.equal(usage.status, 'ok');
  if (usage.status !== 'ok') throw new Error('Expected usage');
  assert.deepEqual(usage.windows.map((w) => w.usedPercent), [0.89, 78.22]);
  const text = formatUsage(result);
  assert.match(text, /За 5 часов.*0,89%.*99,11%/);
  assert.match(text, /За неделю.*78,22%.*21,78%/);
  assert.match(text, /23\.11\.2026|23\.11\.26/);
  assert.match(text, /UTC/);
  assert.doesNotMatch(JSON.stringify(result), /private|booster_wallet/);
  const monthly = parseUsage({ usages: { limit_month_total: { used_ratio: 0.5 }, limit_month_code: { used_ratio: 0.2 } } });
  assert.equal(monthly.status, 'ok');
  if (monthly.status === 'ok') assert.equal(monthly.windows.length, 2);
  const legacy = parseUsage({ usage: { limit: '100', used: '78' },
    limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '1' } }] });
  if (legacy.status !== 'ok') throw new Error('Expected legacy usage');
  assert.deepEqual(legacy.windows.map((w) => [w.label, w.usedPercent]), [['За 300 мин.', 1], ['Основная квота подписки', 78]]);
});

test('malformed or missing quotas never appear as an unused subscription', () => {
  for (const p of [{}, { usages: {} }, { usages: { limit_5h: {} } },
    { usages: { limit_5h: { used_ratio: '' } } }, { usages: { limit_5h: { used_ratio: -1 } } },
    { usages: { limit_5h: { used_ratio: Infinity } } },
    { usages: { limit_5h: { used_ratio: 0.5, reset_time: 'private-key' } } },
    { usage: { limit: 0, used: 1 } }]) assert.throws(() => parseUsage(p));
  const saturated = parseUsage({ usages: { limit_5h: { used_ratio: 1.2 } } });
  if (saturated.status === 'ok') assert.equal(saturated.windows[0].usedPercent, 100);
});

test('usage reads host credentials and only the configured usage endpoint, with bounded redacted failures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-usage-'));
  try {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'KIMI_API_KEY=private-fixture-key\n');
    const options = bridgeOptions(readSettings({ envFile, baseUrl: 'https://api.kimi.ai/coding/v1', executable: '/not-installed', sourceConfig: '/missing/config.toml' }));
    const controller = new AbortController();
    const ok = await loadHostUsage(options, controller.signal, async (url, init) => {
      assert.equal(url, 'https://api.kimi.ai/coding/v1/usages');
      assert.equal(init?.redirect, 'error');
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer private-fixture-key');
      assert.ok(init?.signal);
      return new Response(JSON.stringify(payload));
    });
    assert.equal(ok.supported && ok.usage.status, 'ok');
    assert.doesNotMatch(JSON.stringify(ok), /private-fixture-key/);
    for (const status of [401, 403, 429, 500]) {
      const result = await loadHostUsage(options, undefined, async () => new Response('private-fixture-key account-secret', { status }));
      assert.ok(result.supported);
      assert.equal(result.usage.status, status === 401 ? 'expired' : 'error');
      assert.doesNotMatch(JSON.stringify(result), /private-fixture-key|account-secret/);
    }
    for (const response of [new Response('{}'), new Response('x'.repeat(65537)),
      new Response('{}', { headers: { 'content-length': '65537' } })]) {
      const result = await loadHostUsage(options, undefined, async () => response);
      assert.equal(result.supported && result.usage.status, 'error');
    }
    const aborted = await loadHostUsage(options, undefined, async () => { throw new Error('private-fixture-key'); });
    assert.equal(aborted.supported && aborted.usage.status, 'error');
    assert.doesNotMatch(JSON.stringify(aborted), /private-fixture-key/);
    const absent = await loadHostUsage(bridgeOptions(readSettings({})), undefined, async () => { throw new Error('Must not fetch'); });
    assert.equal(absent.supported && absent.usage.status, 'unauthenticated');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
