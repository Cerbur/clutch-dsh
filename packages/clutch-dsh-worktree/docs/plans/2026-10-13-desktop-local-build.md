# Desktop local-build dependency diagnosis

Branch: `wt-worktree-0.1.18/fix-remote-baseline`.
Baseline: `190050c`, also the release branch's HEAD when diagnosed.

## Reproduced failures

- The release checkout had root `node_modules` and `lib/`, but no package-level
  `node_modules`. Plain file-URL imports failed on Cordis/Subprocess; adding
  Desktop's actual `createRuntimeResolution`/`PluginPackages` and Cordis Loader
  corrected those shared-platform lookups. The Host and Typert entries still
  failed with `ERR_MODULE_NOT_FOUND` for the plugin-owned `zod` dependency.
  The preset entry passed with native resolution. This establishes the local-path
  dependency failure without asserting that the initial two-entry toast has
  been reproduced in every detail: the original profile was already rolled back.
- Evaluating that release's actual Client handoff factory failed with
  `client-modules: require("zustand/vanilla") missed the module table`.
  Desktop crash logs dated 2026-10-13 recorded the same exception. The published
  snapshot store imports Zustand and Immer but lists them only as development
  dependencies. A build without those modules warned and emitted external
  `require()` calls even though they are intended to be bundled.
- The currently installed npm package was the user's rollback, so its successful
  imports do not validate the failed release installation.

## Fix and regression

Declare Zustand/Immer as this package's own build dependencies and enable
`failOnWarn` in the Client build. Keep the existing shared-platform externals
and dependency topology. No Remote, Git baseline, permission lifecycle,
Sidecar or DSH-owned state changes are required.

`node --test test/client-build.test.mjs` copies the real published store into
a temporary package without its upstream development graph and invokes the
production build script. Before the fix, the factory failed on
`zustand/vanilla` and the missing-dependency build incorrectly succeeded.
After the fix, the closed bundle updates the real store without private module
seeds and the incomplete build fails. Both tests run in under one second locally.

The opt-in `test/manual/desktop-plugin-import.mjs` accepts an existing installation
anchor and optional package directory. It creates a temporary profile link,
uses Desktop's actual native resolution and Loader, and imports preset, Host
and Typert entries. Electron Node 24.18.1 on the installed Desktop graph rejects
the old release's missing `zod`; all three entries pass for the built fix branch.
The original full Client handoff also evaluates successfully with only the
existing platform modules. All 1103 package tests, lint, typecheck, build,
workspace/patch checks and bilingual README parity pass.

The bilingual local-install guidance now covers Desktop's `add` command and
retaining checkout dependencies while linked. Existing plans and contracts are
unchanged: this repairs the build/install boundary rather than changing remote
branch behavior. Validation uses isolated fixtures and read-only access to the
Desktop runtime; it does not redeploy the user's profile or claim a live GUI test.
