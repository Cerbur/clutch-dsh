# Session title template manager

Approved in conversation on 2026-09-06. Worktree: `wt-title-0.1.1/feat-template-manager`.

Add a localized Session Title settings section using DSH's native settings slot.
Keep the builtin default immutable. Users edit named YAML templates containing
`template` and `fields`, create/delete them, and choose the active template.
Disabling customization invokes the native first-prompt LLM title generator.
Existing titles change only through native refresh or subsequent eligible generation.

Persist the namespace `clutch-dsh-title` in `$DSH_HOME/settings.yaml`. Raw template
data must remain inspectable after external edits. Resolve each template separately,
show validation errors, and fall back to builtin default if the selected template
is invalid or absent. Never activate an invalid template. Malformed YAML documents
remain owned by DSH's file provider, which keeps its last readable document.

Use revision-fenced writes to prevent overwriting another browser or an external
edit. Validate saved template YAML with the existing config resolver, including
field definitions and references. Do not overwrite drafts on pushed invalidations.
Reuse DSH UI primitives; no shared code editor is exported in the inspected DSH
primitives, so provide a labeled multiline text input for YAML.

This extends the host-only MVP design with a browser entry and settings integration.
Keep source, tests, public bilingual documentation and screenshot within this package;
only dependency lockfile changes may touch workspace-level files. No commit or
release operation is authorized.
