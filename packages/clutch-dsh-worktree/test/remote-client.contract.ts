import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol';
import type { WorktreeConnectionAdapter } from 'clutch-dsh-worktree/client';
import type { WorktreeManager, WorktreeRemoteManager } from 'clutch-dsh-worktree';
import type {} from 'clutch-dsh-worktree/remote';

type Extends<Left, Right> = Left extends Right ? true : false;
type Expect<Value extends true> = Value;
type GeneratedWireManager = {
  [Method in keyof WorktreeRemoteManager]: (
    ...args: Parameters<WorktreeRemoteManager[Method]>
  ) => Promise<RemoteResult<Awaited<ReturnType<WorktreeRemoteManager[Method]>>>>;
};
type GeneratedNamespaceMatchesHostContract = Expect<
  Extends<TypertClientRemote['worktreeManager'], GeneratedWireManager>
>;
type ConnectionAdapterMatchesManager = Expect<Extends<WorktreeConnectionAdapter, WorktreeManager>>;

const generatedNamespaceMatchesHostContract: GeneratedNamespaceMatchesHostContract = true;
const connectionAdapterMatchesManager: ConnectionAdapterMatchesManager = true;
void generatedNamespaceMatchesHostContract;
void connectionAdapterMatchesManager;
