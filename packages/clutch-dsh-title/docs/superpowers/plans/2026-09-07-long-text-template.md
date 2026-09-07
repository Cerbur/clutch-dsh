# Long first prompt and referenced fields

**Goal:** Generate titles from long first eligible prompts and extract only fields
referenced by the compiled template on `wt-title-0.1.2/feat-optimize-long-text-template`.

## Design and decisions

All field definitions still inherit and pass existing configuration validation.
A shared selector reads compiled field segments in first-reference order and
deduplicates names. Provider deterministic resolution, LLM dispatch detection,
system instructions and response validation consume that selection. No dynamic
references means no model route lookup, model call or LLM request event.

Input strategies considered:

- Head only is simple and keeps introductory context, but loses the final request
  when a prompt starts with pasted instructions, logs or source material.
- Tail only keeps the final request but loses the subject and opening context.
- Head and tail preserves both at the cost of losing middle details. Use this
  default because DSH supplies one eligible message as `{ seq, text }`, without
  semantic sections that could support a reliable structural prioritization.

Keep short framing byte-for-byte unchanged. For overflow, trim outer whitespace and reserve the existing
framing and JSON envelope plus `\n[...middle omitted...]\n` inside text and
`truncated: true` on the serialized entry. Allocate half the remaining escaped
UTF-8 byte budget to each end; spare capacity may be used by the other end.
Walk whole Unicode code points, accounting for JSON escaping per point; do not
split surrogate pairs. This does not guarantee preserving grapheme clusters.
Require at least one non-whitespace source code point at each end. If that cannot
fit, fail with a maxInputBytes error before dispatch or logging. Validate the
complete final JSON-framed user input against maxInputBytes (default 4096), not
the source text alone. System instructions and transport envelopes are outside
this existing input-budget contract.

Only the first eligible message is used. Clipping never mutates session messages,
adds model calls or reads later conversation. The event and model call share the
same actual clipped payload and preserve the original seq. Native rename pin,
refresh, cancellation, timeout and stale-result protection remain authoritative.
Missing middle context can reduce title accuracy; no summarization is attempted.

## Implementation and validation sequence

- [x] Add extractor and composition regressions for referenced-only fields,
      repeated references, deterministic-only templates, and invalid unused fields.
      Run them against the baseline and confirm the unwanted requests/failures.
- [x] Add long-input regressions covering Chinese, emoji, escaped characters,
      exact/adjacent byte budgets, tiny budgets, source preservation and request logs.
      Confirm overflow fails on the baseline.
- [x] Implement a shared compiled-template selector in fields.ts and consume it
      in provider.ts and extractor.ts without altering config validation.
- [x] Implement bounded input framing in input.ts and wire the extractor to it.
      Preserve short framing and existing failure/cancellation paths.
- [x] Update both README files and link this amendment from original design/plan.
- [x] Run package test (including build), typecheck, lint, formatting, workspace
      and patch checks. Review diff and commit one scoped change. No merge, push,
      version change, pack or publish.

This amendment supersedes the original plan's all-configured-fields extraction
and unconditional overflow failure. Routine choices proceed under the user's
explicit implementation authorization; the final work is committed together.

## Verification record

- Installed with `pnpm install --frozen-lockfile`; the initial worktree had no dependencies.
- Regression run before implementation: six expected failures reproduced unwanted
  extraction and input-overflow fallback. Short-input exact-budget behavior passed.
- `pnpm --filter @cerbur/clutch-dsh-title test`: 74/74 passed, including build,
  Unicode/escape byte boundaries, native fallback and in-flight rename protection.
- `pnpm --filter @cerbur/clutch-dsh-title typecheck`: passed.
- `pnpm --filter @cerbur/clutch-dsh-title lint`: passed.
- `pnpm exec eslint packages/clutch-dsh-title/test/{composition,extractor,input}.test.mjs`: passed.
- `pnpm run check:workspace` and `pnpm run check:patches`: passed. The latter
  retains the existing unresolved `!!js` YAML tag warning.
- `pnpm exec prettier --check` on every changed source, test and Markdown file,
  and `git diff --check`: passed.
- One full run observed a transient failure in the existing settings file watcher
  test (the expected row was absent after a document update). The focused rerun
  and subsequent full suite passed; no settings persistence code was changed.
- Native automatic scheduling waits for a request header even for deterministic
  templates. Tests preserve this contract and separately verify route-free refresh.
