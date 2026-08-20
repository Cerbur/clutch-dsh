import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol';
import type { WorktreeRemoteNamespace } from 'clutch-dsh-worktree/client';
import type {} from 'clutch-dsh-worktree/remote';

type Extends<Left, Right> = Left extends Right ? true : false;
type Expect<Value extends true> = Value;
type GeneratedNamespaceMatchesFacade = Expect<
  Extends<TypertClientRemote['worktreeManager'], WorktreeRemoteNamespace>
>;

const generatedNamespaceMatchesFacade: GeneratedNamespaceMatchesFacade = true;
void generatedNamespaceMatchesFacade;
