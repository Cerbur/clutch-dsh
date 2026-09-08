export function scrollCurrentSessionIntoView(
  root: ParentNode | null,
  sessionId: string,
): boolean {
  if (root === null) return false;
  const row = Array.from(root.querySelectorAll<HTMLElement>('[data-session-id]'))
    .find((candidate) => candidate.dataset.sessionId === sessionId);
  if (row === undefined) return false;
  row.scrollIntoView({ block: 'nearest' });
  return true;
}
