import type { Context } from '@deepseek-ai/cordis';
import type { ConversationNodeDefinition, ConversationViewDefinition, ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { EMPTY_STEER_STATE, reduceSteerState, steerRelay } from './steer-state.js';
import type { SteerState } from './steer-state.js';

export const WORKTREE_STEER_TARGET = 'clutch-dsh-worktree-steer';

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    'clutch-dsh-worktree-steer': SteerState;
  }
}

/** One Session-local fold, rebuilt by native history replacement and pagination. */
export const worktreeSteerNode: ConversationNodeDefinition<SteerState> = {
  kind: WORKTREE_STEER_TARGET,
  target: WORKTREE_STEER_TARGET,
  // Inbox events are optional across DSH graphs; the reducer validates their payload.
  match: (event: Parameters<typeof reduceSteerState>[1]) => event.type === 'turn/start' || event.type === 'agent/inbox/spliced' ||
    (event.type === 'user/message' && event.surfaceOp === 'append' && steerRelay(event.data) !== undefined)
    ? { id: 'state', role: 'start' } : null,
  start: (_context, match) => reduceSteerState(EMPTY_STEER_STATE, match.event),
  update: (context, match) => reduceSteerState(context.state, match.event),
  buildViewNode: context => context.state === undefined ? null : {
    key: context.key, kind: WORKTREE_STEER_TARGET, id: context.id,
    target: WORKTREE_STEER_TARGET, data: context.state,
  },
};

type SteerNode = ConversationViewNode & { readonly data: SteerState };
export const worktreeSteerView: ConversationViewDefinition<SteerNode, SteerState> = {
  target: WORKTREE_STEER_TARGET,
  create: () => {
    let state = EMPTY_STEER_STATE;
    return {
      empty: EMPTY_STEER_STATE,
      replace: ({ nodes }) => (state = nodes.at(-1)?.data ?? EMPTY_STEER_STATE),
      apply: ({ upserts }) => (state = upserts.at(-1)?.data ?? state),
    };
  },
  // A status strip must not turn an otherwise blank Session into a Chat view.
  isActive: () => false,
};

export function installWorktreeSteerActivity(ctx: Context): void {
  ctx.effect(() => {
    const node = ctx.uiConversation.events.register(worktreeSteerNode);
    const view = ctx.uiConversation.views.register(worktreeSteerView);
    return () => { view(); node(); };
  }, 'clutch-dsh-worktree: steer activity');
}
