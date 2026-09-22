import { open } from 'node:fs/promises';

const DIRECTORY_SYNC_FALLBACK_CODES = ['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'] as const;

type ErrorCode = { readonly code?: string };

function hasCode(error: unknown, codes: readonly string[]): boolean {
  return codes.includes((error as ErrorCode).code ?? '');
}

/**
 * Flush one temporary sidecar file before publishing it. Windows requires a
 * writable handle for FlushFileBuffers; file-sync failures remain visible so
 * an unflushed snapshot is never acknowledged as durable.
 */
export async function syncFile(pathname: string): Promise<void> {
  const handle = await open(pathname, 'r+');
  try {
    await handle.sync();
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
