import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { isWindowsPath, normalizeWindowsPath } from '../contract/windows-path.js';

function errorCode(error: unknown): string | undefined {
  return (error as { readonly code?: string }).code;
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

/**
 * Compare existing paths by filesystem identity, with a lexical fallback only when
 * one of the paths is missing. Permission and I/O failures stay fail-closed.
 */
export async function samePhysicalPath(left: string, right: string): Promise<boolean> {
  if (sameLexicalPath(left, right)) return true;

  let leftStats: Awaited<ReturnType<typeof stat>> | undefined;
  let rightStats: Awaited<ReturnType<typeof stat>> | undefined;
  let leftMissing = false;
  let rightMissing = false;
  try {
    leftStats = await stat(left);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    leftMissing = true;
  }
  try {
    rightStats = await stat(right);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    rightMissing = true;
  }
  if (leftMissing || rightMissing) return sameLexicalPath(left, right);

  if (
    leftStats !== undefined &&
    rightStats !== undefined &&
    leftStats.dev === rightStats.dev &&
    leftStats.ino !== 0 &&
    leftStats.ino === rightStats.ino
  ) {
    return true;
  }
  try {
    const [canonicalLeft, canonicalRight] = await Promise.all([realpath(left), realpath(right)]);
    return sameLexicalPath(canonicalLeft, canonicalRight);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return sameLexicalPath(left, right);
    throw error;
  }
}
