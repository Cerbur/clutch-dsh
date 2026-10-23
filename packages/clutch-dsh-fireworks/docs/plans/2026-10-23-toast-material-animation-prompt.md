# Toast material and animation generation prompt

Scoped follow-up on `wt-fireworks-0.1.5/feat-toast-and-animation-prompt`, based on
`dadfd11a3f85446fe1e951e4c6d9ea53d0386e29`. This supersedes only the toast's colorful
material and the previous Chinese-only generation prompt in the global-toast and animation
settings plans. Tool delivery, navigation, queueing, lifecycle and script runtime stay unchanged.

## Toast reference and decisions

Read-only reference: `../clutch-dsh-worktree/src/client/branch/GitBranchSelector.tsx`
uses `SearchableSingleSelect`; `select/SearchableSingleSelect.tsx` mounts DSH `MenuSurface`.
`select/single-select.css` uses a 12 px large radius, no border, border-l1 elevation stroke
and elevation-prominent shadow. The referenced DSH source checkout resolves the rest:

- `packages/client/ui-primitives/src/MenuSurface.module.css`: background-only material,
  menu-surface-fill and menu-backdrop-filter, noninteractive material; macOS backing below
  page content (not reproduced by this CSS-only toast change).
- `packages/client/ui-theme/src/styles/design-platform.css`: light fill
  `rgba(248,249,250,.58)`, dark fill `rgba(67,69,74,.45)`.
- `packages/client/ui-theme/src/styles/gradient-shadow-text.css`: blur(40px) saturate(150%),
  elevation-prominent's half-pixel stroke and two neutral shadows; dark menu stroke uses l3.

Use that material language without importing the menu component or modifying worktree.
Mix 25% menu fill with an opaque theme surface for readable text over moving celebrations.
Default to opaque theme color without backdrop-filter; provide denser fallback fills when
color-mix or DSH tokens are absent. Use primary labels, currentColor focus and neutral shadows.
No gradient, glow or ornament is added. Preserve all toast markup and controller behavior.

## Prompt contract and localization

The baseline fireworks package has no locale service or dictionary: its prompt/settings
were hardcoded Chinese (with an English delete-confirmation special case). Add narrowly
scoped en/zh dictionaries for this prompt region, matching DSH's two existing UI languages.
DSH locale synchronizes document.lang; observe that attribute for live changes without a new
required service/dependency or installation change. Unknown languages fall back to English.
Do not duplicate technical specifications in dictionaries. One English core includes art
direction and the real v1 metadata, synchronous render entry, frame fields, helper signatures,
absolute time, seeded random ordering, budget/performance and sandbox restrictions.

Copy the exact displayed core plus localized creative brief, with localized success/error
feedback and manual text selection when clipboard is unavailable. A generated script must
still pass existing import/preflight and optional full preview. No AI output is trusted by default.

## Verification scope

Add regressions for complete clipboard arguments in both languages, live language composition,
missing/rejected clipboard, locale observer cleanup, real metadata/helper/Worker contracts,
toast navigation failure/dismissal/accessibility, pointer boundaries, theme fallback and contrast.
Run existing controller/sandbox regressions for queueing, expiry and cleanup. Run package scripts,
scoped lint/format, workspace/patch checks and whitespace checks where dependencies permit.

Browser inventory is empty in this session. Existing README screenshots remain explicitly labeled
as earlier toast styling; do not fabricate replacement captures. No alternate server, GUI config
change, installation-path change, release verification or commit is authorized.

## Execution record

- Confirmed package pwd and clean worktree; feature HEAD and release ref both equal the base.
- Official package typecheck/build/test/lint attempts are blocked: no node_modules, tsc/eslint
  unavailable. The first pnpm invocation automatically tried dependency installation and failed
  registry.npmmirror.com DNS (`ERR_PNPM_TARBALL_FETCH_TARBALL`). Subsequent attempts use
  `--config.verifyDepsBeforeRun=false` only on the command line to avoid repeating that failed
  preparation; no config, registry, install location or lockfile was changed. Global pnpm is
  12.15.0 versus the manifest's 10.32.1; Node is 26.3.1.
- `pnpm --config.verifyDepsBeforeRun=false -C ../.. run check:workspace` passes.
  The analogous `check:patches` fails on missing yaml; scoped pnpm prettier fails on missing tool.
- Supplemental read-only tools from `/Users/yuancheng/Documents/Code/clutch-dsh/node_modules`:
  ESLint on `src test --max-warnings 0`, Prettier on all 13 changed/new files, and strict no-emit
  TypeScript checking of the two new standalone prompt modules pass. These do not constitute
  this worktree's full build/typecheck. Formatting edits were applied via apply_patch.
- Node inline registerHooks plus TypeScript transpileModule runs existing tests against current
  sources in memory, without emitting lib or changing dependency resolution on disk. Core
  prompt/animation/validation/controller/renderer/material coverage passes; a second in-memory
  CommonJS/JSX module loader runs settings and overlay component tests, with the same CSS class
  naming scheme. All 19 component checks pass. This bypasses Client entry registration and the
  production bundler; its native registration test and the full package suite remain unverified.
- Initial supplemental core run: 50/51; the new test's Worker-options extraction was wrong.
  Fixed the extraction and fake Canvas measureText; repeat passed 54/54 before adding the
  separate native-theme numerical contrast case. Initial supplemental lint found three test-only
  issues (two missing URL imports and regex spacing); fixed and repeat passed with zero warnings.
- Clipboard tests intercept the actual component handler's writeText argument: byte-for-byte
  equality with displayed English core plus en/zh slot, language changes, success and missing/
  rejected clipboard. This is not a system clipboard/browser readback. Worker contract fixtures
  execute all helpers across ten portrait/ultrawide timeline samples; no model-generated artifact
  or visual quality claim is made.
- Browser inventory returned zero browsers; native Arc access was explicitly not approved by
  the computer-use tool. No further access was attempted. A temporary helper file in /private/tmp
  was rejected by apply_patch before creation; no permission escalation or alternate write path
  was used, and remaining helpers ran inline. No GUI configuration or installation was changed.
- Both READMEs disclose old screenshot styling. No current visual capture, installed-host
  acceptance, production bundle verification or frame-rate measurement is available this session.

## Authorized commit and rebase follow-up

The user subsequently authorized one scoped commit of these 13 files and a rebase onto
`wt-fireworks-0.1.5/release`. Initial package checks still failed because this worktree had no
dependencies. A temporary `node_modules` link to the release worktree's installed
package dependencies, plus its root tools on the command's PATH, enabled the official scripts
without changing manifests or the lockfile. Package typecheck and the full test script passed
(including the production client build and all 130 tests). The link is removed before clean
worktree gates. Prettier passed for all 13 files; scoped ESLint also passed without warnings.
Browser acceptance and frame-rate measurement remain unverified.

## Post-rebase repair

- Both the feature and release worktrees reproduced missing Cordis `Context` services.
  The lockfile selected bare Cordis 4.0.5 for this package, client-store and ui-workspace,
  while the remaining DSH dependencies selected its optional include/loader peer context.
  Unify those three resolutions with the existing peer context and remove the unused bare
  snapshot. A real dependency-resolution regression checks every DSH development dependency
  against the plugin's Cordis instance. No dependency versions or public requirements change.
- The release baseline also added `AnimationFrame.theme`; the generation prompt omitted it.
  Its existing contract test reproduced this independently of the dependency issue. Include
  the resolved light/dark value, live color updates without restart and the legacy dark
  fallback. Exercise both themes at every timeline sample through the actual Worker helpers.
- These repairs preserve the original toast, playback, navigation and installation contracts.
  Both READMEs now mention the prompt's theme guidance.
- Verification in this feature worktree:
  `pnpm --filter @cerbur/clutch-dsh-fireworks install --frozen-lockfile --offline --ignore-scripts`
  succeeded without downloads; package `typecheck`,
  `lint` and `test` passed, including the production build and all 165 tests. Scoped
  `pnpm exec eslint ... --max-warnings 0`, `pnpm exec prettier --check ...`,
  `pnpm run check:workspace`, `pnpm run check:patches` and `git diff --check` passed.
  Patch validation emitted the existing unresolved `!!js` YAML-tag warning.
- With user authorization to commit, these post-rebase repair changes are amended
  into the feature's scoped commit. No release-worktree edit, publish or browser
  acceptance was performed.
