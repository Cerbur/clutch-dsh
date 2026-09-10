import console from 'node:console';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { resolveDshHome } from './config.mjs';

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
 * Build DSH repository in dshHome via pnpm (pnpm install && pnpm run build).
 * @param {object} [options]
 * @param {boolean} [options.skipInstall]
 * @returns {Promise<{ success: boolean; step?: string; error?: string }>}
 */
export async function updateDsh(options = {}) {
  const home = resolveDshHome();
  if (!home.valid || !home.path) {
    return {
      success: false,
      error: home.error || 'Invalid or missing DSH home. Run dwm home <path> to configure.',
    };
  }

  const dshHome = home.path;
  console.log(`[DWM] Updating DSH in ${dshHome}...`);

  if (!options.skipInstall) {
    console.log('[DWM] Step 1/2: Running pnpm install...');
    const installResult = await runCommand('pnpm', ['install'], dshHome);
    if (installResult.exitCode !== 0) {
      return {
        success: false,
        step: 'pnpm install',
        error:
          installResult.error?.message ||
          `pnpm install failed with exit code ${installResult.exitCode}`,
      };
    }
  }

  console.log('[DWM] Step 2/2: Running pnpm run build...');
  const buildResult = await runCommand('pnpm', ['run', 'build'], dshHome);
  if (buildResult.exitCode !== 0) {
    return {
      success: false,
      step: 'pnpm run build',
      error:
        buildResult.error?.message ||
        `pnpm run build failed with exit code ${buildResult.exitCode}`,
    };
  }

  console.log('[DWM] DSH update and build completed successfully!');
  return { success: true };
}
