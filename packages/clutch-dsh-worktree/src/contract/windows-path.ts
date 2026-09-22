/**
 * Browser-safe Windows path identity helpers. They intentionally do not touch
 * the filesystem; Provider adds physical stat/realpath checks where it has
 * access to Node APIs.
 */

const EXTENDED_PATH_PREFIX = '//?/';
const EXTENDED_UNC_PREFIX = '//?/UNC/';

export function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) ||
    value.startsWith('\\\\') ||
    /^\/\/\?(?:\/|\\)/u.test(value);
}

/** Strip only the extended drive/UNC prefixes supported by the browser boundary. */
export function stripExtendedWindowsPrefix(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  const normalizedUncPrefix = EXTENDED_UNC_PREFIX.toLowerCase();
  if (normalized.toLowerCase().startsWith(normalizedUncPrefix)) {
    return '//' + normalized.slice(EXTENDED_UNC_PREFIX.length);
  }

  if (normalized.startsWith(EXTENDED_PATH_PREFIX)) {
    const drivePath = normalized.slice(EXTENDED_PATH_PREFIX.length);
    if (/^[A-Za-z]:\//u.test(drivePath)) return drivePath;
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
