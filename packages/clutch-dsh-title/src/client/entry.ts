import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { TemplateStore, TITLE_STATS_TIMEOUT_MS } from './store.js';
import type { TemplateOperations } from './store.js';
import { TemplateSection } from './TemplateSection.js';
import { TITLE_NAMESPACE, settingsDocument } from '../templates.js';
import { DEFAULT_TITLE_STATS } from '../types.js';
import type { TitleTokenStats } from '../types.js';
import { en, zh } from './locales.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'clutch.title': keyof typeof en;
  }
}

interface RemoteResult<T> {
  ok: boolean;
  value?: T;
  error?: { message: string };
}

interface ConnectionRpc {
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RemoteResult<TitleTokenStats>>;
}

function connectionRpc(ctx: Context): ConnectionRpc | undefined {
  const candidate = ctx as unknown as { get?: (key: string) => unknown };
  if (typeof candidate.get !== 'function') return undefined;
  const connection = candidate.get('connection') as { rpc?: ConnectionRpc } | undefined;
  return connection?.rpc;
}

async function withStatsDeadline<T>(
  operationName: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('clutch-dsh-title: statistics ' + operationName + ' timed out')),
      TITLE_STATS_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

export const inject = ['slots', 'locale', 'remote', 'remote.settings'];
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('clutch.title', { en, zh }));
  const t = ctx.locale.bind('clutch.title');
  const remote = ctx.remote as unknown as {
    titleStats?: {
      getStats?(): Promise<RemoteResult<TitleTokenStats>>;
      resetStats?(): Promise<RemoteResult<TitleTokenStats>>;
    };
  };
  const operations: TemplateOperations = {
    resetStatsAvailable: false,
    async read() {
      const result = await ctx.remote.settings.describe();
      if (!result.ok) throw new Error(result.error.message);
      const view = result.value.namespaces.find((item) => item.ns === TITLE_NAMESPACE);
      if (!view) throw new Error('Session title settings are unavailable on this host.');
      return {
        writable: result.value.writable,
        revision: view.revision,
        raw: settingsDocument(view.base, view.user),
      };
    },
    async write(ops, revision) {
      const result = await ctx.remote.settings.mutate(TITLE_NAMESPACE, ops, revision);
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    },
    async getStats(): Promise<TitleTokenStats> {
      const rpc = connectionRpc(ctx);
      if (!rpc) {
        if (remote.titleStats?.getStats || remote.titleStats?.resetStats)
          throw new Error('clutch-dsh-title: statistics connection unavailable');
        return DEFAULT_TITLE_STATS;
      }
      const result = await withStatsDeadline('read', (signal) =>
        rpc.call('/api', 'titleStats/getStats', { args: {} }, signal),
      );
      if (!result.ok) throw new Error(result.error?.message ?? 'Failed to get title stats');
      return result.value!;
    },
  };
  if (remote.titleStats?.resetStats) {
    operations.resetStats = async () => {
      const rpc = connectionRpc(ctx);
      if (!rpc) throw new Error('clutch-dsh-title: statistics connection unavailable');
      const result = await withStatsDeadline('reset', (signal) =>
        rpc.call('/api', 'titleStats/resetStats', { args: {} }, signal),
      );
      if (!result.ok) throw new Error(result.error?.message ?? 'Failed to reset title stats');
      return result.value!;
    };
  }
  const controller = new TemplateStore(operations);
  ctx.effect(() => {
    const refresh = () => {
      if (controller.getSnapshot().status !== 'idle') void controller.load();
    };
    const dispose = ctx.remote.$on('settings/document-updated', (ns) => {
      if (ns === TITLE_NAMESPACE) refresh();
    });
    const reset = ctx.on('connection/reset', refresh);
    return () => {
      dispose();
      reset();
    };
  });
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: TITLE_NAMESPACE,
        order: 35,
        label: () => t('nav'),
        inject: () => ({ controller, t }),
      },
      TemplateSection,
    ),
  );
}
