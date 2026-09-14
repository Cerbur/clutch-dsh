# DeepSeek Harness Web Manager (`dwm`)

`dwm` is a dedicated CLI tool to manage, build, run, and extend [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web services smoothly.

It provides service daemonization, argument persistence, one-step repository building, and automatic web service restart upon plugin installation or removal.

---

## Capabilities

1. **Repository Configuration (`dwm home`)**: Configure and persist your local DeepSeek Harness checkout path.
2. **Build & Update (`dwm update`)**: Build DSH according to the official guide (`pnpm install` + `pnpm run build`).
3. **Daemon Service Management (`dwm start` / `dwm down` / `dwm restart`)**:
   - `dwm start [args...]`: Start DSH Web in the background (equivalent to `pnpm dsh web` in your DSH home). Supports transparent argument pass-through.
   - `dwm down`: Gracefully terminate the running DSH Web service.
   - `dwm restart [args...]`: Restart DSH Web with the arguments used at start.
4. **Plugin Management (`dwm plugin install` / `dwm plugin remove` / `dwm plugin list`)**:
   - Install npm packages or local directories into the `web` profile (`pnpm dsh plugin --profile web add <param>`).
   - Automatically restarts the Web service if it was running.
5. **Observability (`dwm status` / `dwm logs`)**:
   - Inspect home path, process state, PID, uptime, and view/follow live logs.
6. **Version Management & Switching (`dwm version` / `dwm versions` / `dwm switch <version>`)**:
   - `dwm version`: Show dwm CLI version and current DSH repository checkout version (compact `dwm -v` also available).
   - `dwm versions`: Fetch remote tags and list all available versions in DSH repository (alias: `dwm version list`).
   - `dwm switch <version>`: Switch DSH repository to the specified version/tag, clean stale dependencies (`pnpm install`), and build packages (`pnpm run build`).
7. **Self-Upgrade (`dwm upgrade`)**:
   - Upgrade the current `dwm` installation by executing the latest upgrade script directly from GitHub.

---

## Installation & Setup

### Option 1: One-Line Install via curl (Recommended)

Install directly from GitHub via curl:

```bash
curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/dsh-web-manager/install.sh | bash
```

To also specify your local DeepSeek Harness repository path at install time:

```bash
curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/dsh-web-manager/install.sh | bash -s -- /path/to/deepseek-harness
```

### Option 2: Local npm Link

From this repository checkout:

```bash
cd scripts/dsh-web-manager
npm link
# or pnpm link --global
```

### Option 3: Direct Invocation

```bash
./scripts/dsh-web-manager/bin/dwm.mjs <command>
# or
node scripts/dsh-web-manager/bin/dwm.mjs <command>
```

---

## Usage Guide

### 1. Set DSH Repository Home

Set your local checkout of DeepSeek Harness:

```bash
dwm home /path/to/deepseek-harness
```

View current configured path:

```bash
dwm home
# or explicitly:
dwm home show
```

### 2. Update and Build DSH

Run `pnpm install` and `pnpm run build` in the configured DSH home:

```bash
dwm update
```

Pass `--skip-install` if you only want to run `pnpm run build`:

```bash
dwm update --skip-install
```

### 3. Check Versions & List DSH Tags

View current dwm and DSH repository checkout status:

```bash
dwm version
# Concise version only:
dwm -v
```

Fetch remote tags and list all available versions in your configured DSH repository:

```bash
dwm versions
# or alias:
dwm version list
dwm version ls
```

### 4. Switch DSH Version & Build

Switch the configured DSH repository to a specific tag/version and rebuild (automatically runs `git checkout`, `pnpm install` to clean stale dependencies, and `pnpm run build`):

```bash
# By full tag name
dwm switch dsh-v0.1.5-rc.2

# By version number
dwm switch 0.1.5-rc.2
dwm switch v0.1.5-rc.2

# Using version namespace alias
dwm version switch dsh-v0.1.5-rc.2
```

Pass `--skip-install` or `--skip-build` if desired:

```bash
dwm switch 0.1.5-rc.2 --skip-install
```

### 5. Start DSH Web Service

Start in the background with optional arguments (all arguments pass through to `pnpm dsh web`):

```bash
# Default launch
dwm start

# Custom port and options
dwm start --port 3080 --no-open
```

To run attached in the current terminal foreground instead:

```bash
dwm start -f
```

### 6. Stop DSH Web Service

Gracefully shut down the background DSH Web service:

```bash
dwm down
# or
dwm stop
```

### 7. Restart DSH Web Service

Restart the service using the parameters specified when it was started:

```bash
dwm restart
```

You can also pass new parameters to override:

```bash
dwm restart --port 3090
```

### 8. Install Plugins

Install an npm package or a local directory plugin into the DSH `web` profile. If DSH Web is running, it will automatically restart with your previous start arguments:

```bash
# Local directory path
dwm plugin install /path/to/my-plugin

# Relative path
dwm plugin install ./packages/clutch-dsh-worktree

# npm package
dwm plugin install dshmarket
```

### 9. Remove Plugins

Remove an installed plugin from the `web` profile. If DSH Web is running, it will automatically restart:

```bash
dwm plugin remove @cerbur/clutch-dsh-worktree
```

### 10. List Plugins

List all installed plugins in the `web` profile:

```bash
dwm plugin list
```

### 11. Check Status

View DSH home validity, process status, PID, uptime, and last log lines:

```bash
dwm status
```

### 12. View Logs

```bash
# View last 30 lines
dwm logs

# View last 100 lines and follow live output
dwm logs -n 100 -f
```

### 13. Upgrade dwm

Upgrade `dwm` to the latest version by fetching and executing the upgrade script from GitHub:

```bash
dwm upgrade

# Upgrade to a specific branch, tag, or commit:
dwm upgrade --ref main
```

### 14. Command Help

View global usage instructions or detailed help for any specific command:

```bash
# Global help
dwm help
# or
dwm --help

# Detailed help for a specific command
dwm help start
dwm home --help
dwm logs --help
```

### 15. Uninstall dwm

Stop running services, remove global binary links (npm/pnpm), and clean runtime state:

```bash
# Standard uninstall (preserves ~/.dwm/config.json)
dwm uninstall
# or
dwm unlink

# Full purge (also removes ~/.dwm directory, configs, and logs)
dwm uninstall --purge
```

---

## Configuration & Runtime Files

- Config file: `~/.dwm/config.json`
- Runtime state: `~/.dwm/state.json`
- PID file: `~/.dwm/web.pid`
- Logs: `~/.dwm/logs/web.log`
- Override config directory with `$DWM_DIR` or `$DWM_HOME`.
