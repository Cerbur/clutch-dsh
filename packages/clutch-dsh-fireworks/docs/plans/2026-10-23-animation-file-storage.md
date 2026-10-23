# Animation file storage

Storage format remains current; draft/Save and retain-on-delete behavior below
is superseded by [immediate settings](2026-10-23-immediate-animation-settings.md).
That plan also records confirmed imports/deletes and damaged-file recovery. The
[animation playback plan](2026-10-22-animation-templates.md#configuration) requires
a fresh Host settings/file read before every queued event starts, preserving only
the active event's captured bytes rather than reusing batch-time caches.

Replace inline source persistence with a version-2 index of immutable scripts
under DSH Home. Keep the editor's runtime `{ active, scripts }` representation
and the existing Worker/renderer contract. This supersedes the original inline
storage decision; it reduces configuration size without adding an asset server.

## Implementation boundary

- Browser imports and previews are drafts. Only Save writes files.
- Host uses injected `dshHomePath`, private hash-named files, bounded reads,
  checksum/path validation, and owner-only native Remote methods.
- Write files before updating only the volatile `animation` field through the
  settings provider with `expectedRevision`; never overwrite old referenced bytes.
- Read legacy inline settings, migrate on save, retain files when references
  are removed. Missing/corrupt selected files report recovery instructions and
  fall back to Emoji. Garbage collection is outside this change.

## Verification

- Unit coverage: migration, deduplication, restart hydration, retained files,
  stale/concurrent writes, readonly/cancellation, malformed/unsafe paths,
  checksum/size/symlinks, independent homes, browser load/save lifecycle.
- Real Cordis Gateway coverage: owner access, request codecs, native load/save,
  revision conflicts and plugin disposal.
- Package build, typecheck, lint, complete test suite and formatting checks.
- DSH at port 3088 with `DSH_HOME=~/.dsh-test`: legacy load, save migration,
  import/preview/save, inspect relative-only config and private JS file,
  refresh/restart hydration, and real tool playback with toast navigation.

## Results

- `pnpm test`: build and all 75 tests passed. `pnpm run typecheck`,
  `pnpm run lint`, scoped `pnpm exec prettier --check ...`, and
  `git diff --check` passed. Workspace `pnpm run check:workspace` and
  `pnpm run check:patches` passed; the latter retains an existing warning
  about an unrelated `!!js dshHomePath()` YAML tag.
- On 3088, reading/previewing legacy settings created no animation directory
  and did not modify the profile. Save reduced the test profile from 38,811
  to 4,131 bytes; both original scripts matched their new files exactly,
  with SHA-256 names and mode `0600`.
- A 65,536-byte imported Canvas Show fixture passed preview and saved byte
  for byte. Its reference added only 153 bytes to the profile. Refresh and
  a real Host restart restored the selected template from disk.
- Real `happy_fireworks` calls after restart mounted the animation surface
  and toast; clicking the final toast opened the originating test Session.
- Temporarily moving only the new test fixture produced a visible recovery
  message and Emoji fallback. Restoring it and clicking Retry restored the
  template. The fixture was then removed from settings; its file was retained,
  and the original two templates and Canvas Show selection were restored.
- A stale revision was refused during browser testing without losing the
  draft. Reopening settings and saving with a fresh revision succeeded;
  subsequent saves in the same page also succeeded.
