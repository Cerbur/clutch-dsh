import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { isWindowsPath, normalizeWindowsPath } from '../contract/windows-path.js';

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
