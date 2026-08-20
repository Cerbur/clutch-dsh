# Client module

This directory contains the browser-safe facade entrypoint for the
`clutch-dsh-worktree` plugin. `createWorktreeManagerFacade()` adapts an already
mounted DSH `worktreeManager` Remote namespace to the stable Manager contract;
it does not mount a contribution or own transport. The Phase 4 UI will consume
this facade. Client code must not execute Git, read sidecar files, import
Provider internals, or call `ctx.remote.$mount()`.
