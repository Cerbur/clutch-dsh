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
scoped tool registration, the existing Manage implementation, and a cancellable notification
endpoint on the existing `/api` Connection. Structural Host ports prevent Host SessionStore
declaration merging into the Client Session Context graph. Tests exercise real DSH registries.

## Delegation behavior (2026-10-09 amendment)

The internal `src/tool/` module owns the tools, with one file per tool containing its input,
output, description and handler. Shared context, native Session access and bounded history
reads stay in adjacent helper files; Host only composes it. Native command execution and model
prompt assembly verify all eight tools. Activation names them explicitly; the legacy two-tool
success text identifies an older Host build still loaded in memory, which requires Host
reload/restart after rebuilding.

1. `/worktree` validates native Workspace membership or exactly one active Sidecar binding.
   Unknown ownership is rejected; cwd alone never establishes Project identity.
2. It enables eight tools: `clutch_new_worktree`, `clutch_list_worktrees`,
   `clutch_span_worktree`, `clutch_list_models`, `clutch_list_sessions`,
   `clutch_read_session`, `clutch_send_message`, and `clutch_wait_sessions`.
   Repeated invocation is idempotent. The command accepts no arguments.
3. `clutch_new_worktree({ name, baseBranch?, instructions? })` creates a new branch from
   the calling Session's healthy active Worktree branch, or the root checkout's current branch
   when its physical cwd matches Local/Main. An explicit local base overrides this. Broken
   bindings never silently select Main. The Host captures the calling checkout's HEAD before
   creation, including detached root HEAD; detached sources omit `baseBranch`. The transaction pins the captured
   commit when creating a new branch; uncommitted files are not copied. It then saves optional shared
   instructions. It returns the Worktree identity and path and creates no Session.
4. `clutch_span_worktree({ worktreeId?, name?, prompt, model?, title? })` resolves an exact active, healthy managed target
   within that Project, creates a native Session with its ordinary creation-time cwd,
   binds it, configures the initial model, optionally renames it through the native API, and
   admits the exact prompt in queue mode. Prefer the stable id; specify exactly one id or name.
   It returns the native Session identity, selected model, request id and stage after admission,
   without waiting for model execution or changing the current UI focus.
5. Failure after creation preserves entities. Instruction failure returns
   `instructionsSaved: false`; dispatch failure returns `binding-failed` or
   `model-failed`, `title-failed`, or `prompt-failed` with the native Session id.
   Retrying dispatch creates another Session. After successful binding and model setup,
   `clutch_send_message` can retry a failed prompt using the returned request id.
6. Existing Session metadata, Workspace members, messages and history are never rewritten.
   Normal new-Session preset and permission policy apply; the plugin does not grant
   Full Access. Native command/tool/prompt lifecycle logging remains DSH-owned.

The name `clutch_span_worktree` is retained exactly as requested.
Activation is runtime-only: run the command again after Agent resume/restart or plugin reload.
Dispatched Sessions require their own command. Nested Agents inheriting a parent tool catalog
cannot execute these registrations because the body checks the exact caller.
There are no merge/publish/remove/cleanup tools and no native parent/subagent lineage.

`clutch_list_worktrees({ workspaceId? })` returns managed facts and local branch candidates;
Git failure is reported as `branchesUnavailable` while preserving a sidecar-supported list.
`clutch_list_sessions({ workspaceId?, worktreeId? })` discovers existing native Sessions and
relations, including unavailable diagnostics without loading unauthorized history. Explicit
Workspace ids must equal the calling Workspace. Every read/send/wait target is reauthorized
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

`clutch_read_session({ sessionId, afterCursor? })` uses a cold native observation. Its opaque
cursor binds the Session id, next event seq, text offset and state watermark. Initial reads cover
the last 100 events and flag omitted history. Pages return up to 20 relevant records and 32,000
text code units; individual messages are split into 8,000-code-unit fragments without skipping
text. `hasMore` instructs another read. Messages, turn boundaries, approvals, runtime errors,
pending inbox and pending user questions are projections, never new persistent task facts.

`clutch_send_message({ sessionId, prompt, mode?, requestId? })` defaults to queue; steer uses
native step-boundary admission. New messages get independent ids, while an explicit id retries
the same message through native deduplication. Native failures return `prompt-failed` with the
retry id even when acceptance is uncertain. Acceptance is not execution or task completion.

`clutch_wait_sessions({ sessionIds, afterCursors?, timeoutMs? })` handles at most eight targets,
defaults to 30 seconds and caps at 60 seconds. Supplied cursors report incremental messages or
state changes; omitted cursors observe from now, returning inactive/waiting targets immediately.
It subscribes before reading, uses a wake revision to close read/wait races, and releases all
subscriptions and timers on timeout, cancellation and Host/calling-Agent disposal. Waiting uses
native event notifications, not polling or the controller's cold-promoting follow transport.
idle does not assert acceptance criteria; the delegator must inspect outputs and tests. Human
questions and approvals are reported, never answered by these tools.

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
