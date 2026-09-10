import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Default fallback path for DSH repository */
export const DEFAULT_DSH_PATH = null;

/**
 * Expand ~ and resolve relative path against cwd.
 * @param {string} rawPath
 * @returns {string}
 */
export function expandPath(rawPath) {
  if (!rawPath) return '';
  let p = rawPath.trim();
  if (p === '~') {
    p = homedir();
  } else if (p.startsWith('~/') || p.startsWith('~\\')) {
    p = path.join(homedir(), p.slice(2));
  }
  return path.resolve(process.cwd(), p);
}

/**
 * Get base configuration and runtime state directory (~/.dwm by default).
 * @returns {string}
 */
export function getConfigDir() {
  const custom = process.env.DWM_HOME || process.env.DWM_DIR;
  if (custom && custom.trim()) {
    return expandPath(custom.trim());
  }
  return path.join(homedir(), '.dwm');
}

/**
 * Get path to config.json.
 * @returns {string}
 */
export function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Get path to state.json.
 * @returns {string}
 */
export function getStatePath() {
  return path.join(getConfigDir(), 'state.json');
}

/**
 * Get path to web.pid.
 * @returns {string}
 */
export function getPidPath() {
  return path.join(getConfigDir(), 'web.pid');
}

/**
 * Get path to logs directory.
 * @returns {string}
 */
export function getLogsDir() {
  return path.join(getConfigDir(), 'logs');
}

/**
 * Get path to main web log file.
 * @returns {string}
 */
export function getLogFilePath() {
  return path.join(getLogsDir(), 'web.log');
}

/**
 * Ensure config directory exists.
 */
export function ensureConfigDir() {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const logs = getLogsDir();
  if (!existsSync(logs)) {
    mkdirSync(logs, { recursive: true });
  }
}

/**
 * Load config from ~/.dwm/config.json.
 * @returns {{ dshHome?: string }}
 */
export function loadConfig() {
  try {
    const file = getConfigPath();
    if (existsSync(file)) {
      const content = readFileSync(file, 'utf8');
      return JSON.parse(content);
    }
  } catch {
    // ignore parse or read error, fallback to default
  }
  return {};
}

/**
 * Save config to ~/.dwm/config.json.
 * @param {Record<string, unknown>} config
 */
export function saveConfig(config) {
  ensureConfigDir();
  const file = getConfigPath();
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/**
 * Validate whether a path is a valid DSH repository.
 * @param {string} targetPath
 * @returns {{ valid: boolean; reason?: string }}
 */
export function validateDshHome(targetPath) {
  if (!targetPath) {
    return { valid: false, reason: 'Path is required' };
  }
  const resolved = expandPath(targetPath);
  if (!existsSync(resolved)) {
    return { valid: false, reason: `Directory does not exist: ${resolved}` };
  }

  const pkgPath = path.join(resolved, 'package.json');
  if (!existsSync(pkgPath)) {
    return { valid: false, reason: `package.json not found in ${resolved}` };
  }

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    // Check if it looks like DSH (specific package name, apps/cli structure, or dsh dev scripts)
    const isDshName =
      typeof pkg.name === 'string' &&
      (pkg.name === '@deepseek-ai/dsh-root' ||
        pkg.name === 'deepseek-harness' ||
        pkg.name === '@deepseek-ai/dsh');
    const hasDshScript = Boolean(pkg.scripts?.dsh || pkg.scripts?.['dev:web']);
    const hasAppsCli = existsSync(path.join(resolved, 'apps', 'cli'));
    if (!isDshName && !hasDshScript && !hasAppsCli) {
      return {
        valid: false,
        reason: `Directory ${resolved} does not appear to be a deepseek-harness repository (missing dsh scripts/structure)`,
      };
    }
  } catch (error) {
    return { valid: false, reason: `Failed to parse package.json: ${error.message}` };
  }

  return { valid: true };
}

/**
 * Resolve effective DSH home directory.
 * Priority:
 * 1. Explicitly configured in config.json
 * 2. DSH_REPO_ROOT or DSH_HOME environment variable
 * 3. DEFAULT_DSH_PATH if set and valid
 * 4. Current working directory if valid DSH repository
 * @returns {{ path: string | null; source: 'config' | 'env' | 'default' | 'cwd' | 'none'; valid: boolean; error?: string }}
 */
export function resolveDshHome() {
  const config = loadConfig();
  if (config.dshHome) {
    const check = validateDshHome(config.dshHome);
    return {
      path: expandPath(config.dshHome),
      source: 'config',
      valid: check.valid,
      error: check.reason,
    };
  }

  if (process.env.DSH_REPO_ROOT) {
    const check = validateDshHome(process.env.DSH_REPO_ROOT);
    if (check.valid) {
      return {
        path: expandPath(process.env.DSH_REPO_ROOT),
        source: 'env',
        valid: true,
      };
    }
  }

  if (process.env.DSH_HOME) {
    const check = validateDshHome(process.env.DSH_HOME);
    if (check.valid) {
      return {
        path: expandPath(process.env.DSH_HOME),
        source: 'env',
        valid: true,
      };
    }
  }

  if (DEFAULT_DSH_PATH && existsSync(DEFAULT_DSH_PATH)) {
    const check = validateDshHome(DEFAULT_DSH_PATH);
    if (check.valid) {
      return {
        path: DEFAULT_DSH_PATH,
        source: 'default',
        valid: true,
      };
    }
  }

  const cwdCheck = validateDshHome(process.cwd());
  if (cwdCheck.valid) {
    return {
      path: process.cwd(),
      source: 'cwd',
      valid: true,
    };
  }

  return {
    path: null,
    source: 'none',
    valid: false,
    error: 'No DSH home configured. Set one with: dwm home <path>',
  };
}

/**
 * Set DSH home path and save to config.
 * @param {string} targetPath
 * @returns {{ success: boolean; path?: string; error?: string }}
 */
export function setDshHome(targetPath) {
  const resolved = expandPath(targetPath);
  const check = validateDshHome(resolved);
  if (!check.valid) {
    return { success: false, error: check.reason };
  }
  const config = loadConfig();
  config.dshHome = resolved;
  saveConfig(config);
  return { success: true, path: resolved };
}
