# Agent Worktree tools: research and implementation

Research date: 2026-10-04. Target branch: `wt-worktree-0.1.17/feat-worktree-tool`.
The requested DeepSeek Harness checkout is at
`4878cdabd87d4041bdaff61d04c966883b9fd07a`; its package graph is
`0.2.0-rc.1`. The plugin version stays unchanged for release aggregation.

## Feasibility and upstream seams

This feature uses existing plugin extension points without DSH core changes.
Relevant source files under the requested DSH checkout:

| Source | Evidence and use |
| --- | --- |
| `packages/interaction/commands/src/index.ts` | Native slash-command registration receives the exact calling Agent, raw input and cancellation signal. |
| `packages/core/tools/src/index.ts` | Agent-scoped registrations contribute to the native and PTC catalogs and are removed with their Cordis fiber. |
| `packages/api/session-controller/src/commands.ts` | `create({ cwd })` creates an ordinary Session; `prompt` performs normal admission and returns acceptance. |
| `packages/api/session-controller/src/types.ts` | Prompt admission requires a request identity, Session identity, queue/steer mode and nonempty content. |
| `packages/api/remotes/src/remote-events.ts` | Generic forwarded Host events use an application-owned fixed allowlist; plugin-specific notifications cannot assume forwarding. |

The implementation uses an optional `commands/tools/sessionController` composition,
scoped tool registration, the existing Manage implementation, and a cancellable notification
endpoint on the existing `/api` Connection. Structural Host ports prevent Host SessionStore
declaration merging into the Client Session Context graph. Tests exercise real DSH registries.

## Initial behavior

1. `/worktree` validates native Workspace membership or exactly one active Sidecar binding.
   Unknown ownership is rejected; cwd alone never establishes Project identity.
2. It enables exactly `clutch_new_worktree` and `clutch_span_worktree` for the calling Agent.
   Repeated invocation is idempotent. The command accepts no arguments.
3. `clutch_new_worktree({ name, instructions? })` creates a new branch from the Workspace
   Main's current local branch through the existing Git transaction, then saves optional shared
   instructions. It returns the Worktree identity and path and creates no Session.
4. `clutch_span_worktree({ name, prompt })` resolves an exact active, healthy managed branch
   within that Project, creates a native Session with its ordinary creation-time cwd,
   binds it, and admits the exact prompt in queue mode. It returns after admission,
   without waiting for model execution or changing the current UI focus.
5. Failure after creation preserves entities. Instruction failure returns
   `instructionsSaved: false`; dispatch failure returns `binding-failed` or
   `prompt-failed` with the native Session id. Retrying dispatch creates another Session.
6. Existing Session metadata, Workspace members, messages and history are never rewritten.
   Normal new-Session model, preset and permission policy apply; the plugin does not grant
   Full Access. Native command/tool/prompt lifecycle logging remains DSH-owned.

The name `clutch_span_worktree` is retained exactly as requested.
Activation is runtime-only: run the command again after Agent resume/restart or plugin reload.
Dispatched Sessions require their own command. Nested Agents inheriting a parent tool catalog
cannot execute these registrations because the body checks the exact caller.
This initial version has no list/remove/cleanup tool or parent-result waiting.

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
The data boundary is retained: native creation and admission are DSH-owned; the Provider port
stays read-only; only binding and Worktree instructions are plugin-owned persistent facts.

Regression coverage includes DSH registry scope/unload behavior, branch selection, optional
instructions, exact prompt order, invalid/ambiguous/unhealthy targets, unowned Sessions,
cancellation, partial failures, notification coalescing, and existing Client/Gateway/Sidecar/Git
tests. Required gates:

```bash
pnpm run check:workspace
pnpm run check:patches
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
