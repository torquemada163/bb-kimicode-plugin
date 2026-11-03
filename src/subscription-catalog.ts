import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CATALOG_TTL_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
export type ModelTable = Record<string, any>;
export type SubscriptionCatalog = {
  fetchedAt: number;
  models: ModelTable;
  stale: boolean;
  error?: string;
};
type Cache = { version: 1; scope: string; fetchedAt: number; attemptedAt: number; models: ModelTable; error?: string };
type LoadOptions = {
  dataDir: string; baseUrl: string; key: string; refreshAfter?: number;
  fetchImpl?: typeof fetch; now?: number;
};
const pending = new Map<string, Promise<SubscriptionCatalog>>();
const record = (v: unknown): ModelTable => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as ModelTable : {};
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const modelFields = new Set(['provider', 'model', 'display_name', 'max_context_size', 'capabilities', 'max_input_size', 'max_output_size', 'support_efforts', 'default_effort', 'protocol', 'beta_api', 'adaptive_thinking']);

function validCachedModels(value: unknown): value is ModelTable {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).length <= 1000 && Object.entries(value).every(([alias, raw]) => {
    const m = record(raw);
    return m.provider === 'managed:kimi-code' && typeof m.model === 'string' && alias === `kimi-code/${m.model}` &&
      typeof m.display_name === 'string' && positive(m.max_context_size) && Array.isArray(m.capabilities) &&
      m.capabilities.every((v: unknown) => typeof v === 'string') && Object.keys(m).every((k) => modelFields.has(k)) &&
      (m.support_efforts === undefined || (Array.isArray(m.support_efforts) && m.support_efforts.every((v: unknown) => typeof v === 'string')));
  });
}

export function parseSubscriptionModels(payload: unknown): ModelTable {
  const data = record(payload);
  if (!Array.isArray(data.data) || data.data.length > 1000 || data.has_more === true ||
    (data.has_more !== undefined && typeof data.has_more !== 'boolean')) throw new Error('Invalid or incomplete Kimi Code model catalog.');
  const models: ModelTable = {};
  for (const value of data.data) {
    const item = record(value);
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/.test(item.id)) throw new Error('Invalid model ID in Kimi Code catalog.');
    const alias = `kimi-code/${item.id}`;
    if (Object.hasOwn(models, alias)) throw new Error('Duplicate model ID in Kimi Code catalog.');
    const limit = record(item.limit);
    const context = limit.context ?? item.context_length;
    if (!positive(context)) throw new Error('Missing context window in Kimi Code catalog.');
    const reasoning = record(item.reasoning);
    const thinking = reasoning.type ?? item.supports_thinking_type ?? (item.supports_reasoning ? 'both' : 'none');
    if (!['only', 'both', 'none', 'no'].includes(thinking)) throw new Error('Unknown thinking mode in Kimi Code catalog.');
    const caps: string[] = [];
    if (thinking === 'only' || thinking === 'both') caps.push('thinking');
    if (thinking === 'only') caps.push('always_thinking');
    const inputs = record(item.modalities).input;
    if (Array.isArray(inputs) ? inputs.includes('image') : item.supports_image_in === true) caps.push('image_in');
    if (Array.isArray(inputs) ? inputs.includes('video') : item.supports_video_in === true) caps.push('video_in');
    if (item.supports_tool_use !== false) caps.push('tool_use');
    if (record(item.tools).dynamic_load === true || item.supports_dynamic_tools === true) caps.push('dynamically_loaded_tools');
    const efforts = record(reasoning.effort);
    const legacy = record(item.think_efforts);
    const supported = efforts.valid ?? (legacy.support === true ? legacy.valid_efforts : item.support_efforts);
    const defaultEffort = efforts.default ?? (legacy.support === true ? legacy.default_effort : item.default_effort);
    if (supported !== undefined && (!Array.isArray(supported) || supported.length === 0 || supported.some((v) => typeof v !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(v)))) throw new Error('Invalid thinking efforts in Kimi Code catalog.');
    const name = typeof item.display_name === 'string' && item.display_name.trim() ? item.display_name.trim() : item.id;
    if (name.length > 256 || /[\r\n\0]/.test(name)) throw new Error('Invalid display name in Kimi Code catalog.');
    const protocol = item.protocol;
    if (protocol !== undefined && !['kimi', 'anthropic', 'response', 'openai_responses'].includes(protocol)) throw new Error('Unsupported model protocol in Kimi Code catalog.');
    models[alias] = {
      provider: 'managed:kimi-code', model: item.id, display_name: name,
      max_context_size: context, capabilities: caps,
      ...(positive(limit.input) ? { max_input_size: limit.input } : {}),
      ...(positive(limit.output) ? { max_output_size: limit.output } : {}),
      ...(Array.isArray(supported) && caps.includes('thinking') ? { support_efforts: [...new Set(supported)] } : {}),
      ...(Array.isArray(supported) && supported.includes(defaultEffort) && caps.includes('thinking') ? { default_effort: defaultEffort } : {}),
      ...(protocol === 'anthropic' ? { protocol: 'anthropic', beta_api: true, ...(caps.includes('thinking') ? { adaptive_thinking: true } : {}) } : {}),
      ...(['response', 'openai_responses'].includes(protocol) ? { protocol: 'openai_responses' } : {}),
    };
  }
  return models;
}

function save(path: string, cache: Cache) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(cache), { mode: 0o600 });
  renameSync(temporary, path);
}

export function loadSubscriptionCatalog(options: LoadOptions): Promise<SubscriptionCatalog> {
  const scope = createHash('sha256').update(options.baseUrl.replace(/\/+$/, '')).update('\0').update(options.key).digest('hex');
  const slot = `${options.dataDir}/${scope}`;
  const running = pending.get(slot);
  if (running) return running;
  const result = load(options, scope).finally(() => { pending.delete(slot); });
  pending.set(slot, result);
  return result;
}

async function load(options: LoadOptions, scope: string): Promise<SubscriptionCatalog> {
  const now = options.now ?? Date.now();
  mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
  const path = join(options.dataDir, `subscription-catalog-${scope}.json`);
  let cache: Cache | undefined;
  try {
    if (statSync(path).size > 1048576) throw new Error('Oversized cache.');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (value.version === 1 && value.scope === scope && Number.isSafeInteger(value.fetchedAt) && value.fetchedAt >= 0 &&
      Number.isSafeInteger(value.attemptedAt) && value.attemptedAt >= 0 && validCachedModels(value.models)) {
      cache = { version: 1, scope, fetchedAt: value.fetchedAt, attemptedAt: value.attemptedAt, models: value.models,
        ...(value.error ? { error: typeof value.error === 'string' && /^Kimi Code catalog returned HTTP \d{3}\.$/.test(value.error)
          ? value.error : 'Cannot refresh the Kimi Code subscription catalog.' } : {}) };
    }
  } catch { /* A cold or unreadable cache requires a live catalog. */ }
  const fresh = cache && now >= cache.fetchedAt && now - cache.fetchedAt < CATALOG_TTL_MS && !cache.error;
  const recentlyAttempted = cache && cache.attemptedAt >= (options.refreshAfter ?? 0) && now >= cache.attemptedAt && now - cache.attemptedAt < (cache.error ? RETRY_MS : CATALOG_TTL_MS);
  if (cache && recentlyAttempted) return { models: cache.models, fetchedAt: cache.fetchedAt, stale: !fresh, ...(cache.error ? { error: cache.error } : {}) };
  let error: string;
  try {
    const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${options.key}`, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Kimi Code catalog returned HTTP ${response.status}.`);
    if (Number(response.headers.get('content-length')) > 1048576) throw new Error('Kimi Code catalog is too large.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty catalog response.');
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 1048576) { await reader.cancel(); throw new Error('Kimi Code catalog is too large.'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const models = parseSubscriptionModels(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const next: Cache = { version: 1, scope, fetchedAt: now, attemptedAt: now, models };
    save(path, next);
    return { models, fetchedAt: now, stale: false };
  } catch (failure) {
    // Do not persist response bodies, credentials, URLs with secrets, or fetch diagnostics.
    const message = failure instanceof Error ? failure.message : '';
    error = /^Kimi Code catalog returned HTTP \d{3}\.$/.test(message) ? message : 'Cannot refresh the Kimi Code subscription catalog.';
  }
  if (!cache) throw new Error(`${error} No saved catalog is available. Check the subscription key and connection, then refresh models.`);
  save(path, { ...cache, attemptedAt: now, error });
  return { models: cache.models, fetchedAt: cache.fetchedAt, stale: true, error };
}
