/**
 * Host-only 组合面：连接真实 DSH 服务、Manage 用例与 Typert Remote 投影。
 * 浏览器 Consumer 必须经 `../client/index.js` 的 facade 访问，不能导入这里的运行时。
 *
 * Host-only composition surface connecting real DSH services, Manage use cases, and
 * the Typert Remote projection. Browser consumers must go through the facade in
 * `../client/index.js` rather than importing this runtime surface.
 *
 * @packageDocumentation
 */
export { DshHostReadAdapter } from './dsh-read-adapter.js';
export type { DshHostReadContext } from './dsh-read-adapter.js';
export { createWorktreeRemoteProjection } from './remote.js';
export { WorktreeRemoteService } from './service.js';
export type { WorktreeHostConfig } from './service.js';
export {
  createDshWorktreePermissionAdapter,
} from './worktree-permission.js';
export type { DshWorktreePermissionAdapterOptions } from './worktree-permission.js';
export {
  createWorktreePermissionManager,
} from './worktree-permission-manager.js';
export type { WorktreePermissionManagerOptions } from './worktree-permission-manager.js';
