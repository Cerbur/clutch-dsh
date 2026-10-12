/** Accept branch short names only; Git revision expressions and options are forbidden. */
export function isSafeBranchName(branch: string): boolean {
  if (!branch || branch === '@' || branch.startsWith('-') || branch.startsWith('refs/')) return false;
  if ([...branch].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 ||
    '~^:?*[\\'.includes(character)) || branch.includes('..') || branch.includes('@{')) return false;
  return branch.split('/').every((part) => part.length > 0 && !part.startsWith('.') &&
    !part.endsWith('.') && !part.endsWith('.lock'));
}

/** Only exact branch namespaces are accepted, and callers must also enumerate the ref. */
export function isSafeBranchIdentity(branch: string): boolean {
  const prefix = ['refs/heads/', 'refs/remotes/'].find((value) => branch.startsWith(value));
  return isSafeBranchName(prefix === undefined ? branch : branch.slice(prefix.length));
}
