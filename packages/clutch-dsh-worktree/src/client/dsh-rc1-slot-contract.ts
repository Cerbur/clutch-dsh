import type {
  ConversationHeaderActionOwnerProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { SnapshotSelectorHook, SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import type {
  SidebarFooterActionOwnerProps,
} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client';

/**
 * The rc.1 published UI packages can resolve their type-only SlotMap imports
 * through a different pnpm peer instance when an older DSH plugin is present
 * in the workspace. Keep this small local convergence declaration tied to the
 * rc.1 package contracts used by Worktree.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.session.header.actions': {
      kind: 'list';
      scope: 'session';
      owner: ConversationHeaderActionOwnerProps;
    };
    'sidebar.footer.action': {
      kind: 'list';
      scope: 'root';
      owner: SidebarFooterActionOwnerProps;
    };
    'shell.overlay': {
      kind: 'list';
      scope: 'root';
    };
  }

  interface GlobalStandardProps {
    useSessions: UseSessions;
    useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>;
  }

  interface SessionStandardProps {
    sessionId: SessionId;
  }
}

/** Narrow runtime face used at the rc.1 renderer compatibility boundary. */
export type WorktreeSlotRegistry = {
  readonly inject: (
    key: string,
    callback: () => (() => void) | Iterable<() => void>,
  ) => () => void;
  readonly register: SlotCore['register'];
};
