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
  WorktreeImportCandidate,
  WorktreePermissionRequest,
  WorktreePermissionNormalizationRequest,
  WorktreePermissionResult,
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
import { createWorktreeRemoteProjection } from './remote.js';
import {
  createDshWorktreePermissionAdapter,
  type DshWorktreePermissionAdapterOptions,
} from './worktree-permission.js';
import { createWorktreePermissionManager } from './worktree-permission-manager.js';
import { registerWorktreeTools, createWorktreeToolSessionPort } from '../tool/index.js';
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
    const dsh = new DshHostReadAdapter(ctx as Context & DshHostReadContext, {
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
    // Optional command composition keeps the read-only Provider adapter unchanged.
    ctx.inject(
      ['commands', 'tools', 'sessionController', 'sessionQuery', 'agents', 'llm', 'systemPrompt'],
      (toolCtx) => {
        return registerWorktreeTools(toolCtx, {
          manager,
          samePhysicalPath,
          dsh,
          sessions: createWorktreeToolSessionPort(toolCtx),
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
    // Optional capabilities can mount late, disappear or be replaced without
    // remounting this Host. Read the owning Context at call time, never capture
    // a provider instance; older profiles remain loadable and fail closed.
    const permissionAdapter = createDshWorktreePermissionAdapter({
      sessions: {
        get: (sessionId) =>
          (
            ctx as unknown as {
              readonly sessions: { get(id: string): unknown };
            }
          ).sessions.get(sessionId),
      },
      get permissionPresets() {
        return ctx.get('permissionPresets') as DshWorktreePermissionAdapterOptions['permissionPresets'];
      },
      get sandboxPolicy() {
        return ctx.get('sandboxPolicy') as DshWorktreePermissionAdapterOptions['sandboxPolicy'];
      },
    });
    this.remote = createWorktreeRemoteProjection(
      manager,
      createWorktreePermissionManager({
        manager,
        dsh,
        permissions: permissionAdapter,
      }),
    );
  }

  // 这些方法保持为薄边界，生成的 Typert 描述符只看到 contract-safe 签名；错误归一化
  // 和 JSON 投影集中由 `createWorktreeRemoteProjection` 负责。
  // These methods stay deliberately thin so generated Typert descriptors see only
  // contract-safe signatures; error normalization and JSON projection remain centralized
  // in `createWorktreeRemoteProjection`.
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

  @Remote
  ensureWorktreePermission(
    input: WorktreePermissionRequest,
  ): Promise<WorktreeRemoteResult<WorktreePermissionResult>> {
    return this.remote.ensureWorktreePermission(input);
  }

  @Remote
  normalizeDetachedWorktreePermissions(
    input: WorktreePermissionNormalizationRequest,
  ): Promise<WorktreeRemoteResult<WorktreePermissionResult>> {
    return this.remote.normalizeDetachedWorktreePermissions(input);
  }
}

export default WorktreeRemoteService;
