import type { WorktreeManager } from '../contract/index.js';
import type {
  DshReadAdapter,
  GitWorktreeAdapter,
  SidecarStore,
} from '../provider/types.js';

/**
 * 单次执行的 cwd 解析键；解析结果是临时 runtime context，不会写回 DSH Session 或 sidecar。
 * Lookup key for one execution's cwd; the result is transient runtime context and is never written back to the DSH Session or sidecar.
 */
export interface RuntimeCwdInput {
  readonly workspaceId: string;
  readonly sessionId: string;
}

/**
 * Manage composition 配置；DSH adapter 必须只读，`dshHome` 划定插件 sidecar/worktree 的绝对存储边界。
 * Manage composition options; the DSH adapter must be read-only and `dshHome` defines the absolute storage boundary for plugin sidecars/worktrees.
 */
export interface WorktreeManagerOptions {
  readonly dsh: DshReadAdapter;
  readonly dshHome: string;

  /**
   * 可替换的底层端口主要用于 Host 组合与确定性测试；缺省时使用本地实现。
   * Replaceable low-level ports for Host composition and deterministic tests; local implementations are used by default.
   */
  readonly git?: GitWorktreeAdapter;
  readonly sidecar?: SidecarStore;

  /**
   * 生成的 ID 会在任何文件系统副作用前校验为路径安全片段。
   * Generated IDs are validated as path-safe segments before any filesystem side effect.
   */
  readonly idFactory?: () => string;
}

/**
 * Host 侧的完整 Manage 服务；`resolveRuntimeCwd` 有意不属于 browser-safe `WorktreeManager` Remote 契约。
 * Complete Host-side Manage service; `resolveRuntimeCwd` is intentionally absent from the browser-safe `WorktreeManager` Remote contract.
 */
export interface WorktreeManagerService extends WorktreeManager {
  /**
   * 每次调用都从 DSH Workspace 与 sidecar 重新派生 cwd；active 关系损坏时明确失败，不静默回退。
   * Re-derives cwd from the DSH Workspace and sidecar on every call; a broken active relation fails explicitly instead of silently falling back.
   */
  resolveRuntimeCwd(input: RuntimeCwdInput): Promise<string>;
}
