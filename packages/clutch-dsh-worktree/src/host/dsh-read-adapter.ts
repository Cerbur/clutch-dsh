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

/**
 * plugin 从 DSH Host 消费的最小只读 service slice。
 *
 * 接口刻意只包含 Workspace 身份/路径/成员关系和 Session header 查询；没有
 * Project/Session mutation、transcript、消息或事件内容加载能力。
 *
 * Minimal read-only service slice consumed from the DSH Host. It intentionally contains
 * only Workspace identity/path/membership and Session header queries, with no
 * Project/Session mutation or transcript, message, or event-content loading capability.
 */
export interface DshHostReadContext {
  /** Workspace 身份、根路径与 Session 成员关系。 / Workspace identity, root, and membership. */
  readonly workspaceRegistry: {
    get(id: string): DshWorkspaceView | undefined;
    list(): readonly DshWorkspaceView[];
  };
  /** 当前内存中的 Session header 视图。 / Live in-memory Session header views. */
  readonly sessions: {
    get(id: SessionId): DshSessionView | undefined;
    list(): readonly DshSessionView[];
  };
  /**
   * 仅列出持久化 header；不提供 inspect/load/mutation。
   * Lists persisted headers only; inspect, load, and mutation are deliberately absent.
   */
  readonly sessionPersistence: {
    list(): Promise<readonly DshSessionHeaderView[]>;
  };
}

/**
 * 把真实 DSH Host 读取服务适配到 Provider port，同时保持 DSH 是 Workspace 和
 * Session facts 的唯一来源。
 *
 * Adapts real DSH Host reads to the Provider port while preserving DSH as the sole source
 * of Workspace and Session facts.
 */
export class DshHostReadAdapter implements DshReadAdapter {
  constructor(private readonly ctx: DshHostReadContext) {}

  async getWorkspace(workspaceId: string): Promise<DshWorkspaceSummary | undefined> {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId);
    if (workspace === undefined) return undefined;
    return { workspaceId: workspace.id, rootPath: workspace.path };
  }

  async getSession(sessionId: string): Promise<DshSessionSummary | undefined> {
    // live header 优先，持久化列表只补齐未加载的 Session；两条路径都不读取 transcript。
    // Live headers win; the persistence list only fills unloaded Sessions, and neither
    // path reads transcripts.
    const live = this.ctx.sessions.get(sessionId as SessionId);
    if (live !== undefined) return this.sessionSummary(live.header);
    const header = (await this.ctx.sessionPersistence.list()).find(
      (candidate) => candidate.id === sessionId,
    );
    return header === undefined ? undefined : this.sessionSummary(header);
  }

  async listSessions(): Promise<readonly DshSessionSummary[]> {
    // 以 Session ID 合并两种 header 来源，既覆盖活跃 Session，也覆盖尚未载入内存的历史
    // Session，并让最新的 live 视图保留优先级。
    // Merge both header sources by Session ID to cover active and unloaded historical
    // Sessions while preserving the live view's precedence.
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
    // Workspace 归属从 DSH registry 的成员关系派生，而不是从 cwd 猜测或写入 plugin
    // sidecar；cwd 也只是读取现有 header fact。
    // Workspace ownership is derived from DSH registry membership rather than inferred
    // from cwd or written to the plugin sidecar; cwd is likewise read only as a header fact.
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
