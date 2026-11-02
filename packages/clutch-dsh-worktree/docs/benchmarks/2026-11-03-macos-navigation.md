# macOS navigation benchmark — 2026-11-03

## Scope

This repeats the [Windows benchmark](2026-11-03-windows-navigation.md) using the unchanged [benchmark script](../../scripts/benchmark-navigation.mjs). It compares the parent reader at `b6d9541697089900ae98d9a56994fe6700db4ddf` plus verified current legacy Manager endpoints against the navigation reader and endpoint at `7ba63943bf610519261c15e660c63749546bb196`. The measured checkout is `07bdc7d2c48170003587db43612329db914cba5f`.

The old reader issues five parallel Manager calls per Workspace; the new reader uses one shared navigation snapshot and limits concurrent Workspace reads to three. This measures the navigation read phase, not a complete DSH launch or browser paint, and does not compare two separately installed releases. The script verifies unchanged shared implementations and checkout extraction, checks output equivalence and fixture health, and records source/build hashes.

## Results

On this machine, navigation read time became **39.7–54.8% shorter by median**. All output-equivalence and fixture-health assertions passed. This is one interactive workstation run, not a population estimate.

| Scenario | Legacy median (ms) | Navigation median (ms) | Median reduction | Legacy p95 (ms) | Navigation p95 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| One attached checkout | 72.22 | 36.41 | 49.6% | 86.44 | 41.23 |
| One detached checkout, no tag | 93.05 | 56.08 | 39.7% | 139.70 | 69.58 |
| One Workspace, 8 managed attached worktrees | 77.14 | 40.68 | 47.3% | 129.14 | 52.04 |
| 12 independent Workspaces, all complete | 437.98 | 197.88 | 54.8% | 519.55 | 237.43 |

Reduction is `1 - navigation median / legacy median`; p95 uses nearest rank over 30 measured observations per mode. Signed paired-difference medians are 36.37, 37.53, 36.55 and 244.94 ms respectively. A difference of medians is not the median of paired differences.

One measured pair in the eight-worktree scenario favored legacy by 12.11 ms; the other 119 pairs favored navigation. No observations were discarded. The run does not establish the cause of that slower pair.

For 12 Workspaces, **first reader completion** median improved **411.96 → 46.78 ms** (88.6% lower), and p95 **490.16 → 52.50 ms**. All-complete time also improved despite the three-Workspace scheduler limit. This does not establish behavior for slow/network repositories or heterogeneous workloads.

| Scenario | Git invocations | Peak pending Git calls | Sidecar file reads | Logical endpoint calls |
| --- | ---: | ---: | ---: | ---: |
| Attached | 10 → 4 | 3 → 2 | 3 → 1 | 5 → 1 |
| Detached | 11 → 5 | 3 → 2 | 3 → 1 | 5 → 1 |
| 8 managed worktrees | 10 → 4 | 3 → 2 | 3 → 1 | 5 → 1 |
| 12 Workspaces | 120 → 48 | 36 → 6 | 36 → 12 | 60 → 12 |

Counts were identical across all measured observations and match the Windows run. Peak pending calls is measured at the adapter `run` boundary, not through an OS process-lifetime trace. Attached managed worktree branch heads come from porcelain, so Git counts do not scale with the eight worktrees; additional path/activity projection remains timed. DSH activity is an idle stub.

Immediate cached second reads issued zero Git, sidecar and endpoint calls in both modes. Their medians were approximately 0.005–0.014 ms. Both readers already cache; this is not a new cache speedup or a real application reopen measurement.

## Comparison with Windows

| Scenario | Windows median reduction | macOS median reduction |
| --- | ---: | ---: |
| Attached | 49.4% | 49.6% |
| Detached | 39.6% | 39.7% |
| 8 managed worktrees | 46.8% | 47.3% |
| 12 Workspaces | 48.7% | 54.8% |

Both machines show a similar relative improvement for single-Workspace scenarios and identical reductions in call counts. The macOS fanout improvement is larger in this run. Absolute timings are not an OS-only comparison: CPU, memory, filesystem, Git version, Node version and workstation load differ. Windows used Node v24.9.0 and Git 2.47.1.windows.1 on a Ryzen 5 7500F; this run used the versions below.

## Data and reproduction

- [Raw JSON with all warmup and measured observations](2026-11-03-macos-navigation.json).
- Sampling: 4 scenarios × (3 warmup + 30 measured) pairs × 2 modes; 240 measured initial reads and 240 measured cached reads. Pair order alternates legacy/navigation and navigation/legacy. Each mode creates a fresh reader followed by an immediate cached second read.
- Each fixture has one committed file. The managed fixture has eight linked worktrees, eight bindings and nonempty instructions; the fanout fixture has 12 independent repositories. Fixtures and the transpiled parent reader are created under OS temp and removed by the script afterward.
- Full validation and a fresh package build completed before sampling. No agent-started tests or builds ran concurrently with the benchmark.
- Recorded at 2026-11-03 01:46 Asia/Shanghai (`2026-11-02T17:46:00.274Z` in the raw JSON).

From the monorepo root, with dependencies installed:

```sh
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-worktree build
cd packages/clutch-dsh-worktree
node scripts/benchmark-navigation.mjs --samples 30 --warmups 3 --output navigation-macos-rerun.json
```

Use a new output filename because exclusive creation prevents overwriting measurements. Retain source identical to `7ba6394` and Git history containing `b6d9541`. The script allows subsequent benchmark/documentation commits, verifies shared source, and records reader hashes; it still requires the operator to make a fresh build.

## Environment

- macOS 27.2, build 26B123; Darwin 27.2.0; arm64.
- MacBookPro18,3, Apple M1 Pro, 8 physical / 8 logical cores, 17,179,869,184 bytes RAM (16 GiB).
- Node v26.3.1; Git 2.54.0 (Apple Git-157); validation uses package-pinned pnpm 10.32.1.
- AC power attached; AC low-power mode disabled. Power settings were observed, not changed.
- Checkout and temporary fixtures reside on the same internal APFS SSD data volume, with FileVault enabled.
- OS filesystem caches and security settings were not changed. This is a normal interactive workstation, not an isolated performance lab.

## Interpretation boundaries

- Real temporary Git repositories and linked worktrees exercise local process creation and physical path reads.
- File-backed JSON sidecars omit production schema validation, migration, locking and storage-boundary costs.
- Manager calls are in process: endpoint counts describe logical RPC demand, not HTTP transport or serialization latency.
- DSH startup/recovery, native Session services, context loading and browser rendering are excluded. First completion means a reader promise resolved, not that React published or painted the Workspace.
- Warmups and repeated fixtures warm OS caches; a fresh reader is not an OS cold start. Cached reentry does not invalidate the reader and is not a Surface mode switch.
- No OS CPU, disk I/O, energy or process-tree memory trace was collected; these timings and counts do not establish savings in those metrics.

## Validation

All required checks passed with pnpm 10.32.1: workspace shape, Cordis patches, package lint, TypeScript typecheck, build, full tests and README parity. The full test runner completed in 80.136 seconds: **1,323 tests, 1,311 passed, 0 failed, 12 skipped**. The package test command includes a fresh build and remote-test TypeScript compilation. The Cordis check retained its existing nonfatal `!!js` unresolved-tag warning.

Commands run from the monorepo root:

```sh
npx --yes pnpm@10.32.1 run check:workspace
npx --yes pnpm@10.32.1 run check:patches
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-worktree lint
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-worktree typecheck
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-worktree test
node --test packages/clutch-dsh-worktree/test/readme-parity.test.mjs
```

The shell initially selected pnpm 12.15.0; that preliminary validation was stopped before being used as evidence, then all checks were run with pinned pnpm. The benchmark script and product source are unchanged. Raw-data integrity checks and `git diff --check` also passed.
