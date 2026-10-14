import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path';
import { isWindowsPath, stripExtendedWindowsPrefix } from '../../../contract/windows-path.js';

export class GitFileAddressError extends Error {
  readonly code = 'GIT_FILE_OUTSIDE_SESSION';
}

function absoluteDirectory(value: string): string {
  const absolute = stripExtendedWindowsPrefix(value).replace(/\\/g, '/');
  if (!absolute.startsWith('/') && !/^[A-Za-z]:\//u.test(absolute)) {
    throw new GitFileAddressError('Workspace directory, Git root and Session cwd must be absolute');
  }
  const normalized = absolute.replace(/\/+$/u, '');
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new GitFileAddressError('Ambiguous directory path');
  }
  return normalized;
}

/** Resolve Workspace-relative Git paths against the actual Session cwd. */
export function buildSessionFileAddress(
  sessionId: string,
  path: string,
  workspacePath?: string,
  cwd?: string,
  gitRootPath = workspacePath,
): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized) ||
    normalized.includes('\0') || normalized.split('/').some((segment) => segment === '.' || segment === '')) {
    throw new GitFileAddressError('Expected a Workspace-relative Git file path');
  }
  if (workspacePath === undefined) {
    if (normalized.split('/').includes('..')) throw new GitFileAddressError('Workspace directory is required');
    return fileAddressFor(sessionId, cwd, normalized);
  }
  const root = absoluteDirectory(workspacePath);
  const sessionRoot = absoluteDirectory(cwd ?? workspacePath);
  const checkoutRoot = absoluteDirectory(gitRootPath ?? workspacePath);
  const parts = root.split('/');
  const rootSegments = root.startsWith('//') ? 4 : 1;
  for (const segment of normalized.split('/')) {
    if (segment === '..') {
      if (parts.length <= rootSegments) throw new GitFileAddressError('Path escapes the filesystem root');
      parts.pop();
    } else parts.push(segment);
  }
  const target = parts.join('/');
  const windows = isWindowsPath(workspacePath) || isWindowsPath(cwd ?? workspacePath) || root.startsWith('//');
  const identity = (value: string) => windows ? value.toLowerCase() : value;
  if (!identity(target).startsWith(identity(checkoutRoot) + '/') ||
    !identity(target).startsWith(identity(sessionRoot) + '/')) {
    throw new GitFileAddressError('The changed file is outside the Session working directory');
  }
  // Compute the relative path explicitly so Windows casing and extended prefixes
  // cannot make the native lexical helper emit an accidental absolute address.
  return fileAddressFor(sessionId, cwd, target.slice(sessionRoot.length + 1));
}
