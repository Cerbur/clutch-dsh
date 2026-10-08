# Worktree Host permission capability lifecycle

## Scope and baseline

- Feature: `wt-worktree-0.1.17/feat-permission-lifecycle`.
- Clean starting HEAD and local release reference:
  `55ba94d164f348dd8bd425a12dacda81b015cfd2`.
- Only this package's permission Host, tests and documentation change. No required
  permission injection, contribution-hook change, native permission/RiskConfirmation
  change, profile edit, existing installation-link change, production restart,
  Session operation, commit, merge, push or publication.

## Confirmed root cause and regression seam

The Host declares only workspaceRegistry/sessions/sessionPersistence as required
injections. Previously it read optional permissionPresets/sandboxPolicy once in its
constructor and captured the instances (or undefined) in its adapter. Cordis
`ctx.get()` is a current lookup, not a lifecycle subscription: later provision does
not remount this Host. The same capture also keeps a revoked/replaced instance.
This proves a deterministic lifetime defect, not that every reported field failure
or increased failure rate has the same cause; there is no such trace/statistical
attribution here.

Regression: [host-permission-lifecycle.test.mjs](../../test/host-permission-lifecycle.test.mjs),
using [permission-host.mjs](../../test/helpers/permission-host.mjs). The helper loads
the actual compiled Host constructor and mounts it through real Cordis
`ctx.plugin({ inject: Service.inject, apply(child) { new Service(...) } })`.
Only the unrelated DshRead/disk manager and Typert base/decorators are substituted.
Actual permission-manager, physical path validation, adapter, Remote projection,
`ensureWorktreeSessionPermission` and confirmation controller execute. A dialog
snapshot assertion is not a DOM/portal/CSS assertion.

### Red → green

After building the unchanged baseline, run in the package directory:

```bash
node --test test/host-permission-lifecycle.test.mjs
```

Before the fix: provider-first passed; host-first failed, exit 1, with
`live provider must expose confirmation dialog state` (actual undefined, expected
session). Both had a live provider and exactly one Host mount. After replacing
constructor captures with Context-backed adapter option getters, both passed.
The completed regression suite has 11 passing tests, including:

- provider-first and late provider confirmation, no mutation before confirmation;
- missing requests, restoration and retry without Host remount;
- revocation between dialog and confirmed call: unverified/retryable, no old setter;
- replacement during confirmation and repeated remounts, retired provider traps;
- explicit native read-only and post-plugin restrictions survive replacement;
- cancellation never grants Full Access;
- malformed capability and missing preset fail closed/fallback, then recover;
- late/replaced/revoked sandboxPolicy defaults and detached normalization.

The same adapter remains alive so provider replacement does not erase its runtime
ownership/restriction evidence. Public Remote contracts and permission decisions
are unchanged; getters resolve the currently scoped capabilities after the
manager's asynchronous relation checks.

## Actual HMR seam investigation

[permission-preset-hmr.mjs](../../test/manual/permission-preset-hmr.mjs) is an
opt-in isolated experiment, not part of the default test suite. It reads an
existing HMR graph, creates and later removes only its own mkdtemp fixture, and
uses the package's actual permission-presets export mapping and compiled
contribution implementation. Temporary fixture links exist only inside that new
directory; no installed link is switched. There is no Loader import/resolver stub.

Executed from this feature package:

```bash
/Users/yuancheng/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node --expose-internals test/manual/permission-preset-hmr.mjs /Users/yuancheng/.dsh/desktop/rollback/profile/node_modules
```

Observed graph: Node 24.21.0, Cordis 4.0.2, Loader 1.0.3, HMR 1.0.17. It runs the
actual chokidar watcher, HMR classification/cache invalidation/re-import/runtime
replacement and Node internal module graph, not fiber.restart or Entry.update
masquerading as watcher HMR. Startup, 10 contribution edits + 10 native fixture
edits (20 hmr/reload events), module revision identity, one appended preset,
native defaults, Auto-style registration, raw config/default preservation and
bundle withdrawal all passed, exit 0. The actual Host is mounted before Loader;
it remains mounted once, sees each new provider, never calls trapped retired
providers, and exposes confirmation before its final Full Access setter.

Harness development initially timed out with a 10ms debounce during rapid writes.
Using HMR's native 100ms debounce and explicit watcher readiness completed the
experiment. Canonical temporary module paths match the watcher realpath. These
harness timeouts are not evidence of a permission contribution defect.

Limitations: the HMR graph is an existing installed backup graph, not the current
production graph; native permission/Auto and outer I/O remain fixtures. Full DSH
profile/module topology, real native provider under HMR, browser DOM/portal/CSS,
and production watcher coverage remain unverified. The hook is unchanged because
no hook-specific red evidence was found. Missing presets cause fallback/unverified
and skip confirmation; they do not directly create repeated confirmation dialogs.
Building this feature does not hot-update the running GUI installed from another
feature. No production GUI or user Session was touched.

## Verification and environment

All required gates passed in the original feature worktree, not a copied checkout.
From the monorepo root (all exit 0):

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

The full test gate includes build and the Remote type fixture: **829/829 passed**,
no failures, cancellations or skipped tests. From the package directory:

```bash
node --test test/readme-parity.test.mjs
node --test test/host-permission-lifecycle.test.mjs test/permission-preset-append.test.mjs
```

README parity: 1/1; focused permissions: 17/17 (11 lifecycle + 6 unchanged
contribution tests). The final actual HMR experiment above also passed again
with 20 reload events after formatting and the final build. The first lint run
caught missing explicit Node globals/imports and getter-return in retired-provider
traps; these were fixed and lint was rerun successfully, not waived.

For each pnpm command, the actual invocation uses the bundled Node and pnpm script:

```bash
export pnpm_config_verify_deps_before_run=false
PNPM_NODE=/Users/yuancheng/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
PNPM_SCRIPT=/Users/yuancheng/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs
"$PNPM_NODE" "$PNPM_SCRIPT" <arguments-shown-above>
```

Final review: only the permission capability lookup changes in production source;
all other changes are this package's tests and synchronized documents.
`git diff --check` passed; no debug probes remain. HEAD/release reference remain at
the original baseline. All changes are unstaged/uncommitted for review.

The bundled pnpm 11 defaults to an implicit dependency install before scripts.
The first attempt failed on a root temporary file under the narrower sandbox;
no install completed. Subsequent commands set
`pnpm_config_verify_deps_before_run=false` only in their process environment,
without altering dependencies or configuration. pnpm is invoked with the bundled
Node/script paths. Native build child processes use the existing system Node
26.3.1: forcing bundled Node 24 for rolldown failed due to macOS Team-ID addon
mapping, not source/type errors. The compatible child runtime completed builds.
