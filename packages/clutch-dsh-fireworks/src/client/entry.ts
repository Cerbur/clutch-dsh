import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { FireworksOverlay } from './FireworksOverlay.js';
import { FireworksController } from './fireworks-controller.js';
import {
  mountFireworksRemote,
  openFireworksStream,
  type FireworksRemote,
} from './fireworks-stream.js';
import { AnimationStore } from './animation-store.js';
import { AnimationSettings } from './AnimationSettings.js';
import { selectedAnimation } from './animation-templates.js';

export * from '../contract/index.js';
export { FireworksOverlay } from './FireworksOverlay.js';
export type { FireworksRenderer } from './fireworks-renderer.js';
export { emojiFireworksRenderer } from './fireworks-renderer.js';

export const name = 'clutch-dsh-fireworks-client';
export const inject = ['slots', 'connection', 'remote', 'uiWorkspace'];

export async function apply(ctx: Context): Promise<void> {
  const remote = (ctx as unknown as { remote: FireworksRemote }).remote;
  await ctx.effect(() => mountFireworksRemote(remote));
  // $mount creates a new Cordis service. The caller must explicitly inject
  // that namespace; injecting only `remote` cannot access its child service.
  await ctx.inject(['remote.clutch_fireworks'], registerFireworksClient);
}

function registerFireworksClient(ctx: Context): void {
  const remote = (ctx as unknown as { remote: FireworksRemote }).remote;
  // Host and Client Connection faces share this package's TypeScript program.
  const connection = (ctx as unknown as { connection: ConnectionHandle }).connection;
  const animations = new AnimationStore(connection.rpc);
  ctx.effect(() => {
    void animations.load();
    return () => animations.dispose();
  });
  let streamFailure: string | undefined;
  const controller = new FireworksController(
    async function* (query, signal) {
      try {
        for await (const batch of openFireworksStream(remote, query, signal)) {
          streamFailure = undefined;
          if (batch.events.length) await animations.load();
          yield batch;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!signal.aborted && streamFailure !== message)
          console.warn('clutch_fireworks: Remote stream disconnected: ' + message);
        streamFailure = message;
        throw error;
      }
    },
    Date.now,
    () => selectedAnimation(animations.getSnapshot().preferences),
  );
  const navigation = ctx.uiWorkspace as unknown as { openSession(id: string): unknown };
  ctx.effect(() => controller.start());
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'clutch-dsh-fireworks-overlay',
        order: 10,
        inject: () => ({
          controller,
          openSession: (sessionId: string) => navigation.openSession(sessionId),
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
