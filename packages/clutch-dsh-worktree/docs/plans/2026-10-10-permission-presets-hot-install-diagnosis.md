# Desktop permission-preset hot-install diagnosis

## Diagnosis phase status and scope

**Restart-free native contribution remains blocked. The user-approved restart
reminder is a separate, implemented Client-only follow-up described below.**

The initial diagnosis established that a safe complete plugin-only hot-install fix
was not implemented.
The current native API/lifecycle prevents safe arbitrary preset contribution to an
already-running provider while preserving existing Auto Sessions. Do not ship a
native restart workaround merely because the simplified permission fixture passes.

Worktree: wt-worktree-0.1.17/fix-permission-presets-hmr. At the end of the diagnosis
phase, all production-source and bundle edits from the rejected experiment were
restored to HEAD; only diagnostics and documentation remained. No DSH core, user
profile, installation link, live GUI or Session was changed. That diagnosis phase
performed no commit, merge, publication or push. The later reminder follow-up does
not change the native permission lifecycle or the bundle patch.

## Independently verified findings

| Hypothesis | Result |
| --- | --- |
| Market rejects config/inject/expressions before importing the permission subentry | Confirmed with installed dshmarket 1.66.14 |
| A late config contributor does not replay already-resolved native configuration | Confirmed with real Cordis/Loader and the actual contribution |
| Package exports intrinsically prevent permission-subentry Desktop HMR imports | Not reproduced: package export/file URL share module identity; 20 watcher reloads pass |
| Blind native reconfiguration is a safe complete fix | Disproved with the actual Desktop native permission provider and an Auto-selected Session |

### Market hot mount rejects the bundle

The installed Market parseSimplePatch() accepts only plain id/name insertion rows.
hotMount() calls it before importing bundle entries. A null result returns its
config/expression/restart-required reason. The current [bundle patch](../../cordis.patch.yml)
has both a foreign permission-row injection change and Host config.dshHome using
!!js dshHomePath(). Either exceeds that protocol; the first top-level permission
row alone already returns null. This is a composition rejection, not a subpath
import failure.

Read-only installed Market repro from the package directory:

~~~bash
node test/manual/permission-preset-market.mjs /absolute/path/to/dshmarket/lib/hot.js
~~~

With the installed Desktop dshmarket 1.66.14, output is
**Market hot-mount rows: null**, then the installation-eligibility assertion fails,
exit 1. The rejected experimental insert-only patch returned both expected rows,
exit 0, without modifying Market.

Accepted Market rows have mkt- prefixed ids and absolute file:// URLs resolved
against the installed profile, in a Market-owned Include subtree. Contributors
must not require their own original bare name/id to survive this transformation.

### Startup hooks are not retroactive configuration

The [contribution](../../src/host/permission-preset-append.ts) registers a global
internal/config hook and provides clutchWorktreePermissionPresets. This gates
cold composition when the patch is applied before native activation. A running
Desktop has already validated and constructed native permissions. Inserting the
contribution does not itself validate that existing entry again.

The [late-install repro](../../test/manual/permission-preset-late-install.mjs)
starts real Cordis/Loader, activates a minimal native catalog, then mounts the
actual compiled contributor. Its expected catalog includes worktree-full-access;
the actual catalog still contains only the two native defaults. Command takes
under a second and exits 1:

~~~bash
node test/manual/permission-preset-late-install.mjs
~~~

The native catalog is a fixture; Loader/contribution are real. This test alone
cannot establish native-provider lifecycle safety.

### Actual Desktop HMR and exports work in the isolated seam

The [HMR harness](../../test/manual/permission-preset-hmr.mjs) now accepts either
@deepseek-ai/cordis-plugin-hmr or @deepseek-ai/dsh-hmr and checks the actual package
permission subpath export and its file URL return the same apply function.

Executed against the installed Desktop archive, without a replacement server:

~~~bash
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' --expose-internals test/manual/permission-preset-hmr.mjs '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules'
~~~

Observed: Electron Node 24.18.1, Cordis 4.0.4, Loader 1.0.5,
@deepseek-ai/dsh-hmr 0.2.0-rc.2. Cold gated startup, package/file-URL identity,
10 contribution edits + 10 native-fixture edits, revision/module-cache identity,
Auto-style registration, default/raw-config preservation and withdrawal pass:
**20 actual watcher reload events, exit 0.** The actual Host fixture remains
mounted once and does not call revoked providers.

Limits: actual Desktop watcher/module-loader graph, not its full production
profile. Native provider/Auto and outer I/O remain fixtures in this HMR script.
No browser DOM/UI success is claimed. Profile-specific resolver or watcher
coverage problems outside this seam are not ruled out.

## Rejected fix and additional native safety blocker

The experiment made the patch plain inserts, resolved Host home from DSH's existing
dshHomePath service, and replayed native configuration with
fiber.update(entry.options.config, true), followed by fiber.await(). It never
edited Loader raw config, native table fields or Session data directly. The late
catalog regression and Include subtree/file-URL tests turned green; **19 targeted
catalog/home tests and 20 actual Desktop HMR reloads passed**.

**Independent double-check still rejected this implementation.** The actual
PermissionPresetService holds per-instance presets and Auto admission. Its
constructor synchronously iterates ctx.sessions.list() and pinInitialPermission().
A replacement instance starts without Auto admission. An existing stored auto
identity throws before the official Auto dependant can re-register:

~~~text
permission: cannot restore preset "auto" without its active integration
PermissionPresetService.pinInitialPermission (.../dsh-permission-presets/lib/index.js:374)
new PermissionPresetService (.../dsh-permission-presets/lib/index.js:205)
Fiber.execute (.../cordis/lib/index.js:1068)
~~~

The [actual-native repro](../../test/manual/permission-preset-native.mjs) uses the
unmodified installed provider/schema/Cordis/Loader with isolated shell, approval,
Session and projection ports. It first activates native permissions and the real
registerAuto(), then supplies an Auto-selected Session and explicitly probes the
proposed noSave refresh:

~~~bash
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' --expose-internals test/manual/permission-preset-native.mjs '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules'
~~~

Observed: Auto restore error, then **late contribution must not break live native
permissions**, actual provider undefined, exit 1. A harness-only rejection handler
lets its temporary fixture clean up; production errors are not intercepted. The
proposed update is explicit even with restored baseline code, so this blocker
remains independently reproducible.

The [unit fixture](../../test/permission-preset-append.test.mjs) does not pin existing
Sessions and cannot detect this ordering failure. Cordis construction completes
before initialization hooks and ready-service dependant notifications; ordinary
inject/service callbacks are too late to bridge the gap. noSave suppresses Loader
persistence, **not reconstruction or Session initialization**. An independent
read-only reviewer confirmed these constraints; the author also executed the
actual-native repro.

Do not compensate by copying private admission callbacks, replacing constructors,
wrapping native tables/prototypes, hiding Sessions, faking Auto registration,
substituting danger-full-access + never or writing permission events during install.
A preflight check for currently selected Auto alone is not a general contract for
safe installation, replacement and withdrawal.

## Safe implementation path requiring an upstream seam

A minimal native-owned extension is an effect-scoped general registrar, such as
registerPreset(name, validatedSpec) returning a disposer:

1. Native validates the spec and rejects collisions/reserved identities.
2. Registration adds exactly one runtime catalog entry and notifies existing
   native catalog subscribers, without rebuilding the provider/Auto integration.
3. Addition/removal leaves defaults, existing Session identities, effective knob
   values and durable facts unchanged.
4. Native defines withdrawal of a selected contribution (derived custom state or
   native-retained resolution), without silently widening access.
5. The calling plugin's effect owns the contribution and disposer. Reload/removal
   are reversible and do not leave plugin listeners/tables behind.

With this supported seam, the plugin can ship a Market-compatible insert-only
patch, resolve home from DSH and register on the current provider without any
cross-service restart. Separately, native registration-before-restore is needed
for safe native restart/cold boot with stored Auto. The general registrar solves
hot contribution without restarting native permissions.

Until that seam exists, preserve the live native provider and fail closed when the
named preset is unavailable. Do not promise restart universally fixes Auto restore,
or claim the incomplete workaround is a safe full plugin-only fix.

## Diagnosis-phase verification of retained baseline and diagnostics

All requested ordinary gates passed from the monorepo root:

| Gate | Result |
| --- | --- |
| pnpm run check:workspace | pass |
| pnpm run check:patches | pass |
| pnpm --filter @cerbur/clutch-dsh-worktree lint | pass |
| pnpm --filter @cerbur/clutch-dsh-worktree typecheck | pass |
| pnpm --filter @cerbur/clutch-dsh-worktree build | pass |
| pnpm --filter @cerbur/clutch-dsh-worktree test | **981/981 pass** |
| node --test test/readme-parity.test.mjs | **1/1 pass** |

The explicit parity command was also executed through its monorepo-root package
path. Bundled Node/pnpm were used; pnpm_config_verify_deps_before_run=false prevents
pnpm 11 from automatically reinstalling this preinstalled graph before each
script. Repository configuration and lockfiles were not changed. Installation
initially hit the package-only write boundary and was separately approved.

Those green diagnosis-phase gates validate the retained baseline, **not a finished
hot-install fix**. The three opt-in red diagnostics sit outside the ordinary
test/*.test.mjs suite and demonstrate the original defects/unsafe workaround.
The diagnosis phase changed no public behavior, so it left the bilingual READMEs
and release metadata untouched and did not create a fix commit.

## User-approved restart reminder follow-up

The user subsequently requested a restart reminder instead of native lifecycle
changes. The existing Client-owned [restart controller](../../src/client/restart-notice.ts)
now distinguishes missing Host and missing native preset reasons. Only the
existing Host result **fallback-workspace-write** triggers the preset reminder;
unverified capability, user restrictions and generic Connection/domain failures
do not establish this reason. No new RPC, native restart, catalog mutation or
Session write is introduced by the reminder.

- Missing Host and missing preset have independent once-per-Client-fiber budgets,
  so recovery from an initial missing Host does not suppress a later preset
  warning and repeated Session actions do not spam toasts.
- Healthy Host probes do not dismiss a missing-preset reminder. Native Full Access
  success can dismiss it. Newer native results abort older Host probes so stale
  missing-Host replies cannot overwrite them.
- The native Toast uses a reason snapshot and reason-specific key/lifetime. Its
  completion callback is reason-scoped so an old toast cannot close a new reason. Its
  preset copy conditionally advises restarting Desktop, or restarting Web and
  refreshing the page, after installation/update. It states that fallback remains
  active, without claiming Full Access was granted or restart always cures an
  incompatible configuration. Persistent permission recovery copy retains the
  guidance after toast dismissal and directs unresolved cases to settings.
- English/Chinese installation docs and locale dictionaries are updated together.
  Users are advised to finish active tasks before restarting.

The [reminder regressions](../../test/client-restart-notice.test.mjs) cover exact
classification, independent budgets, dismissal/recovery, stale/aborted probes,
disposal, bilingual copy, the compiled native Toast boundary and the production
Client callback/overlay handoff. They assert no additional RPC or native
Workspace/Session projection changes. This completes the notification request,
**not restart-free preset registration**. Final verification and the scoped
commit are reported in the task handoff.
