import { open } from 'node:fs/promises';

const FILE_SYNC_FALLBACK_CODES = ['EINVAL', 'ENOTSUP', 'EPERM'] as const;
const DIRECTORY_SYNC_FALLBACK_CODES = ['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'] as const;

type ErrorCode = { readonly code?: string };

function hasCode(error: unknown, codes: readonly string[]): boolean {
  return codes.includes((error as ErrorCode).code ?? '');
}

/**
 * Flush one temporary sidecar file when the filesystem supports it. Windows
 * requires a writable handle for FlushFileBuffers, while some filesystems do
 * not expose file sync at all; both cases retain the existing best-effort
 * durability contract.
 */
export async function syncFile(pathname: string): Promise<void> {
  const handle = await open(pathname, 'r+');
  try {
    try {
      await handle.sync();
    } catch (error) {
      if (!hasCode(error, FILE_SYNC_FALLBACK_CODES)) throw error;
    }
  } finally {
    await handle.close();
  }
}

/** Directory sync is best effort because Windows and several filesystems do not support it. */
export async function syncDirectory(pathname: string): Promise<void> {
  try {
    const handle = await open(pathname, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!hasCode(error, DIRECTORY_SYNC_FALLBACK_CODES)) throw error;
  }
}
