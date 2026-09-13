# Session reload compatibility review

Baseline: `wt-worktree-0.1.11/release`; feature: `wt-worktree-0.1.11/feat-fix-session-reload`.

The rc.1 dependency declares `SessionPersistence.list()` as returning headers, while
the current local upstream source returns lightweight snapshots containing `header`.
Keep both supported shapes and normalize once at the Host boundary, without casts,
transcript reads, or changes to Session membership. Run the same behavioral tests
against both shapes so cold lookup, live precedence, and data-boundary checks agree.

The feature also accepts known optional v4 development metadata. Preserve this existing
compatibility fix without claiming an instruction injection feature. The explicit key
allowlist and field validation remain strict; legacy schema validation is unchanged.
This is an amendment to the original relationship-only storage boundary for existing
development data, not a new metadata authoring API. Older v4 readers still reject these
fields. Validate serialization, unrelated disk writes, and conflicting repeat upserts.

Validation: package typecheck, lint, build and tests, plus workspace and patch checks.
