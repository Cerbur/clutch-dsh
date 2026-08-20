import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types';

import type {
  DshReadAdapter,
  DshSessionSummary,
  DshWorkspaceSummary,
} from '../provider/types.js';

interface DshWorkspaceView {
  readonly id: string;
  readonly path: string;
  readonly sessionIds: readonly SessionId[];
}
type DshSessionHeaderView = Pick<SessionHeader, 'id' | 'cwd'>;
interface DshSessionView {
  readonly id: SessionId;
  readonly header: DshSessionHeaderView;
}

/** Exact read-only Host service slice consumed from DSH v0.1.0-rc.7. */
export interface DshHostReadContext {
  readonly workspaceRegistry: {
    get(id: string): DshWorkspaceView | undefined;
    list(): readonly DshWorkspaceView[];
  };
  readonly sessions: {
    get(id: SessionId): DshSessionView | undefined;
    list(): readonly DshSessionView[];
  };
  readonly sessionPersistence: {
    list(): Promise<readonly DshSessionHeaderView[]>;
  };
}

/** Read-only bridge from real DSH Host services into the Provider port. */
export class DshHostReadAdapter implements DshReadAdapter {
  constructor(private readonly ctx: DshHostReadContext) {}

  async getWorkspace(workspaceId: string): Promise<DshWorkspaceSummary | undefined> {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId);
    if (workspace === undefined) return undefined;
    return { workspaceId: workspace.id, rootPath: workspace.path };
  }

  async getSession(sessionId: string): Promise<DshSessionSummary | undefined> {
    const live = this.ctx.sessions.get(sessionId as SessionId);
    if (live !== undefined) return this.sessionSummary(live.header);
    const header = (await this.ctx.sessionPersistence.list()).find(
      (candidate) => candidate.id === sessionId,
    );
    return header === undefined ? undefined : this.sessionSummary(header);
  }

  async listSessions(): Promise<readonly DshSessionSummary[]> {
    const summaries = new Map<string, DshSessionSummary>();
    for (const session of this.ctx.sessions.list()) {
      summaries.set(session.id, this.sessionSummary(session.header));
    }
    for (const header of await this.ctx.sessionPersistence.list()) {
      if (!summaries.has(header.id)) summaries.set(header.id, this.sessionSummary(header));
    }
    return [...summaries.values()];
  }

  private sessionSummary(header: DshSessionHeaderView): DshSessionSummary {
    const workspaceId = this.ctx.workspaceRegistry
      .list()
      .find((workspace) => workspace.sessionIds.includes(header.id))?.id;
    return {
      sessionId: header.id,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      cwd: header.cwd ?? '',
    };
  }
}
