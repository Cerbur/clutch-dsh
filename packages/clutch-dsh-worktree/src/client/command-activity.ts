/** Promote this plugin's native command row out of the blank-session Hero. */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type {
  ConversationNodeDefinition,
  ConversationViewDefinition,
  ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client';

export const WORKTREE_COMMAND_ACTIVITY = 'clutch-dsh-worktree-command-activity';

/** Native Chat still owns the result row; this target supplies only shell activity. */
export const worktreeCommandActivityNode: ConversationNodeDefinition<boolean> = {
  kind: WORKTREE_COMMAND_ACTIVITY,
  target: WORKTREE_COMMAND_ACTIVITY,
  match: (event) => event.type === 'command/run' && event.data.name === 'cluworktree'
    ? { id: String(event.data.commandId), role: 'start' }
    : null,
  start: () => true,
  update: () => true,
  buildViewNode: (context) => context.start === undefined ? null : {
    key: context.key,
    kind: WORKTREE_COMMAND_ACTIVITY,
    id: context.id,
    target: WORKTREE_COMMAND_ACTIVITY,
    data: true,
  },
};

/** A private activity target has no tab or duplicate command presentation. */
export const worktreeCommandActivityView: ConversationViewDefinition<ConversationViewNode, boolean> = {
  target: WORKTREE_COMMAND_ACTIVITY,
  create: () => {
    let active = false;
    return {
      empty: false,
      replace: ({ nodes }) => (active = nodes.length > 0),
      apply: ({ upserts }) => (active ||= upserts.length > 0),
    };
  },
  isActive: (active) => active,
};

/** Activate only already retained bindings, including later generations and replay. */
export function installWorktreeCommandActivity(ctx: Context): void {
  ctx.effect(() => {
    const node = ctx.uiConversation.events.register(worktreeCommandActivityNode);
    const view = ctx.uiConversation.views.register(worktreeCommandActivityView);
    const tracked = new WeakSet<object>();
    let disposed = false;
    let queued = false;
    const sync = () => {
      if (disposed) return;
      for (const id of ctx.sessions.list.getSnapshot().ids ?? []) {
        const binding = ctx.sessions.binding(id as SessionId);
        if (binding === undefined || tracked.has(binding)) continue;
        ctx.uiConversation.binding(binding).activate(WORKTREE_COMMAND_ACTIVITY);
        tracked.add(binding);
      }
    };
    const schedule = () => {
      if (disposed || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        sync();
      });
    };
    const unsubscribe = ctx.sessions.list.subscribe(schedule);
    // Let Controller retention finish before borrowing a newly published binding.
    schedule();
    return () => {
      disposed = true;
      unsubscribe();
      view();
      node();
    };
  }, 'clutch-dsh-worktree: command activity');
}
