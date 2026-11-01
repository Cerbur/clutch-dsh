import type { Context } from '@deepseek-ai/cordis';
import {
  registerWorktreeInstructions,
  type WorktreeInstructionHost,
} from './worktree-instructions.js';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

import type {
  BranchRecord,
  WorkspaceCheckout,
  SessionBinding,
  WorktreeGitCommitFiles,
  WorktreeGitCommitFilesRequest,
  WorktreeGitFileDiff,
  WorktreeGitFileDiffRequest,
  WorktreeGitHistory,
  WorktreeGitHistoryRequest,
  WorktreeId,
  WorktreeRecord,
  WorktreeSessionState,
  WorktreeImportCandidate,
  WorkspaceId,
  WorkspaceGitState,
  WorktreeRemoteManager,
  WorktreeRemoteResult,
} from '../contract/index.js';
import type { GitSubprocessRuntime } from '../provider/types.js';
import { samePhysicalPath } from '../provider/path-identity.js';
import { createWorktreeManager } from '../manage/index.js';
import type { WorktreeManagerService } from '../manage/index.js';
import { DshHostReadAdapter, type DshHostReadContext } from './dsh-read-adapter.js';
import type { WorktreeActivitySource } from './worktree-activity.js';
import { createWorktreeRemoteProjection, project } from './remote.js';
import { createBaselineSync } from './baseline-sync.js';
import { createWorktreeSessionCreation } from './session-creation.js';
import { createWorktreeError } from '../contract/index.js';
import type { WorktreeSessionCreationRequest, WorktreeSessionCreationResult } from '../contract/index.js';
import type { WorktreeBaselineSyncRequest, WorktreeSessionDispatchResult } from '../contract/baseline-sync.js';
import { registerWorktreeTools, createWorktreeToolSessionPort } from '../tool/index.js';
import { createNativeWorktreeSessionDirectoryPort } from '../tool/native-session.js';
import { WorktreeToolChanges } from './worktree-tool-changes.js';
import type { WorktreeToolChangeBatch } from '../contract/worktree-tool-changes.js';
import type { WorktreeToolSelection, WorktreeToolSettingsScope } from '../contract/tool-settings.js';
import { WorktreeToolSettings } from './tool-settings.js';

/**
 * Host composition 所需且由 DSH bundle 注入的配置。
 * Configuration supplied by the DSH bundle to the Host composition.
 */
export interface WorktreeHostConfig {
  /** DSH 解析后的绝对数据根目录。 / Absolute DSH data root resolved by the Host. */
  readonly dshHome: string;
  /** Provider ids whose wire tools require explicit nullable default fields. */
  readonly nullableToolProviders?: readonly string[];
}

/**
 * Worktree plugin 的真实 composition root。
 *
 * Cordis 构造该服务时，以 `worktreeManager` 注册 Typert namespace，并把只读 DSH
 * adapter、Manage 实现和 browser-safe projection 组合成一个同生命周期对象；所属
 * Cordis fiber 卸载时，服务注册也随之移除。
 *
 * The real composition root for the Worktree plugin. When Cordis constructs it, the
 * service registers the `worktreeManager` Typert namespace and composes the read-only
 * DSH adapter, Manage implementation, and browser-safe projection into one
 * lifecycle-bound object. Its service registration is removed with the owning fiber.
 */
export class WorktreeRemoteService extends TypertRemoteService {
  // Cordis 在实例化前保证这三个只读 Host 服务可用；这里不注入任何 DSH mutation API。
  // Cordis ensures these three read-only Host services exist before instantiation; no
  // DSH mutation API is injected here.
  static inject = ['workspaceRegistry', 'sessions', 'sessionPersistence'];

  private readonly manager: WorktreeManagerService;
  private readonly dsh: DshHostReadAdapter;
  private readonly remote: WorktreeRemoteManager;
  private readonly toolChanges = new WorktreeToolChanges();
  private readonly toolSettings: WorktreeToolSettings;
  private baselineSync?: ReturnType<typeof createBaselineSync>;
  private sessionCreation?: ReturnType<typeof createWorktreeSessionCreation>;

  /**
   * 为当前 Cordis fiber 建立一次 Host 组合，并复用同一个 Remote projection 处理调用。
   * Builds the Host composition once for the current Cordis fiber and reuses one Remote
   * projection for all calls.
   */
  constructor(ctx: Context, config: WorktreeHostConfig) {
    super(ctx, 'worktreeManager');
    this.toolSettings = new WorktreeToolSettings(config.dshHome);
    let disposed = false;
    ctx.effect(
      () => () => {
        disposed = true;
      },
      'clutch-dsh-worktree: activity reader disposal',
    );
    const activitySource = ctx.get('activitySource') as WorktreeActivitySource | undefined;
    const native = ctx as Context & DshHostReadContext;
    const dsh = new DshHostReadAdapter({
      workspaceRegistry: native.workspaceRegistry,
      sessions: native.sessions,
      sessionPersistence: native.sessionPersistence,
      // Optional sibling services must use get(); undeclared Context property reads throw.
      // Resolve on each call so late mounting and replacement remain visible.
      get workingDirectory() {
        return ctx.get('workingDirectory') as DshHostReadContext['workingDirectory'];
      },
      get sessionQuery() {
        return ctx.get('sessionQuery') as DshHostReadContext['sessionQuery'];
      },
    }, {
      activitySource,
      isDisposed: () => disposed,
    });
    this.dsh = dsh;
    const subprocess = ctx.get('subprocess') as GitSubprocessRuntime | undefined;
    const manager = createWorktreeManager({
      dsh,
      dshHome: config.dshHome,
      subprocess,
    });
    this.manager = manager;
    ctx.effect(() => () => this.toolChanges.dispose(), 'clutch-dsh-worktree: tool change cleanup');
    ctx.inject(['sessionController', 'agents'], (sessionCtx) => {
      const sessions = createNativeWorktreeSessionDirectoryPort(sessionCtx);
      const creation = createWorktreeSessionCreation({ manager, sessions,
        changed: (workspaceId, worktreeId, requestId) => this.toolChanges.changed(workspaceId, worktreeId, requestId) });
      this.sessionCreation = creation;
      sessionCtx.effect(() => () => {
        creation.dispose();
        if (this.sessionCreation === creation) this.sessionCreation = undefined;
      });
    });
    // Optional command composition keeps the read-only Provider adapter unchanged.
    ctx.inject(
      ['commands', 'tools', 'sessionController', 'sessionQuery', 'agents', 'llm', 'systemPrompt'],
      (toolCtx) => {
        const sessions = createWorktreeToolSessionPort(toolCtx);
        const sync = createBaselineSync({ manager, sessions,
          changed: (workspaceId, worktreeId, requestId) => this.toolChanges.changed(workspaceId, worktreeId, requestId) });
        this.baselineSync = sync;
        toolCtx.effect(() => () => {
          sync.dispose();
          if (this.baselineSync === sync) this.baselineSync = undefined;
        }, 'clutch-dsh-worktree: baseline task cleanup');
        return registerWorktreeTools(toolCtx, {
          nullableToolProviders: config.nullableToolProviders,
          manager,
          samePhysicalPath,
          dsh,
          sessions,
          changed: (workspaceId, worktreeId) => this.toolChanges.changed(workspaceId, worktreeId),
          isDisposed: () => disposed,
          settings: this.toolSettings,
        });
      },
    );
    registerWorktreeInstructions(
      ctx as unknown as WorktreeInstructionHost,
      (sessionId) => manager.resolveSessionInstructions(sessionId),
      () => disposed,
    );
    ctx.effect(
      () => () => this.manager.close(),
      'clutch-dsh-worktree: Host manager cleanup',
    );
    this.remote = createWorktreeRemoteProjection(manager);
  }

  // 这些方法保持为薄边界，生成的 Typert 描述符只看到 contract-safe 签名；错误归一化
  // 和 JSON 投影集中由 `createWorktreeRemoteProjection` 负责。
  // These methods stay deliberately thin so generated Typert descriptors see only
  // contract-safe signatures; error normalization and JSON projection remain centralized
  // in `createWorktreeRemoteProjection`.
  @Remote
  canReuseLocalSession(input: { workspaceId: string; sessionId: string }): Promise<WorktreeRemoteResult<boolean>> {
    return project(async () => {
      const workspace = await this.dsh.getWorkspace(input.workspaceId);
      const bindings = await this.manager.listBindings(input);
      const session = await this.dsh.getSession(input.sessionId);
      if (session && session.originalCwd === undefined) {
        throw createWorktreeError('SESSION_CWD_MISMATCH', 'Native execution directory is unavailable.');
      }
      return !!workspace && !!session && session.sessionId === input.sessionId &&
        session.workspaceId === input.workspaceId &&
        !bindings.some((binding) => binding.sessionId === input.sessionId) &&
        await samePhysicalPath(session.cwd, workspace.rootPath);
    });
  }

  @Remote
  createWorktreeSession(input: WorktreeSessionCreationRequest, signal: AbortSignal): Promise<WorktreeRemoteResult<WorktreeSessionCreationResult>> {
    return project(() => {
      if (!this.sessionCreation) throw createWorktreeError('WORKTREE_STATE_CONFLICT', 'Native Session creation capability is unavailable.');
      return this.sessionCreation.create(input, signal);
    });
  }

  @Remote
  syncWorktreeBaseline(input: WorktreeBaselineSyncRequest, signal: AbortSignal): Promise<WorktreeRemoteResult<WorktreeSessionDispatchResult>> {
    return project(() => {
      if (!this.baselineSync) throw new Error('Native Session task capability is unavailable.');
      return this.baselineSync.sync(input, signal);
    });
  }

  @Remote
  async getToolSettings(input: { scope: WorktreeToolSettingsScope }): Promise<WorktreeRemoteResult<WorktreeToolSelection>> {
    await this.validateToolSettingsScope(input.scope);
    return { ok: true, value: await this.toolSettings.read(input.scope) };
  }

  @Remote
  async updateToolSettings(input: {
    scope: WorktreeToolSettingsScope;
    selection: WorktreeToolSelection;
    expected: WorktreeToolSelection;
  }): Promise<WorktreeRemoteResult<WorktreeToolSelection>> {
    await this.validateToolSettingsScope(input.scope);
    return { ok: true, value: await this.toolSettings.update(input.scope, input.selection, input.expected) };
  }

  private async validateToolSettingsScope(scope: WorktreeToolSettingsScope): Promise<void> {
    if (scope.kind === 'general') return;
    if (scope.kind === 'local') {
      if (!scope.workspaceId || !(await this.dsh.getWorkspace(scope.workspaceId)))
        throw new Error('Workspace is unavailable. Reopen its Dashboard.');
      return;
    }
    if (scope.kind !== 'worktree') throw new Error('Invalid tool settings scope');
    const records = await this.manager.listWorktrees({ workspaceId: scope.workspaceId });
    if (!records.some((record) => record.worktreeId === scope.worktreeId && record.status === 'active'))
      throw new Error('Worktree is unavailable. Reopen its Dashboard.');
  }

  @Remote
  async watchToolChanges(
    input: { readonly afterRevision: number },
    signal: AbortSignal,
  ): Promise<WorktreeRemoteResult<WorktreeToolChangeBatch>> {
    return { ok: true, value: await this.toolChanges.watch(input.afterRevision, signal) };
  }

  @Remote
  getWorktreeInstructions(input: {
    workspaceId: string;
    worktreeId: string;
  }): Promise<WorktreeRemoteResult<string>> {
    return this.remote.getWorktreeInstructions(input);
  }

  @Remote
  updateWorktreeInstructions(input: {
    workspaceId: string;
    worktreeId: string;
    instructions: string;
    expectedInstructions: string;
  }): Promise<WorktreeRemoteResult<string>> {
    return this.remote.updateWorktreeInstructions(input);
  }

  @Remote
  updateWorktreeBaseBranch(input: {
    workspaceId: string;
    worktreeId: string;
    baseBranch: string;
    expectedBaseBranch?: string;
  }): Promise<WorktreeRemoteResult<string>> {
    return this.remote.updateWorktreeBaseBranch(input);
  }

  @Remote
  getWorkspaceGitState(input: { workspaceId: WorkspaceId }): Promise<WorktreeRemoteResult<WorkspaceGitState>> {
    return this.remote.getWorkspaceGitState(input);
  }

  @Remote
  listWorktrees(input: {
    readonly workspaceId: string;
  }): Promise<WorktreeRemoteResult<readonly WorktreeRecord[]>> {
    return this.remote.listWorktrees(input);
  }

  @Remote
  readWorktreeSessionState(input: { workspaceId: string; worktreeId: string }): Promise<WorktreeRemoteResult<WorktreeSessionState>> {
    return this.remote.readWorktreeSessionState(input);
  }

  @Remote
  listWorktreeCommits(input: WorktreeGitHistoryRequest): Promise<WorktreeRemoteResult<WorktreeGitHistory>> {
    return this.remote.listWorktreeCommits(input);
  }

  @Remote
  listWorktreeCommitFiles(
    input: WorktreeGitCommitFilesRequest,
  ): Promise<WorktreeRemoteResult<WorktreeGitCommitFiles>> {
    return this.remote.listWorktreeCommitFiles(input);
  }

  @Remote
  getWorktreeCommitFileDiff(
    input: WorktreeGitFileDiffRequest,
  ): Promise<WorktreeRemoteResult<WorktreeGitFileDiff>> {
    return this.remote.getWorktreeCommitFileDiff(input);
  }

  @Remote
  listImportCandidates(input: {
    readonly workspaceId: WorkspaceId;
  }): Promise<WorktreeRemoteResult<readonly WorktreeImportCandidate[]>> {
    return this.remote.listImportCandidates(input);
  }

  @Remote
  listBranches(input: {
    readonly workspaceId: string;
  }): Promise<WorktreeRemoteResult<readonly BranchRecord[]>> {
    return this.remote.listBranches(input);
  }

  @Remote
  fetchRemoteBranches(input: {
    readonly workspaceId: string;
  }): Promise<WorktreeRemoteResult<readonly BranchRecord[]>> {
    return this.remote.fetchRemoteBranches(input);
  }

  @Remote
  getWorkspaceCheckout(input: { readonly workspaceId: WorkspaceId }): Promise<WorktreeRemoteResult<WorkspaceCheckout>> {
    return this.remote.getWorkspaceCheckout(input);
  }

  @Remote
  createWorktree(input: {
    readonly workspaceId: string;
    readonly branch: string;
    readonly newBranch?: string;
    readonly fromHead?: boolean;
    readonly expectedHeadCommit?: string;
  }): Promise<WorktreeRemoteResult<WorktreeRecord>> {
    return this.remote.createWorktree(input);
  }

  @Remote
  importWorktree(input: {
    readonly workspaceId: WorkspaceId;
    readonly absolutePath: string;
  }): Promise<WorktreeRemoteResult<WorktreeRecord>> {
    return this.remote.importWorktree(input);
  }

  @Remote
  removeWorktree(input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
    readonly mutationToken: string;
  }): Promise<WorktreeRemoteResult<null>> {
    return this.remote.removeWorktree(input);
  }

  @Remote
  unarchiveWorktree(input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
    readonly mutationToken: string;
  }): Promise<WorktreeRemoteResult<null>> {
    return this.remote.unarchiveWorktree(input);
  }

  @Remote
  adoptWorktreeBranch(input: {
    workspaceId: string;
    worktreeId: string;
    mutationToken: string;
    expectedBranch: string;
  }): Promise<WorktreeRemoteResult<null>> {
    return this.remote.adoptWorktreeBranch(input);
  }

  @Remote
  recoverWorktrees(input: { workspaceId: string }): Promise<WorktreeRemoteResult<null>> {
    return this.remote.recoverWorktrees(input);
  }

  @Remote
  cleanWorktree(input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
    readonly mutationToken: string;
  }): Promise<WorktreeRemoteResult<null>> {
    return this.remote.cleanWorktree(input);
  }

  @Remote
  forgetWorktree(input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
    readonly mutationToken: string;
  }): Promise<WorktreeRemoteResult<null>> {
    return this.remote.forgetWorktree(input);
  }

  @Remote
  insertWorktreeBefore(input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
    readonly beforeWorktreeId?: string;
  }): Promise<WorktreeRemoteResult<readonly WorktreeId[]>> {
    return this.remote.insertWorktreeBefore(input);
  }

  @Remote
  listBindings(input: {
    readonly workspaceId: string;
  }): Promise<WorktreeRemoteResult<readonly SessionBinding[]>> {
    return this.remote.listBindings(input);
  }

  @Remote
  bindSession(input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
    readonly sessionId: string;
  }): Promise<WorktreeRemoteResult<SessionBinding>> {
    return this.remote.bindSession(input);
  }

}

export default WorktreeRemoteService;
