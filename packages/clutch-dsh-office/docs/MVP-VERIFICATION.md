# MVP verification

Date: 2026-10-26. Branch: `wt-office-0.1.0/release`.

## Automated checks

Commands were run from this release worktree using `npx --yes pnpm@10.32.1`
for the pinned package manager:

```bash
npx --yes pnpm@10.32.1 install --ignore-scripts
npx --yes pnpm@10.32.1 install --frozen-lockfile --ignore-scripts --offline
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-office test
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-office typecheck
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-office lint
node scripts/check-workspace.mjs
node scripts/validate-cordis-patches.mjs
./node_modules/.bin/eslint packages/clutch-dsh-office/src packages/clutch-dsh-office/test packages/clutch-dsh-office/scripts
./node_modules/.bin/prettier --check AGENTS.md README.md README.zh.md packages/clutch-dsh-office
git diff --check
```

The package test command builds both compiler faces and the browser bundle, then
passes eleven tests: native SlotRegistry registration/unload, connection readiness,
unopened-session titles, active membership,
idle-kitchen retention/native workspace order,
stable two-character admission/overflow, duplicate membership, waiting precedence,
archive/blank/subagent filtering, action stations, and time-based walking.

The native lifecycle test uses the published DSH renderer and Cordis runtime,
keeping an existing main panel registered while adding and withdrawing Office.
No profile installation is performed by the test.

The lockfile was checked structurally against HEAD: every pre-existing importer,
package record, and dependency snapshot is unchanged. All four affected README
screenshot links resolve. Installation reports existing workspace peer-version
warnings; the patch guard reports its existing `!!js` YAML warning and exits zero.

## Browser checks

The local fixture runs at `http://127.0.0.1:4188` with simulated workspaces.
Playwright checked:

- English and Chinese overview with two kitchens, one/two characters, overflow,
  and a persistent waiting bubble.
- Focused kitchen navigation and return to the overview.
- Local activity preview and its searching control.
- Empty state, loading state, and unavailable-state messaging.
- A 390px viewport without horizontal overflow.
- Reduced-motion preference with the scene remaining available.
- WebGL context loss showing an alert; Reload scene removes the alert and
  restores the two visible canvases.
- Offscreen kitchens do not create a canvas until they intersect the viewport.

The committed [overview screenshot](../assets/screenshots/office-overview.png)
is a real browser capture of that simulated fixture, not a DSH installation.

## Real-profile acceptance

The scenario table below records the original active-workspaces-only acceptance.
The later all-kitchens revision is recorded separately below and supersedes the
room-removal expectations in that original table.

The user explicitly authorized installation into `~/.dsh-test`. Installed the local
release package with DSH's source CLI, preserving the existing Title, Worktree,
Fireworks and trace-plugin entries. The runtime is `dsh-v0.2.1-rc.2`, commit
`687f282`, served at `http://127.0.0.1:3088`.

```bash
DSH_HOME=/Users/yuancheng/.dsh-test node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add /Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_29c81af66e9e/packages/clutch-dsh-office
DSH_HOME=/Users/yuancheng/.dsh-test node --import tsx/esm apps/cli/src/bin.ts --profile web --patch /private/tmp/office-live-acceptance/overlay.yml --patch apps/web/tests/pin-browse-picker.overlay.yml --port 3088 --no-open
```

The temporary overlay registers a deterministic model adapter on its own
`office-qa` route. It creates real Agents with the native minimal preset, native
Workspace membership, durable turns, and native `ask_user_question` execution.
Only model responses are controlled; Office's state, transport, UI and renderer
are the installed plugin. No external model requests or edits to DSH source.

| Scenario                                        | Actual result                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Three native workspaces, only two active        | Only A and B appear; Quiet remains absent.                              |
| Three running Sessions in A                     | Two visible characters, `+1` overflow; no duplicate actor.              |
| Visible C finishes                              | C disappears; overflow actor A fills the seat; B stays present.         |
| Blank Session and running subagent in Quiet     | Neither makes Quiet an active Office.                                   |
| Unopened Session calls `ask_user_question`      | B shows a persistent waiting bubble without opening its history.        |
| Browser reload while waiting                    | Waiting bubble and running rooms reconstruct from native state.         |
| User selects Continue and submits in native UI  | Waiting changes back to cooking; completing that turn removes its room. |
| Rename B through native title service           | Native title updates in the Office roster.                              |
| Enter room and return                           | Focused room and overview contain the expected live workspace counts.   |
| Browser goes offline                            | Rooms and counts withdraw; connection message appears.                  |
| Stop B while browser is offline, then reconnect | Only still-running A returns; B does not return from stale cache.       |
| Last live Session finishes in focused room      | Focused quiet state appears; returning shows overview empty state.      |

Two real integration failures were found, corrected and reproduced as passing:

1. Title projections are strings, and the native list already owns `title` and
   `displayTitle`. The initial object-only reader fell back to indistinguishable
   short ids. The normalized fact reader now uses those native labels.
2. Workspace snapshots can remain ready while offline. Office now requires browser
   online status, native connection readiness, and an active connection generation
   before it shows live rooms/counts. Reconnection uses the native refreshed facts.

The real-profile [screenshot](../assets/screenshots/office-live-profile.png) now shows
the all-kitchens vertical-list revision in the normal test profile, including idle
workspaces without characters.
The seven dedicated Sessions were stopped and archived after acceptance. Existing
user Sessions were not driven. QA directories and archived logs are retained.
The three temporary QA Workspace registrations were removed through the native
UI. The service was restarted without either temporary overlay; the controlled
model route and driver are not part of the normal test profile.

Intentional offline tests produced expected browser network errors for existing
Worktree/Fireworks transports. Rebuilding via HMR produced Three.js's duplicate
import warning; a clean reload is the final acceptance baseline. No clean-load
Office runtime error was observed. This is not a broad DSH compatibility matrix.

## All-kitchens vertical-list revision

The user subsequently requested every native Workspace retain its kitchen, even
when idle, and a single vertical list at every viewport width. This supersedes
the original active-workspaces-only room filtering above. Only eligible active
Sessions become characters; a workspace with no Sessions or only idle/archived/
blank/subagent Sessions still has its empty kitchen. Offline handling stays gated
by connection readiness.

- The real `~/.dsh-test` profile showed all five native Workspaces, in native order,
  with zero actors and an explicit idle label. Browser geometry confirmed equal
  horizontal positions and strictly increasing vertical positions.
- The fixture's three kitchens retained their identities and order when every
  actor stopped. All three idle labels appeared and no characters remained.
- Eleven package tests passed, including retention after the last actor stops,
  empty-workspace ordering, and deletion of a removed workspace.
- Client typecheck, source/test/script lint, Prettier, workspace/patch guards and
  `git diff --check` passed. Both overview screenshots were refreshed.

## Current release scope

Production `~/.dsh` and DeepSeek Harness source were not modified. Office remains
installed in the authorized test profile. No npm publish, pack, commit or push was
performed. The full workspace suite and compatibility matrix were not run.
