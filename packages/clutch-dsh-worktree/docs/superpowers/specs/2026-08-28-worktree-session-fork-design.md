# Worktree Session Fork Design

## Goal

让从 Worktree Session 发起的 fork，无论入口是原生 Workspace session list 的 tab、Worktree view，还是 Session 对话中的 fork，都继续属于同一个 Worktree 关系视角，并在 fork 成功后出现在 Worktree view。

## Scope and non-goals

本次只修改 `@cerbur/clutch-dsh-worktree` plugin。保持 plugin-only：不修改 DeepSeek Harness 源码，不写入 DSH 原生 `Workspace.sessionIds`，不修改 DSH Session header、transcript、Project/Workspace identity 或原生 Workspace 持久化列表。

因此，原生 DSH Workspace 管理中的持久化 `Workspace.sessionIds` 仍只记录 DSH 自己确认属于 Workspace root 的 Session。Worktree fork 的 child 通过 DSH 原生 Session API 持久化并继续由 DSH 的全局 Session 管理；Worktree 归属由 plugin sidecar binding 表示，浏览器内再通过现有 Workspace membership projection 显示。

## Chosen approach

### 1. Wrap the shared native fork entry point

在 plugin composition root 中保存并包装当前 `ctx.sessions.fork`。包装器先调用原生 fork，保留 `sessionId`、`atSeq` 和 `increaseTitle` 语义；拿到 child ID 后根据 parent Session 的 active Worktree binding 创建同一 Worktree 的 child binding。

原生 DSH 的 Workspace tab 和对话 fork 都经由同一个 `ctx.sessions.fork`，所以不需要复制或修改两个上游 UI 的实现。没有 Worktree parent binding 的普通 Main Session fork 完全沿用原生行为。

### 2. Bind after native Session creation

child 先由 DSH 创建并发布。plugin 只在 fork 成功后读取 Workspace binding，并调用已有 `bindSession`。
binding 成功后只触发 Worktree view 的保留刷新；刷新读取到 child binding 后，再由已有的
browser-local membership projection 把 `{ workspaceId, sessionId: childId }` 放入 native Workspace
list 的临时视图并打开 child。这样 child 不会在 binding refresh 前短暂落入 Main/Local。

如果 sidecar 查询或 binding 失败，不删除、不回滚 DSH 已创建的 child；child 仍返回给原生调用方并可以打开，同时记录 retryable recovery。下一次 plugin 初始化会扫描带有 `parentId` 的 Session summary，重新为仍有 active Worktree parent binding 的 child 尝试 binding。

### 3. Preserve ready UI and recover late writes

binding 成功触发 Worktree view 的保留内容刷新，刷新只更新 binding projection，不先清空当前 ready 内容。失败只显示可重试状态；不会把 provider/sidecar 错误伪装成空 Worktree 列表。

包装器销毁时恢复原始 `ctx.sessions.fork`，忽略尚未完成的 plugin sidecar 回调。child 已经由 DSH 持久化，之后可由启动恢复流程处理。

## Data flow

```text
native Workspace tab fork / conversation fork
                    │
                    ▼
         ctx.sessions.fork wrapper
                    │
          native DSH creates child
                    │
          child id + parent session id
                    │
       lookup active sidecar binding
          ┌─────────┴─────────┐
          │                   │
       no binding          Worktree binding
          │                   │
   native behavior       bind child in sidecar
                              │
                   browser-local membership
                              │
                    Worktree view shows child
```

## Error and recovery semantics

- native fork failure：保持原生 reject/catch 语义，不写 sidecar。
- native fork 成功、sidecar 查询失败：child 保留，记录 source/child recovery，允许稍后重试。
- sidecar bind conflict：child 保留；如果已有同一 binding，按已有幂等语义视为成功；其他 active Worktree 冲突显示 retryable error。
- plugin dispose：不再执行迟到的 bind、projection 或 open；不删除 child。
- native Workspace list：不写 `Workspace.sessionIds`，因此 Worktree child 不会被伪装成 root-cwd native Workspace membership。

## Verification

- 协调器单测覆盖 parent binding 成功、Main Session 不绑定、`atSeq`/`increaseTitle` 透传、sidecar 失败保留 child 与 retry、dispose 忽略迟到结果。
- Client composition 测试覆盖原生 `sessions.fork` 包装与恢复。
- 启动恢复测试覆盖 parent/child summary 配对，以及不带 `parentId` 的 Session 不会被自动绑定。
- Worktree surface 测试覆盖 binding 成功后的保留刷新和 recovery action。
- 运行 package typecheck、build、test 及 workspace/patch checks。
