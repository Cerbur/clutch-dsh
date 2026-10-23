# Immediate animation settings and preset cards

Supersedes the draft/Save/preview-gate and retain-on-delete decisions in
the earlier animation file-storage and selection-save plans. User requested
immediate import, deletion and selection, and a native preset-style card layout.

## Scope

- Import validates metadata/size and immediately writes and selects the script.
  Select immediately updates the active id. No Save/Discard or mandatory preview.
- Preview and export are independent per-card actions. Preview never changes
  the active id. Active cards show Current instead of the built-in/custom tag.
- Header: icon left, title and tag together, duration below. Divider, Preview
  and Export left, Delete right for custom cards only. Import lives top-right.
  Cards use compact spacing and an auto-fit grid with a 220 px preferred minimum;
  column count follows the available panel width, including below 220 px without overflow.
- Removing an inactive template preserves selection; active removal uses Emoji.
- Host first commits settings using revision CAS, then deletes removed hashes
  absent from remaining ids, live settings, and persisted Home/profile documents.
  Quoted YAML and legacy inline references are recognized. No arbitrary file or
  blanket orphan deletion. YAML parser is reused at the already locked version.
- Updates are serialized in the library instance. UI blocks overlapping writes
  (including asynchronous file reading); failures restore the authoritative state.
  Existing protection for real concurrent edits and one content-checked retry
  for revision-only changes remains. Other processes' manual config edits are
  outside this transaction; malformed/unreadable documents retain files with warnings.

## Verification

- Shipped-component tests: immediate selection/import, independent previews,
  per-card deletion, current fallback, failure state and absence of Save/Discard.
- Filesystem tests: actual unlink, same-source duplicates, cross-profile/legacy
  references, conflicts and visible cleanup errors.
- Full package build/tests, typecheck, lint, formatting, workspace/patch checks.
- 3088: 64 KiB import writes immediately; export matches bytes; selection persists;
  previewing another card preserves active choice; actual deletion removes bytes;
  refresh/restart recovery and real background tool use; clean up test references.

## Results

- Package build and all 87 tests passed, along with typecheck, lint, scoped
  formatting, whitespace, workspace and patch checks. The patch check retains
  the existing unrelated YAML `!!js dshHomePath()` warning.
- 3088 imported exactly 65,536 bytes without Save or preview. Exported bytes
  matched the import exactly. Choosing Aurora persisted `rings`; previewing
  the custom card did not change it.
- Deletion removed both the reference and physical hash file. Reimporting and
  restarting the real 3088 Host restored the selected script from disk.
- A real background `happy_fireworks` after restart displayed the custom
  animation and toast; clicking the toast opened the originating Session.
- Deleting the active test card after restart restored Emoji and physically
  removed its file. The parsed test profile then exactly matched the pre-test
  profile. Existing user templates and unrelated configuration were preserved.
- The installed card layout screenshot replaces the README's previous editor
  screenshot in both languages.
- Compact-layout follow-up: 3088 measured 4 columns at 1600 px, 2 at 768 px,
  and 1 at 390 px, with no horizontal overflow. Typical card height is 117 px
  (wrapped rows may be taller). Build, lint and scoped formatting passed.

## Import/delete confirmation follow-up

The latest user request supersedes immediate import and one-click deletion above.
Selecting a file now validates size/header plus syntax, render entry and one bounded frame in
an opaque iframe/Worker without saving. Valid imports show the same card details in a native
confirmation dialog, with optional full-screen preview/export. Confirm Add writes and activates;
Cancel and Escape discard the staged source. Known full-preview failures block adding until a
successful replay. Failed saves retain the staged source for retry. No independent Save step.
Deletion first turns the card red and exposes Cancel/Delete below its red Delete action; only
confirmation updates settings and invokes the existing reference-aware physical file cleanup.
Compact responsive cards and immediate selection remain unchanged.

### Follow-up verification results

- `pnpm test`: build and all 96 tests passed. `pnpm run typecheck`, `pnpm run lint`,
  scoped `pnpm exec prettier --check`, and `git diff --check` passed.
  Root `pnpm run check:workspace` and `pnpm run check:patches` passed (the same
  pre-existing YAML `!!js` tag warning remains).
- Computer use on 3088 rejected missing headers, syntax errors, missing render entry,
  a nonterminating frame, and 65,537-byte files with error dialogs. A 65,536-byte
  valid script opened the confirmation dialog; preview and export did not persist.
  Exported bytes matched exactly. Cancel and Escape left the profile byte-identical
  to baseline and created no script file. Full preview caught a later-frame error
  and disabled confirmation; cancelling allowed a new valid import.
- Confirm Add persisted exactly 65,536 bytes with mode 0600, activated the new card,
  and survived an actual 3088 Host restart plus page reload. Real background
  `happy_fireworks` calls completed; the toast opened the originating Session.
- Delete first exposed red card/inline Cancel/Delete without unlinking. Cancel
  retained the template. Confirmation physically removed its script; active removal
  restored Emoji, inactive removal preserved Aurora. Import, confirmation, cancellation
  and deletion were exercised again after restart. Test references were removed and
  the original active choice restored; pre-existing templates/files were preserved.
- Responsive browser measurements: 1600/768/390 px gave 4/2/1 columns with no
  horizontal overflow. The 390 px confirmation dialog fit within x=17..373; Escape
  cancelled it. The viewport override was reset afterward.
- README screenshots show the real import dialog and red inline delete confirmation.

## Typography and light/dark theme follow-up

- Supersedes the original inline title/tag placement: names, duration and tag now stack
  vertically inside the shared card-details renderer, including the import dialog.
  Titles truncate to one line with native full-name hover tooltips; the 220 px auto-fit
  grid remains compact and responsive.
- Centralize settings/dialog text, surface, border, error colors and typography sizes/weights
  in the settings stylesheet. Replace undefined `--dsw-alias-text-*` references with DSH's
  supported `--dsw-alias-label-*` aliases; remove dark-only fallback colors from dialogs.
- Match Agent Preset Tag's 11 px/17 px capsule and outline/solid palettes. Current selection
  uses label-primary fill with bg-layer-3 text; primary buttons use native DSH fill/foreground.
- Verify light/dark cards, selected tags, valid import dialog, preview, invalid-file dialog,
  long title tooltip/ellipsis and responsive widths in the real 3088 browser.

### Theme verification results

- `pnpm test` passed all 96 tests. No new CSS-mirroring unit tests were added;
  visual regression was checked against the real 3088 UI and its computed styles.
- Before the fix, the light selected tag used white text on `rgb(238,238,238)` because
  `--dsw-alias-text-primary` was undefined. It now uses the native Agent Preset solid
  palette: contrast 18.9:1 in light mode and 11.57:1 in dark mode.
- Light dialog title/name contrast is 18.9:1 and body text 5.8:1. Dark dialog title
  contrast is 11.57:1 and body text 8.03:1. The dark error color was additionally
  mixed toward the primary label to improve contrast from 3.68:1 to 4.55:1.
- Native Agent Preset tags were inspected in the browser: same 11 px font, 17 px line
  height, 1 px/8 px padding and solid/outline colors. Tag rows reserve the same height
  on all cards so the action dividers stay aligned.
- Both themes passed valid-file confirmation, preview/cancel and invalid-file dialogs.
  The long title is a single-line ellipsis, retains its exact full `title` attribute,
  and lays out above duration and tag in both cards and the shared dialog renderer.
- 1600/768/390 px widths showed 4/2/1 columns without horizontal overflow. The
  390 px dialog fit x=17..373 with a truncated title and intact full-name tooltip.
- Temporary imports were cancelled; the original active animation, existing scripts,
  Follow System appearance preference and original viewport were preserved/restored.

## Fixed footer, circular progress and missing-file recovery

Supersedes the expanded deletion panel, preview-status paragraphs, and previous name/time/tag order.

- Shared card details are now name/tag/time. The existing 40 px action footer is replaced
  in place: prompt left, Delete then Cancel right. Cancel occupies the original Delete position;
  there is no added row. English uses the short prompt `Confirm delete?`.
- Preview becomes a circular SVG progress/stop control, started on the first painted-frame
  acknowledgement and advanced with CSS for the configured duration. Completion/cancel/error
  clears it; async preview reads cannot outlive cancellation/unmount. Remove the explanatory
  preview paragraph and the textual playback-status paragraphs from cards and import dialogs.
- The v2 file manifest retains small name/duration metadata; old path-only settings are
  backfilled while readable. Runtime preferences keep unavailable ids separate from scripts.
  Missing/corrupt selected files persist Emoji using revision CAS, retaining the card/list entry.
  Broken cards stay readable and provide deletion only. Reads/writes share one queue, recovery
  retries a CAS conflict once, and read-only/write failures report why fallback could not persist.
- Cached JS cannot recreate a deleted existing id. Unchanged sources reuse their old reference,
  closing the preflight/CAS deletion race. New imports can still repair bytes under a new id.
  Other edits retain unavailable entries and limits include them. Settings refresh availability
  every two seconds while visible and on focus, plus before preview and live launch.

### Full-flow acceptance

- Final copy cleanup removes the redundant import-limits paragraph beneath the grid and the
  Export action from the pending-import dialog. Saved cards retain Export; pending imports
  offer Preview only before Confirm Add.

- All 105 tests passed, including physical deletion, corruption, restart, retained metadata,
  broken-list cleanup, stale cached sources, deletion during preflight/CAS, recovery conflict,
  read-only/write failure and circular preview accessibility. Build, typecheck, lint, formatting
  and workspace checks were run for delivery.
- Real computer use on 3088 verified invalid-file rejection; 65,536-byte import; circular
  preview/stop; byte-identical export; cancellation without persistence; Confirm Add and activation.
- Deleting the active disposable script on disk caused automatic Emoji selection and persisted
  `active: emoji`, retaining its original name/duration in a delete-only broken card. An actual
  Host restart and page reload retained that state. A real `happy_fireworks` after restart
  succeeded with Emoji; its toast opened the originating test Session.
- Removing the broken card cleared its reference. Reimport, selection, cancellation and deletion
  were repeated after restart. Deleting the inactive healthy test card preserved the selected
  original animation and physically removed the hash file. The final animation manifest matched
  the pre-test manifest (including original ids, paths and newly backfilled display metadata).
- At 1600/768/390 px, grids used 4/2/1 columns without overflow. Every card was 137 px high;
  confirmation preserved all grid-relative rectangles exactly and the footer stayed 40 px.
  The original Delete x-coordinate exactly matched confirmation Cancel. Both light and dark
  previews/footers were exercised; the original Follow System preference and viewport were restored.
