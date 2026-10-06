import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path';

/** Resolve checkout-relative Git paths against the actual Session cwd. */
export function buildSessionFileAddress(
  sessionId: string,
  path: string,
  gitRootPath?: string,
  cwd?: string,
): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  // Git paths remain checkout-relative even when the Session cwd is nested.
  const target = gitRootPath === undefined
    ? normalized
    : gitRootPath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + normalized;
  return fileAddressFor(sessionId, cwd, target);
}
