/**
 * Browser-safe Windows path identity helpers. They intentionally do not touch
 * the filesystem; Provider adds physical stat/realpath checks where it has
 * access to Node APIs.
 */

const EXTENDED_UNC_PREFIX = '//?/UNC/';
const EXTENDED_PATH_PREFIX = '//?/';

export function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) ||
    value.startsWith('\\\\') ||
    /^\/\/\?(?:\/|\\)/u.test(value);
}

/** Strip only the extended drive/UNC prefixes supported by the browser boundary. */
export function stripExtendedWindowsPrefix(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (/^\/\/\?\/UNC\//iu.test(normalized)) {
    return '//' + normalized.slice(EXTENDED_UNC_PREFIX.length);
  }
  const extendedPath = normalized.slice(EXTENDED_PATH_PREFIX.length);
  if (
    normalized.startsWith(EXTENDED_PATH_PREFIX) &&
    /^[A-Za-z]:\//u.test(extendedPath)
  ) {
    return extendedPath;
  }
  return value;
}

export function normalizeWindowsPath(value: string): string {
  let normalized = stripExtendedWindowsPrefix(value).replaceAll('\\', '/');
  const unc = normalized.startsWith('//');
  normalized = normalized.replace(/\/{2,}/gu, '/');
  if (unc && normalized.startsWith('/')) normalized = '/' + normalized;
  if (normalized.length > 3) normalized = normalized.replace(/\/+$/u, '');
  return normalized.toLowerCase();
}

export function sameWindowsPath(left: string, right: string): boolean {
  return (isWindowsPath(left) || isWindowsPath(right)) &&
    normalizeWindowsPath(left) === normalizeWindowsPath(right);
}
