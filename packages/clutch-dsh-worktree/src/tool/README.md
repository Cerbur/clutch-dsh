# Worktree tools

Internal Node-only module loaded by the Host; not a separate workspace package.

Each tool file owns its input schema, output schema, description and handler:

- `new-worktree.ts`
- `list-worktrees.ts`
- `span-worktree.ts`
- `list-models.ts`
- `list-sessions.ts`
- `send-message.ts`
- `report-result.ts` (delegated Sessions only)

`index.ts` owns activation, automatic delegated-Agent setup and scoped lifetimes.
`guidance.ts` supplies model-visible workflow guidance through native system prompt sections.
`errors.ts` explains failures and recovery with correct invocation examples.
`context.ts` validates ownership; `inputs.ts` and `outputs.ts` hold reusable schema fragments.
`native-session.ts` wraps native APIs; `history.ts` provides internal read-only status projection.
`types.ts` reuses existing contract, Manage and Provider types.

There are no model-facing history read or wait tools. Reports use bounded native queued messages
with a runtime-only fixed destination, reauthorized on each send. Models explicitly report results;
turn completion does not imply task completion. Agent/plugin restart loses that destination.
The Host supplies physical path identity checks and native ports. Tool execution never modifies
DSH data directly, and Provider code never imports this module.
