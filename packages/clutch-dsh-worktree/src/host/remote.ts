import {
  WORKTREE_ERROR_CODES,
  createWorktreeError,
  type WorktreeError,
  type WorktreeManager,
  type WorktreeRemoteManager,
  type WorktreeRemoteResult,
} from '../contract/index.js';

const worktreeErrorCodes = new Set<string>(WORKTREE_ERROR_CODES);

function isWorktreeError(error: unknown): error is WorktreeError {
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return false;
  const candidate = error as Partial<WorktreeError>;
  return (
    typeof candidate.code === 'string' &&
    worktreeErrorCodes.has(candidate.code) &&
    typeof candidate.message === 'string' &&
    typeof candidate.details === 'object' &&
    candidate.details !== null &&
    !Array.isArray(candidate.details)
  );
}

async function project<Value>(operation: () => Promise<Value>): Promise<WorktreeRemoteResult<Value>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    // 只有稳定、可识别的领域错误进入 browser-safe Result；未知异常继续交给 DSH
    // Gateway 作为 transport/Host failure 处理，避免把基础设施故障伪装成业务拒绝。
    // Only stable, recognized domain errors enter the browser-safe Result. Unknown
    // exceptions continue to the DSH Gateway as transport/Host failures instead of being
    // disguised as business rejections.
    if (!isWorktreeError(error)) throw error;
    return {
      ok: false,
      error: createWorktreeError(error.code, error.message, error.details),
    };
  }
}

/**
 * 将 Host 内的 Manage 能力投影为 DSH Remote 可传输的 plain-JSON contract。
 *
 * 该边界只暴露稳定结果和错误值，不泄漏 Manager 实例、Provider class、Git、sidecar
 * 或其他 Node-only 对象。
 *
 * Projects Host-side Manage capabilities into the plain-JSON contract carried by DSH
 * Remote. The boundary exposes only stable result and error values, never Manager
 * instances, Provider classes, Git, sidecar, or other Node-only objects.
 *
 * @param manager - Host 内已组合完成的用例接口。 / Fully composed Host use-case port.
 * @returns 可供生成 Remote 暴露的安全投影。 / Safe projection for generated Remote export.
 */
export function createWorktreeRemoteProjection(manager: WorktreeManager): WorktreeRemoteManager {
  return {
    listWorktrees: (input) => project(() => manager.listWorktrees(input)),
    listBranches: (input) => project(() => manager.listBranches(input)),
    createWorktree: (input) => project(() => manager.createWorktree(input)),
    removeWorktree: (input) =>
      project(async () => {
        await manager.removeWorktree(input);
        // `void` 没有 JSON 表示，因此成功删除在 wire contract 中显式投影为 null。
        // `void` has no JSON representation, so successful removal is explicitly projected
        // to null in the wire contract.
        return null;
      }),
    listBindings: (input) => project(() => manager.listBindings(input)),
    bindSession: (input) => project(() => manager.bindSession(input)),
  };
}
