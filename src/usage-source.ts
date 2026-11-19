import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { providerUsageSchema } from '@get-bb/plugin-sdk/provider-bridge';
import { z } from 'zod';
import { PROVIDER_ID } from './config.js';

export const LIST_USAGE_RESOURCES = 'provider-usage.v1.listResources';
export const GET_USAGE_RESOURCE = 'provider-usage.v1.getResource';
const fields = { accountEmail: z.string().nullable(), planLabel: z.string().nullable(),
  plan: z.object({ id: z.string().min(1), multiplier: z.number().int().positive().nullable() }).nullable() };
const usageState = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), ...fields, windows: z.array(z.object({
    id: z.string().min(1), kind: z.enum(['five-hour', 'daily', 'weekly', 'custom']),
    label: z.string().min(1), usedPercent: z.number().nonnegative(), resetsAt: z.string().nullable(),
    model: z.string().nullable(), cost: z.object({ usedUsdCents: z.number().nonnegative(), limitUsdCents: z.number().positive() }).nullable(),
  })) }),
  z.object({ status: z.literal('not_installed'), ...fields }),
  z.object({ status: z.literal('unauthenticated'), ...fields }),
  z.object({ status: z.literal('expired'), ...fields }),
  z.object({ status: z.literal('error'), ...fields, message: z.string() }),
]);
const observationSchema = z.object({ accountKey: z.string().min(1).nullable(),
  observedAt: z.number().int().nonnegative().nullable(), usage: usageState });
const resourceIdSchema = z.tuple([z.string().min(1), z.literal(PROVIDER_ID)]);

/** Public discovery contract consumed by BB's Provider Usage sidebar and settings. */
export const usageSourceContract = defineRpcContract({
  [LIST_USAGE_RESOURCES]: {
    input: z.object({}),
    output: z.object({ resources: z.array(z.object({
      id: z.string().min(1), accountKey: z.string().min(1).nullable(),
      providerId: z.string().min(1), label: z.string().min(1),
      scope: z.object({ kind: z.literal('host'), hostId: z.string().min(1), hostName: z.string().min(1) }),
    })) }),
    experimental_description: 'List Kimi Code quota resources using host/provider metadata only.',
  },
  [GET_USAGE_RESOURCE]: {
    input: z.object({ resourceId: z.string().min(1), refresh: z.boolean() }),
    output: observationSchema,
    experimental_description: 'Collect subscription usage for one Kimi Code execution host.',
  },
});

type Observation = z.infer<typeof observationSchema>;

export function registerUsageSource(bb: BbPluginApi) {
  // Neither credentials nor email can serve as a provider-issued quota identity.
  const observed = new Map<string, number>();
  const inflight = new Map<string, { refresh: boolean; promise: Promise<Observation> }>();
  const owns = (p: { id: string; pluginId?: string | null }) => p.id === PROVIDER_ID && p.pluginId === bb.pluginId;
  const unavailable = (resourceId: string, message: string): Observation => ({ accountKey: null,
    observedAt: observed.get(resourceId) ?? null,
    usage: { status: 'error', accountEmail: null, planLabel: null, plan: null, message } });

  async function load(resourceId: string, refresh: boolean): Promise<Observation> {
    let hostId: string;
    try { [hostId] = resourceIdSchema.parse(JSON.parse(resourceId)); }
    catch { throw new Error('Неизвестный источник лимитов Kimi Code.'); }
    const host = await bb.sdk.hosts.get({ hostId });
    if (host.status === 'disconnected') return unavailable(resourceId, 'Хост исполнения отключён.');
    const providers = await bb.sdk.providers.list({ hostId, capability: 'usage' });
    if (!providers.some(owns)) {
      observed.delete(resourceId);
      throw new Error('Источник лимитов Kimi Code больше недоступен.');
    }
    try {
      // Core routes this to the selected host bridge; the server never reads its key.
      const result = await bb.sdk.system.usageLimits({ hostId, providerId: PROVIDER_ID, refresh });
      const usage = providerUsageSchema.parse(result[PROVIDER_ID]);
      if (usage.status === 'ok') observed.set(resourceId, Date.now());
      return observationSchema.parse({ accountKey: null, observedAt: observed.get(resourceId) ?? null,
        usage: { ...usage, accountEmail: null, planLabel: usage.status === 'ok' ? usage.planLabel : null, plan: null,
          ...(usage.status === 'ok' ? { windows: usage.windows.map((w, index) => ({
            ...w, id: `${index}:${w.label}`, kind: w.label === 'За 5 часов' ? 'five-hour' : w.label === 'За неделю' ? 'weekly' : 'custom',
            model: null, cost: null,
          })) } : {}) },
      });
    } catch { return unavailable(resourceId, 'Не удалось получить лимиты Kimi Code с хоста исполнения.'); }
  }

  async function collect(resourceId: string, refresh: boolean): Promise<Observation> {
    const pending = inflight.get(resourceId);
    if (pending) {
      if (!refresh || pending.refresh) return pending.promise;
      await pending.promise.catch(() => {});
      return collect(resourceId, refresh);
    }
    const promise = load(resourceId, refresh).finally(() => { inflight.delete(resourceId); });
    inflight.set(resourceId, { refresh, promise });
    return promise;
  }

  bb.rpc.register(usageSourceContract, {
    async [LIST_USAGE_RESOURCES]() {
      const hosts = await bb.sdk.hosts.list();
      const resources = (await Promise.all(hosts.map(async (host) => {
        const providers = await bb.sdk.providers.list({ hostId: host.id, capability: 'usage' });
        return providers.filter(owns).map((p) => ({ id: JSON.stringify([host.id, p.id]),
          accountKey: null, providerId: p.id, label: p.displayName,
          scope: { kind: 'host' as const, hostId: host.id, hostName: host.name },
        }));
      }))).flat();
      const validIds = new Set(resources.map((r) => r.id));
      for (const id of observed.keys()) if (!validIds.has(id)) observed.delete(id);
      return { resources };
    },
    [GET_USAGE_RESOURCE]: ({ resourceId, refresh }) => collect(resourceId, refresh),
  }, { experimental_discoverable: true,
    experimental_description: 'Kimi Code subscription limits for BB sidebar and Usage limits settings. Credentials stay on the execution host.' });
}
