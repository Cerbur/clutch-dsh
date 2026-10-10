# Agent Worktree tools: research and implementation

Research date: 2026-10-04. Target branch: `wt-worktree-0.1.17/feat-worktree-tool`.
The requested DeepSeek Harness checkout is at
`4878cdabd87d4041bdaff61d04c966883b9fd07a`; its package graph is
`0.2.0-rc.1`. The plugin version stays unchanged for release aggregation.

## Feasibility and upstream seams

This feature uses existing plugin extension points without DSH core changes.
Relevant source files under the requested DSH checkout:

| Source                                            | Evidence and use                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/interaction/commands/src/index.ts`      | Native slash-command registration receives the exact calling Agent, raw input and cancellation signal.                          |
| `packages/core/tools/src/index.ts`                | Agent-scoped registrations contribute to the native and PTC catalogs and are removed with their Cordis fiber.                   |
| `packages/api/session-controller/src/commands.ts` | `create({ cwd })` creates an ordinary Session; `prompt` performs normal admission and returns acceptance.                       |
| `packages/api/session-controller/src/types.ts`    | Prompt admission requires a request identity, Session identity, queue/steer mode and nonempty content.                          |
| `packages/api/remotes/src/remote-events.ts`       | Generic forwarded Host events use an application-owned fixed allowlist; plugin-specific notifications cannot assume forwarding. |

The implementation uses an optional `commands/tools/sessionController` composition,
scoped tool and system-prompt registration, the existing Manage implementation, and a cancellable notification
endpoint on the existing `/api` Connection. Structural Host ports prevent Host SessionStore
declaration merging into the Client Session Context graph. Tests exercise real DSH registries.

## Delegation behavior (2026-10-09 amendment)

The internal `src/tool/` module owns the tools, with one file per tool containing its input,
output, description and handler. Shared context, native Session access and read-only status
projection stay in adjacent helper files; Host only composes it. Native command execution and model
prompt assembly verify all six delegation tools and the delegated-Agent report tool. Activation uses DSH's native command lifecycle and a concise capability-count acknowledgement.

2026-10-10 presentation amendment: native Chat considers an ordinary command Node insufficient
to leave the blank-session Hero, while `/compact` receives a separate active Node kind.
The browser contributes a private Conversation activity target matching only
`command/run` for `cluworktree`, activated on already-retained Session bindings.
This displays DSH's existing command row immediately without opening a model Turn,
rewriting Session metadata, or adding transcript events. Errors, repeated invocation,
history replay, binding generations and plugin disposal use the same native lifecycle.

1. `/cluworktree` validates native Workspace membership or exactly one active Sidecar binding.
   Unknown ownership is rejected; cwd alone never establishes Project identity.
2. General preferences select a subset of the six tools: `clutch_new_worktree`, `clutch_list_worktrees`,
   `clutch_span_worktree`, `clutch_list_models`, `clutch_list_sessions`, and `clutch_send_message`.
   Repeated invocation adds only missing registrations, including those already automatically injected. The command accepts no arguments and is registered only while General is enabled.
3. `clutch_new_worktree({ name, baseBranch?, instructions? })` creates a new branch from
   the calling Session's healthy active Worktree branch, or the root checkout's current branch
   when its physical cwd matches Local/Main. An explicit local base overrides this. Broken
   bindings never silently select Main. The Host captures the calling checkout's HEAD before
   creation, including detached root HEAD; detached sources omit `baseBranch`. The transaction pins the captured
   commit when creating a new branch; uncommitted files are not copied. It then saves optional shared
   instructions. It returns the Worktree identity and path and creates no Session.
4. `clutch_span_worktree({ worktreeId?, name?, prompt, model?, title? })` resolves an exact active, healthy managed target
   within that Project, creates a native Session with its ordinary creation-time cwd,
   binds it, configures the initial model, optionally renames it through the native API, enables only fixed-destination reporting and reporting guidance by default, and
   admits the exact prompt in queue mode. Prefer the stable id; specify exactly one id or name.
   It returns the native Session identity, selected model, request id and stage after admission,
   without waiting for model execution or changing the current UI focus.
5. Failure after creation preserves entities. Instruction failure returns
   `instructionsSaved: false`; dispatch failure returns `binding-failed` or
   `model-failed`, `title-failed`, `reporting-failed`, or `prompt-failed` with the native Session id.
   Retrying dispatch creates another Session. After successful binding and model setup,
   `clutch_send_message` can retry a failed prompt using the returned request id.
6. Existing Session metadata, Workspace members, messages and history are never rewritten.
   Normal new-Session preset and permission policy apply; the plugin does not grant
   Full Access. Native command/tool/prompt lifecycle logging remains DSH-owned.

The name `clutch_span_worktree` is retained exactly as requested.
Activation is runtime-only: run the command again after Agent resume/restart or plugin reload.
Dispatched Sessions are enabled automatically before prompt admission. Nested Agents inheriting a parent tool catalog
cannot execute these registrations because the body checks the exact caller.
There are no merge/publish/remove/cleanup tools and no native parent/subagent lineage.

`clutch_list_worktrees({ workspaceId? })` returns managed facts and local branch candidates;
Git failure is reported as `branchesUnavailable` while preserving a sidecar-supported list.
`clutch_list_sessions({ workspaceId?, worktreeId? })` discovers existing native Sessions and
relations, including unavailable diagnostics without loading unauthorized history. Explicit
Workspace ids must equal the calling Workspace. Every send/report target is reauthorized
against native membership, active binding and physical cwd; detached or mismatched relations fail.
Native message admission always passes the strict Manage runtime-cwd/Workspace gate, including
when the root is missing. Healthy archived Worktrees keep active bindings and allow follow-ups;
only fresh dispatch requires an active Worktree.

Model discovery uses the native catalog, with optional provider filtering and reasoning efforts.
An omitted dispatch model inherits the caller's effective selection. An unavailable route or effort
fails before creation. The Session port installs creation-only outer `system-prompt/assemble` and
`agent/request` waterfalls on the new Agent. It does not append raw events or call native
`selectModel`, which also saves the deployment default. Native `request/header` commits the actual
route; the override is then disposed and native history owns restore. A native model change also
disposes it. Before the first header, the override is runtime-only and a restart discards it.

`clutch_read_session` and `clutch_wait_sessions` were removed after the exported Session trace
showed 76 reads and 50 waits returning 473,192 text characters combined. Even event-based waits
created repeated model calls and transcript context. Lists remain for discovery and explicit
status questions, not monitoring. A legacy `discuss/mode` migration error is isolated to that
Session's unavailable diagnostic instead of aborting the list. No source log is modified.

Activation installs scoped `systemPrompt.section` guidance: infer delegation from user intent,
create isolated Worktrees for independent tasks, use returned stable ids, inherit base/model unless
overridden, then acknowledge admission and end the turn while reports arrive. Continue only
separate independent work already requested by the human. Do not substitute native agent lists,
terminal Git/file checks, tests, edits or commits for removed monitoring tools. Progress/investigation
requires an explicit human request; concrete admission failures permit targeted recovery.
Evaluate supplied report evidence without routinely rerunning checks; further verification requires
a human request or a concrete evidence gap/inconsistency.
Model guidance explains default inheritance (including effort), explicit catalog-backed selection
for user model/task-based requirements, and disabled-discovery handling without invented routes.
Critical handoff and model rules are shared by the scoped section and native tool descriptions.
DSH's minimal persona has `complete: true`, so it intentionally drops extra prompt sections.
The plugin preserves that contract instead of concatenating text onto the complete system prompt;
native tool descriptions still convey the rules, and PTC SDK rendering retains those descriptions.
Schemas omit `$schema`; target alternatives expose exact-one id/name validation, all fields explain
source/default/limits. Error bodies identify the reason and a corrected call; partial creation
failures preserve identities and describe repair. No tool grants permissions or answers approvals.

The subsequent native/PTC smoke run completed dispatch, three pushed reports and continuation,
but both delegates first omitted report `status`. The PTC `ToolArgs` entries had degraded to
`unknown`: Zod's `minLength`, `maxLength` and `anyOf` exceed DSH's SDK schema vocabulary.
`src/tool/schema.ts` now projects lengths into descriptions (still enforced by the original
Zod parser) and converts only disjoint closed-object unions to supported `oneOf`. Unsupported
keywords and overlapping alternatives fail explicitly. Report guidance names required status
and summary. Regression tests use DSH's real schema validator and TypeScript SDK generator for
all seven tools, checking required/optional fields and preserving strict runtime rejection.

`clutch_send_message({ sessionId, prompt, mode?, requestId? })` defaults to queue; steer uses
native step-boundary admission. New messages get independent ids, while an explicit id retries
the same message through native deduplication. Native failures return `prompt-failed` with the
retry id even when acceptance is uncertain. Acceptance is not execution or task completion.

`clutch_report_result({ status, summary, evidence?, requestId? })` is registered only for newly
delegated Agents. Its fixed destination lives in the Agent-scoped registration closure; no native
lineage or Sidecar task facts are written. Before admission, both source and recipient are
reauthorized in the same Workspace, including binding, physical cwd and the strict root gate.
The report is a normal queued native message with a Host-authored source id and the Agent's
completed/blocked/failed claim. Summary and evidence are each capped at 2,000 characters.
Reports are model-driven and may not arrive after crashes/stops or while awaiting human input.
They are claims requiring verification; no turn/end listener invents task success. The caller
must not auto-reply to each report. Follow-up work can send a fresh report. Admission failure
preserves requestId for identical retries. Plugin/Agent restart removes routing and guidance;
a resumed Session may enable `/cluworktree` and manually use `clutch_send_message` with the known
delegator id. Existing Sessions are not retroactively assigned a reporting destination.

## Tool preferences (2026-10-10 amendment)

General, per-Workspace Local/Main and per-Worktree switches default to off. Each selection normalizes the final
deselection to disabled. Settings show localized capability names and descriptions, without
internal tool names. General controls command discovery and activation; Worktree selection
controls automatic injection independently. Local/Main has a separate Workspace-scoped selection,
which applies only to native-member Sessions at that Workspace root with no Worktree binding.

Host preferences live under `clutch-dsh-worktree/tool-settings/general.json` and
`tool-settings/worktrees/ws-<encoded-workspace-id>/wt-<encoded-worktree-id>.json`.
Local/Main preferences use `tool-settings/locals/ws-<encoded-workspace-id>.json`.
Local preference access validates the native Workspace identity without reading relationship shards.
Each versioned file contains only an enabled flag and the selected capability ids.
They never share relationship shards or native Session metadata. Updates use a Host-local
serialized queue, expected-value conflict detection, writable-handle fsync, atomic rename and
best-effort directory sync. Invalid files remain untouched; a missing file is an off selection.

The Agent-scoped catalog incrementally registers missing capabilities and rolls back a failed
addition without losing previous registrations. A prompt-assembly middleware selects Local/Main preferences
when there is no binding, or the active Worktree's preferences when bound. Detached or ambiguous
bindings never fall back to Local. It verifies native ownership, physical cwd and Worktree availability before injection; this handles binding
after Agent creation and restoration after restart. Native assembly collects providers before
its waterfall, so a changed registration triggers one fresh assembly with an invocation-local
recursion marker before any model request. This includes schemas, the PTC SDK and delegation
guidance from request 1, instead of adding them at pre-step for request 2. Concurrent assemblies
refresh independently and ordinary downstream transformers run once on the fresh result.
Existing registrations persist to Agent
disposal. Preferences do not trigger Workspace list refreshes.

Delegated Agents receive only `clutch_report_result` and reporting guidance by default.
Explicit Worktree preferences can add selected delegation capabilities before prompt admission;
`/cluworktree` adds the General selection without replacing fixed-destination reporting.
Reporting destinations remain runtime-only. This supersedes the original all-tools child policy.

The 2026-10-10 real-session timing correction supersedes pre-step tool injection:
in a real-session reproduction, the initial system message at seq 10
had no Worktree tool text, while seq 29 at step 2 added it. The deterministic regression follows
the native assemble-before-pre-step order and requires equal first/second request assemblies.
Guidance also makes create-and-fix requests create-and-delegate by default, moving dependency
setup, edits and checks into the delegated Session. Enabled plugin tools take preference over
competing Worktree/Session tools unless the user explicitly chooses another workflow.

## Historical Session cwd compatibility (2026-10-10)

The real historical Session failure was reproduced through native prompt assembly with a
real Git checkout, Sidecar and Manage instance. A root-only historical record is projected
to the Workspace subdirectory while DSH retains its immutable Git-root Session cwd.
Automatic injection rejected that valid active binding before the first model request.
HEAD capture independently rejected the same relation, so changing tool authorization alone
would leave default Worktree creation broken.

Permission checks, tool authorization/default-base selection and Manage HEAD capture now share
the Provider's physical cwd rule for already-active bindings: the Workspace directory or that
record's exact Git root. New bindings still require the Workspace directory. No native header,
history or legacy path record is rewritten; HEAD is read from the authorized Session cwd.
Tests cover old and explicit path records, native/PTC first and repeated assemblies, discovery,
continuation, reports, default creation from a checkout ahead of Main, aliases and archived
follow-ups. Foreign ownership, sibling directories, missing/escaping paths, unbound/detached/
cleaned relations and the Workspace-root write gate remain rejected.

Focused reproduction and regression command (after building the package):

```bash
node --test --test-name-pattern='legacy Git-root|legacy compatibility' test/worktree-tools.test.mjs
```

## Notification and refresh design

`watchToolChanges({ afterRevision }, signal)` waits at most 20 seconds and returns a
runtime revision and coalesced Workspace/Worktree identities. At most one latest notification
per Workspace is retained. It is an invalidation feed and is never written to Sidecar.
Cancellation and Host disposal release waiters.

The Client owns one shared long-poll. Each change invalidates only its owning Workspace's
reader generation. Matching Context and visible Surface share the replacement read.
Surface refresh sets `alreadyInvalidated` and preserves all ready views.
A connection failure retries after five seconds. Connection reset cancels the old poll and
starts from revision zero, so a restarted Host cannot reuse an old cursor. Client disposal cancels both requests and
backoff. Without new changes, there are no Git or Worktree-list reads.

## Plan amendment and verification

This extends the bootstrap plan's UI-only Session orchestration with a Host command path.
The 2026-10-09 amendment adds the delegation feedback loop to that command path.
The data boundary is retained: native creation, model request headers, rename and admission are DSH-owned; the Provider port
stays read-only; only binding and Worktree instructions are plugin-owned persistent facts.

Regression coverage includes DSH registry scope/unload behavior, branch selection, optional
instructions, exact prompt order, invalid/ambiguous/unhealthy targets, unowned Sessions,
cancellation, partial failures, notification coalescing, and existing Client/Gateway/Sidecar/Git
tests. Required gates:

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree lint
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
node --test test/readme-parity.test.mjs
```

2026-10-04 verification result: all six gates passed; the full package suite passed
759/759 tests. `pnpm --filter @cerbur/clutch-dsh-worktree lint` and
`git diff --check` also passed. A frozen offline install confirmed that the six added
Worktree importer lines reuse existing lockfile snapshots without changing other plugins.

Live dispatch against an LLM account is separate from deterministic regression validation.
This implementation does not install into or modify the user's running DSH profile.
