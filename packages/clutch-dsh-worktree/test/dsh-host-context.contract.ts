import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-persistence';
import type {} from '@deepseek-ai/dsh-workspace';
import type { DshHostReadContext } from '@cerbur/clutch-dsh-worktree';

type Extends<Left, Right> = Left extends Right ? true : false;
type Expect<Value extends true> = Value;
type ActualDshContextMatchesReadPort = Expect<
  Extends<
    Pick<Context, 'workspaceRegistry' | 'sessions' | 'sessionPersistence'>,
    DshHostReadContext
  >
>;

const actualDshContextMatchesReadPort: ActualDshContextMatchesReadPort = true;
void actualDshContextMatchesReadPort;
