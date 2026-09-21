import { realpath } from 'node:fs/promises';
import path from 'node:path';

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\') || value.startsWith('//');
}

function normalizeWindowsPath(value: string): string {
  const normalized = value.replaceAll('/', '\\');
  if (/^\\\\\?\\UNC\\/iu.test(normalized)) return '\\\\' + normalized.slice(8);
  if (/^\\\\\?\\[A-Za-z]:[\\/]/u.test(normalized)) return normalized.slice(4);
  return normalized;
}

/** Compare lexical paths using the case and separator rules of the represented platform. */
export function sameLexicalPath(left: string, right: string): boolean {
  if (left === right) return true;
  if (isWindowsPath(left) || isWindowsPath(right)) {
    return path.win32.relative(
      path.win32.normalize(normalizeWindowsPath(left)),
      path.win32.normalize(normalizeWindowsPath(right)),
    ) === '';
  }
  return path.resolve(left) === path.resolve(right);
}

/** Compare existing paths physically, with a platform-aware lexical fallback for aliases and missing paths. */
export async function samePhysicalPath(left: string, right: string): Promise<boolean> {
  if (sameLexicalPath(left, right)) return true;
  try {
    const [canonicalLeft, canonicalRight] = await Promise.all([realpath(left), realpath(right)]);
    return sameLexicalPath(canonicalLeft, canonicalRight);
  } catch {
    return sameLexicalPath(left, right);
  }
}
