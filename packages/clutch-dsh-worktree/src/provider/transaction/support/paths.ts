import path from 'node:path';
import { lstat, realpath, stat } from 'node:fs/promises';
import type { RepositoryIdentity } from '../../types.js';

export function isMissing(error: unknown): boolean {
  return (error as { readonly code?: string }).code === 'ENOENT';
}

export async function pathExists(pathname: string): Promise<boolean> {
  try {
    await stat(pathname);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export async function pathEntryMissing(pathname: string): Promise<boolean> {
  try {
    await lstat(pathname);
    return false;
  } catch (error) {
    if (isMissing(error)) return true;
    throw error;
  }
}

export async function isDirectory(pathname: string): Promise<boolean> {
  try {
    return (await stat(pathname)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export async function canonicalPath(pathname: string): Promise<string> {
  try {
    return await realpath(pathname);
  } catch (error) {
    if (isMissing(error)) return path.resolve(pathname);
    throw error;
  }
}

export async function samePhysicalPath(left: string, right: string): Promise<boolean> {
  if (path.resolve(left) === path.resolve(right)) return true;
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export function sameRepository(left: RepositoryIdentity, right: RepositoryIdentity): boolean {
  return path.resolve(left.commonDirectory) === path.resolve(right.commonDirectory);
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
