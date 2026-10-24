import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'smol-toml';
import type { KimiSettings } from './config.js';

type Table = Record<string, any>;
const table = (value: unknown): Table => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Table : {};

// Offline defaults for API-key-only installations; native metadata takes precedence.
export function subscriptionModels(): Table {
  return Object.fromEntries([
    ['k3.1-pro', 'K3.1 Pro', 1048576],
    ['k3.1-pro-highspeed', 'K3.1 Pro Highspeed', 1048576],
    ['kimi-for-coding', 'K2.8 Preview', 1048576],
    ['kimi-for-coding-highspeed', 'K2.7 Code Highspeed', 262144],
    ['k3', 'K3', 1048576],
    ['k3-256k', 'K3-256k', 262144],
  ].map(([model, display_name, max_context_size]) => [`kimi-code/${model}`, {
    provider: 'managed:kimi-code', model, display_name, max_context_size,
    capabilities: ['thinking', 'image_in', 'tool_use',
      ...(model === 'k3.1-pro' || model === 'k3.1-pro-highspeed'
        ? ['always_thinking', 'video_in', 'dynamically_loaded_tools'] : [])],
    ...(model === 'kimi-for-coding-highspeed' ? {} : { support_efforts: ['low', 'high', 'max'], default_effort: 'high' }),
  }]));
}

/** Snapshot provider/model tables only. Never modify the user's standalone CLI config. */
export function writeHostCatalog(config: KimiSettings, dataDir: string) {
  let source: Table = {};
  const sourcePath = config.sourceConfig === 'auto'
    ? join(process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code'), 'config.toml')
    : config.sourceConfig;
  if (sourcePath !== 'none') {
    if (config.sourceConfig !== 'auto' || existsSync(sourcePath)) {
      try { source = parse(readFileSync(sourcePath, 'utf8')); }
      catch { throw new Error('Cannot read the source Kimi config. Check sourceConfig and TOML syntax on the execution host.'); }
    }
  }
  const providers: Table = structuredClone(table(source.providers));
  const models: Table = { ...subscriptionModels(), ...structuredClone(table(source.models)) };
  const subscriptionProvider = {
    type: 'kimi', base_url: config.baseUrl, api_key_env: 'BB_KIMI_CODE_API_KEY',
  };
  // Replace managed OAuth credentials with the explicitly supplied subscription API key.
  for (const [name, provider] of Object.entries(providers)) {
    const base = table(provider).base_url;
    if (name === 'managed:kimi-code' || (typeof base === 'string' && /^https:\/\/api\.kimi\.(com|ai)\/coding(?:\/|$)/.test(base))) {
      providers[name] = { ...subscriptionProvider };
    }
  }
  providers['managed:kimi-code'] = { ...subscriptionProvider };
  for (const value of Object.values(models)) {
    const model = table(value);
    if (model.provider === 'managed:kimi-code' && config.maxContextSize !== 'auto') model.max_context_size = Number(config.maxContextSize);
  }
  const requested = config.model === 'auto' ? source.default_model : config.model;
  const defaultModel = typeof requested === 'string' && requested in models ? requested
    : Object.keys(models).find((name) => models[name].provider === 'managed:kimi-code' && models[name].model === requested)
      ?? 'kimi-code/kimi-for-coding';
  const snapshot = { default_model: defaultModel, providers, models };
  const home = join(dataDir, 'kimi-home');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = join(home, 'config.toml');
  const text = stringify(snapshot);
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) {
    const temporary = join(home, `config-${randomUUID()}.tmp`);
    writeFileSync(temporary, text, { mode: 0o600 });
    renameSync(temporary, path);
  }
  chmodSync(path, 0o600);
  return { home, defaultModel };
}
