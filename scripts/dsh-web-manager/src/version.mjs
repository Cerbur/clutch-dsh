import console from 'node:console';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { resolveDshHome, validateDshHome } from './config.mjs';
import { getStatus } from './process.mjs';

/**
 * Run git command and capture output.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<{ exitCode: number; stdout: string; stderr: string; error?: Error }>}
 */
export function runGit(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      resolve({ exitCode: 1, stdout, stderr, error: err });
    });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}

/**
 * Run command with custom or inherited stdio.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @param {import('node:child_process').StdioOptions} [stdio='inherit']
 * @returns {Promise<{ exitCode: number; error?: Error }>}
 */
export function runProcess(cmd, args, cwd, stdio = 'inherit') {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio,
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
 * Fetch and list all available tag versions in DSH home.
 * @param {object} [options]
 * @param {boolean} [options.skipFetch] Skip remote fetch (useful offline or in tests)
 * @param {boolean} [options.silent] Suppress console logs
 * @param {string} [options.home] Optional explicit DSH home path
 * @returns {Promise<{ success: boolean; versions?: string[]; current?: string | null; error?: string }>}
 */
export async function listDshVersions(options = {}) {
  let home;
  if (options.home) {
    const check = validateDshHome(options.home);
    home = {
      path: options.home,
      valid: check.valid,
      error: check.reason,
      source: 'override',
    };
  } else {
    home = resolveDshHome();
  }
  if (!home.valid || !home.path) {
    return {
      success: false,
      error: home.error || 'Invalid or missing DSH home. Run dwm home <path> to configure.',
    };
  }

  const dshHome = home.path;

  if (!options.skipFetch) {
    if (!options.silent) {
      console.log(`[DWM] Fetching tags in DSH repository (${dshHome})...`);
    }
    const fetchRes = await runGit(['fetch', '--tags'], dshHome);
    if (fetchRes.exitCode !== 0 && !options.silent) {
      console.warn(
        `[DWM] ⚠️  Warning: git fetch --tags exited with code ${fetchRes.exitCode}. Listing local tags.`,
      );
    }
  }

  const tagRes = await runGit(['tag', '-l', '--sort=v:refname'], dshHome);
  if (tagRes.exitCode !== 0) {
    return {
      success: false,
      error: tagRes.stderr.trim() || 'Failed to list git tags in DSH repository.',
    };
  }

  const versions = tagRes.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const current = await getCurrentDshVersion(dshHome);

  return {
    success: true,
    versions,
    current,
  };
}

/**
 * Detect current version or ref of DSH home repository.
 * @param {string} dshHome
 * @returns {Promise<string>}
 */
export async function getCurrentDshVersion(dshHome) {
  if (!dshHome) return 'none';
  const describeRes = await runGit(['describe', '--tags', '--exact-match'], dshHome);
  if (describeRes.exitCode === 0 && describeRes.stdout.trim()) {
    return describeRes.stdout.trim();
  }
  const branchRes = await runGit(['branch', '--show-current'], dshHome);
  const branch = branchRes.stdout.trim();
  const shaRes = await runGit(['rev-parse', '--short', 'HEAD'], dshHome);
  const sha = shaRes.stdout.trim();
  if (branch && sha) {
    return `${branch} (${sha})`;
  }
  if (branch) return branch;
  if (sha) return `HEAD (${sha})`;
  return 'unknown';
}

/**
 * Resolve candidate git ref in repository.
 * @param {string} version
 * @param {string} cwd
 * @returns {Promise<string | null>}
 */
export async function resolveGitVersionRef(version, cwd) {
  const trimmed = version.trim();
  if (!trimmed) return null;

  const candidates = Array.from(
    new Set([trimmed, `dsh-${trimmed}`, `dsh-v${trimmed}`, `v${trimmed}`]),
  );

  for (const candidate of candidates) {
    const check = await runGit(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], cwd);
    if (check.exitCode === 0) {
      return candidate;
    }
  }

  return null;
}

/**
 * Switch DSH repository to target version and rebuild packages.
 * @param {string} targetVersion
 * @param {object} [options]
 * @param {boolean} [options.skipFetch]
 * @param {boolean} [options.skipInstall]
 * @param {boolean} [options.skipBuild]
 * @param {boolean} [options.silent]
 * @param {string} [options.home]
 * @param {import('node:child_process').StdioOptions} [options.stdio]
 * @returns {Promise<{ success: boolean; version?: string; step?: string; error?: string }>}
 */
export async function switchDshVersion(targetVersion, options = {}) {
  let home;
  if (options.home) {
    const check = validateDshHome(options.home);
    home = {
      path: options.home,
      valid: check.valid,
      error: check.reason,
      source: 'override',
    };
  } else {
    home = resolveDshHome();
  }
  if (!home.valid || !home.path) {
    return {
      success: false,
      error: home.error || 'Invalid or missing DSH home. Run dwm home <path> to configure.',
    };
  }

  if (!targetVersion || typeof targetVersion !== 'string' || !targetVersion.trim()) {
    return {
      success: false,
      error: 'Target version is required: dwm switch <version>',
    };
  }

  const dshHome = home.path;
  const rawTarget = targetVersion.trim();

  let resolvedRef = await resolveGitVersionRef(rawTarget, dshHome);

  if (!resolvedRef && !options.skipFetch) {
    if (!options.silent) {
      console.log(`[DWM] Fetching latest tags in ${dshHome} to search for ${rawTarget}...`);
    }
    await runGit(['fetch', '--tags'], dshHome);
    resolvedRef = await resolveGitVersionRef(rawTarget, dshHome);
  }

  if (!resolvedRef) {
    return {
      success: false,
      error: `Version "${rawTarget}" not found in DSH repository. Run "dwm version list" to view available versions.`,
    };
  }

  const stdio = options.stdio || (options.silent ? 'pipe' : 'inherit');

  if (!options.silent) {
    console.log(`[DWM] Step 1/3: Switching to ${resolvedRef} in ${dshHome}...`);
  }

  const checkoutRes = await runGit(['checkout', resolvedRef], dshHome);
  if (checkoutRes.exitCode !== 0) {
    return {
      success: false,
      step: 'git checkout',
      error:
        checkoutRes.stderr.trim() ||
        checkoutRes.error?.message ||
        `git checkout failed with exit code ${checkoutRes.exitCode}`,
    };
  }

  if (!options.skipInstall) {
    if (!options.silent) {
      console.log('[DWM] Step 2/3: Running pnpm install (cleaning stale dependencies)...');
    }
    const installRes = await runProcess('pnpm', ['install'], dshHome, stdio);
    if (installRes.exitCode !== 0) {
      return {
        success: false,
        step: 'pnpm install',
        error:
          installRes.error?.message ||
          `pnpm install failed with exit code ${installRes.exitCode}`,
      };
    }
  }

  if (!options.skipBuild) {
    if (!options.silent) {
      console.log('[DWM] Step 3/3: Running pnpm run build (building packages)...');
    }
    const buildRes = await runProcess('pnpm', ['run', 'build'], dshHome, stdio);
    if (buildRes.exitCode !== 0) {
      return {
        success: false,
        step: 'pnpm run build',
        error:
          buildRes.error?.message ||
          `pnpm run build failed with exit code ${buildRes.exitCode}`,
      };
    }
  }

  if (!options.silent) {
    console.log(`[DWM] ✅ Switched to ${resolvedRef} and successfully built DSH packages!`);
    const status = getStatus();
    if (status.process.running) {
      console.log(
        '[DWM] 💡 Note: DSH Web is currently running. Run "dwm restart" to reload with the new version.',
      );
    }
  }

  return {
    success: true,
    version: resolvedRef,
  };
}
