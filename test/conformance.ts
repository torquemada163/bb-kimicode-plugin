import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  experimental_captureBridgeJsonRpcOutput as capture,
  experimental_runBridgeConformance as conformance,
  experimental_formatConformanceReport as format,
} from '@get-bb/plugin-sdk/provider-bridge/testing';
import { experimental_providerBridge as bridge } from '../host.js';
import { bridgeOptions, readSettings } from '../src/config.js';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'bb-kimi-conformance-'));
  const envFile = join(dir, '.env');
  writeFileSync(envFile, 'KIMI_API_KEY=fixture-key\n');
  const options = bridgeOptions(readSettings({ sourceConfig: 'none', envFile, executable: resolve('test/fixtures/acp-agent.mjs') }));
  const output = capture();
  bridge.start?.({ pluginId: 'kimicode', dataDir: dir, tempDir: dir });
  try {
    const report = await conformance({
      transport: { send: bridge.handleLine, takeMessages: output.takeMessages },
      providerId: 'kimi-code',
      session: {
        cwd: dir,
        options: { model: '__kimi_env_model__', permissionMode: 'accept-edits', permissionScope: 'workspace', approvalReviewer: 'user', permissionEscalation: 'deny', providerOptions: options },
        promptInput: [{ type: 'text', text: 'hello', mentions: [] }],
        zeroWorkPromptInput: [{ type: 'text', text: '/noop', mentions: [] }],
      },
      timeoutMs: 5000,
    });
    output.restore();
    process.stderr.write(format(report) + '\n');
    assert.equal(report.passed, true, format(report));
  } finally {
    output.restore();
    rmSync(dir, { recursive: true, force: true });
  }
}
await main();
