import type {
  BranchRecord,
  SessionBinding,
  WorktreeManager,
  WorktreeRecord,
  WorktreeRemoteManager,
} from './index.js';

// 两份列表刻意独立于 interface 编写：任何方法遗漏或意外扩张都会在类型检查阶段失败。
// These lists are deliberately independent of the interfaces so omissions or accidental expansion fail at type-check time.
const expectedManagerKeys = [
  'listWorktrees',
  'listBranches',
  'createWorktree',
  'removeWorktree',
  'insertWorktreeBefore',
  'listBindings',
  'bindSession',
] as const;
const expectedRemoteKeys = [
  'listWorktrees',
  'listBranches',
  'createWorktree',
  'removeWorktree',
  'insertWorktreeBefore',
  'listBindings',
  'bindSession',
] as const;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

// 双向相等检查同时拒绝缺失键和额外键，而不只是验证一侧可赋值性。
// Bidirectional equality rejects both missing and extra keys instead of checking one-way assignability.
type ManagerKeysMatchSpec = Expect<
  Equal<keyof WorktreeManager, (typeof expectedManagerKeys)[number]>
>;
type RemoteKeysMatchSpec = Expect<
  Equal<keyof WorktreeRemoteManager, (typeof expectedRemoteKeys)[number]>
>;

const managerKeysMatchSpec: ManagerKeysMatchSpec = true;
const remoteKeysMatchSpec: RemoteKeysMatchSpec = true;

// 这些编译契约 fixture 固定公开 DTO 的最小可构造形状；它们不导出，也不充当运行时 validator。
// These compile-contract fixtures pin the minimum constructible public DTO shapes; they are neither exported nor used as runtime validators.
const worktree: WorktreeRecord = {
  worktreeId: 'wt_example',
  workspaceId: 'ws_example',
  absolutePath: '/tmp/dsh/worktree/wt_example',
  branch: 'feature/example',
  status: 'active',
};
const branch: BranchRecord = {
  name: 'feature/example',
  isCurrent: false,
  checkedOut: false,
};
const binding: SessionBinding = {
  workspaceId: 'ws_example',
  worktreeId: 'wt_example',
  sessionId: 'session_example',
  status: 'active',
};

// `void` 只用于满足 no-unused 检查；契约证明本身由上面的类型赋值完成。
// `void` only satisfies no-unused checks; the contract proofs are the type assignments above.
void managerKeysMatchSpec;
void remoteKeysMatchSpec;
void expectedManagerKeys;
void expectedRemoteKeys;
void worktree;
void branch;
void binding;
