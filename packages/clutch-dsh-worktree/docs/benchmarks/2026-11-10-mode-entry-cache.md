# Worktree mode entry cache — 2026-11-10

## Scope

This measures one change: re-entering Worktree mode now reuses projections the shared
client reader already holds. A projection younger than
`ENTRY_REUSE_MAX_AGE_MS` (30 s) is not read again; an older or retired projection is
painted immediately from the reader and revalidated in place. The change is
client-only; the Host API and Sidecar data are unchanged.

It measures the Surface read phase, not a complete DSH launch or browser paint. It is
not a general benchmark of the package and does not replace the
[2026-11-03 navigation benchmark](2026-11-03-macos-navigation.md), which compares two
different reader implementations.

## Environment

- macOS 27.2, Darwin 27.2.0, arm64, MacBookPro18,3 (Apple M1 Pro, 16 GiB).
- Package commit: `8861a3b` plus the uncommitted mode-entry change.
- Host: the already-running DSH Web GUI at `127.0.0.1:65271`, desktop profile
  (`DSH_PROFILE=desktop`), plugin host build from `main` at `0.1.25`. The host was not
  restarted or modified.
- Client: headless Chromium 149 (Playwright 1.64.1) with the built
  `lib/client.js` substituted in flight for the Worktree plugin's module in the served
  plugin bundle. Other plugin modules, the Host, the Gateway and the Sidecar were the
  real ones.
- Dataset: the 21 Workspaces in `~/.dsh/storages/workspace.json`; 5 are not Git
  work trees. One Workspace has 4 managed Worktrees and 5 active Session bindings.
- In-process comparison used Node v20.20.2 and the real `WorktreeManagerImpl` with the
  real Sidecar and `LocalGitAdapter` (no DSH subprocess service).

## Results

### Live client, repeated entry

The mode action was clicked, measured, exited and clicked again while the client stayed
loaded. "Navigation RPCs" counts `POST /api/worktreeManager/readWorkspaceNavigation`
requests; "all RPC done" is the last matched response relative to the click.

| Entry | Navigation RPCs | All RPC done | Workspace rows at 80 ms |
| --- | ---: | ---: | ---: |
| First entry (cold client cache) | 19 | 221 ms | 21 |
| Second entry (warm cache) | 0 | 0 ms | 21 |
| Third entry (warm cache) | 0 | 0 ms | 21 |

Before the change each entry issued one navigation read per Workspace: the same client
measured 21 navigation RPCs on its first and second entry (229 ms and 177 ms to the last
response on this machine). The first-entry cost is unchanged by design — the client has
nothing to reuse yet — and its RPC count varies by a few because the Context projection
may read the current Workspace first.

### Live client, retired cache

After the first entry the Surface was exited and the reuse limit was allowed to expire
(31 s wait). The next entry issued 21 navigation reads again, but the tree was already
populated from the reader:

| Sample | Rows | Loading text | Navigation RPCs | Last response |
| --- | ---: | --- | ---: | ---: |
| 80 ms after click | 21 | absent | 21 in flight | 210 ms |

The revalidation is therefore visible as background work, not as a blocking empty or
loading tree. A retired projection is never served as fresh: `read()` still starts a
new generation and publishes the new facts.

### In-process, same 21 Workspaces

`createWorktreeViewReader` plus the real Manager, counting `readWorkspaceNavigation`
calls and wall time:

| Scenario | Navigation reads | Wall time |
| --- | ---: | ---: |
| Cold reader | 21 | 131.5 ms |
| Old re-entry (invalidate all, read all) | 21 | 122.7 ms |
| New re-entry (all projections within reuse limit) | 0 | 0.0 ms |

The in-process timings use the Node `execFile` Git fallback; the live Host uses the DSH
subprocess service, so absolute values are not comparable across the two tables.

## Interpretation boundaries

- OS and Git filesystem caches were warm; this is not a cold-start measurement.
- One workstation, one profile, one Workspace set, one plugin build; no population
  estimate.
- The live measurement substitutes only the Worktree client module. It does not install
  a release and does not prove behaviour after an app restart.
- DOM presence at 80 ms is not a paint timestamp, and no CPU, I/O or process trace was
  collected.
- First entry after a client load still performs the full Workspace scan; the change
  targets repeated entry and the visible transition, not the cold scan.
- The 30 s limit bounds reuse. Mutations, admission notifications, reconnect recovery
  and native Session membership changes still retire or revalidate the affected
  Workspace as before.
