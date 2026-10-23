# Plugin icon

Worktree: `wt-fireworks-0.1.5/feat-plugin-icon`.

## Scope

Add an original, transparent SVG inspired by a party-popper emoji: an upright
golden cone, purple bands, and colorful ribbons and confetti spreading upward.
Keep the silhouette readable at the plugin manager's small display sizes and
on both light and dark backgrounds.

The existing Emoji animation card uses the literal `🎉` character in
`src/client/AnimationSettings.tsx`; retain it and all animation behavior.
This adds package display artwork beyond the original emoji-only MVP scope.

## Integration

- Export `./icon` as `./assets/icon.svg` from `package.json`. The existing
  `files: ["lib", "cordis.patch.yml", "assets"]` includes this resource.
- DSH's `packages/boot/app-boot/src/package-meta.ts` reads the exported icon
  without evaluating the plugin and embeds it as an image data URL. Both the
  bundle and its package-root plugin entry can resolve this resource. No DSH
  source changes, runtime registration, or additional dependencies are needed.
- Retain the existing package name and description as display-text fallbacks.
- Update both READMEs and refresh their screenshot references from user-supplied PNGs.
- Reinstall the local package after changing its manifest, then restart DSH to
  refresh installed metadata. Installation and release operations are outside
  this change.

## Verification

Check Node's self-referencing `./icon` resolution, XML validity, package ownership
and the 256 KiB DSH limit. Render the SVG at small and large sizes on light and
dark backgrounds. Run workspace/patch checks and package checks when dependencies
are available. Do not run `npm pack` in this feature worktree.

Completed on 2026-10-24:

- Node self-reference resolves `@cerbur/clutch-dsh-fireworks/icon` to the local
  asset. XML parses successfully; the 1883-byte SVG is within DSH's limit and
  the existing `assets` publication entry covers it.
- Native SVG previews checked on light/dark backgrounds at 40, 32, 24 and 16 px.
- `pnpm run check:workspace`, `pnpm run check:patches`,
  `pnpm --filter @cerbur/clutch-dsh-fireworks typecheck` and
  `pnpm --filter @cerbur/clutch-dsh-fireworks build` passed.
- `node --test test/package-manifest.test.mjs` passed all four existing tests.
  Prettier checks for the changed Markdown/JSON and `git diff --check` passed.
- User-supplied installed-DSH screenshots show the new icon on the plugin details
  page. This is supplied visual evidence, not an independent live-app test.

## Screenshot refresh and template name

The user supplied three 3248 × 1970 PNG captures and authorized resizing for
faster loading. Keep PNG format and aspect ratio, using 1600 × 970 images:

- `assets/screenshots/screenshots-zh.png`: whale fireworks and celebration toast.
  Reuse this path so both root READMEs receive the updated preview as well.
- `assets/screenshots/animation-settings.png`: the new plugin icon, built-ins,
  an active imported animation, and the expanded AI generation prompt.
- `assets/screenshots/animation-import-confirmation.png`: import confirmation.

List exactly these three images in `screenshots.json` and both package README
feature tables. Remove the MVP illustration reference, the previous separate
toast capture reference and the obsolete toast-styling caveat from those tables
and usage text. Remove the two obsolete screenshot assets and update earlier
plans to reference the current PNG without relabeling their historical acceptance.

Rename the built-in template to `鲸跃烟火 · Whale Show` in its script header and
current documentation. Preserve `classic`, 5000 ms, rendering and saved selections.
The supplied screenshots retain their original pixels apart from downscaling;
they were captured before the name change.
