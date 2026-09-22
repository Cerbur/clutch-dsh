import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const WINDOWS_PROCESS_PROBE_TIMEOUT_MS = 1_000;
const WINDOWS_PROCESS_PROBE_MAX_BUFFER = 64 * 1024;
const execFile = promisify(execFileCallback);

/** The small process-liveness seam needed by stale mutation-lock reclamation. */
export interface ProcessLiveness {
  isAlive(pid: number): Promise<boolean>;
}

export interface ProcessLivenessOptions {
  readonly platform?: NodeJS.Platform;
  /** Test seam for the Windows process-table query; production uses tasklist. */
  readonly windowsIsAlive?: (pid: number) => Promise<boolean>;
}

async function isPosixProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { readonly code?: string }).code === 'EPERM';
  }
}

async function isWindowsProcessAlive(pid: number): Promise<boolean> {
  // Node 23.4.0 briefly mapped signal 0 to SIGKILL on Windows. Query the
  // native process table instead, and fail closed when it cannot be queried.
  try {
    const { stdout } = await execFile(
      'tasklist.exe',
      ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'],
      {
        encoding: 'utf8',
        maxBuffer: WINDOWS_PROCESS_PROBE_MAX_BUFFER,
        timeout: WINDOWS_PROCESS_PROBE_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    return new RegExp('^"[^"]*","' + pid + '",', 'mu').test(stdout);
  } catch {
    // Reclamation requires proof that the owner is dead. Keep an unknown
    // process alive rather than risking removal of a live owner's lock.
    return true;
  }
}

export function createProcessLiveness({
  platform = process.platform,
  windowsIsAlive = isWindowsProcessAlive,
}: ProcessLivenessOptions = {}): ProcessLiveness {
  return {
    isAlive: platform === 'win32' ? windowsIsAlive : isPosixProcessAlive,
  };
}

export const defaultProcessLiveness = createProcessLiveness();
