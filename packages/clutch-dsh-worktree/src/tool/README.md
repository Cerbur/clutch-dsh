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
`delegation.ts` owns consumable in-memory tokens, bounded native input/retry provenance, report attempts
and code-enforced callback/ancestor guards.
`guidance.ts` supplies model-visible workflow guidance through native system prompt sections.
`errors.ts` explains failures and recovery with correct invocation examples.
`schema.ts` projects Zod inputs into DSH's native/PTC schema subset; the original parser
retains strict execution validation. String limits stay visible as descriptions, and exclusive
closed-object target alternatives use `oneOf`. Unsupported constructs fail explicitly.
`context.ts` validates ownership; `inputs.ts` and `outputs.ts` hold reusable schema fragments.
`native-session.ts` wraps native APIs; `history.ts` provides internal read-only status projection.
`types.ts` reuses existing contract, Manage and Provider types.

There are no model-facing history read or wait tools. Reports use bounded native queued messages
with a runtime-only token destination, reauthorized on each send. Tokens are cleared after
successful admission or direct human input; stable tools, SDK and guidance remain registered.
Explicit parent dispatches can rearm authorization; reports and ordinary plugin messages cannot
start callback dispatches. Spent tokens and report payloads are unlinked immediately; dispatch
retry hashes have a hard capacity limit. Agent/scope disposal and plugin unload clear ownership.
Models explicitly report results;
turn completion does not imply task completion. Agent/plugin restart loses that destination.
The Host supplies physical path identity checks and native ports. Tool execution never modifies
DSH data directly, and Provider code never imports this module.
