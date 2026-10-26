# clutch-dsh-office

Follow the repository AGENTS.md and docs/RELEASING.md. This plugin is strictly
plugin-only: never modify DeepSeek Harness source or patch its private DOM to
provide an Office feature. The DSH checkout is a read-only integration reference.

- Package: `@cerbur/clutch-dsh-office`; release name: `office`.
- Initial MVP work is authorized directly in `wt-office-0.1.0/release`.
- Subsequent features use `wt-office-<version>/feat-<name>` from the matching
  release baseline, with the repository clean/rebase/merge gates.
- Commit, push, publish, and installation into a user's DSH profile still require
  explicit authorization. No such authorization is implied by this document.
- Read both READMEs and `docs/plans/2026-10-26-office-mvp.md` before behavior changes.
- Keep DSH adaptation, Office projection, action scheduling, and Three.js rendering
  separate. Never retain or activate Sessions just to draw a character.
- Runtime session facts stay native; the Office projection is disposable Client
  presentation state. No extra model requests, prompt injection, or Session-log writes.
- MVP renders every native workspace in a single vertical list, at most two active
  Session characters per kitchen. Idle kitchens remain visible without characters.
  Unknown/disconnected state must not be presented as successful completion.
- All public behavior changes update README.md and README.zh.md together.
- Do not commit lib/, node_modules/, browser fixtures' generated output, or credentials.
