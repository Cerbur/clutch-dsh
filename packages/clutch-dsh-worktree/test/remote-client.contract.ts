import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol';
import type { WorktreeConnectionAdapter } from '@cerbur/clutch-dsh-worktree/client';
import type { WorktreeManager, WorktreeRemoteManager, WorktreeRemoteResult, WorktreeBaselineSyncRequest, WorktreeSessionDispatchResult } from '@cerbur/clutch-dsh-worktree';
import type {} from '@cerbur/clutch-dsh-worktree/remote';

type Extends<Left, Right> = Left extends Right ? true : false;
type Expect<Value extends true> = Value;
type GeneratedWireManager = {
  [Method in keyof WorktreeRemoteManager]: (
    ...args: Parameters<NonNullable<WorktreeRemoteManager[Method]>>
  ) => Promise<RemoteResult<Awaited<ReturnType<NonNullable<WorktreeRemoteManager[Method]>>>>>;
};
type GeneratedNamespaceMatchesHostContract = Expect<
  Extends<TypertClientRemote['worktreeManager'], GeneratedWireManager>
>;
type ConnectionAdapterMatchesManager = Expect<Extends<WorktreeConnectionAdapter, WorktreeManager>>;

const generatedNamespaceMatchesHostContract: GeneratedNamespaceMatchesHostContract = true;
const connectionAdapterMatchesManager: ConnectionAdapterMatchesManager = true;
const generatedSyncMatchesContract: Expect<Extends<TypertClientRemote['worktreeManager']['syncWorktreeBaseline'],
  (input: WorktreeBaselineSyncRequest) => Promise<RemoteResult<WorktreeRemoteResult<WorktreeSessionDispatchResult>>>>> = true;
void generatedSyncMatchesContract;
void generatedNamespaceMatchesHostContract;
void connectionAdapterMatchesManager;
