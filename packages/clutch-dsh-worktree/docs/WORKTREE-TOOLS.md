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
   when its physical cwd matches Local/Main. An explicit local or fetched remote base overrides this. Broken
   bindings never silently select Main. The Host captures the calling checkout's HEAD before
   creation, including detached root HEAD; detached sources omit `baseBranch`. The transaction pins the captured
   commit when creating a new branch; uncommitted files are not copied. It then saves optional shared
   instructions. It returns the Worktree identity and path and creates no Session.
4. `clutch_span_worktree({ worktreeId?, name?, prompt, model?, title? })` resolves an exact active, healthy managed target
   within that Project, creates a native Session with its ordinary creation-time cwd,
   binds it, configures the initial model, optionally renames it through the native API, enables only fixed-destination reporting and reporting guidance by default, and
   admits the exact prompt payload inside a native Agent relay envelope in queue mode. Prefer the stable id; specify exactly one id or name.
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
The Dashboard's Sync with Base action shares `dispatchWorktreeSession` with this tool:
native creation, binding, initial model routing, optional title, and prompt admission.
The tool retains its reporting prepare hook and calling-model inheritance. Dashboard tasks
are user-originated ordinary Sessions using the configured default model, without inventing
a delegating Agent or reporting destination. Only the Session executes the requested merge/rebase;
the plugin still has no Git merge/rebase tool or working-tree mutation provider.
Activation is runtime-only: run the command again after Agent resume/restart or plugin reload.
Dispatched Sessions are enabled automatically before prompt admission. Nested Agents inheriting a parent tool catalog
cannot execute these registrations because the body checks the exact caller.
There are no merge/publish/remove/cleanup tools and no native parent/subagent lineage.

`clutch_list_worktrees({ workspaceId? })` returns managed facts and local and fetched remote branch candidates;
Git failure is reported as `branchesUnavailable` while preserving a sidecar-supported list.
Its branch output schema declares optional `ref`, `kind` (`local` or `remote`) and `remote`.
Native DSH output validation accepts both exact-ref facts and older adapters omitting these fields.
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
Tool descriptions lead with the action, result and recovery behavior, following native DSH
delegation/control tools. Field descriptions own base/default selection, target eligibility,
filter scope and retry identity details. Dispatch/follow-up descriptions still retain compact
handoff rules and dispatch retains model-selection guidance for complete personas; these rules
must not depend only on extra system-prompt sections.
Dispatch and continuation share the same nonblank, verbatim prompt validator but use separate
field descriptions: dispatch requires a self-contained task and checks; continuation describes
only the follow-up message. Delivery timing belongs to `mode`, and exact retry conditions belong
to `requestId`. Projected string bounds use `Nonempty.` and concise UTF-16 length notes rather
than repeating validator implementation prose; original Zod bounds remain authoritative.
DSH's minimal persona has `complete: true`, so it intentionally drops extra prompt sections.
The plugin preserves that contract instead of concatenating text onto the complete system prompt;
native tool descriptions still convey the rules, and PTC SDK rendering retains those descriptions.
Schemas omit `$schema`; flat optional target fields retain runtime exact-one id/name validation, all fields explain
source/default/limits. Error bodies identify the reason and a corrected call; partial creation
failures preserve identities and describe repair. No tool grants permissions or answers approvals.

The subsequent native/PTC smoke run completed dispatch, three pushed reports and continuation,
but both delegates first omitted report `status`. The PTC `ToolArgs` entries had degraded to
`unknown`: Zod's `minLength`, `maxLength` and `anyOf` exceed DSH's SDK schema vocabulary.
`src/tool/schema.ts` now projects lengths into descriptions (still enforced by the original
Zod parser). The low-level historical projector can convert disjoint object unions to oneOf,
but registered tool inputs now follow the stricter union-free profile below (issue #8 amendment).
Unsupported keywords and overlapping alternatives still fail explicitly. Report guidance names
required status and summary. Tests use DSH's real registry/validator and SDK generator for all
seven tools, keeping native optionality separate from provider strict wire normalization.

`clutch_send_message({ sessionId, prompt, mode?, requestId? })` defaults to queue; steer uses
native step-boundary admission. New messages get independent ids, while an explicit id retries
the same message through a stable native message id and native pending/insertion/consumed receipt lookup. Native failures return `prompt-failed` with the
retry id even when acceptance is uncertain. Acceptance is not execution or task completion.

`clutch_report_result({ status, summary, evidence?, requestId? })` is registered for delegated
Agents. Its destination and one-shot authority come from the current in-memory token; no native
lineage or Sidecar task facts are written. Before admission, both source and recipient are
reauthorized in the same Workspace, including binding, physical cwd and the strict root gate.
The report is a normal queued native message with a Host-authored source id and the Agent's
completed/blocked/failed claim. Summary and evidence are each capped at 2,000 characters.
Reports are model-driven and may not arrive after crashes/stops or while awaiting human input.
They are claims requiring verification; no turn/end listener invents task success. The caller
must not auto-reply to each report. Successful admission of any outcome consumes and clears the
token; the reporting tool, SDK and guidance stay stable. Only a new parent dispatch can open reporting again;
direct user interaction closes old authorization. Admission failure preserves requestId and exact
payload for identical retries, with a synchronous reservation preventing concurrent duplicates.
Plugin/Agent restart removes routing and guidance;
a resumed Session may enable `/cluworktree` and manually use `clutch_send_message` with the known
delegator id. Existing Sessions are not retroactively assigned a reporting destination.

## All-tool schema audit (2026-10-26, issue #8)

[TOOL-SCHEMA-STANDARD.md](TOOL-SCHEMA-STANDARD.md) is the normative sourced author/native profile,
provider adaptation boundary and human decision gate. Root-level oneOf is valid JSON Schema and
DSH vocabulary, but fails some strict gateways before model invocation; merely enabling such a
tool can break every conversation turn. The fix is a single closed object, not a different union keyword.

| Registered tool | Audit finding and treatment |
| --- | --- |
| clutch_new_worktree | Already a closed object; clarified captured HEAD (not assumed main), instruction default/partial preservation and unsafe blind retry. |
| clutch_list_worktrees | Already closed; clarified discovery-only, no fetch and branchesUnavailable retaining Worktree facts. |
| clutch_span_worktree | Replaced root union with optional id/name fields; exact-one Zod refinement runs before handler effects. Value-based target selection handles optional undefined/null normalization. Clarified authorization, inheritance, admission and partial recovery; removed duplicated full workflow prose. |
| clutch_list_models | Already closed; clarified explicit selection use, read-only defaults and unknown vs unavailable provider. |
| clutch_list_sessions | Already closed; clarified filters, per-item unavailable diagnostics, no transcripts/verified completion or routine monitoring. |
| clutch_send_message | Already closed and enum/default correct; clarified healthy archived bindings, no ancestor/self messaging, queue/steer, exact destination/prompt/mode retry and admission vs reply. Compact safety remains in tool text for minimal personas. |
| clutch_report_result | Conditional registration is included, not a seventh-tool blind spot. Closed enum object retained; one-shot token, fixed destination, completed claim and identical retry contract reviewed and tested; optional evidence/retry defaults clarified. |

All seven reject unknown fields before effects, including nested model keys. Optional null-as-omission
was a genuine strict-adapter/runtime conflict: the human explicitly approved the extension before
implementation. Required nulls, unknown keys and invalid empty values remain rejected. Prompt text
stays exact; string lengths are documented as UTF-16 code units. Neither target, both targets, empty,
whitespace, undefined and null cases have registered-executor coverage.

Default package tests discover real registrar exports recursively and compare their inventory to
actual DSH registrations after command, automatic and delegated-report activation. Every tool gets
recursive schema/field-description checks, valid/invalid executor examples and no-effects assertions.
Fifteen intentionally invalid tool/schema fixtures prove the guard rejects root/nested regressions;
existing semantic safety tests remain, rather than replacing quality with length thresholds or snapshots.
The external DSH pi-ai test in the same suite uses DSH_SCHEMA_ADAPTER_ANCHOR when supplied; it
executes real makeStrictJsonSchema/convertResponsesTools, verifies recursive all-required/null/closed
shape and no native mutation, and executes normalized nullable arguments. Without this external graph
only that seam reports skipped. Local integration is not a live provider/gateway E2E claim.

New/changed tools must satisfy the tests. Suspected rule/test defects require a human decision with
failure, implementation and official evidence; do not weaken/skip assertions to pass. See the
standard and DEVELOPMENT contributor gate. Implementation/verification record:
[2026-10-26 tool contracts](plans/2026-10-26-tool-contracts.md).

### Provider opt-in wire projection (2026-10-29)

`nullableToolProviders` defaults to empty. At final native prompt assembly,
`src/tool/wire-schema.ts` projects enabled plugin validators for explicitly listed
provider ids to closed objects with all properties required and previously optional
values nullable. String length constraints survive here. First-report requestId is
null-only; an uncertain attempt restores the string/null retry field. This protects
generation without accepting blank identities or weakening runtime authorization,
retry provenance or tokens. Native registration/PTC remain portable and optional;
other plugins and non-selected providers retain their schemas. No strict flag is set.

The real native-loop test covers completed report → parent queue → fresh report in
one process, provider isolation and uncertain admission. A restart between dispatch
and follow-up invalidates the process-local report target; it is not evidence that
completion disposed the tool. Live verification must record the same Host process
throughout, inspect actual parameter payloads and confirm pushed reports at the parent.

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

## Task-scoped report and callback amendment (2026-10-10)

This supersedes the 2026-10-09 Agent-lifetime reporting policy and its instruction to report after
every follow-up. A task must consume its native dispatch input before reporting, and has one report
admission budget for `completed`, `blocked` or `failed`. Human input and unrelated plugin messages
invalidate that budget. Explicit parent follow-ups rearm closed tasks; retries of old dispatches
never do. Native relay message ids match Host-recorded dispatch identities and the actual sender before
consumption can activate a task. Human user-RPC inputs cannot activate relay tokens. Legacy queued
plugin RPC prefixes remain callback-blocked after upgrade; no history is rewritten or polled for progress.

Code rejects message destinations that are the caller or any ancestor. A turn consuming only
reports or ordinary plugin messages cannot dispatch more messages/tasks through these tools;
fresh human input or a valid parent task restores dispatch. An active nested task can forward its
own result once. Historical surface replacement is ignored; callback blocking survives empty turns,
and unknown plugin requestId prefixes after restart remain blocked. Both native and PTC execution
use the same guards, including stale tool handles. Other plugins' tools are outside this boundary.
The registry and guards are documented in [ARCHITECTURE.md](ARCHITECTURE.md).

Regression coverage exercises outcome closure, direct human interaction, parent follow-up rearming,
old dispatch retries, exact report retries, concurrent report reservation, input consumption,
unrelated messages, ancestor cycles and stable native/PTC prompt assemblies across token consumption.

The in-memory-token refinement supersedes tool removal: issued tokens never enter prompts or
persisted data. Consumed tokens and report bodies are unlinked immediately. A report invocation
captures its token before awaits and reserves it atomically before admission, so delayed validation
or settlement cannot use/spend a replacement token. One uncertain attempt retains only its exact
retry payload. Agent disposal (including a parent) revokes associated tokens; plugin unload clears
all state. Dispatch retry provenance is bounded to 512 entries and stores prompt/mode digests,
with no spent-token references. Live token entries are protected; full capacity fails explicitly.
Expired retry ids fail closed, and ancestry is limited to 64 levels. Stress tests run thousands of
report cycles and inspect retaining containers, alongside disposal and concurrency race tests.

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

## Agent provenance amendment (2026-10-26)

Task dispatch, continuation and reporting now call the same Host-owned native relay Adapter.
The sender comes from the exact live calling Agent, not a tool parameter. Public DSH message
factories supply an immutable user-role message with source kind agent-message, form relay and
senderSessionId; a native-style Agent envelope preserves attribution in provider-visible text.
The supplied body stays exact. Agent roles are not elevated to system/developer or forged as
this Session's assistant. Native Chat uses its existing context/relay renderer and Agent trigger;
no replacement UI or DSH core change is needed. Dashboard tasks remain human-originated.

The Adapter uses native followup/steer and native durable inbox insertion/consumed facts for retry receipts.
It serializes admission per target, validates exact live sender/recipient after awaits and fails
closed when the native receipt read fails. Stable namespaced ids are derived from requestId;
request bodies and modes remain locked by the existing upper-layer retry signatures. No second
persistent receipt store is created. Report claims retain a bounded, id-only Host routing
receipt (sender/recipient, no body or token). Only a matching receipt preserves a valid outer
task when an incoming report blocks automatic callbacks; a report-looking id alone does not.
No marker mints a token or proves success. New human input still closes old reporting. Legacy plugin RPCs cannot
masquerade as fresh human input or activate relay tasks. Old persisted history is left untouched.

The native loop claims pending input before awaited prompt assembly/request preparation,
and appends `user/message` later. Retry lookup therefore includes every matching
`agent/inbox/spliced.inserted` message, current pending input and historical `user/message`.
All occurrences must agree on role, source and exact content; unreadable insertion receipts
fail closed. A native queue edit preserves the id, so conflicting old/new payloads reject both
old-id retries even after claim. Remove, cancellation and queue-to-steer movement retain the
original admission fact: retries never resurrect removed input. Acceptance still does not
prove execution or completion. Upper-layer dispatch signatures continue to enforce mode;
native target alone cannot establish it because steering and cancellation can move input.
Native JSON replay and Adapter recreation need no plugin receipt cache.

Default tests cover the complete new route, stale/forged senders, concurrent/uncertain retries,
consumed native receipts, cancellation/disposal and task/token races. The optional native-source
integration in the same test suite executes real ReactLoopInbox/fold, provider context conversion,
Chat classification, relay body rendering and JSON history replay. Only its persistence/driver
shell, CSS and unused image/unknown-block dependencies are isolated; this is not a full running
GUI or live-provider E2E. Set DSH_NATIVE_SOURCE to the existing checkout; a supplied broken path
fails rather than silently skipping. Evidence and design: [Agent relay record](plans/2026-10-26-agent-relay.md).

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
