import type { BranchRecord, SessionBinding, WorktreeManager, WorktreeRecord } from './index.js';

const expectedManagerKeys = [
  'listWorktrees',
  'listBranches',
  'createWorktree',
  'removeWorktree',
  'listBindings',
  'bindSession',
] as const;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;
type ManagerKeysMatchSpec = Expect<
  Equal<keyof WorktreeManager, (typeof expectedManagerKeys)[number]>
>;

const managerKeysMatchSpec: ManagerKeysMatchSpec = true;

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

void managerKeysMatchSpec;
void expectedManagerKeys;
void worktree;
void branch;
void binding;
