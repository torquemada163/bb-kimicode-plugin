import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threadStartParamsSchema } from '@get-bb/plugin-sdk/provider-bridge';
import { REASONING_LEVELS, normalizeReasoningOptions } from '../src/reasoning.js';

test('BB default medium follows the documented Kimi mapping to high', () => {
  assert.ok(REASONING_LEVELS.includes('medium'));
  const options = { model: 'kimi-code/k3', reasoningLevel: 'medium', permissionMode: 'accept-edits', permissionScope: 'workspace', approvalReviewer: 'user', permissionEscalation: 'deny' };
  normalizeReasoningOptions(options);
  assert.equal(options.reasoningLevel, 'high');
  const request = threadStartParamsSchema.parse({ threadId: 'regression', cwd: '/tmp', instructionMode: 'append', options });
  assert.equal(request.options.reasoningLevel, 'high');
  assert.equal(request.options.model, 'kimi-code/k3');
});

test('explicit Kimi thinking levels and omitted options are preserved', () => {
  for (const level of ['low', 'high', 'max']) {
    const options = { reasoningLevel: level, model: 'kimi-code/k3' };
    normalizeReasoningOptions(options);
    assert.deepEqual(options, { reasoningLevel: level, model: 'kimi-code/k3' });
  }
  const options = {};
  normalizeReasoningOptions(options);
  assert.deepEqual(options, {});
});
