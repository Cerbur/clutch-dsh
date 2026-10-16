import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { SETTINGS_NAMESPACE, type FireworksShowPreferences } from '../contract/index.js';
import { createFireworksOverlay, type PreferencesScope } from './FireworksOverlay.js';

export * from '../contract/index.js';
export { FireworksOverlay, createFireworksOverlay } from './FireworksOverlay.js';
export type { FireworksRenderer } from './fireworks-renderer.js';
export { emojiFireworksRenderer } from './fireworks-renderer.js';
export { planShow } from './show-scheduler.js';
export { mountFireworksShow, detectShowTheme } from './fireworks-show.js';

export const name = 'clutch-dsh-fireworks-client';
export const inject = ['slots', 'configForms'];

export function apply(ctx: Context): void {
  let scope: PreferencesScope;
  try {
    const form = ctx.configForms.get<FireworksShowPreferences>(SETTINGS_NAMESPACE);
    scope = {
      subscribe: (listener: () => void) => form.subscribe(listener),
      getSnapshot: () => form.getSnapshot() as FireworksShowPreferences,
    };
  } catch {
    scope = { subscribe: () => () => {}, getSnapshot: () => ({}) };
  }
  const Overlay = createFireworksOverlay(scope);
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'clutch-dsh-fireworks-overlay',
        order: 10,
      },
      Overlay,
    ),
  );
}
