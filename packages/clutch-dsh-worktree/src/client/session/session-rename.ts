import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';

type Sessions = Context['sessions'];
type CompatibleSessions = Omit<Sessions, 'using'> & {
  readonly using?: Sessions['using'];
};

/** Rename a listed Session across DSH generations with different retention semantics. */
export async function renameWorktreeSession(
  sessions: Sessions,
  sessionId: SessionId,
  title: string,
): Promise<void> {
  const compatibleSessions = sessions as CompatibleSessions;
  if (typeof compatibleSessions.using === 'function') {
    const result = await compatibleSessions.using(
      sessionId,
      { source: 'workspaceOperation' },
      (reference) => reference.binding.session.rename(title),
    );
    if (!result.ok) throw new Error(result.error.message);
    return;
  }

  // DSH versions before borrow-only bindings expose a live Session for a listed id.
  const session = compatibleSessions.binding(sessionId)?.session;
  if (session === undefined) throw new Error(`unknown session "${sessionId}"`);
  const result = await session.rename(title);
  if (!result.ok) throw new Error(result.error.message);
}
