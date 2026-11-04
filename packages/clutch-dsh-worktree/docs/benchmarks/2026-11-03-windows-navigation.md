# Windows navigation benchmark — 2026-11-03

## Scope

This record measures the navigation read phase of `7ba63943bf610519261c15e660c63749546bb196` against the parent reader at `b6d9541`. It does not measure a complete DSH application launch or browser paint. The parent reader issues five parallel Manager calls; the new reader requests one shared navigation snapshot and limits concurrent Workspace reads to three.

The old backend endpoints remain in the current build. The optimization only extracted `getWorkspaceCheckout` without changing its body; the Git provider, manager-worktrees, manager-sessions and recovery implementation did not change. This permits a controlled read-path comparison using a real parent reader and the current Manager. It is not two separately installed DSH releases.

## Results

On this machine, the measured read phase became **39.6–49.4% shorter by median**. Every measured pair favored navigation; all output-equivalence and fixture-health assertions passed. This is a single-machine run, not a population estimate or a complete product latency claim.

| Scenario | Legacy median (ms) | Navigation median (ms) | Median reduction | Legacy p95 (ms) | Navigation p95 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| One attached checkout | 132.20 | 66.86 | 49.4% | 137.38 | 70.87 |
| One detached checkout, no tag | 164.73 | 99.52 | 39.6% | 171.51 | 105.69 |
| One Workspace, 8 managed attached worktrees | 140.60 | 74.78 | 46.8% | 147.98 | 84.18 |
| 12 independent Workspaces, all complete | 677.82 | 347.44 | 48.7% | 810.25 | 398.45 |

Reduction is `1 - navigation median / legacy median`; p95 uses nearest rank over 30 measured observations per mode. The raw JSON also retains signed within-pair deltas; their medians are respectively 65.47, 65.43, 65.99 and 313.66 ms. A difference of medians and a median of paired differences are different statistics.

For 12 Workspaces, **first reader completion** median was **623.99 → 86.33 ms** (86.2% lower), with p95 **748.90 → 102.96 ms**. All-complete time also improved in this fixture despite the new three-Workspace scheduler limit. This does not establish the tradeoff for slow/network repositories or heterogeneous workloads.

| Scenario | Git invocations | Peak pending Git calls | Sidecar file reads | Logical endpoint calls |
| --- | ---: | ---: | ---: | ---: |
| Attached | 10 → 4 | 3 → 2 | 3 → 1 | 5 → 1 |
| Detached | 11 → 5 | 3 → 2 | 3 → 1 | 5 → 1 |
| 8 managed worktrees | 10 → 4 | 3 → 2 | 3 → 1 | 5 → 1 |
| 12 Workspaces | 120 → 48 | 36 → 6 | 36 → 12 | 60 → 12 |

Counts were identical across all 30 measured samples per mode. Peak pending calls is measured at the adapter `run` boundary, not by an OS process-lifetime trace. Git counts do not grow with the eight attached worktrees because porcelain supplies their branch heads; their additional path/activity projection work remains measured. DSH activity is an idle stub.

Immediate cached second reads performed zero Git, sidecar or endpoint calls on both versions; medians were approximately 0.004–0.012 ms. This is an existing cache capability, not a newly achieved speedup or an application reopen measurement.

## Data and reproduction

- [Raw JSON with every warmup and measured observation](2026-11-03-windows-navigation.json).
- [Benchmark script](../../scripts/benchmark-navigation.mjs).
- Sampling: 4 scenarios × (3 warmup + 30 measured) pairs × 2 modes; 240 measured initial reads and 240 measured cache reads. Each mode uses a new reader, followed immediately by its cached second read. Pair order alternates legacy/navigation and navigation/legacy. No outliers are discarded.
- Each fixture has one committed file; the managed fixture has eight linked worktrees, eight bindings and nonempty instructions. The fanout fixture has 12 separate repositories. Fixtures and the transpiled parent reader are created under OS temp and removed afterward.
- Node v24.9.0, Git 2.47.1.windows.1. Fresh TypeScript/client build completed in the pinned-pnpm validation run immediately before measurement; no concurrent tests or builds ran during sampling.

From the monorepo root, with dependencies installed and pnpm 10.32.1 available:

```powershell
pnpm --filter @cerbur/clutch-dsh-worktree build
cd packages/clutch-dsh-worktree
node scripts/benchmark-navigation.mjs --samples 30 --warmups 3 --output navigation-rerun.json
```

Use a new output filename: exclusive creation prevents overwriting existing measurements. The checkout must retain source identical to `7ba6394` and history containing `b6d9541`. The script permits subsequent benchmark/documentation commits, verifies the parent relationship and unchanged shared source, and records commit IDs plus reader source/build hashes. It requires a fresh build; it does not independently prove all existing build artifacts match source. The report records the initial checkout commit, before this benchmark commit.

## Environment

- Windows 11 Pro, build 26200 (`10.0.26200`), x64.
- AMD Ryzen 5 7500F, 6 cores / 12 logical processors; 33,943,793,664 bytes physical RAM.
- Balanced power plan; C: (temporary fixtures) and E: (checkout) are fixed NTFS volumes.
- Antivirus settings and OS filesystem caches were not changed. This is a normal interactive workstation, not an isolated performance lab.
- Full validation finishes before formal performance sampling.

## Interpretation boundaries

- Real temporary Git repositories and linked worktrees exercise Windows Git process creation and physical path reads.
- Sidecar fixtures use file-backed JSON reads; they omit production storage-boundary and schema validation costs.
- Manager endpoints are called in process. Endpoint counts describe logical RPC demand, not measured HTTP requests or network latency.
- Startup recovery is excluded. Both versions still await the same global recovery promise in production.
- First completed Workspace means reader completion, not React publication or a rendered frame. Current/expanded prioritization, progressive Surface rendering, native Session membership and context loading are outside these timings.
- No ETW/WPR capture is taken: process counts and wall time must not be presented as total CPU, disk I/O, power or process-tree memory savings.
- Warmups and repeated fixtures warm the OS cache. A fresh reader is not an OS cold start.
- Cached reentry is an immediate second read of the same reader without invalidation. Both versions already cache; it does not represent a real Surface mode switch, which can trigger refresh.

## Validation

The initial unchanged optimization checkout ran the complete suite: 1,323 tests, 1,284 passed, 27 failed and 12 skipped. The initial shell selected pnpm 12.6.0; validation was then repeated with the package-pinned pnpm 10.32.1, with the same 1,284 pass / 27 fail / 12 skip result (118.019 seconds for the test runner). Workspace structure, Cordis patches, package ESLint, TypeScript typecheck and package build all passed. Detailed initial failure evidence is retained in [validation failures](2026-11-03-windows-validation-failures.txt).

Failures include Windows symlink privileges, absolute Windows paths used as ESM import specifiers, LF/CRLF source-string and content assertions, Git path separator assertions, and platform-specific missing-path/error expectations. These failures existed before benchmark changes; no assertions, skips or product code are modified to make this benchmark pass. The full suite is not a green release gate.

The focused navigation and README checks pass: `node --test test/navigation-loading.test.mjs test/navigation-surface.test.mjs test/readme-parity.test.mjs` (10 tests). The five-sample diagnostic emitted by that existing test is not used as the formal benchmark data.

Commands run from the monorepo root with `npx --yes pnpm@10.32.1` (abbreviated below as `pnpm`):

```powershell
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm exec eslint packages/clutch-dsh-worktree/scripts/benchmark-navigation.mjs
node --check packages/clutch-dsh-worktree/scripts/benchmark-navigation.mjs
```

The package test command successfully runs the full build and remote-test TypeScript compilation before its test runner reports the failures above. The Cordis check exits successfully with the existing `!!js` unresolved-tag warning. Final benchmark ESLint and syntax checks pass. `git diff --check` passes. This commit records measurements and the unsuccessful full-suite gate; it is not release approval.
