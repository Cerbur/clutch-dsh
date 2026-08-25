# clutch-dsh-worktree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

> **Package amendment (2026-08-20):** `@cerbur/clutch-dsh-worktree` is one runnable
> package. Use the package-consolidation plan for the migration and treat the
> role sections below as internal modules, not nested package creation tasks.

**Goal:** 为 DSH Web UI 增加 project-worktree-session 视角，在不改写 DSH 原始 Project、Session 和会话内容的前提下，通过插件自有的外部关系索引维护 Worktree 与 Session 的绑定。

**Architecture:** DSH 继续作为 Project、Session、消息和 transcript 的唯一数据源；clutch-dsh-worktree 只保存 Project/Worktree/Session 的关系、worktree 生命周期元数据和路径解析所需的信息。Web UI 读取 DSH 原始 session 列表，再与外部关系索引做投影，从而提供 worktree 视角；回到 project-session 视角时，原始 session 仍由 DSH 按 Project 展示，不依赖插件写回任何 session 字段。

**Tech Stack:** DSH/Cordis plugin APIs、TypeScript、Git worktree、插件自有 sidecar index、现有 DSH Project/Session read APIs、Node test runner。

## Global Constraints

- 插件不得写入或修改 DSH 的 Project、Session、消息、transcript、历史内容或原始 session metadata。
- 插件关系索引只保存 projectId、worktreeId、sessionId、worktree 路径/分支/状态、关系状态和 schema version；不保存 session 内容。
- 插件自有索引必须位于 host 提供的 plugin data directory 或独立 sidecar 存储中，不得写入 Project 工作目录或 DSH 原始数据目录。
- DSH Project 的原始工作目录由 DSH read API 返回；插件不得在自己的索引中复制或覆盖这个值。
- Session 创建必须通过 DSH 已有的 Project/Session API，并保持原始 Project 归属；绑定关系在插件外部索引中单独写入。
- 未绑定 Worktree 的 session 的 worktreeId 为 null，运行时工作目录解析为 Project 根目录，即 main 视角。
- 绑定 Worktree 的 session 的运行时工作目录解析为 Worktree 路径；这个解析结果不得持久化回 DSH Session。
- 一个 Session 同时最多绑定一个 active Worktree；一个 Worktree 可以绑定多个 Session。
- 删除 Worktree 不删除 Session；关系索引保留 detached 状态，只有显式解绑才回到 main 视角。
- Git 操作只允许创建、查询和删除 worktree 及其 Git metadata；插件不负责修改工作树中的业务文件。
- 所有关系写入必须幂等；重复绑定同一关系不会创建重复记录，冲突绑定必须返回可解释错误。
- Service Definition、Provider、Consumer 在同一 package 内保持单向内部 seam；
  只有需要独立替换或发布时才拆成 package。

---

## Current Understanding

现有 DSH Web UI 以 project-session 为主视角：

~~~text
Project
└── Session
~~~

本插件增加第二种组织方式：

~~~text
Project
└── Worktree
    └── Session
~~~

两种视角使用同一批 DSH Session：

- Project-session 视角按 DSH 的原始 Project 列出全部 Session。
- Project-worktree-session 视角读取同一批 Session，再根据插件外部索引按 Worktree 分组。
- Session 不会因为进入 Worktree 视角而被复制、迁移或改写。
- 未绑定 Worktree 的 Session 显示在 main 分组中。

## Source-of-Truth Boundary

| 数据 | 唯一来源 | 插件是否写入 |
| --- | --- | --- |
| Project identity | DSH Project API | 否 |
| Project 原始工作目录 | DSH Project API | 否 |
| Session identity 和内容 | DSH Session API | 否 |
| Worktree 的 Git path、branch、状态 | clutch-dsh-worktree internal Provider | 是，写入插件自有索引 |
| Session 与 Worktree 的关系 | clutch-dsh-worktree sidecar index | 是，写入插件自有索引 |
| 运行时 cwd | 每次根据 DSH Project + sidecar relation 派生 | 不持久化 |

## External Index Model

~~~ts
export type ProjectId = string;
export type WorktreeId = string;
export type SessionId = string;

export type WorktreeStatus = 'active' | 'removed';

export interface WorktreeRecord {
  readonly id: WorktreeId;
  readonly projectId: ProjectId;
  readonly absolutePath: string;
  readonly branch: string | null;
  readonly status: WorktreeStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SessionBinding {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly worktreeId: WorktreeId | null;
  readonly status: 'active' | 'detached';
  readonly updatedAt: string;
}

export interface ResolvedSessionContext {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly projectRoot: string;
  readonly cwd: string;
  readonly worktreeId: WorktreeId | null;
}

export interface IndexSnapshot {
  readonly schemaVersion: 1;
  readonly worktrees: readonly WorktreeRecord[];
  readonly bindings: readonly SessionBinding[];
}
~~~

索引不保存 projectRoot 的副本。解析上下文时先从 DSH Project API 取得原始工作目录，再读取关系索引决定 cwd。

## Runtime Flows

### Project-session 视角

1. DSH Web UI 调用原有 Project/Session API。
2. DSH 返回 Project 下的全部 Session。
3. 插件不拦截、不重排、不修改这个结果。
4. Worktree session 因为仍然属于原始 Project，所以自然出现在原始列表中。

### Project-worktree-session 视角

1. Consumer 读取当前 Project 的 Worktree 列表。
2. Consumer 读取同一个 Project 的 DSH Session 列表。
3. Consumer 读取关系索引中的 SessionBinding。
4. worktreeId 为 null 的 Session 放入 main 分组；其余 Session 放入对应 Worktree 分组。
5. 页面创建 Session 时，先以原始 Project 身份调用 DSH Session API，再在关系索引中绑定 Worktree。

### Worktree 创建与删除

创建顺序：

1. 从 DSH Project API 读取 Project 根目录。
2. 调用 Git worktree API 创建目标路径和 branch。
3. Git 创建成功后，将 WorktreeRecord 写入插件索引。
4. 如果索引写入失败，删除刚创建的 worktree 并返回错误。

删除顺序：

1. 读取 WorktreeRecord 和 active SessionBinding。
2. UI 显式确认后执行 Git worktree 删除。
3. 将 WorktreeRecord 标记为 removed，相关 SessionBinding 标记为 detached。
4. 保留 DSH Session；只有显式解绑才回到 main。

### Session 创建与绑定

1. Consumer 通过现有 DSH API 创建属于原始 Project 的 Session。
2. Provider 写入 sessionId -> worktreeId 关系。
3. 关系写入失败时，Session 保持 DSH 原始状态，并按 main 视角处理；界面提示用户重试绑定。
4. 后续执行请求通过 resolveSessionContext 得到 worktree cwd，但不把 cwd 写回 DSH Session。

## Component Boundaries

### Internal Service Definition: `src/contract/`

Internal module: `src/contract/index.ts`

Owns:

- ID、状态和关系类型。
- Worktree/session index service contract。
- 运行时 cwd 派生 contract。

Does not own：

- DSH Session 内容。
- Git command execution。
- UI 状态。
- sidecar 存储实现。

### Internal Provider: `src/provider/`

Internal modules: `src/provider/index.ts`, `src/provider/git.ts`,
`src/provider/sidecar.ts`, `src/provider/types.ts`

Owns:

- Git worktree adapter 和底层 Git 操作。
- 插件自有 sidecar 索引的底层读写。
- DSH Project/Session read API adapter port。
- Provider-owned errors and persistence validation。
- Sidecar mutation primitives and atomic persistence。

Does not own：

- DSH 原始数据迁移。
- Project/Session 内容写入。
- Web UI 页面和路由。

### Internal Manage: `src/manage/`

Internal modules: `src/manage/index.ts`, `src/manage/manager.ts`,
`src/manage/types.ts`

Owns:

- Worktree/Session use-case orchestration.
- Worktree creation/removal, binding conflicts and idempotency.
- Main, active Worktree and detached runtime cwd resolution.
- Git/sidecar recovery sequencing and degraded-state decisions.

Does not own：

- Git commands or sidecar file-format implementation details.
- DSH original Workspace/Session data or Web UI routes.

### Internal Consumer: `src/client/`

Internal browser entrypoint: `src/client/`

Owns:

- 侧边栏 Worktree 模式切换。
- Worktree 列表、创建和状态展示。
- Worktree 下的 Session 列表和创建入口。
- main、active worktree、detached 三种关系状态展示。
- 调用 DSH 原始 session API 和 plugin Remote facade 的编排。

Does not own：

- 关系索引持久化。
- Git 命令。
- 修改原始 project-session 页面中的 Session 数据。

### rc.8 Client workaround decision (2026-08-20)

rc.8 的 `session.create` 不能同时接受 `workspaceId` 和 Worktree `cwd`。在不修改
DSH 源码的前提下，Client Consumer 采用以下桥接：

1. Worktree `+` 通过 `session.create({ cwd: worktreePath })` 创建原始 DSH Session；
2. plugin sidecar 写入当前 Workspace、Worktree 和 Session 的关系；
3. binding 成功后，plugin 只在浏览器内把该 Session ID 投影到
   `ctx.workspaces.list` 对应 Workspace 的 `sessionIds`，使 DSH composer 能解析到
   当前 Workspace；
4. native Workspace list 刷新后重放 projection，binding 删除或 Client dispose 时
   撤销 projection；
5. Main `+` 继续调用原生 `ctx.workspaces.startSession(workspaceId)`，不写 sidecar。

这不是 DSH Host 的持久 attach；需要原生持久 membership 时仍需 DSH 提供可同时指定
Workspace 与独立 cwd 的 Session API。该 workaround 不修改 DSH 源码、Host 数据或
Session metadata。

## Implementation Tasks

### Task 1: 定义 Service Definition 和关系解析 contract

**Files:**

- Modify: packages/clutch-dsh-worktree/README.md
- Create: packages/clutch-dsh-worktree/package.json
- Create: packages/clutch-dsh-worktree/cordis.patch.yml
- Create: packages/clutch-dsh-worktree/tsconfig.json
- Create: packages/clutch-dsh-worktree/src/index.ts
- Create: packages/clutch-dsh-worktree/test/context.test.mjs

**Interfaces:**

- Consumes: 仓库 bootstrap plan 中的 Service Definition package 约定。
- Produces: clutch-dsh-worktree 的稳定类型和 resolveSessionCwd contract，Provider 与 Consumer 不依赖具体存储实现。

- [ ] **Step 1: 创建 Service Definition package metadata**

定义 package 名称 clutch-dsh-worktree、ESM 输出、build/lint/typecheck/test scripts，以及 dist/index.js 和 dist/index.d.ts exports。

- [ ] **Step 2: 定义关系和上下文类型**

在 src/index.ts 中导出 External Index Model 里的类型，以及以下 service contract：

~~~ts
export interface WorktreeSessionService {
  listWorktrees(projectId: ProjectId): Promise<readonly WorktreeRecord[]>;
  listBindings(projectId: ProjectId): Promise<readonly SessionBinding[]>;
  createWorktree(input: {
    projectId: ProjectId;
    absolutePath: string;
    branch: string | null;
  }): Promise<WorktreeRecord>;
  removeWorktree(worktreeId: WorktreeId): Promise<void>;
  bindSession(input: {
    projectId: ProjectId;
    sessionId: SessionId;
    worktreeId: WorktreeId | null;
  }): Promise<SessionBinding>;
  unbindSession(sessionId: SessionId): Promise<void>;
  resolveSessionContext(sessionId: SessionId): Promise<ResolvedSessionContext>;
}
~~~

- [ ] **Step 3: 添加纯函数 cwd 规则**

从 Service Definition package 导出：

~~~ts
export function resolveSessionCwd(input: {
  projectRoot: string;
  worktreePath: string | null;
}): string {
  return input.worktreePath ?? input.projectRoot;
}
~~~

这个 helper 不读取文件、不调用 Git、不检查 DSH 数据，也不修改输入。

- [ ] **Step 4: 添加关系解析测试**

测试未绑定 Session 使用 Project 根目录，已绑定 Session 使用 Worktree 路径。测试必须覆盖 main、active worktree 和 detached 三种输入。

- [ ] **Step 5: 验证 Service Definition 独立构建**

Run: pnpm --filter @cerbur/clutch-dsh-worktree typecheck && pnpm --filter @cerbur/clutch-dsh-worktree build && pnpm --filter @cerbur/clutch-dsh-worktree test

Expected: 全部成功；Service Definition 没有 Provider、Consumer 或 Git 实现依赖。

### Task 2: 实现插件自有外部关系索引

**Files:**

- Create: packages/clutch-dsh-worktree/package.json
- Create: packages/clutch-dsh-worktree/cordis.patch.yml
- Create: packages/clutch-dsh-worktree/tsconfig.json
- Create: packages/clutch-dsh-worktree/src/index.ts
- Create: packages/clutch-dsh-worktree/src/index-store.ts
- Create: packages/clutch-dsh-worktree/test/index-store.test.mjs

**Interfaces:**

- Consumes: WorktreeSessionService、WorktreeRecord 和 SessionBinding。
- Produces: 插件自有 sidecar index 的持久化实现；写入对象只包含关系和 worktree metadata，不包含 Project/Session 内容。

- [ ] **Step 1: 定义 sidecar 文件位置**

从 DSH host 的 plugin data directory 获取根路径，在其下使用固定文件名 clutch-dsh-worktree/index.json。禁止使用 Project 工作目录、.git 目录或 DSH 原始数据文件作为索引路径。

- [ ] **Step 2: 定义 sidecar schema**

初始 JSON 文档必须是：

~~~json
{
  "schemaVersion": 1,
  "worktrees": [],
  "bindings": []
}
~~~

worktrees 包含 WorktreeRecord；bindings 包含 SessionBinding。不得增加 session title、message、transcript、prompt 或 Project content 字段。

- [ ] **Step 3: 实现 IndexStore 接口**

~~~ts
export interface IndexStore {
  read(): Promise<IndexSnapshot>;
  upsertWorktree(record: WorktreeRecord): Promise<WorktreeRecord>;
  markWorktreeRemoved(worktreeId: WorktreeId): Promise<void>;
  bindSession(input: {
    projectId: ProjectId;
    sessionId: SessionId;
    worktreeId: WorktreeId | null;
  }): Promise<SessionBinding>;
  detachSessions(worktreeId: WorktreeId): Promise<void>;
  unbindSession(sessionId: SessionId): Promise<void>;
}
~~~

使用 process-local write mutex 和 atomic temporary-file replacement。每次 mutation 都读取最新 snapshot、应用幂等更新、写入同目录临时文件、rename 覆盖 index.json，再释放 mutex。

- [ ] **Step 4: 实现关系约束**

Store 必须拒绝：

- projectId 与 WorktreeRecord 不匹配的 binding；
- 同一 sessionId 指向第二个 active Worktree；
- 非绝对路径的 WorktreeRecord；
- 同一 Project 下重复的 active worktree path。

Store 必须接受重复执行相同的 bindSession 和 upsertWorktree，而不增加重复记录。

- [ ] **Step 5: 添加 IndexStore tests**

测试以下行为：

~~~text
empty index -> schemaVersion 1 with empty arrays
same worktree upsert twice -> one worktree record
same session bind twice -> one active binding
bind to another active worktree -> rejected without changing the first binding
binding project mismatch -> rejected
detach worktree -> bindings become detached and remain queryable
~~~

- [ ] **Step 6: 验证插件不写入 DSH 原始数据**

准备 Project JSON 和 Session JSON fixture。运行所有 IndexStore mutation 后，断言 fixture 内容 byte-for-byte 不变，并断言 index.json 只生成在 plugin data directory 下。

### Task 3: 实现 Git Worktree 生命周期和 DSH read adapter

**Files:**

- Modify: packages/clutch-dsh-worktree/src/index.ts
- Create: packages/clutch-dsh-worktree/src/git-worktree.ts
- Create: packages/clutch-dsh-worktree/src/dsh-read-adapter.ts
- Create: packages/clutch-dsh-worktree/src/session-context.ts
- Create: packages/clutch-dsh-worktree/src/session-execution-context.ts
- Create: packages/clutch-dsh-worktree/test/git-worktree.test.mjs
- Create: packages/clutch-dsh-worktree/test/session-context.test.mjs
- Create: packages/clutch-dsh-worktree/test/session-execution-context.test.mjs

**Interfaces:**

- Consumes: Task 1 的 Service Definition 和 Task 2 的 IndexStore。
- Produces: Worktree lifecycle provider、只读 DSH adapter 和不修改 Session 的 runtime context resolver。

- [ ] **Step 1: 定义 DSH read adapter**

~~~ts
export interface DshReadAdapter {
  getProject(projectId: ProjectId): Promise<{
    id: ProjectId;
    rootPath: string;
  }>;
  getSession(sessionId: SessionId): Promise<{
    id: SessionId;
    projectId: ProjectId;
  }>;
  listProjectSessions(projectId: ProjectId): Promise<readonly {
    id: SessionId;
  }[]>;
}
~~~

Adapter 可以调用现有 DSH API，但不得暴露 Project 或 Session mutation 方法。

- [ ] **Step 2: 定义 Git worktree adapter**

~~~ts
export interface GitWorktreeAdapter {
  create(input: {
    projectRoot: string;
    absolutePath: string;
    branch: string;
  }): Promise<{ absolutePath: string; branch: string }>;
  remove(input: {
    projectRoot: string;
    absolutePath: string;
  }): Promise<void>;
  exists(input: {
    projectRoot: string;
    absolutePath: string;
  }): Promise<boolean>;
}
~~~

Git command 必须以 Project root 作为 cwd；失败信息必须包含 Project root、目标路径和 Git exit message。

- [ ] **Step 3: 实现 createWorktree 顺序**

先读 Project root，再校验和 canonicalize 目标路径，执行 Git create，写入 WorktreeRecord。索引写入失败时删除刚创建的 Worktree 并返回原始错误。该流程不得创建 Session 或写入任何 DSH Session 字段。

- [ ] **Step 4: 实现 removeWorktree 顺序**

读取 WorktreeRecord 和 binding，要求 active binding 经过显式确认后再执行 Git remove；Git 成功后标记 Worktree removed、bindings detached。Git 失败时不改变索引状态，保留可重试记录。

- [ ] **Step 5: 实现 session context resolver**

~~~ts
export async function resolveSessionContext(
  sessionId: SessionId,
  deps: {
    dsh: DshReadAdapter;
    index: IndexStore;
  },
): Promise<ResolvedSessionContext>;
~~~

Resolver 必须读取 Project 根目录、读取 sidecar binding，并按以下规则返回 cwd：

- 无 binding、null binding 或 detached binding：Project 根目录；
- active binding：对应 Worktree 路径；
- active binding 找不到 WorktreeRecord：返回明确的 worktree not found 错误；
- 任何情况下都不持久化派生 cwd。

- [ ] **Step 6: 添加 runtime context tests**

覆盖未绑定、main、active worktree、detached 和缺失 WorktreeRecord 五种情况，并验证失败不会修改索引。

- [ ] **Step 7: 接入执行时 cwd resolver**

Create `src/session-execution-context.ts` with this adapter contract:

~~~ts
export interface DshSessionExecutionAdapter {
  execute(input: {
    sessionId: SessionId;
    cwd: string;
  }): Promise<unknown>;
}

export async function executeWithResolvedContext(
  sessionId: SessionId,
  deps: {
    resolve: (sessionId: SessionId) => Promise<ResolvedSessionContext>;
    dsh: DshSessionExecutionAdapter;
  },
): Promise<unknown>;
~~~

`executeWithResolvedContext` 必须先解析 Session context，再把 cwd 作为本次 DSH execution 的运行时参数传入；不得更新 DSH Session、Project 或 sidecar binding。测试必须断言执行 adapter 收到 Worktree path，并且 DSH fixture 内容保持不变。

### Task 4: 编排 Session 创建和外部绑定

**Files:**

- Modify: packages/clutch-dsh-worktree/src/index.ts
- Create: packages/clutch-dsh-worktree/src/session-binding.ts
- Create: packages/clutch-dsh-worktree/test/session-binding.test.mjs

**Interfaces:**

- Consumes: DSH 原始 Session create API、Task 2 的 IndexStore 和 Task 3 的 DshReadAdapter。
- Produces: createSessionForWorktree 编排函数；先创建正常 DSH Session，再单独写入关系索引。

- [ ] **Step 1: 定义只创建原始 Project Session 的 adapter**

~~~ts
export interface DshSessionCreateAdapter {
  createSession(input: {
    projectId: ProjectId;
  }): Promise<{ id: SessionId }>;
}
~~~

Adapter 必须使用现有 DSH Project/Session 创建路径，不得向 DSH Session 添加 worktreeId、cwd、关系 metadata 或 plugin 字段。

- [ ] **Step 2: 定义 createSessionForWorktree**

~~~ts
export async function createSessionForWorktree(input: {
  projectId: ProjectId;
  worktreeId: WorktreeId | null;
  dsh: DshSessionCreateAdapter;
  index: IndexStore;
}): Promise<{ sessionId: SessionId; binding: SessionBinding }>;
~~~

当 worktreeId 非 null 时，先通过 IndexStore 确认它属于 projectId 且状态为 active；校验失败时不得调用 DSH create。校验通过后创建 DSH Session，再绑定 sidecar。worktreeId 为 null 时写入 main binding；sidecar 写失败时返回包含 sessionId 的可重试错误，且不删除或修改 DSH Session。

- [ ] **Step 3: 添加绑定编排测试**

测试：

~~~text
create in active worktree -> one DSH session and one active sidecar binding
create in main -> one DSH session and one null-worktree binding
sidecar write failure -> DSH session remains created and unchanged
invalid worktree ID -> DSH create is not called
~~~

- [ ] **Step 4: 验证 project-session 兼容性**

使用 fake DSH Project/Session store 断言：

1. Worktree 模式创建的 Session 与 Project 模式创建的 Session 拥有相同的原始 projectId 结构。
2. 原始 Project Session list 同时包含两者，且没有 plugin-specific 字段。
3. 只有外部 index 区分 Worktree binding。
4. plugin index 不可用时，project-session read path 仍然可用。

### Task 5: 创建 project-worktree-session Web UI Consumer

**Files:**

- Modify: packages/clutch-dsh-worktree/package.json
- Modify: packages/clutch-dsh-worktree/cordis.patch.yml
- Create: packages/clutch-dsh-worktree/src/client/index.ts
- Create: packages/clutch-dsh-worktree/src/client/project-worktree-session-view.ts
- Create: packages/clutch-dsh-worktree/test/view-model.test.mjs

**Interfaces:**

- Consumes: Task 1 的 Service Definition、Task 3 的 context resolver 和 Task 4 的 Session creation orchestration。
- Produces: 侧边栏模式切换和 project-worktree-session view model；现有 project-session view 不被替换或改写。

- [ ] **Step 1: 定义 UI view model**

~~~ts
export interface ProjectWorktreeSessionViewModel {
  readonly projectId: ProjectId;
  readonly mainSessions: readonly SessionId[];
  readonly worktrees: readonly {
    readonly worktreeId: WorktreeId;
    readonly path: string;
    readonly branch: string | null;
    readonly status: WorktreeStatus;
    readonly sessionIds: readonly SessionId[];
  }[];
  readonly detachedSessionIds: readonly SessionId[];
}
~~~

View model 是 DSH Session IDs 和 sidecar relations 的投影，不得把 Session content 复制到 plugin state。

- [ ] **Step 2: 实现 Worktree 模式入口**

Consumer 提供 Worktree sidebar entry、当前 Project 选择、main 分组、active Worktree 分组、detached 状态、create-worktree 和 create-session action。切回 Project 模式时调用现有 DSH project-session view。

- [ ] **Step 3: 实现 view model projection**

投影算法必须：

1. 调用 DSH listProjectSessions(projectId)；
2. 调用 plugin listWorktrees(projectId) 和 listBindings(projectId)；
3. 保证每个 DSH Session ID 在结果中恰好一次；
4. 将 null 或缺失 binding 放入 mainSessions；
5. 将 active binding 放入对应 Worktree；
6. 将 detached binding 放入 detachedSessionIds；
7. 将 orphan binding 显示为 repair warning，不删除任一侧数据。

- [ ] **Step 4: 添加 Consumer view model tests**

覆盖全 main、单 Worktree、混合 Session、detached binding、orphan binding 和 sidecar 不可用场景。

- [ ] **Step 5: 验证 Web UI 侧边栏切换**

集成测试断言：

- Project mode 在 plugin index 初始化前仍可用；
- Consumer 加载后出现 Worktree mode；
- 创建 Worktree 不会删除或重排原始 Project Sessions；
- Worktree 创建的 Session 是正常 Project Session，同时有一条外部 binding；
- 回到 Project mode 后该 Session 仍在原始 Project 列表中。

## 2026-08-20 UI 创建流程补充

Worktree Consumer 的创建弹窗采用单一路径：

1. base branch 默认选择当前 Workspace checkout 的 branch；没有 current 标记时回退到第一个 local branch。
2. Worktree name 始终作为必填项展示，默认是 `dsh/` 加 8 位 UUID 字符；打开弹窗时会对已知 local branch 和 Worktree branch 做碰撞检查并自动重滚。
3. 创建统一传入 `newBranch`，由 Host 使用 `git worktree add -b <newBranch> <generatedPath> <baseBranch>`。
4. Host 返回 WorktreeRecord 后，Client 立即调用现有的 `session.create({ cwd })`、sidecar `bindSession` 和 `sessions.open` 链路；中间不等待列表刷新，以免刷新失败阻断新 Session。
5. Worktree 创建成功但 Session/binding 失败时，弹窗关闭、Worktree 保留，原有 Session binding repair 入口继续提供重试或打开已创建 Session。

这次 UI 调整不改变 DSH Session/Workspace 的数据边界，也不把 Worktree metadata 写进 DSH 原始数据。实际验证覆盖 CTool：生成 `dsh/17d78b46`，创建并打开 `session-c5e035af-1e3e-4d16-8bf2-119f376a7dfe`，sidecar active binding 与 Session `cwd` 均指向同一 Worktree。

## 2026-08-22 Git readiness follow-up

Worktree 创建弹窗按 Workspace 独立区分 Git 前置条件：非 Git Workspace 显示
`git init`、创建 README、首次 commit 的可复制命令；已有 Git 但没有初始 commit
时显示创建 README 和首次 commit 的命令；已有 commit 但没有本地 `heads` 分支时
显示 `git switch -c main`。这些命令只展示，不由插件执行，也不由插件写入 Workspace
业务文件。

分支列表成功返回时，弹窗默认选择 Workspace 当前 branch，并只渲染真实 local
branch；`No local branch` 不再作为可选项。分支列表的已知 Git 前置条件错误转成
Workspace-local readiness，Worktree/binding 事实仍保留；未知 Connection、Gateway、
sidecar 或 Worktree 错误继续走原有 retryable error surface。

## 2026-08-26 Imported subdirectory branch follow-up

当 DSH 导入的 Workspace root 是 Git worktree 根目录下的子目录时，Git 的
`worktree list --porcelain` 仍返回包含该目录的 worktree 根路径。此前 Manage 只比较两个
路径是否完全相同，导致 `BranchRecord.isCurrent` 永远为 `false`，Worktree 模式的 Main
分组无法显示当前 branch。

修复在 Git adapter validation 后通过可选的 root resolver 执行
`git rev-parse --show-toplevel`，再将这个 root 复用于 branch 与 worktree 读取，因此根目录
和子目录导入会使用完全相同的 Git 信息算法；旧的注入 adapter 没有 resolver 时仍回退到
原始 Workspace root。新增 Manage 回归测试覆盖寻根和子目录 Workspace。该修复不改变 DSH
或 sidecar 数据边界。

## 2026-08-21 UI tree parity follow-up

为对齐 DSH 原生 Workspace tree，Workspace 和 Worktree 的 row body 都是浏览器内存
展开状态的 toggle target；菜单、`+` 和 disclosure button 会阻止事件冒泡。默认显示
folder/branch glyph，悬浮时替换为垂直居中的 18px outline chevron；标题沿用
14px/400/20px 的 native text metrics。Workspace、Main 和嵌套 Worktree 的 `+`
按钮共用固定右对齐 action rail，嵌套 `treeChildren` 不再添加额外右侧 padding，避免
Worktree 的 `+` 向左漂移。

本轮 package surface test 为 22/22，且在 Arc 的真实 DSH Local Build 页面通过
Computer Use 检查了 Workspace/Worktree hover disclosure、Worktree row body 收起与
展开，以及 Workspace/Main/Worktree action rail 的截图位置。

## Failure and Repair Rules

- Sidecar 写失败：保留 DSH Session，不进行回滚式删除；返回 sessionId 和 retryable relation error。
- Worktree 路径不存在：阻止新的 Session context resolve，并显示明确的 Worktree unavailable 状态。
- Worktree 删除失败：不改变 relation 状态，允许重试。
- active binding 指向不存在记录：UI 显示 repair warning，resolver 不静默切换到另一个 Worktree。
- detached binding：运行时安全回退到 Project 根目录，但 UI 保留 detached 标识；显式解绑后才归入 main。
- 并发绑定冲突：同一 Session 只保留一个 active binding，竞争写入返回 conflict。
- sidecar 损坏：project-session 原始视角仍可用；插件进入 read-only degraded mode，不删除 DSH 数据。

## Acceptance Criteria

- Web UI 可以从 project-session 视角切换到 project-worktree-session 视角。
- 用户可以在 Project 下创建 Worktree，并在 Worktree 中创建 Session。
- 未绑定 Worktree 的 Session 使用 Project 根目录并显示在 main 视角。
- Worktree Session 的运行时 cwd 是 Worktree 路径，但 DSH Session 数据仍保持原始 Project 归属。
- 切回 project-session 视角时，全部 Session 仍可由 DSH 原始列表展示。
- 插件关系索引只存在于插件自有 data directory/sidecar 中。
- 删除 Worktree 不删除 Session，不修改消息或 transcript。
- sidecar 缺失、关系孤儿、Worktree 删除和并发绑定都有可解释的修复或错误结果。
- data-boundary regression suite 证明 DSH Project、Session、消息和 transcript 内容未被插件写入。

## Non-Goals

本阶段不做：

- 修改 DSH Project/Session schema；
- 将 Worktree 信息写入 DSH Session metadata；
- 迁移或复制已有 Session；
- 多用户权限、远程 Worktree、跨机器索引同步；
- 替换现有 project-session 页面；
- 管理 Worktree 内的业务文件变更或提交策略。

## Bootstrap Plan Integration

插件 package 位于 packages/clutch-dsh-worktree/；仓库 bootstrap 计划和
2026-08-20 package-consolidation plan 共同记录 package identity。实现时先
完成内部 Service Definition 和外部索引 contract，再推进同一 package 的
Provider、Remote 和 Browser Consumer。

## Self-Review

- 用户确认的 external relationship index 方案贯穿数据模型、Provider、Consumer、错误处理和测试。
- 计划明确禁止写入 DSH Project、Session、消息和 transcript，并给出 fixture byte-for-byte regression 测试。
- main、active worktree、detached 三种关系状态均有读取、展示、运行时 cwd 和修复规则。
- project-session 兼容性由 DSH 原始列表保证，插件只提供 Worktree 视角投影。
- 所有跨任务使用的类型和函数名称已在前置任务中定义。
