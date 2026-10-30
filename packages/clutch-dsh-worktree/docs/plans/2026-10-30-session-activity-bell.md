# Session activity bell

Add a bell between Search and Collapse All in the Worktree Sidebar header. A notification
dot means the list contains running, pending-interaction or unread-completed Sessions.
The empty panel says “No active sessions” / “无活跃会话”. Each entry has Session title,
Workspace and Worktree on the left, native StateDot and localized time on the right.
Selecting an entry follows existing Session navigation; opening the bell does not mark read.

Use the existing native status owner, Workspace list and retained Worktree views only.
Tree search, expansion and row limits do not affect membership. Exclude archived/blank and
catalog-only Sessions. Relationship-unavailable entries must not be mislabeled Local/Main.
Keep ready facts visible through refreshes. No Host/Provider/Sidecar or transport changes.

DSH's current native status has no start/stop timestamp. Display clocks use native Session
`updatedAt` initially (the existing row baseline), then observed ongoing transitions in this
Client. These approximate initial times are explicitly documented; no history is read to
invent a timestamp. A visible-panel-only timer updates display without fetching or persisting.

Use native floating-menu material/positioning and StateDot; implement the bell as a small
code-native SVG because the installed primitive catalog has no bell. Support pointer and
keyboard opening, Escape/focus return, outside click, search/Sidebar dismissal and cleanup.
Sidebar dismissal includes unavailable overlay bounds independently of native collapse:
anchor loss or invalid geometry closes the portal and releases its timer/keyboard listener.
Recovery must leave it closed until the user opens it again. Regression coverage connects
the real geometry hook to production `SurfaceHeader` and `SessionActivityBell`, retaining
ready Session/Workspace facts and restoring native content during degradation.

Verify membership/status transitions using the real native UiSession fixture, exercise the
production component with React/DOM events, inspect light/dark and empty/nonempty rendering,
and run all package-required workspace, patches, lint, typecheck, build, test and README checks.

## Live verification — 2026-10-30

Verified against the running `~/.dsh-test` Web profile on `127.0.0.1:3088`, whose UI
reports DSH `0.2.1-rc.2-687f282`. Installed this feature with the native command:

```bash
DSH_HOME=/Users/yuancheng/.dsh-test pnpm dsh plugin --profile web add \
  /Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_7976b0b10e03/packages/clutch-dsh-worktree
```

The profile previously linked `wt_7b0d2cd8ceaa`. Changing the link did not replace the
Host's cached package directory, so the idle test server was restarted on its original port.
Used the already-authenticated Chrome page; no credential recovery or authentication
changes were needed. UI automation used native computer-use actions and assertions over
the resulting accessibility trees, without injecting status, list, RPC or transport mocks.

Two new test Sessions in the existing `batch-manage-qa-20261030` Workspace exercised:

| Scenario | Live result |
| --- | --- |
| Cold idle list | Plain bell; popup says `无活跃会话` |
| Real `sleep 35` task | Bell count 1; native ongoing indicator; Session title, Workspace, Local and elapsed time |
| Leave Session before its native stop | Completed reminder remains in bell |
| Close and reopen bell | Reminder remains unread; Escape closes and returns focus |
| Select completed entry | Native Session opens; unread clears; ordinary bell returns |
| Standard-mode `ask_user_question` | Native warning/`等待回答` takes priority in bell |
| Answer the test-only question | Task returns `BELL-QA-WAIT-DONE`; no pending interaction remains |
| Rerun the first Session with `sleep 25` | Reopened popup immediately shows current `已运行 21秒`; task returns `BELL-QA-REOPEN-DONE` |

The first attempt to ask a question in Minimal mode correctly reported that its tool was
unavailable; the warning scenario was rerun in a new Standard-mode Session. Native directory
pickers could not be controlled by the automation, so their two test-created processes were
cancelled and the existing test Workspace was used. No business files were read or changed;
Git status in `/private/tmp/clutch-batch-live-20261030/repo` remained empty. Live membership
covered Local/Main; managed-Worktree branch joins and catalog exclusion remain covered by
the automated projection tests rather than a live Worktree-creation claim.

Live testing exposed stale time on the first frame after reopening: the closed panel's
clock waited for its next one-second interval. Added a regression that advances time while
closed (red before the fix), then refreshes display time in the bell click handler (green).
The real `sleep 25` run confirmed the fix in the loaded feature bundle.

Final checks: `check:workspace`, `check:patches`, package `lint`, `typecheck`, build through
`pnpm --filter @cerbur/clutch-dsh-worktree test`, and README parity all passed. Full suite:
1298 tests, 1287 passed, 11 optional external-native tests skipped, zero failures. Also ran
`node test/manual/session-permission-native.mjs /Users/yuancheng/.dsh-test/profiles/node_modules`;
the real native permission graph passed. Test Sessions were retained as evidence, with all
tasks finished. Restored the original `wt_7b0d2cd8ceaa` profile link through the same native
install command and restarted the idle test server on port 3088. Other plugin links were
preserved; startup reported no plugin import errors.
