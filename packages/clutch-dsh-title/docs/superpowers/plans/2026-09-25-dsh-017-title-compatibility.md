# DSH 0.1.7 Compatibility — Title Plugin

## Goal and scope

Make `@cerbur/clutch-dsh-title` work with the DSH `dsh-v0.1.7-rc.1` release while preserving the existing title behavior and previously supported DSH versions, except for intentionally standardizing the built-in editable emoji template's description limit to 64 Unicode characters. Changes stay inside the title package; no DSH source is changed.

## Compatibility findings

- DSH 0.1.7's LLM `MessageSourceMap` is merge-extensible and no longer has the catch-all `{ kind: 'plugin', plugin: string }` source. `src/extractor.ts` used that removed source shape for its structured field-extraction request.
- Declare the plugin-owned `clutch-dsh-title` source kind through module augmentation using DSH's `ContextFormed` type, and emit `{ kind: 'clutch-dsh-title' }`. This changes only attribution metadata on the internal extraction message; prompt, route, and output remain unchanged.
- Keep the editable emoji template's `desc.maxCharacters` at 64 in both `src/templates.ts` and `cordis.patch.yml`. This is an intentional shared default across supported DSH versions, not a version-specific behavior change.
- DSH 0.1.7 renamed public primitives icons from fixed pixel-suffix names to size variants; `IconPlusOutline16` is no longer exported. Use a tiny title-owned SVG for the same plus affordance, avoiding reliance on a DSH-version-specific icon export.
- DSH 0.1.7 replaced `SettingsProvider.register()` with profile-backed `SettingsForms` over volatile fields on the plugin Config. Preserve the existing `enabled`, `active`, and `templates` data by declaring those optional fields volatile, disabling the generated generic form, and reading the plain base/user descriptor; retain the legacy `register()` branch for older DSH. DSH's settings importer migrates the legacy settings.yaml namespace into the profile.
- Schemastery 3.18.4 adds the runtime `.volatile()` API used by DSH 0.1.7, so the title package's direct Schemastery dependency must include that version. DSH 0.1.7 no longer ships the old file-backed SettingsProvider; keep legacy-API tests on an aliased SettingsProvider and a test-only file adapter, without depending on the retired runtime package.
- The existing peer range `>=0.1.2-rc.1` does not admit later prereleases under semver prerelease matching. Extend every DSH peer range with `|| >=0.1.7-rc.1`; broaden the Cordis peer from exact 4.0.1 to `^4.0.1` so the DSH release's 4.0.4 peer is accepted. Pin development-time DSH dependencies to `0.1.7-rc.1`, Cordis to 4.0.4, and Schemastery to `^3.18.4` so checks compile and run against the target API.
- Document the compatibility boundary in both localized READMEs. DSH 0.1.7's Node requirement is `^22.19.0 || >=24.0.0`.

## Verification sequence

1. Add regressions asserting the plugin-owned extraction message source and DSH 0.1.7 profile-settings read/configure behavior while retaining legacy SettingsProvider coverage.
2. Install workspace dependencies and run title package typecheck, build, tests, lint, README parity, and workspace/patch checks as applicable.
3. Install the built title package into the isolated `~/.dsh-test` DSH 0.1.7 profile, start DSH Web on port 3088, and verify startup and title-plugin composition. Do not edit DSH source.
4. Review the scoped diff and commit only title-plugin compatibility changes.

## Verification record

- Before the requested rc1 pin, `pnpm install --filter @cerbur/clutch-dsh-title --ignore-scripts --registry=https://registry.npmjs.org` passed on the original rc2 dependency graph. An unfiltered workspace install attempted the unrelated `clutch-dsh-worktree` prepare script and failed on its mixed Cordis peer graph, so dependency linking was filtered to this package without running unrelated lifecycle scripts.
- Before the requested rc1 pin, title package typecheck, lint, and test passed on the original rc2 dependency graph; the package suite reports 115/115 passing. The test command includes the package build.
- Review follow-up on the original rc2 pin: standardized the emoji template description limit to 64 in source and DSH profile patch, added a source/patch parity regression, and updated both READMEs to document the shared limit.
- `pnpm run check:workspace` and `pnpm run check:patches`: passed. Patch validation retains the existing unresolved `!!js` YAML-tag warning.
- `pnpm exec prettier --check` over the changed title package files and `git diff --check`: passed.
- After the user requested a 0.1.7-rc.1 pin, filtered install and dependency resolution succeeded; `pnpm --filter @cerbur/clutch-dsh-title list --depth 0` showed direct DSH dev dependencies at rc1. The rc1 test run passed 115/115 (including build); typecheck, lint, workspace/patch checks, Prettier, and `git diff --check` also passed.
- Installed the local title plugin into the isolated profile with `DSH_HOME=$HOME/.dsh-test pnpm dsh plugin --profile web add /Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_435c4df805a7/packages/clutch-dsh-title`. `pnpm dsh plugin --profile web list` confirms it is present.
- Historical smoke test before the requested rc1 pin: started the DSH `dsh-v0.1.7-rc.2` source checkout with `DSH_HOME=/Users/yuancheng/.dsh-test` on port 3088. The listener responded on 127.0.0.1:3088 with the expected 401 for an unauthenticated request (PID 23475). This is historical rc2 evidence, not an rc1 verification.
- The DSH source checkout remains clean. `pnpm peers check` reports one unrelated existing issue: `dsh-pocket@2.10.6` lacks its declared `@deepseek-ai/cordis@^4.0.1` peer; the title package has no peer error.
