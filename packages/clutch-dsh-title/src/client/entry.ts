import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { TemplateStore } from './store.js';
import { TemplateSection } from './TemplateSection.js';
import { TITLE_NAMESPACE, settingsDocument } from '../templates.js';
import { en, zh } from './locales.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'clutch.title': keyof typeof en;
  }
}
export const inject = ['slots', 'locale', 'remote', 'remote.settings'];
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('clutch.title', { en, zh }));
  const t = ctx.locale.bind('clutch.title');
  const controller = new TemplateStore({
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
  });
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
