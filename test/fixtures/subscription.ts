import { DEFAULT_BASE_URL } from '../../src/config.js';
import { loadSubscriptionCatalog } from '../../src/subscription-catalog.js';

export const fixtureModels = [
  ['kimi-for-coding', 'K2.8 Preview', 1048576],
  ['kimi-for-coding-highspeed', 'K2.7 Code Highspeed', 262144],
  ['k3', 'K3', 1048576], ['k3-256k', 'K3-256k', 262144],
  ['k3.1-pro', 'K3.1 Pro', 1048576],
  ['k3.1-pro-highspeed', 'K3.1 Pro Highspeed', 1048576],
].map(([id, display_name, context]) => ({
  id, display_name, limit: { context }, modalities: { input: ['text', 'image', 'video'] },
  reasoning: { type: 'only', ...(id === 'kimi-for-coding-highspeed' ? {} : { effort: { valid: ['low', 'high', 'max'], default: 'high' } }) },
  tools: { dynamic_load: true },
}));

export async function seedSubscription(dataDir: string, key: string) {
  return loadSubscriptionCatalog({ dataDir, key, baseUrl: DEFAULT_BASE_URL,
    fetchImpl: async () => new Response(JSON.stringify({ data: fixtureModels })) });
}
