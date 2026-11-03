import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'smol-toml';
import type { KimiSettings } from './config.js';
import type { SubscriptionCatalog } from './subscription-catalog.js';

type Table = Record<string, any>;
const table = (value: unknown): Table => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Table : {};

/** Snapshot provider/model tables only. Never modify the user's standalone CLI config. */
export function writeHostCatalog(config: KimiSettings, dataDir: string, subscription: SubscriptionCatalog) {
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
  const providers: Table = Object.create(null);
  const models: Table = Object.assign(Object.create(null), structuredClone(subscription.models));
  if (config.includeExternalModels) {
    for (const [alias, value] of Object.entries(table(source.models))) {
      const model = table(value);
      const provider = table(table(source.providers)[model.provider]);
      const base = provider.base_url;
      if (model.provider === 'managed:kimi-code' || alias.startsWith('kimi-code/') ||
        (typeof base === 'string' && /^https:\/\/api\.kimi\.(com|ai)\/coding(?:\/|$)/.test(base))) continue;
      if (typeof model.provider !== 'string' || !Object.keys(provider).length) continue;
      providers[model.provider] = structuredClone(provider);
      models[alias] = { ...structuredClone(model), display_name: `${model.display_name ?? model.model} · API (${model.provider})` };
    }
  }
  providers['managed:kimi-code'] = {
    type: 'kimi', base_url: config.baseUrl, api_key_env: 'BB_KIMI_CODE_API_KEY',
  };
  for (const value of Object.values(models)) {
    const model = table(value);
    if (model.provider === 'managed:kimi-code' && config.maxContextSize !== 'auto') model.max_context_size = Number(config.maxContextSize);
  }
  const requested = config.model === 'auto' ? source.default_model : config.model;
  const defaultModel = typeof requested === 'string' && Object.hasOwn(models, requested) ? requested
    : Object.keys(models).find((name) => models[name].provider === 'managed:kimi-code' && models[name].model === requested)
      ?? Object.keys(subscription.models)[0] ?? '';
  const labeledModels = Object.fromEntries(Object.entries(models).map(([alias, value]) => [alias,
    alias.startsWith('kimi-code/') ? { ...value, display_name: `${value.display_name} · подписка Kimi Code` } : value]));
  const snapshot = { default_model: defaultModel, providers, models: labeledModels,
    loop_control: { max_attempts_per_step: 1, compaction_max_attempts: 1 } };
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
  return { home, defaultModel, models: labeledModels, subscription };
}

export function pickerModels(catalog: ReturnType<typeof writeHostCatalog>) {
  return Object.entries(catalog.models).map(([id, model]) => {
    const thinking = model.capabilities?.includes('thinking');
    const efforts: string[] = model.support_efforts?.length ? model.support_efforts : [thinking ? 'high' : 'off'];
    const stale = model.provider === 'managed:kimi-code' && catalog.subscription.stale;
    return {
      id, model: id, displayName: model.display_name + (stale ? ' · кеш' : ''),
      description: model.provider === 'managed:kimi-code'
        ? `Каталог подписки от ${new Date(catalog.subscription.fetchedAt).toISOString()}.` +
          (stale ? ' Обновление недоступно; показан сохранённый список.' : '')
        : `Отдельный API: ${model.provider}.`,
      isDefault: id === catalog.defaultModel,
      supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
      defaultReasoningEffort: efforts.includes(model.default_effort) ? model.default_effort : efforts[0],
    };
  });
}
