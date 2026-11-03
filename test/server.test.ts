import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.js';
import { CATALOG_TTL_MS } from '../src/subscription-catalog.js';

test('manual and scheduled catalog refresh invalidate the generation, target the execution host, and stop on disposal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { bb, harness } = createFakePluginHost({ pluginId: 'kimicode', settings: { envFile: '/host/subscription.env' },
    sdk: { providers: { models: async () => ({ models: [], modelLoadError: null }) } },
  });
  await plugin(bb);
  try {
    const before = harness.inspection.registrations.providerRegistrations[0].experimental_bridgeOptions;
    assert.equal((before?.kimiConfig as any).includeExternalModels, false);
    const result = await harness.behavior.runCli(['models', 'refresh', '--machine', 'host-target']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(harness.inspection.sdk.callsTo('providers.models')[0], [{ providerId: 'kimi-code', hostId: 'host-target', signal: undefined }]);
    assert.equal(harness.inspection.registrations.providerRegistrations.length, 1);
    const after = harness.inspection.registrations.providerRegistrations[0].experimental_bridgeOptions;
    assert.ok(Number(after?.kimiCatalogRefreshAfter) >= Number(before?.kimiCatalogRefreshAfter));
    let attempts = 0;
    harness.inspection.sdk.stub('providers.models', async () => {
      attempts++;
      return { models: [], modelLoadError: attempts === 1 ? { providerId: 'kimi-code', code: 'failed', detail: 'Provider "kimi-code" is not running' } : null };
    });
    const restarting = harness.behavior.runCli(['models', 'refresh', '--machine', 'host-target']);
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    t.mock.timers.tick(250);
    assert.equal((await restarting).exitCode, 0);
    assert.equal(attempts, 2);
    attempts = 0;
    harness.inspection.sdk.stub('providers.models', async () => {
      attempts++;
      return { models: [], modelLoadError: { providerId: 'kimi-code', code: 'failed', detail: 'Kimi Code catalog returned HTTP 429.' } };
    });
    assert.equal((await harness.behavior.runCli(['models', 'refresh', '--machine', 'host-target'])).exitCode, 1);
    assert.equal(attempts, 1, 'API errors must not be retried as bridge startup races');
    const service = harness.behavior.runService('subscription-catalog-refresh');
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    t.mock.timers.tick(CATALOG_TTL_MS);
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    const scheduled = harness.inspection.registrations.providerRegistrations[0].experimental_bridgeOptions;
    assert.ok(Number(scheduled?.kimiCatalogRefreshAfter) > Number(after?.kimiCatalogRefreshAfter));
    assert.equal(harness.inspection.registrations.providerRegistrations.length, 1);
    service.controller.abort();
    await service.done;
  } finally { await harness.lifecycle.dispose(); }
});
