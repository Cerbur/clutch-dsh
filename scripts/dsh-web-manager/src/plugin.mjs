import console from 'node:console';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expandPath, resolveDshHome } from './config.mjs';
import { readProcessState, restartWebService } from './process.mjs';

/**
 * Run a command in a specified directory and stream output.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<{ exitCode: number; error?: Error }>}
 */
function runCommand(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('error', (err) => {
      resolve({ exitCode: 1, error: err });
    });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 0 });
    });
  });
}

/**
 * Normalize plugin target: if it's a local path or starts with ., ~, /,
 * resolve to an absolute path. Otherwise treat as npm package name.
 * @param {string} target
 * @returns {string}
 */
export function normalizePluginSpec(target) {
  if (!target) return '';
  const trimmed = target.trim();

  // If starts with path characters or exists locally
  if (
    trimmed.startsWith('.') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('~') ||
    trimmed.startsWith('file:') ||
    trimmed.startsWith('link:') ||
    existsSync(expandPath(trimmed))
  ) {
    if (trimmed.startsWith('file:') || trimmed.startsWith('link:')) {
      const prefix = trimmed.slice(0, 5);
      const rest = trimmed.slice(5);
      return `${prefix}${expandPath(rest)}`;
    }
    return expandPath(trimmed);
  }

  return trimmed;
}

/**
 * Install plugin for web profile.
 * If web was running, restart it with saved start arguments.
 * @param {string} pluginSpec
 * @returns {Promise<{ success: boolean; restarted: boolean; error?: string }>}
 */
export async function installPlugin(pluginSpec) {
  if (!pluginSpec || !pluginSpec.trim()) {
    return {
      success: false,
      restarted: false,
      error: 'Plugin specification (npm package or local path) is required.',
    };
  }

  const home = resolveDshHome();
  if (!home.valid || !home.path) {
    return {
      success: false,
      restarted: false,
      error: home.error || 'Invalid or missing DSH home. Run dwm home <path> to configure.',
    };
  }

  const normalized = normalizePluginSpec(pluginSpec);
  const dshHome = home.path;
  const wasRunning = readProcessState().running;

  console.log(`[DWM] Installing plugin: ${normalized} (in ${dshHome})...`);
  const cmdArgs = ['dsh', 'plugin', '--profile', 'web', 'add', normalized];
  const result = await runCommand('pnpm', cmdArgs, dshHome);

  if (result.exitCode !== 0) {
    return {
      success: false,
      restarted: false,
      error:
        result.error?.message || `Plugin installation failed with exit code ${result.exitCode}`,
    };
  }

  console.log(`[DWM] Plugin ${normalized} installed successfully.`);

  if (wasRunning) {
    console.log('[DWM] DSH Web is currently running. Restarting web service to load new plugin...');
    const restartResult = await restartWebService();
    if (!restartResult.success) {
      return {
        success: true,
        restarted: false,
        error: `Plugin was installed, but web service restart failed: ${restartResult.error}`,
      };
    }
    console.log(`[DWM] DSH Web service restarted successfully (PID: ${restartResult.pid}).`);
    return { success: true, restarted: true };
  }

  console.log('[DWM] DSH Web is not currently running. Run "dwm start" when ready.');
  return { success: true, restarted: false };
}

/**
 * Remove plugin from web profile.
 * If web was running, restart it with saved start arguments.
 * @param {string} pluginName
 * @returns {Promise<{ success: boolean; restarted: boolean; error?: string }>}
 */
export async function removePlugin(pluginName) {
  if (!pluginName || !pluginName.trim()) {
    return {
      success: false,
      restarted: false,
      error: 'Plugin name to remove is required.',
    };
  }

  const home = resolveDshHome();
  if (!home.valid || !home.path) {
    return {
      success: false,
      restarted: false,
      error: home.error || 'Invalid or missing DSH home. Run "dwm home <path>" to configure.',
    };
  }

  const dshHome = home.path;
  const wasRunning = readProcessState().running;
  const target = pluginName.trim();

  console.log(`[DWM] Removing plugin: ${target} (in ${dshHome})...`);
  const cmdArgs = ['dsh', 'plugin', '--profile', 'web', 'remove', target];
  const result = await runCommand('pnpm', cmdArgs, dshHome);

  if (result.exitCode !== 0) {
    return {
      success: false,
      restarted: false,
      error: result.error?.message || `Plugin removal failed with exit code ${result.exitCode}`,
    };
  }

  console.log(`[DWM] Plugin ${target} removed successfully.`);

  if (wasRunning) {
    console.log('[DWM] DSH Web is currently running. Restarting web service...');
    const restartResult = await restartWebService();
    if (!restartResult.success) {
      return {
        success: true,
        restarted: false,
        error: `Plugin was removed, but web service restart failed: ${restartResult.error}`,
      };
    }
    console.log(`[DWM] DSH Web service restarted successfully (PID: ${restartResult.pid}).`);
    return { success: true, restarted: true };
  }

  console.log('[DWM] DSH Web is not currently running.');
  return { success: true, restarted: false };
}

/**
 * List installed plugins in web profile.
 * @returns {Promise<{ success: boolean; error?: string }>}
 */
export async function listPlugins() {
  const home = resolveDshHome();
  if (!home.valid || !home.path) {
    return {
      success: false,
      error: home.error || 'Invalid or missing DSH home. Run "dwm home <path>" to configure.',
    };
  }

  const dshHome = home.path;
  const cmdArgs = ['dsh', 'plugin', '--profile', 'web', 'list'];
  const result = await runCommand('pnpm', cmdArgs, dshHome);
  return { success: result.exitCode === 0 };
}
