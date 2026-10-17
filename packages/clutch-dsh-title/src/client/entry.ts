import type { Context } from '@deepseek-ai/cordis';
import titleRemote from '@cerbur/clutch-dsh-title/remote';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-plugin-manager/types';
import { TemplateStore, TITLE_STATS_TIMEOUT_MS } from './store.js';
import type { TemplateOperations } from './store.js';
import { TemplateSection } from './TemplateSection.js';
import { TITLE_NAMESPACE, settingsDocument } from '../templates.js';
import { parseDiagnostics, parseStats } from '../types.js';
import type { TitleTokenStats } from '../types.js';
import { en, zh } from './locales.js';
import { RestartNotice } from './restart-notice.js';
import { RestartToast } from './RestartToast.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'clutch.title': keyof typeof en;
  }
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
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(titleRemote);
  const ui = ctx.inject(['remote.titleStats'], registerUi);
  try {
    await ui;
  } catch (error) {
    await ui.dispose();
    await unmount();
    throw error;
  }
  return async () => {
    await ui.dispose();
    await unmount();
  };
}

function registerUi(ctx: Context): void {
  const locale = ctx.locale;
  ctx.effect(() => locale.register('clutch.title', { en, zh }));
  const t = locale.bind('clutch.title');
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
      const result = await withStatsDeadline('read', (signal) =>
        ctx.remote.titleStats.getStats(signal),
      );
      if (!result.ok) throw new Error(result.error?.message ?? 'Failed to get title stats');
      return parseStats(result.value);
    },
    async getDiagnostics() {
      const result = await withStatsDeadline('diagnostics read', (signal) =>
        ctx.remote.titleStats.getDiagnostics(signal),
      );
      if (!result.ok) throw new Error(result.error?.message ?? 'Failed to get title diagnostics');
      return parseDiagnostics(result.value);
    },
    async resetStats() {
      const result = await withStatsDeadline('reset', (signal) =>
        ctx.remote.titleStats.resetStats(signal),
      );
      if (!result.ok) throw new Error(result.error?.message ?? 'Failed to reset title stats');
      return parseStats(result.value);
    },
    async resetDiagnostics() {
      const result = await withStatsDeadline('diagnostics reset', (signal) =>
        ctx.remote.titleStats.resetDiagnostics(signal),
      );
      if (!result.ok) throw new Error(result.error?.message ?? 'Failed to reset title diagnostics');
      return parseDiagnostics(result.value);
    },
  };
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
  ctx.effect(() => {
    const notice = new RestartNotice((signal) => ctx.remote.titleStats.getStats(signal));
    const check = () => void notice.check();
    const reset = ctx.on('connection/reset', check);
    const changed = ctx.remote.$on('plugin-manager/changed', check);
    const overlay = ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'clutch-dsh-title.restart-toast',
          inject: () => ({ notice, t }),
        },
        RestartToast,
      ),
    );
    check();
    return () => {
      notice.dispose();
      reset();
      changed();
      overlay();
    };
  });
}
