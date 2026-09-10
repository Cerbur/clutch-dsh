import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfigDir, getPidPath, getStatePath } from './config.mjs';
import { readProcessState, stopWebService } from './process.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

/**
 * Uninstall dwm: stop services, unlink global binary, clean up files.
 * @param {object} [options]
 * @param {boolean} [options.purge] Whether to delete ~/.dwm config & logs
 * @returns {Promise<{ success: boolean; stoppedService: boolean; unlinked: boolean; purged: boolean; error?: string }>}
 */
export async function uninstallDwm(options = {}) {
  const { purge = false } = options;
  console.log('[DWM] Starting dwm uninstallation...');

  // 1. Stop running web service
  let stoppedService = false;
  const state = readProcessState();
  if (state.running) {
    console.log('[DWM] Step 1/3: Stopping active DSH Web service...');
    const stopRes = await stopWebService();
    stoppedService = stopRes.stopped;
    if (stopRes.success) {
      console.log('  ✅ DSH Web service stopped.');
    } else {
      console.error(`  ⚠️  Failed to stop DSH Web: ${stopRes.error}`);
    }
  } else {
    console.log('[DWM] Step 1/3: DSH Web is not running.');
  }

  // 2. Unlink global command
  console.log('[DWM] Step 2/3: Unlinking global dwm command...');
  let unlinked = false;
  try {
    const npmUnlink = spawnSync('npm', ['unlink'], {
      cwd: packageRoot,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    if (npmUnlink.status === 0) {
      unlinked = true;
    }
  } catch {
    // ignore
  }

  try {
    spawnSync('npm', ['unlink', '-g', '@cerbur/dsh-web-manager'], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch {
    // ignore
  }

  try {
    spawnSync('pnpm', ['rm', '-g', '@cerbur/dsh-web-manager'], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch {
    // ignore
  }

  console.log('  ✅ Global dwm link removed.');

  // 3. Clean up configuration and runtime files
  console.log('[DWM] Step 3/3: Cleaning up state and configuration...');
  let purged = false;
  const configDir = getConfigDir();

  if (purge) {
    if (existsSync(configDir)) {
      try {
        rmSync(configDir, { recursive: true, force: true });
        purged = true;
        console.log(`  ✅ Purged configuration directory: ${configDir}`);
      } catch (err) {
        console.error(`  ⚠️  Failed to remove ${configDir}: ${err.message}`);
      }
    }
  } else {
    const pidFile = getPidPath();
    const stateFile = getStatePath();
    if (existsSync(pidFile)) {
      try {
        unlinkSync(pidFile);
      } catch {
        // ignore
      }
    }
    if (existsSync(stateFile)) {
      try {
        unlinkSync(stateFile);
      } catch {
        // ignore
      }
    }
    console.log(
      `  ✅ Runtime state cleaned. (${configDir}/config.json preserved. Use --purge to delete all)`,
    );
  }

  console.log('\n[DWM] 🎉 dwm uninstallation complete.');
  return { success: true, stoppedService, unlinked, purged };
}
