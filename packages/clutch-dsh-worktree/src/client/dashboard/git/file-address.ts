/**
 * Canonical DSH session file address constructor.
 * Equivalent to `sessionFileAddress` from `@deepseek-ai/dsh-util-workspace-path`.
 * Address grammar: `dsh-resource://file/session/<sessionId>/<encodedPath>`
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':');
}

function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/');
}

export function buildSessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  return `dsh-resource://file/session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
}
