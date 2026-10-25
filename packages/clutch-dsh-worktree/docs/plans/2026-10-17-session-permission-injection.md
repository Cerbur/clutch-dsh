# Session permission injection without a loaded named preset

Keep the cold-start configuration contribution as an optional native menu label.
Do not restart or mutate the live native permission provider to install a preset.
Separate that catalog capability from the native per-Session policy write path:
after the existing binding/path checks and RiskConfirmation acknowledgement,
append the same `approval/policy` and `sandbox/mode` events used by DSH's public
setters, only when the live native policy services and their Session reads are available.
Read back both effective values before reporting success. Native UI may derive
`custom`; never append a fabricated `permission/preset` identity.

Preserve late-provider lookup, explicit restrictions, cancellation, detached
normalization and older-profile fallback. Share equivalent pending confirmations
without combining different Session/Worktree/path identities. Keep missing-Host
and genuinely unsupported-policy recovery, while successful custom-mode requests
do not ask users to restart solely for a menu label.

Regression coverage must include the actual Host/confirmation flow, native
projection readback, missing/retired providers, partial write failure, custom
read-only and user downgrades across adapter replacement. Verify against the
existing ~/.dsh-test environment using isolated fixture Sessions, not its user
history. Run all package AGENTS.md gates from the target monorepo root.

## Implemented structure

- `contract/worktree-permission.ts` distinguishes named catalog availability from
  optional native `sessionPolicy` capability without changing the Remote result shape.
- `host/service.ts` resolves approval alongside the other optional capabilities
  on every call. The actual permission manager still owns binding/physical-path gates.
- `host/worktree-permission.ts` selects the named preset when present, otherwise
  appends the native knob events after confirmation. It reads effective sandbox
  policy and approval overrides, validates named specifications and verifies every
  applied/normalized result. Historical sandbox downgrades survive adapter replacement.
- The Client confirmation controller shares only equivalent pending requests,
  copies the target identity, and never caches completed consent. RiskConfirmation
  retains its native acknowledgement checkbox. Both locales explain Custom.
- The cold-start contribution and bundle are unchanged. This is per-Session
  application, not a new native arbitrary-preset registration API. Missing Host
  still requires composition/restart; unsupported policy graphs retain fallback.

## Verification results

The baseline regression failed because missing presets bypassed confirmation and
called the workspace-write fallback. The new native-policy, readback, cancellation,
provider-lifetime, collision and partial-write regressions pass after the fix.

Executed from this target monorepo root, all exit 0:

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
```

Final full suite: **1150/1150 pass**, no failures/cancellations/skips. The test gate
also rebuilds the final sources and runs the Remote type fixture. Explicit package
README parity: `node --test test/readme-parity.test.mjs`, **1/1 pass**.

Native integration from this package directory, both exit 0:

```bash
node test/manual/session-permission-native.mjs /Users/yuancheng/.dsh-test/profiles/node_modules
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' --expose-internals test/manual/session-permission-native.mjs '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules'
```

Both runs use real native Session, projection registry, SandboxPolicyService,
ApprovalService and PermissionPresetService. They verify confirmation-before-write,
effective Custom Full Access + ask, idempotency, unchanged catalog/defaults, Auto
coexistence, normalization and downgrade replay using new in-memory Sessions.
The production dialog regression verifies compiled component wiring, acknowledgement
state/reset and bilingual Custom copy at the native primitive boundary; it is not
a browser DOM/portal end-to-end test.

Dependencies were installed in the target Worktree with
`pnpm install --frozen-lockfile --ignore-scripts --offline`. No dependency manifest
or lockfile changed. This Worktree lies outside the initial writable sandbox;
dependency installation and builds/tests required the approved filesystem escalation.
No native source/runtime, user profile/history, existing plugin link or live GUI
was modified. No commit, merge, push or publication was performed.
