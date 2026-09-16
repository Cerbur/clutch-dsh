/** Keep one current Session row in the Worktree content scrollport. */
export function scrollCurrentSessionIntoView(
  root: HTMLElement | null,
  sessionId: string,
): boolean {
  if (root === null) return false;
  const row = Array.from(root.querySelectorAll<HTMLElement>('[data-session-id]')).find(
    (candidate) => candidate.dataset.sessionId === sessionId,
  );
  if (row === undefined) return false;

  const rootRect = root.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  if (rowRect.top < rootRect.top) {
    root.scrollTop -= rootRect.top - rowRect.top;
  } else if (rowRect.bottom > rootRect.bottom) {
    root.scrollTop += rowRect.bottom - rootRect.bottom;
  }
  return true;
}
