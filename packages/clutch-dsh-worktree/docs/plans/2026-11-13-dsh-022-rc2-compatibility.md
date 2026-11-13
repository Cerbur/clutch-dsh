# DSH 0.2.2-rc.2 compatibility validation

Date: 2026-11-13. Feature branch: `wt-worktree/feat-2.2-rc.2-compatibility`.
The DSH checkout is at `dsh-v0.2.2-rc.2`. Package version remains unchanged.
This document records feature validation, not release verification.

## Status

Four compatibility fixes are implemented and automated checks pass. Real UI
regression has exercised navigation, registration, sessions, activity and
Dashboard flows, including native retention and successful reclamation in an
isolated test corpus. The requested UI regression matrix is now complete,
including question/approval recovery and real browser zoom. The destructive
Clutch cleanup exclusion below remains; this does not claim every possible
browser/permission variant passed.
The feature is ready for its authorized scoped commit. No push, pack, publish
or release tag was performed.

## Confirmed problems and fixes

1. The removed `useAnchoredPosition` export was invoked while rendering the
   Activity Bell, including when closed. Removing its obsolete test mock
   reproduced two TypeErrors. The trigger and portalled panel now share a unique
   CSS anchor. Opening focuses the panel; existing dismissal and status rules
   remain. CSS anchor support follows the native menu browser requirement.
2. rc.2 extends the Sidebar workspace slot with `useSectionScroller` and a
   container-height contract. The plugin binds the actual SurfaceContent
   scrollport and releases it on fold or withdrawal. Capability-gated
   `max-height: 100cqh` bounds the occupant; rc.1 retains its flex fallback.
3. Native archive cleanup previously left the cached plugin projection ready.
   A read-only optional `worktree/cleanup` listener now retains transient path
   identity at scheduling, revalidates ownership and filesystem identity at
   settlement, and notifies only matching Workspaces/Worktrees. It does not
   write Session data, change cwd, detach bindings or mark Clutch cleanup done.
   Only ENOENT permits lexical fallback. Tests cover real Git removal, aliases,
   corruption, uncertain I/O, stale ownership and disposal.
4. Add Workspace directly invoked the native-only directory picker. A real
   browser run reproduced `directory-picker/unavailable` with the composed
   browse backend. The plugin now renders the elected DSH directory flow in its
   own child slot, preserving the native implementation and injected props.
   Cancellation, replacement, withdrawal, duplicate picks and stale callbacks
   are guarded. rc.1 already has this flow contract.

Development pins target rc.2; the peer minimum remains rc.1. Both public README
languages and the client, architecture and development docs are synchronized.
Historical plans were not rewritten.

## Automated checks

All required workspace/package checks passed, using pnpm 10.32.1:

```bash
npx --yes pnpm@10.32.1 run check:workspace
npx --yes pnpm@10.32.1 run check:patches
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-worktree lint
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-worktree typecheck
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-worktree build
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-worktree test
```

The last package-script run without native-source overrides had 1,398 passes,
20 skips and no failures. Every test file was then rerun against that completed
build and its compiled fixtures with `DSH_NATIVE_SOURCE` pointing to the rc.2
checkout, `DSH_SCHEMA_ADAPTER_ANCHOR` pointing to its llm-pi-ai package manifest,
and `DSH_HOME` / `TMPDIR` pointing to isolated test directories:

```bash
node --test test/*.test.mjs
```

Run from the package directory: **1,422 passed, 0 failed, 0 skipped**. Avoiding a
second rebuild kept HMR from interrupting the UI run. README parity also passed
with `node --test test/readme-parity.test.mjs`. Frozen-lockfile installation and
all ten official DSH build gates passed. No DSH tracked source was edited. No
tool-schema safety assertion was removed or weakened.

## Actual rc.2 UI regression

The app ran with the requested test home, the official browse-picker overlay
and this feature's local plugin. New disposable fixtures were used throughout;
existing test data was preserved. Light and dark screenshots were inspected.

| Scenario | Observed result |
| --- | --- |
| Native / Worktree mode | Entry and exit render both navigation modes. |
| Add Workspace | Reproduced the old failure; fixed flow opens the configured browse dialog, cancels, and adopts a selected existing test directory without error. |
| Native create and import | Native New Worktree checkbox plus a real model turn creates a checkout; plugin candidate selector imports it and creates a borrower Session in that cwd. |
| Plugin creation | Branch search filters correctly; selecting a comparison branch creates the named Worktree and opens a Session. |
| Session fork | Forked from the Session menu; both Sessions appear under the same Worktree. |
| Empty Activity Bell | Opens, receives focus, and restores trigger focus on Escape. |
| Running Activity Bell | A real timer task appears with runtime, Workspace and branch context. |
| Unread completion | Leaving during execution preserves completion. Opening/closing the bell does not acknowledge it; selecting the entry navigates and clears its marker. |
| Sidebar scroll handoff | At 900 by 500 pixels, the inner scrollport stays bounded. A 220px downward wheel moves outer navigation 152px then inner content 68px; the inverse wheel restores both to zero. |
| Short viewport / theme | Dark popup stays inside the viewport. CSS anchor, computed text color and screenshot were checked. Automatic collapse and reopening preserve content. |
| Dashboard and Git | Overview and Git tabs work; changing comparison baseline displays one commit, +1/-1, and the expected source diff. |
| Instructions | Test instruction saves and appears in the overview. |
| Worktree archive | Confirmation, archived grouping and unarchive work; checkout and Sessions remain. |
| Native archive, original test corpus | Native cleanup reports failed and retains the checkout; the historical validation issue below is preserved. |
| Native archive, active borrower | In isolated storage, archiving the owner while its borrower remains unarchived returns `retained`. |
| Native archive, successful reclamation | Unarchive owner, archive borrower, then archive owner again: native result is `removed`, the directory is absent, and the UI automatically shows Worktree needs repair without refresh/reload. Sidecar retains the Worktree and active binding, with no diskCleanup marker. |
| Native keep-on-archive | A temporary startup overlay enables retention. A fresh native owner can be archived with its checkout still present; cleanup status is null because no attempt starts. Shared profile configuration is unchanged. |
| File preview | Without a suitable Session, the UI requests one; after creating it, Open in sidebar displays the file tab and exact source content. |
| Cleanup confirmation | The dialog names the checkout, explains irreversibility and lack of runtime checks, asks the user to ensure tasks stopped, and promises to retain Session history. Cancel closes it without removing the checkout; the Worktree can be unarchived. |

Follow-up in the built-in browser reused `~/.dsh-test` and the isolated overlay
on port 3088. Standard mode exposed the question tool: the sidebar and Activity
Bell displayed waiting-for-answer, navigating away retained the state, and the
bell returned to the question. Selecting blue and submitting restored running,
then completed with the waiting marker cleared.

A read-only `pwd` invocation with `sandbox_permissions: danger-full-access`
triggered the native one-time approval card. The sidebar and bell displayed
waiting-for-approval after navigating away; selecting the bell entry returned
to the approval. Allow Once resumed the command, then completion cleared the
marker and the bell showed no active sessions. The standing access mode remained
workspace-write. The model's final claim that no approval appeared contradicted
the observed UI and is not used as evidence.

True browser zoom passed in Arc after explicit user authorization to use it for
this case only. Native View-menu zoom controls and the visible percentage badge
confirmed 80%, 125% and 150%. At each scale the open Activity Bell remained
anchored below its trigger and within the page, including while changing zoom
with the panel open. The Dashboard baseline dialog stayed centered, fully within
the page, with its search, branch roster, close and footer controls visible at
all three scales. Cancel dismissed it without saving; zoom was restored to 100%
and the browser sidebar restored after verification. Screenshots were inspected
at every scale. This used actual browser zoom, not viewport resizing or CSS
scaling. The built-in browser shortcut attempts did not change its 1280 by 720
viewport or devicePixelRatio of 2 and are not counted as zoom evidence.
Automated coverage is not counted as UI verification. Destructive Clutch disk
cleanup was cancelled at its confirmation boundary, not executed. Native
archive-triggered removal was exercised successfully as described above.

## Test environment findings

A read-only replay found an existing historical unarchived Session incompatible
with rc.2 log validation. Native cleanup scans the entire unarchived corpus and
can fail when cold inspection reaches such a record. Original history was not
edited. The exact warning stack of the running cleanup attempt was unavailable,
so the reproduced validation path is distinguished from a captured runtime stack.

A separate test server used empty Session persistence, generic storage and
Clutch sidecar roots while retaining the test profile. Following explicit user
authorization for local login, native creation, import, borrower protection,
successful reclamation and repair projection all ran through the real UI.
Original historical data and the failed original fixture remain intact.

The shared-settings retention toggle was rejected by automatic approval, so the
retention case used a temporary startup overlay instead. No shared setting was
changed. The local authentication 401 responses occurred during login; no new
application runtime exception appeared in the final browser console check.
Test servers were stopped after verification. Test fixtures remain available,
and the test profile continues to link this feature package. No production
profile was modified.
