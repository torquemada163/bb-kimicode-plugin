import type { ProviderUsage, ProviderUsageResult, ProviderUsageWindow } from '@get-bb/plugin-sdk/provider-bridge';
import { readSettings } from './config.js';
import { asRecord, readHostApiKey } from './credentials.js';

const WINDOWS = {
  limit_5h: 'За 5 часов',
  limit_7d: 'За неделю',
  limit_month_total: 'За месяц — общая квота',
  limit_month_code: 'За месяц — Kimi Code',
};
const LIMIT_BYTES = 65536;
const numeric = (v: unknown): number => typeof v === 'number' ? v
  : typeof v === 'string' && v.trim() ? Number(v) : NaN;

function reset(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('Invalid quota reset timestamp.');
  }
  return new Date(value).toISOString();
}

function window(label: string, ratio: number, resetsAt: unknown): ProviderUsageWindow {
  if (!Number.isFinite(ratio) || ratio < 0) throw new Error('Invalid quota usage ratio.');
  return { label, usedPercent: Math.min(100, Math.round(ratio * 10000) / 100), resetsAt: reset(resetsAt) };
}

/** Whitelist quota metadata only; never return account ids, keys, or raw API bodies. */
export function parseUsage(payload: unknown): ProviderUsage {
  const data = asRecord(payload);
  const windows: ProviderUsageWindow[] = [];
  if (data.usages !== undefined) {
    const usages = asRecord(data.usages);
    for (const [name, label] of Object.entries(WINDOWS)) {
      const value = usages[name];
      if (value === undefined || value === null) continue;
      const item = asRecord(value);
      windows.push(window(label, numeric(item.used_ratio), item.reset_time));
    }
  } else {
    // Older responses expose normalized quota units, not token counts.
    const add = (raw: unknown, label: string) => {
      const detail = asRecord(raw);
      const limit = numeric(detail.limit), used = numeric(detail.used);
      if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used) || used < 0) throw new Error('Invalid quota counters.');
      windows.push(window(label, used / limit, detail.resetTime));
    };
    if (Array.isArray(data.limits)) {
      if (data.limits.length > 16) throw new Error('Too many quota windows.');
      for (const entry of data.limits) {
        const item = asRecord(entry), period = asRecord(item.window);
        const duration = numeric(period.duration);
        const units: Record<string, string> = { TIME_UNIT_MINUTE: 'мин.', TIME_UNIT_HOUR: 'ч.', TIME_UNIT_DAY: 'дн.' };
        const unit = typeof period.timeUnit === 'string' ? units[period.timeUnit] : undefined;
        if (!Number.isSafeInteger(duration) || duration <= 0 || !unit) throw new Error('Unknown quota window.');
        add(item.detail, `За ${duration} ${unit}`);
      }
    }
    if (data.usage !== undefined) add(data.usage, 'Основная квота подписки');
  }
  if (!windows.length) throw new Error('No subscription quota windows.');
  return { status: 'ok', accountEmail: null, planLabel: 'Подписка Kimi Code', windows };
}

export async function loadHostUsage(options: Record<string, unknown>, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ProviderUsageResult> {
  const error = (message: string): ProviderUsageResult => ({ supported: true, usage: { status: 'error', message, accountEmail: null, planLabel: null } });
  let baseUrl: string, key: string;
  try {
    const config = readSettings(asRecord(options.kimiConfig));
    if (!config.envFile) return { supported: true, usage: { status: 'unauthenticated' } };
    baseUrl = config.baseUrl;
    key = readHostApiKey(config.envFile);
  } catch { return error('Не удалось прочитать настройки или ключ Kimi Code на хосте. Проверьте envFile и права доступа.'); }
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/usages`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) return { supported: true, usage: { status: 'expired' } };
      return error(`Не удалось получить лимиты подписки Kimi Code (HTTP ${response.status}). Повторите /usage позже.`);
    }
    if (Number(response.headers.get('content-length')) > LIMIT_BYTES) { await response.body?.cancel(); throw new Error('Oversized usage response.'); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing usage response.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > LIMIT_BYTES) { await reader.cancel(); throw new Error('Oversized usage response.'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    return { supported: true, usage: parseUsage(JSON.parse(Buffer.concat(chunks).toString('utf8'))) };
  } catch { return error('Лимиты Kimi Code недоступны: ошибка соединения, тайм-аут или некорректный ответ API. Повторите /usage позже.'); }
}

export function formatUsage(result: ProviderUsageResult): string {
  if (!result.supported) return 'Данные лимитов Kimi Code недоступны.';
  const usage = result.usage;
  if (usage.status === 'unauthenticated') return 'Настройте envFile плагина: нужен ключ подписки Kimi Code на хосте исполнения.';
  if (usage.status === 'expired') return 'Kimi Code отклонил ключ подписки (HTTP 401). Проверьте ключ в envFile.';
  if (usage.status === 'error') return usage.message;
  if (usage.status !== 'ok') return 'Данные лимитов Kimi Code недоступны.';
  const percent = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
  const rows = usage.windows.map((w) => `- **${w.label}:** использовано ${percent(w.usedPercent)}%, осталось ${percent(100 - w.usedPercent)}%.` +
    (w.resetsAt ? ` Сброс: ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(w.resetsAt))} UTC.` : ' Время сброса API не указал.'));
  return ['**Лимиты подписки Kimi Code**', '', ...rows, '', 'Свежие данные аккаунта по подписочному ключу; это общие лимиты, не расход токенов текущего треда.'].join('\n');
}
