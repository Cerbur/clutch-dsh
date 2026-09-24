import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';

type Sessions = Context['sessions'];
type UiWorkspace = Context['uiWorkspace'];
type CompatibleUiWorkspace = Omit<UiWorkspace, 'openSession'> & {
  readonly openSession?: UiWorkspace['openSession'];
};
type CompatibleSessions = Omit<Sessions, 'open'> & {
  readonly open?: (sessionId: SessionId) => void;
};

/** Use DSH-owned navigation in 1.7; keep the older Session-controller fallback. */
export function openWorktreeSession(
  uiWorkspace: UiWorkspace,
  sessions: Sessions,
  sessionId: SessionId,
): void {
  const compatibleUiWorkspace = uiWorkspace as CompatibleUiWorkspace;
  if (typeof compatibleUiWorkspace.openSession === 'function') {
    compatibleUiWorkspace.openSession(sessionId);
    return;
  }
  const legacyOpen = (sessions as CompatibleSessions).open;
  if (typeof legacyOpen === 'function') {
    legacyOpen(sessionId);
    return;
  }
  throw new Error('DSH Client does not expose a Session navigation method');
}
