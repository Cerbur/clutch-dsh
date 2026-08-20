/**
 * Manage 模块的公开入口：暴露用例编排与 runtime cwd 服务，并通过注入隐藏底层 Git/sidecar 实现。
 * Public Manage entrypoint: exposes use-case orchestration and runtime cwd services while keeping Git/sidecar implementations behind injection.
 *
 * @packageDocumentation
 */
export { WorktreeManagerImpl, createWorktreeManager } from './manager.js';
export type {
  RuntimeCwdInput,
  WorktreeManagerOptions,
  WorktreeManagerService,
} from './types.js';
