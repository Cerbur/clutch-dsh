import console from 'node:console';
import process from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfigPath, getLogFilePath, resolveDshHome, setDshHome } from './config.mjs';
import {
  getStatus,
  readLogTail,
  restartWebService,
  startWebService,
  stopWebService,
} from './process.mjs';
import { updateDsh } from './update.mjs';
import { installPlugin, listPlugins, removePlugin } from './plugin.mjs';
import { uninstallDwm } from './uninstall.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      return pkg.version || '0.1.0';
    }
  } catch {
    // ignore
  }
  return '0.1.0';
}

export function printHelp() {
  const v = getVersion();
  console.log(`
DeepSeek Harness Web Manager (dwm) v${v}

Usage:
  dwm <command> [options]

Commands:
  home [show|set <path>]   Display or set the local DSH repository path
                           (dwm home show: display; dwm home <path> / dwm home set <path>: set)
  update                   Build DSH in configured home (pnpm install && pnpm run build)
  start [args...]          Start DSH Web service in background (pass-through args to pnpm dsh web)
                           Use -f or --foreground to run attached in the terminal
  down, stop               Stop the running DSH Web service
  restart [args...]        Restart DSH Web service using previous (or new) start arguments
  plugin install <param>   Install plugin from npm or local path; restart web service if running
                           (alias: dwm plugin add <param>)
  plugin remove <param>    Remove plugin; restart web service if running
                           (alias: dwm plugin rm <param>)
  plugin list              List installed plugins for web profile
  status                   Show DSH home and Web service running status
  logs [-n <lines>] [-f]   View or follow DSH Web log output
  uninstall [--purge]      Stop services, unlink global dwm command, and clean state (alias: unlink)
  help, -h, --help         Show this help message
  version, -v, --version   Show dwm version

Examples:
  dwm home /path/to/deepseek-harness
  dwm update
  dwm start --port 3080 --no-open
  dwm status
  dwm logs -n 50 -f
  dwm plugin install @cerbur/clutch-dsh-worktree
  dwm plugin install ./packages/clutch-dsh-worktree
  dwm plugin remove @cerbur/clutch-dsh-worktree
  dwm down
  dwm restart

Run "dwm help <command>" or "dwm <command> --help" for detailed help on any command.
`);
}

export const COMMAND_HELPS = {
  home: `
Usage:
  dwm home [show]
  dwm home <path>
  dwm home set <path>

Description:
  Display or configure the local DeepSeek Harness repository path.
  Verifies that the target path contains a valid DSH repository setup.

Options:
  show, get, list, ls   Display current configured path, resolution source, and validity

Examples:
  dwm home
  dwm home show
  dwm home /path/to/deepseek-harness
`,
  update: `
Usage:
  dwm update [--skip-install]

Description:
  Build and update DeepSeek Harness in the configured DSH home repository
  following the official guide (pnpm install && pnpm run build).

Options:
  --skip-install   Skip "pnpm install" and only run "pnpm run build"

Examples:
  dwm update
  dwm update --skip-install
`,
  start: `
Usage:
  dwm start [options] [args...]

Description:
  Start DeepSeek Harness Web service. By default, launches as a background
  daemon process logging to ~/.dwm/logs/web.log. All trailing arguments pass
  directly to "pnpm dsh web" in the DSH repository.

Options:
  -f, --foreground   Run attached in current terminal foreground instead of daemon
  -h, --help         Show this help message

Pass-through arguments (to pnpm dsh web):
  --port <port>      Specify Web server port (e.g. 3080)
  --no-open          Do not automatically open browser on startup

Examples:
  dwm start
  dwm start --port 3080 --no-open
  dwm start -f
`,
  down: `
Usage:
  dwm down
  dwm stop

Description:
  Gracefully stop the background DeepSeek Harness Web service.
  Sends SIGTERM (and SIGKILL if needed) to the recorded PID and resets state.

Examples:
  dwm down
  dwm stop
`,
  stop: `
Usage:
  dwm stop
  (Alias for "down")
`,
  restart: `
Usage:
  dwm restart [args...]

Description:
  Restart the DeepSeek Harness Web service.
  Reuses previous launch arguments automatically if no new arguments are given.
  If arguments are provided, they replace previous arguments.

Examples:
  dwm restart
  dwm restart --port 3090
`,
  plugin: `
Usage:
  dwm plugin install <param>   Install plugin from npm or local path; restart Web if running
  dwm plugin remove <param>    Remove plugin from web profile; restart Web if running
  dwm plugin list              List installed plugins for web profile

Description:
  Manage plugins for the DSH "web" profile. Automatically restarts the Web
  service using your saved arguments if it is currently running.

Aliases:
  dwm plugin add <param>       Alias for "install"
  dwm plugin rm <param>        Alias for "remove"
  dwm plugin ls                Alias for "list"

Examples:
  dwm plugin install @cerbur/clutch-dsh-worktree
  dwm plugin install ./packages/clutch-dsh-worktree
  dwm plugin remove @cerbur/clutch-dsh-worktree
  dwm plugin list
`,
  status: `
Usage:
  dwm status

Description:
  Show status of DSH home path, whether Web service is RUNNING or STOPPED,
  process PID, uptime, active launch arguments, and recent log entries.

Examples:
  dwm status
`,
  logs: `
Usage:
  dwm logs [-n <lines>] [-f]

Description:
  Inspect or tail the DSH Web log file (~/.dwm/logs/web.log).

Options:
  -n <lines>         Number of tail lines to display (default: 30)
  -f, --follow       Follow log output in real time (stream live logs)

Examples:
  dwm logs
  dwm logs -n 100
  dwm logs -n 50 -f
`,
  uninstall: `
Usage:
  dwm uninstall [--purge]
  dwm unlink [--purge]

Description:
  Stop background Web services, unlink global binary links (npm/pnpm/local bin),
  and clean up runtime state files.

Options:
  --purge, --all     Also delete ~/.dwm directory, configuration, and log history

Examples:
  dwm uninstall
  dwm uninstall --purge
`,
  unlink: `
Usage:
  dwm unlink [--purge]
  (Alias for "uninstall")
`,
};

export function printCommandHelp(command) {
  const norm = (command || '').toLowerCase().trim();
  if (COMMAND_HELPS[norm]) {
    console.log(COMMAND_HELPS[norm].trim() + '\n');
    return true;
  }
  console.log(`No specific help available for command "${command}".\n`);
  printHelp();
  return false;
}

/**
 * Handle "home" command.
 * @param {string[]} args
 */
function handleHome(args) {
  const sub = args[0];

  // Display home if no args, or explicitly requested with show / get / list / ls
  if (args.length === 0 || sub === 'show' || sub === 'get' || sub === 'list' || sub === 'ls') {
    const res = resolveDshHome();
    console.log('[DWM] DSH Home Configuration:');
    if (res.path) {
      console.log(`  Path:   ${res.path}`);
      console.log(`  Source: ${res.source}`);
      const statusStr = res.valid ? '✅ Valid DSH repository' : `⚠️  Invalid (${res.error})`;
      console.log(`  Status: ${statusStr}`);
    } else {
      console.log('  Path:   <not set>');
      console.log(`  Status: ❌ ${res.error}`);
      console.log('  To set: dwm home <path/to/deepseek-harness>');
    }
    console.log(`  Config: ${getConfigPath()}`);
    return res.valid ? 0 : 1;
  }

  let target = sub;
  if (sub === 'set') {
    if (!args[1]) {
      console.error('[DWM] ❌ Path is required: dwm home set <path>');
      return 1;
    }
    target = args[1];
  }

  const setRes = setDshHome(target);
  if (setRes.success) {
    console.log(`[DWM] ✅ DSH home set to: ${setRes.path}`);
    return 0;
  } else {
    console.error(`[DWM] ❌ Failed to set DSH home: ${setRes.error}`);
    return 1;
  }
}

/**
 * Handle "start" command.
 * @param {string[]} rawArgs
 */
async function handleStart(rawArgs) {
  let foreground = false;
  const args = [];

  for (const arg of rawArgs) {
    if (arg === '-f' || arg === '--foreground') {
      foreground = true;
    } else {
      args.push(arg);
    }
  }

  const result = await startWebService({ args, foreground });
  if (result.success) {
    if (!foreground) {
      console.log(`[DWM] ✅ ${result.message}`);
      console.log(`[DWM] Logs: ${result.logFile}`);
      if (args.length > 0) {
        console.log(`[DWM] Args: ${args.join(' ')}`);
      }
    }
    return 0;
  } else {
    if (result.message) {
      console.log(`[DWM] ⚠️  ${result.message}`);
      return 0;
    }
    console.error(`[DWM] ❌ ${result.error}`);
    return 1;
  }
}

/**
 * Handle "down" / "stop" command.
 */
async function handleDown() {
  const result = await stopWebService();
  if (result.success) {
    if (result.stopped) {
      console.log(`[DWM] 🛑 ${result.message}`);
    } else {
      console.log(`[DWM] ${result.message}`);
    }
    return 0;
  } else {
    console.error(`[DWM] ❌ ${result.error}`);
    return 1;
  }
}

/**
 * Handle "restart" command.
 * @param {string[]} args
 */
async function handleRestart(args) {
  console.log('[DWM] Restarting DSH Web service...');
  const result = await restartWebService({ overrideArgs: args });
  if (result.success) {
    console.log(`[DWM] ✅ ${result.message}`);
    console.log(`[DWM] Logs: ${result.logFile}`);
    if (result.args && result.args.length > 0) {
      console.log(`[DWM] Args: ${result.args.join(' ')}`);
    }
    return 0;
  } else {
    console.error(`[DWM] ❌ ${result.error}`);
    return 1;
  }
}

/**
 * Handle "plugin" command.
 * @param {string[]} args
 */
async function handlePlugin(args) {
  const sub = args[0];
  const target = args[1];

  if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
    console.log(`
Usage:
  dwm plugin install <npm-pkg-or-path>   Install plugin and restart web if running
  dwm plugin remove <plugin-name>        Remove plugin and restart web if running
  dwm plugin list                        List installed plugins for web profile
`);
    return 0;
  }

  if (sub === 'install' || sub === 'add') {
    if (!target) {
      console.error('Error: specify plugin to install (npm package name or local path).');
      return 1;
    }
    const res = await installPlugin(target);
    return res.success ? 0 : 1;
  }

  if (sub === 'remove' || sub === 'rm' || sub === 'uninstall') {
    if (!target) {
      console.error('Error: specify plugin name to remove.');
      return 1;
    }
    const res = await removePlugin(target);
    return res.success ? 0 : 1;
  }

  if (sub === 'list' || sub === 'ls') {
    const res = await listPlugins();
    return res.success ? 0 : 1;
  }

  console.error(`Unknown plugin subcommand: ${sub}. Use: dwm plugin install | remove | list`);
  return 1;
}

/**
 * Handle "status" command.
 */
function handleStatus() {
  const s = getStatus();
  console.log('=== DeepSeek Harness Web Manager (dwm) Status ===');
  console.log(
    `DSH Home:    ${s.home.path || '<none>'} (${s.home.valid ? 'valid' : 'invalid'}, ${s.home.source})`,
  );
  if (s.process.running) {
    console.log(`Web Status:  🟢 RUNNING`);
    console.log(`PID:         ${s.process.pid}`);
    console.log(`Uptime:      ${s.uptime}`);
    console.log(
      `Start Args:  ${s.process.args && s.process.args.length > 0 ? s.process.args.join(' ') : '<none>'}`,
    );
    console.log(`Log File:    ${s.logFile}`);
  } else {
    console.log(`Web Status:  ⚪ STOPPED`);
    console.log(`Log File:    ${s.logFile}`);
    if (s.process.args && s.process.args.length > 0) {
      console.log(`Last Args:   ${s.process.args.join(' ')}`);
    }
  }

  if (s.recentLogs.length > 0) {
    console.log('\nRecent Logs:');
    for (const line of s.recentLogs) {
      console.log(`  ${line}`);
    }
  }
  return 0;
}

/**
 * Handle "logs" command.
 * @param {string[]} args
 */
async function handleLogs(args) {
  const logFile = getLogFilePath();
  if (!existsSync(logFile)) {
    console.log(`Log file does not exist yet (${logFile}).`);
    return 0;
  }

  let lines = 30;
  let follow = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' && args[i + 1]) {
      lines = parseInt(args[i + 1], 10) || 30;
      i++;
    } else if (args[i] === '-f' || args[i] === '--follow') {
      follow = true;
    }
  }

  if (follow) {
    const tailChild = spawn('tail', ['-n', String(lines), '-f', logFile], {
      stdio: 'inherit',
    });
    return new Promise((resolve) => {
      process.on('SIGINT', () => {
        tailChild.kill();
        resolve(0);
      });
      tailChild.on('close', (code) => resolve(code ?? 0));
    });
  } else {
    const tail = readLogTail(logFile, lines);
    for (const l of tail) {
      console.log(l);
    }
    return 0;
  }
}

/**
 * Main CLI entry point.
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function runCli(argv = []) {
  if (argv.length === 0) {
    printHelp();
    return 0;
  }

  const command = argv[0];
  const args = argv.slice(1);

  const hasHelpFlag = args.includes('--help') || args.includes('-h');
  if (hasHelpFlag && command !== 'plugin') {
    printCommandHelp(command);
    return 0;
  }

  switch (command) {
    case 'home':
      return handleHome(args);

    case 'update': {
      const skipInstall = args.includes('--skip-install');
      const res = await updateDsh({ skipInstall });
      if (!res.success && res.error) {
        console.error(`[DWM] ❌ ${res.error}`);
      }
      return res.success ? 0 : 1;
    }

    case 'start':
      return await handleStart(args);

    case 'down':
    case 'stop':
      return await handleDown();

    case 'restart':
      return await handleRestart(args);

    case 'plugin':
      return await handlePlugin(args);

    case 'status':
      return handleStatus();

    case 'logs':
      return await handleLogs(args);

    case 'uninstall':
    case 'unlink': {
      const purge = args.includes('--purge') || args.includes('--all');
      const res = await uninstallDwm({ purge });
      return res.success ? 0 : 1;
    }

    case 'help':
    case '-h':
    case '--help':
      if (args[0]) {
        printCommandHelp(args[0]);
      } else {
        printHelp();
      }
      return 0;

    case 'version':
    case '-v':
    case '--version':
      console.log(`dwm v${getVersion()}`);
      return 0;

    default:
      console.error(`[DWM] Unknown command: "${command}"`);
      printHelp();
      return 1;
  }
}
