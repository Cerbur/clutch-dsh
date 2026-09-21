/**
 * Browser-safe Windows path identity helpers. They intentionally do not touch
 * the filesystem; Provider adds physical realpath checks where it has access
 * to Node APIs.
 */

export function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\') || value.startsWith('//');
}

export function normalizeWindowsPath(value: string): string {
  let normalized = value.replaceAll('\\', '/');
  if (/^\/\/\?\/UNC\//iu.test(normalized)) normalized = '//' + normalized.slice(8);
  else if (/^\/\/\?\//u.test(normalized)) normalized = normalized.slice(4);
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
