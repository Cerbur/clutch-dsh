import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { FireworksOverlay } from './FireworksOverlay.js';

export type {
  FireworksEmojiVisual,
  FireworksRenderer,
  FireworksSvgVisual,
  FireworksVisual,
} from './fireworks-renderer.js';

export const inject = ['slots'];

export function apply(ctx: ClientContext): void {
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
