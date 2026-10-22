import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { FireworksOverlay } from './FireworksOverlay.js';
import { FireworksController } from './fireworks-controller.js';
import { FIREWORKS_CONNECTION_CHANNEL, FIREWORKS_EVENTS_ENDPOINT } from '../contract/index.js';
import { AnimationStore } from './animation-store.js';
import { AnimationSettings } from './AnimationSettings.js';
import { selectedAnimation } from './animation-templates.js';

export * from '../contract/index.js';
export { FireworksOverlay } from './FireworksOverlay.js';
export type { FireworksRenderer } from './fireworks-renderer.js';
export { emojiFireworksRenderer } from './fireworks-renderer.js';

export const name = 'clutch-dsh-fireworks-client';
export const inject = ['slots', 'connection', 'uiWorkspace'];

export function apply(ctx: Context): void {
  // Host and Client Connection faces share this package's TypeScript program.
  const connection = (ctx as unknown as { connection: ConnectionHandle }).connection;
  const animations = new AnimationStore(connection.rpc);
  ctx.effect(() => {
    void animations.load();
    return () => animations.dispose();
  });
  const controller = new FireworksController(
    async (query, signal) => {
      const result = await connection.rpc.call(
        FIREWORKS_CONNECTION_CHANNEL,
        FIREWORKS_EVENTS_ENDPOINT,
        query,
        signal,
      );
      if (!result.ok) throw new Error(result.error.message);
      if ((result.value as { events?: unknown[] })?.events?.length) await animations.load();
      return result.value;
    },
    Date.now,
    () => selectedAnimation(animations.getSnapshot().preferences),
  );
  const navigation = ctx.uiWorkspace;
  ctx.effect(() => controller.start());
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'clutch-dsh-fireworks-overlay',
        order: 10,
        inject: () => ({
          controller,
          openSession: (sessionId: string) => navigation.openSession(sessionId as SessionId),
        }),
      },
      FireworksOverlay,
    ),
  );
  // The public Plugins slot is late-declared by DSH. Keep its compatibility
  // face local instead of importing the plugin manager's runtime into this bundle.
  const settingsSlots = ctx.slots as unknown as {
    inject(name: 'plugins.bundle.config', register: () => void): void;
    register(
      options: {
        name: 'plugins.bundle.config';
        key: string;
        inject: () => { store: AnimationStore; playback: FireworksController };
      },
      component: typeof AnimationSettings,
    ): void;
  };
  settingsSlots.inject('plugins.bundle.config', () =>
    settingsSlots.register(
      {
        name: 'plugins.bundle.config',
        key: '@cerbur/clutch-dsh-fireworks',
        inject: () => ({ store: animations, playback: controller }),
      },
      AnimationSettings,
    ),
  );
}
