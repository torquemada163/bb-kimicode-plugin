import { test } from 'node:test';
import assert from 'node:assert/strict';
import { experimental_scanPublicSdkOnly } from '@get-bb/plugin-sdk/testing';

test('plugin depends only on the published SDK and declared packages', () => {
  const report = experimental_scanPublicSdkOnly(process.cwd(), { allow: [/^(dotenv|smol-toml)$/, /^@get-bb\/plugin-sdk\/provider-bridge\/testing$/] });
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.privateDependencies, []);
});
