import console from 'node:console';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import {
  ensureConfigDir,
  getLogFilePath,
  getPidPath,
  getStatePath,
  resolveDshHome,
} from './config.mjs';

/**
 * Check if a process with the given PID is currently alive.
 * @param {number | null | undefined} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * Read current process state from state.json and web.pid.
 * Validates whether the recorded PID is actually alive.
 * @returns {{
 *   running: boolean;
 *   pid: number | null;
 *   args: string[];
 *   startedAt?: string;
 *   cwd?: string;
 * }}
 */
export function readProcessState() {
  const stateFile = getStatePath();
  const pidFile = getPidPath();
  let state = { running: false, pid: null, args: [] };

  if (existsSync(stateFile)) {
    try {
      state = JSON.parse(readFileSync(stateFile, 'utf8'));
    } catch {
      // ignore parse error
    }
  }

  // Fallback to pidFile if state has no pid
  if (!state.pid && existsSync(pidFile)) {
    try {
      const p = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      if (Number.isFinite(p) && p > 0) {
        state.pid = p;
      }
    } catch {
      // ignore
    }
  }

  if (state.pid) {
    if (isProcessAlive(state.pid)) {
      state.running = true;
    } else {
      // Process is dead, clean up stale state
      state.running = false;
      state.pid = null;
      if (existsSync(pidFile)) {
        try {
          unlinkSync(pidFile);
        } catch {
          // ignore
        }
      }
      try {
        writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
      } catch {
        // ignore
      }
    }
  } else {
    state.running = false;
  }

  return state;
}

/**
 * Persist process state to state.json and web.pid.
 * @param {Record<string, unknown>} state
 */
export function saveProcessState(state) {
  ensureConfigDir();
  const stateFile = getStatePath();
  const pidFile = getPidPath();

  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');

  if (state.pid && state.running) {
    writeFileSync(pidFile, String(state.pid) + '\n', 'utf8');
  } else if (existsSync(pidFile)) {
    try {
      unlinkSync(pidFile);
    } catch {
      // ignore
    }
  }
}

/**
 * Read the last N lines from a log file.
 * @param {string} filePath
 * @param {number} maxLines
 * @returns {string[]}
 */
export function readLogTail(filePath, maxLines = 20) {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter((l, i, arr) => i < arr.length - 1 || l.length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

/**
 * Start DSH Web service.
 * @param {object} options
 * @param {string[]} [options.args] Arguments to forward to `pnpm dsh web`
 * @param {boolean} [options.foreground] Whether to run in foreground
 * @param {number} [options.bootCheckDelayMs] Milliseconds to wait before checking if daemon stayed alive
 * @returns {Promise<{
 *   success: boolean;
 *   pid?: number;
 *   args?: string[];
 *   logFile?: string;
 *   message?: string;
 *   error?: string;
 * }>}
 */
export async function startWebService(options = {}) {
  const { args = [], foreground = false, bootCheckDelayMs = 800 } = options;

  const home = resolveDshHome();
  if (!home.valid || !home.path) {
    return {
      success: false,
      error: home.error || 'Invalid or missing DSH home. Run dwm home <path> to configure.',
    };
  }

  const currentState = readProcessState();
  if (currentState.running && currentState.pid) {
    return {
      success: false,
      message: `DSH Web is already running (PID: ${currentState.pid}). Use "dwm restart" or "dwm down" first.`,
      pid: currentState.pid,
      args: currentState.args,
    };
  }

  const dshHome = home.path;
  const logFile = getLogFilePath();
  ensureConfigDir();

  if (foreground) {
    console.log(`Starting DSH Web in foreground in ${dshHome}...`);
    console.log(`Command: pnpm dsh web ${args.join(' ')}`);
    const child = spawn('pnpm', ['dsh', 'web', ...args], {
      cwd: dshHome,
      stdio: 'inherit',
      env: { ...process.env },
    });

    saveProcessState({
      pid: child.pid,
      running: true,
      startedAt: new Date().toISOString(),
      args,
      cwd: dshHome,
    });

    const exitCode = await new Promise((resolve) => {
      child.on('close', (code) => resolve(code ?? 0));
      child.on('error', () => resolve(1));
    });

    saveProcessState({
      pid: null,
      running: false,
      stoppedAt: new Date().toISOString(),
      args,
      cwd: dshHome,
    });

    return { success: exitCode === 0, pid: child.pid, args };
  }

  // Background daemon mode
  const logFd = openSync(logFile, 'a');
  const timestamp = new Date().toISOString();
  const banner = `\n=== [DWM] DSH Web started at ${timestamp} | args: ${args.join(' ')} ===\n`;
  writeFileSync(logFd, banner, 'utf8');

  let child;
  try {
    child = spawn('pnpm', ['dsh', 'web', ...args], {
      cwd: dshHome,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env },
    });
  } catch (err) {
    closeSync(logFd);
    return {
      success: false,
      error: `Failed to spawn pnpm dsh web: ${err.message}`,
    };
  }

  closeSync(logFd);
  child.unref();

  const pid = child.pid;
  if (!pid) {
    return {
      success: false,
      error: 'Process failed to spawn (no PID assigned).',
    };
  }

  saveProcessState({
    pid,
    running: true,
    startedAt: timestamp,
    args,
    cwd: dshHome,
  });

  // Brief probe to ensure it did not crash on boot
  if (bootCheckDelayMs > 0) {
    await new Promise((res) => setTimeout(res, bootCheckDelayMs));
    if (!isProcessAlive(pid)) {
      const tail = readLogTail(logFile, 15);
      saveProcessState({
        pid: null,
        running: false,
        args,
        cwd: dshHome,
      });
      return {
        success: false,
        error: `DSH Web exited immediately after launch (PID ${pid}).\nRecent logs from ${logFile}:\n${tail.join('\n')}`,
      };
    }
  }

  return {
    success: true,
    pid,
    args,
    logFile,
    message: `DSH Web started in background (PID: ${pid})`,
  };
}

/**
 * Stop running DSH Web service.
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ success: boolean; stopped: boolean; pid?: number; message?: string; error?: string }>}
 */
export async function stopWebService(options = {}) {
  const { timeoutMs = 5000 } = options;
  const state = readProcessState();

  if (!state.running || !state.pid) {
    return {
      success: true,
      stopped: false,
      message: 'DSH Web is not running.',
    };
  }

  const pid = state.pid;

  // Attempt graceful SIGTERM
  try {
    // Try killing process group first
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ESRCH or other error
    }
  }

  // Wait for process to exit
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) break;
    await new Promise((res) => setTimeout(res, 100));
  }

  // Force SIGKILL if still alive
  if (isProcessAlive(pid)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
    await new Promise((res) => setTimeout(res, 300));
  }

  const stillAlive = isProcessAlive(pid);
  if (stillAlive) {
    return {
      success: false,
      stopped: false,
      pid,
      error: `Failed to stop process ${pid}; process is still running.`,
    };
  }

  saveProcessState({
    ...state,
    running: false,
    pid: null,
    stoppedAt: new Date().toISOString(),
  });

  return {
    success: true,
    stopped: true,
    pid,
    message: `DSH Web (PID: ${pid}) has stopped.`,
  };
}

/**
 * Restart DSH Web service with preserved or new arguments.
 * @param {object} [options]
 * @param {string[]} [options.overrideArgs]
 * @returns {Promise<{
 *   success: boolean;
 *   pid?: number;
 *   args?: string[];
 *   logFile?: string;
 *   message?: string;
 *   error?: string;
 * }>}
 */
export async function restartWebService(options = {}) {
  const state = readProcessState();
  const argsToUse =
    options.overrideArgs !== undefined && options.overrideArgs.length > 0
      ? options.overrideArgs
      : state.args || [];

  if (state.running) {
    const stopResult = await stopWebService();
    if (!stopResult.success) {
      return {
        success: false,
        error: `Failed to stop running web service during restart: ${stopResult.error}`,
      };
    }
  }

  return await startWebService({ args: argsToUse });
}

/**
 * Get comprehensive status.
 */
export function getStatus() {
  const home = resolveDshHome();
  const state = readProcessState();
  const logFile = getLogFilePath();
  const tail = readLogTail(logFile, 5);

  let uptimeStr = 'N/A';
  if (state.running && state.startedAt) {
    const diffSec = Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000);
    if (diffSec < 60) uptimeStr = `${diffSec}s`;
    else if (diffSec < 3600) uptimeStr = `${Math.floor(diffSec / 60)}m ${diffSec % 60}s`;
    else uptimeStr = `${Math.floor(diffSec / 3600)}h ${Math.floor((diffSec % 3600) / 60)}m`;
  }

  return {
    home,
    process: state,
    uptime: uptimeStr,
    logFile,
    recentLogs: tail,
  };
}
