import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { FireworksOverlay } from './FireworksOverlay.js';

export * from '../contract/index.js';
export { FireworksOverlay } from './FireworksOverlay.js';
export type { FireworksRenderer } from './fireworks-renderer.js';
export { emojiFireworksRenderer } from './fireworks-renderer.js';

export const name = 'clutch-dsh-fireworks-client';
export const inject = ['slots'];

export function apply(ctx: Context): void {
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'clutch-dsh-fireworks-overlay',
        order: 10,
      },
      FireworksOverlay,
    ),
  );
}
