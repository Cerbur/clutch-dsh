import console from 'node:console';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export const DEFAULT_UPGRADE_URL =
  'https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/dsh-web-manager/upgrade.sh';

/**
 * Execute dwm upgrade via GitHub upgrade script.
 * @param {object} [options]
 * @param {string} [options.ref] Optional git branch/tag/commit ref
 * @param {string} [options.scriptUrl] Custom upgrade script URL
 * @param {string} [options.scriptPath] Local script path for testing
 * @param {boolean} [options.silent]
 * @param {import('node:child_process').StdioOptions} [options.stdio]
 * @returns {Promise<{ success: boolean; error?: string }>}
 */
export async function upgradeDwm(options = {}) {
  const stdio = options.stdio || (options.silent ? 'pipe' : 'inherit');
  const env = { ...process.env };

  if (options.ref) {
    env.DWM_REF = options.ref;
  }

  const scriptPath =
    options.scriptPath ||
    process.env.DWM_UPGRADE_SCRIPT_PATH ||
    null;

  if (scriptPath && existsSync(scriptPath)) {
    if (!options.silent) {
      console.log(`[DWM] Running local upgrade script: ${scriptPath}...`);
    }
    return new Promise((resolve) => {
      const child = spawn('bash', [scriptPath], {
        stdio,
        env,
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: `dwm upgrade script failed with exit code ${code ?? 1}`,
          });
        }
      });
    });
  }

  const upgradeUrl =
    options.scriptUrl ||
    process.env.DWM_UPGRADE_URL ||
    DEFAULT_UPGRADE_URL;

  if (!options.silent) {
    console.log(`[DWM] Fetching and executing upgrade script from GitHub: ${upgradeUrl}...`);
  }

  return new Promise((resolve) => {
    const child = spawn(
      'bash',
      ['-c', 'curl -fsSL "$0" | bash', upgradeUrl],
      {
        stdio,
        env,
      },
    );

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: `dwm upgrade failed with exit code ${code ?? 1}`,
        });
      }
    });
  });
}
