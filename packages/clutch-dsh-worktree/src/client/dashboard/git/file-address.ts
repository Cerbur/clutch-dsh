import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path';
import { isWindowsPath, stripExtendedWindowsPrefix } from '../../../contract/windows-path.js';

export class GitFileAddressError extends Error {
  readonly code = 'GIT_FILE_OUTSIDE_SESSION';
}

function absoluteDirectory(value: string): string {
  const absolute = stripExtendedWindowsPrefix(value).replace(/\\/g, '/');
  if (!absolute.startsWith('/') && !/^[A-Za-z]:\//u.test(absolute)) {
    throw new GitFileAddressError('Git root and Session cwd must be absolute');
  }
  const normalized = absolute.replace(/\/+$/u, '');
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new GitFileAddressError('Ambiguous directory path');
  }
  return normalized;
}

/** Resolve checkout-relative Git paths against the actual Session cwd. */
export function buildSessionFileAddress(
  sessionId: string,
  path: string,
  gitRootPath?: string,
  cwd?: string,
): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized) ||
    normalized.includes('\0') || normalized.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new GitFileAddressError('Expected a checkout-relative Git file path');
  }
  // Git paths remain checkout-relative even when the Session cwd is nested.
  if (gitRootPath === undefined) return fileAddressFor(sessionId, cwd, normalized);
  const root = absoluteDirectory(gitRootPath);
  const sessionRoot = absoluteDirectory(cwd ?? gitRootPath);
  const target = root + '/' + normalized;
  const windows = isWindowsPath(gitRootPath) || isWindowsPath(cwd ?? gitRootPath) || root.startsWith('//');
  const identity = (value: string) => windows ? value.toLowerCase() : value;
  if (!identity(target).startsWith(identity(sessionRoot) + '/')) {
    throw new GitFileAddressError('The changed file is outside the Session working directory');
  }
  // Compute the relative path explicitly so Windows casing and extended prefixes
  // cannot make the native lexical helper emit an accidental absolute address.
  return fileAddressFor(sessionId, cwd, target.slice(sessionRoot.length + 1));
}
