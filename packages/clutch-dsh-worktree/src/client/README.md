# Client module

This directory is the future browser Consumer entrypoint for the
`clutch-dsh-worktree` plugin. It will depend on the browser-safe contract and
the Manage/Remote facade; it must not execute Git, read sidecar files, or import
Provider internals.
