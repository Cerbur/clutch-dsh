# Registration dropdown and tab motion repair

Branch: `wt-worktree-0.1.18/fix-remote-baseline`.
Baseline: `672313a` (the earlier Desktop dependency fix remains intact).

## Evidence and feedback loop

The supplied `录屏2026-10-13 下午6.01.05.mov` declares 120 fps with variable
frame timestamps. Cropped frame sequences around the first dropdown opening and
tab switch were reviewed at 16.7 ms intervals, with the tab disappearance also
examined at 8.3 ms intervals. The dropdown reserves maximum height before
shrinking to its loading state. The tab switch visibly removes the overlay and
then fades in the next form.

The deterministic registration test exercises the real state/action/dialog
composition and captures React's element key. Before the fix, switching to
Import changed the shell key from 1 to 3. The regression requires stable shell
identity across tabs, preserved form values, rejection of prior-tab callbacks,
and a fresh shell on batched close/reopen.

An isolated Chromium fixture uses real React and the production registration
and selection components/CSS, with upstream native Modal/MenuSurface and their
CSS/focus lifetime. Input/Button/icon adapters and deferred manager reads are
fixtures; no production Desktop or profile is started or modified.
`requestAnimationFrame` samples distinguish preparing, pending and ready phases.
The original CSS fails the browser assertion with heights
`[302.5, 302.5, 214, 214, ...]` while still loading. Before the tab fix, the old
Modal DOM disconnects and the replacement's opacity is approximately 0.26
50 ms after switching.

## Change

- Remove the preparing-only forced viewport height. Preparation and an empty
  pending roster share natural compact sizing. Ready content sizes naturally
  within the existing 220px/available-space cap. Embedded picker sizing,
  deferred candidate reads, virtualization and retained-row refresh behavior
  remain unchanged.
- Separate the registration shell lifetime from branch callback generations.
  The state owner advances shell lifetime synchronously on open/close;
  tab changes still invalidate callbacks but only key the picker body.
  Manager/Workspace replacement can renew the shell. Retry and tab switches
  retain the native Modal and overlay DOM, avoiding repeated entry animation.

## Verification

Run the focused seam from the package directory:

```bash
node --test test/client-registration-branches.test.mjs test/client-single-select.test.mjs
```

Browser assertions pass for one and thirty branches. Preparing and pending
height is consistently 214px in the fixture. One result uses a 114px roster;
thirty results use the 212.5px budget available in that viewport. Four consecutive
Create/Import switches preserve both Modal and overlay DOM, keep opacity at 1,
and retain a typed Worktree name. These dimensions describe the test fixture,
not fixed product dimensions or a live Desktop deployment.

All required gates passed from the worktree root: `pnpm run check:workspace`,
`pnpm run check:patches`, package `lint`, `typecheck`, `build` and `test`.
The full test command reports 1108 passing tests and zero failures. Package
`node --test test/readme-parity.test.mjs`, the focused 49-test run, documentation
format checks and `git diff --check` also pass. The browser check was driven with
Playwright CLI's `run-code --filename` against the isolated local fixture; the
fixture server and its dedicated browser session were closed afterward.

The public behavior is documented in both README languages and the Client seam
document. This change does not alter Host/Remote, Git behavior, Sidecar or native
Session/Workspace ownership.
