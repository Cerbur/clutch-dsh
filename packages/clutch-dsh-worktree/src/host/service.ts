import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

import type {
  BranchRecord,
  SessionBinding,
  WorktreeId,
  WorktreeRecord,
  WorktreeImportCandidate,
  WorktreePermissionRequest,
  WorktreePermissionNormalizationRequest,
  WorktreePermissionResult,
  WorkspaceId,
  WorktreeRemoteManager,
  WorktreeRemoteResult,
} from '../contract/index.js';
import { createWorktreeManager } from '../manage/index.js';
import {
  DshHostReadAdapter,
  type DshHostReadContext,
} from './dsh-read-adapter.js';
import { createWorktreeRemoteProjection } from './remote.js';
import {
  createDshWorktreePermissionAdapter,
  type DshWorktreePermissionAdapterOptions,
} from './worktree-permission.js';
import { createWorktreePermissionManager } from './worktree-permission-manager.js';

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

  private readonly remote: WorktreeRemoteManager;

  /**
   * 为当前 Cordis fiber 建立一次 Host 组合，并复用同一个 Remote projection 处理调用。
   * Builds the Host composition once for the current Cordis fiber and reuses one Remote
   * projection for all calls.
   */
  constructor(ctx: Context, config: WorktreeHostConfig) {
    super(ctx, 'worktreeManager');
    const dsh = new DshHostReadAdapter(ctx as Context & DshHostReadContext);
    const manager = createWorktreeManager({
      dsh,
      dshHome: config.dshHome,
    });
    // Permission presets are an optional DSH capability. Read them through a
    // structural seam so an older profile can still mount this plugin and
    // report `unverified` instead of failing during composition.
    const optionalServices: Pick<
      DshWorktreePermissionAdapterOptions,
      'permissionPresets' | 'sandboxPolicy'
    > = {
      permissionPresets: ctx.get('permissionPresets') as DshWorktreePermissionAdapterOptions['permissionPresets'],
      sandboxPolicy: ctx.get('sandboxPolicy') as DshWorktreePermissionAdapterOptions['sandboxPolicy'],
    };
    const permissionAdapter = createDshWorktreePermissionAdapter({
      sessions: {
        get: (sessionId) => (ctx as unknown as {
          readonly sessions: { get(id: string): unknown };
        }).sessions.get(sessionId),
      },
      permissionPresets: optionalServices.permissionPresets,
      sandboxPolicy: optionalServices.sandboxPolicy,
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
  listWorktrees(input: {
    readonly workspaceId: string;
  }): Promise<WorktreeRemoteResult<readonly WorktreeRecord[]>> {
    return this.remote.listWorktrees(input);
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
  createWorktree(input: {
    readonly workspaceId: string;
    readonly branch: string;
    readonly newBranch?: string;
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
  }): Promise<WorktreeRemoteResult<null>> {
    return this.remote.removeWorktree(input);
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
