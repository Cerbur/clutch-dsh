# Worktree tools

Internal Node-only module loaded by the Host.

Each tool file owns its input schema, output schema, description and handler:

- `new-worktree.ts`
- `list-worktrees.ts`
- `span-worktree.ts`
- `list-models.ts`
- `list-sessions.ts`
- `read-session.ts`
- `send-message.ts`
- `wait-sessions.ts`

`index.ts` owns slash-command activation and scoped registration lifetimes.
`context.ts` validates ownership and supplies the shared Workspace/read context.
`inputs.ts` and `outputs.ts` hold reusable schema fragments.
`native-session.ts` wraps native Session APIs; `history.ts` projects bounded history.
`types.ts` reuses existing contract, Manage and Provider types.

The Host supplies physical path identity checks and native ports. Tool execution never modifies
DSH data directly, and Provider code never imports this module.
