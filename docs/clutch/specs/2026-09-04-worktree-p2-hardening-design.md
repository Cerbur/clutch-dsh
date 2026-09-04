# Worktree P2 Hardening Design

## Goal

Close the remaining P2 gaps in `@cerbur/clutch-dsh-worktree` after the DSH `0.1.2-rc.1` migration. The change must preserve DSH as the source of truth, keep the browser projection on the native Workspace source object, prevent ready-state UI flicker, and make the package's tests, dependency graph, and public documentation reflect the rc.1 contract.

## Scope and approach

Use the smallest safe change set. The current implementation already decorates the original `ctx.workspaces.list` object with a reversible read projection and already retains a ready Context value when the current Workspace identity remains stable. Therefore, lock those behaviors down with regression tests instead of introducing a second adapter or refactoring the projection.

The implementation scope is limited to:

- browser composition regression coverage;
- Context ready-state regression coverage;
- explicit rc.1 Typert Gateway configuration in the composition fixture;
- removal of the unused `@deepseek-ai/dsh-client-ui-settings` package-local devDependency followed by a generated lockfile update;
- synchronized English and Chinese compatibility documentation;
- package architecture notes describing the rc.1 WorkspaceSource and uiWorkspace changes.

If a requested regression fails against the current implementation, fix only the smallest underlying defect required by that regression while retaining the same public contracts.

## Architecture and data flow

The native `ctx.workspaces.list` is a read-only `WorkspaceSource` exposing only `getSnapshot()` and `subscribe()`. The Worktree Client receives that exact object and installs a browser-local, reversible membership projection on it. The projection observes native snapshots, merges virtual Worktree membership, and publishes through the same object; it never calls or requires `list.set` and never creates a copied list object.

Consequently:

1. ui-workspace and every other Client consumer continue reading the same list reference from Cordis Context.
2. Native Workspace snapshot notifications are observed by the Worktree projection and by native consumers through one source instance.
3. Disposing the Client removes the projection, unsubscribes native listeners, and restores the original `getSnapshot` and `subscribe` descriptors.
4. The fixture must model the rc.1 source accurately by omitting `set`, while the real Cordis composition test verifies initialization still succeeds.

The Context projection subscribes to native Session and Workspace sources. On a refresh for the same current identity, it retains the current ready value while replacement data is pending. A changed identity may load a new value; a completed read replaces the retained value atomically. No native update path may publish a loading state with an empty value after a valid ready state unless the user explicitly starts a first load or retry.

Navigation and directory selection remain delegated to rc.1 `ctx.uiWorkspace`; native Workspace commands remain on `ctx.workspaces`. The old `dsh-client-runtime` path is not reintroduced.

## File-level changes

- `packages/clutch-dsh-worktree/test/client-composition.test.mjs`: assert strict identity between the Cordis Workspace list and the list consumed by the Worktree wrapper/other Client hooks; assert the fixture's list has no `set` and that composition initialization completes without a TypeError.
- `packages/clutch-dsh-worktree/test/worktree-context-store.test.mjs`: add a ready-state native Workspace and Session snapshot regression. Capture snapshots during notification and assert every observed state retains the prior valid value or publishes the replacement value, never `loading` plus an empty context.
- `packages/clutch-dsh-worktree/test/dsh-composition.test.mjs`: instantiate `const gatewayConfig = TypertGatewayService.Config({});` and pass it to `host.plugin(TypertGatewayService, gatewayConfig)`.
- `packages/clutch-dsh-worktree/package.json`: remove only the unused `@deepseek-ai/dsh-client-ui-settings` devDependency.
- `pnpm-lock.yaml`: regenerate with `pnpm install`; do not hand-edit it.
- `packages/clutch-dsh-worktree/README.md` and `README.zh.md`: replace the Compatibility prose with the synchronized four-row DSH Client, DSH Host, Git, and Node.js facts table, and add the rc.1 checkout command to source validation instructions.
- `packages/clutch-dsh-worktree/AGENTS.md`: document the read-only WorkspaceSource, reversible same-object projection, uiWorkspace navigation/directory delegation, and removal of the old runtime dependency.

## Errors and compatibility

The tests must treat absence of `list.set` as the supported rc.1 shape, not as an error. Existing retryable Context error behavior remains unchanged. The Gateway fixture must use the rc.1 explicit configuration contract. No new transport, mutation API, dependency, or DSH-native data write is introduced.

The compatibility table is authoritative for the public minimums:

| Component  | Minimum version | Notes                                                             |
| ---------- | --------------- | ----------------------------------------------------------------- |
| DSH Client | `>=0.1.2-rc.1`  | Requires Session/Workspace Controllers and Client Store           |
| DSH Host   | `>=0.1.2-rc.1`  | Requires Typert Gateway `/api` protocol and subprocess capability |
| Git        | `>=2.20.0`      | Requires worktree core commands and branch discovery              |
| Node.js    | `>=20.0.0`      | LTS is recommended                                                |

## Validation

After implementation and lockfile regeneration, run exactly this user-requested sequence from the workspace root:

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree test
git status
```

Any failure is investigated before proceeding. The final report names changed files and records the actual result of every command.
