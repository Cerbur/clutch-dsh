# Worktree UI i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 接入 DSH 原生 LocaleRuntime，使 Worktree mode 的全部插件自有浏览器文案跟随
DSH 当前语言，并保留 DSH/Host 原始错误信息和现有 Worktree 行为。

**Architecture:** '@deepseek-ai/dsh-client-locale' 继续拥有语言选择、持久化和
LocaleFace；本插件只注册 'worktree' namespace 的 'zh/en' 词典。两个 DSH Slot
registration 声明同一 namespace，'PropsLocale.t' 从 Surface 传给内部行、菜单和弹窗。
插件自有错误 code 在浏览器 UI 层格式化，未知 DSH/Host message 原样显示。

**Tech Stack:** TypeScript、React、DSH rc.8 Client Slot/Locale contract、pnpm、Node
test runner、现有 Client composition fixture。

> **Implementation status (2026-08-21):** Completed through Task 5. The implementation
> landed in commits `654466c`, `caaa643`, `3df34bf`, `df1dc0c`, `c41f272`, and
> `ae77063`. `pnpm run check` passes; `check:patches` retains the existing YAML
> `!!js dshHomePath()` warning.

## Global Constraints

- 使用 '@deepseek-ai/dsh-client-locale' rc.8 的 'ctx.locale'、'locale.register'、
  'locale: namespace' 和 'PropsLocale'，不自建 i18n runtime。
- 'worktree' namespace 必须同时注册 'zh' 与 'en'，'zh' 是 key source，'en' 必须经过
  'Record<WorktreeLocaleKey, string>' 完整性检查。
- DSH Host 继续是语言偏好来源；插件不新增语言检测、语言设置、语言存储或语言切换 UI。
- 插件自有可见静态文案、ARIA/title/placeholder、弹窗 copy、状态和恢复按钮全部来自
  'worktree' 词典。
- Workspace/Session/title、branch、absolute path、Session ID、endpoint 和 Git/DSH
  原始技术数据不翻译。
- 未知 DSH/Host error 的原始 'message' 必须原样展示；插件自有 wrapper/fallback
  message 必须通过结构化 code 使用当前语言词条。
- 不修改 Host、Provider、Manage、sidecar schema、Remote contract、DSH Project/Session
  原始数据或 Worktree 生命周期顺序。
- 不把 'lib/'、'dist/'、coverage 或临时 fixture 输出加入 Git。
- 每个生产行为修改遵循 RED → GREEN → REFACTOR；先运行会失败的测试，再写最小实现。

---

## File Map

### Create

- 'packages/clutch-dsh-worktree/src/client/locales.ts' — 'worktree' namespace 常量和
  'zh/en' 词典。
- 'packages/clutch-dsh-worktree/src/client/worktree-error-copy.ts' — UI 层插件错误
  code 到 't()' 的纯格式化边界。
- 'packages/clutch-dsh-worktree/test/client-locale.test.mjs' — 词典 key parity 和
  参数模板 contract。
- 'packages/clutch-dsh-worktree/test/client-error-copy.test.mjs' — 错误文案翻译和原始
  message 保留 contract。

### Modify

- 'packages/clutch-dsh-worktree/package.json' — locale peer/dev dependency 和 Client
  inject metadata。
- 'packages/clutch-dsh-worktree/src/client/entry.ts' — 'ctx.locale' inject、namespace
  declaration、词典生命周期和两个 Slot 的 locale declaration。
- 'packages/clutch-dsh-worktree/src/client/WorktreeModeAction.tsx' — footer 文案改用
  'PropsLocale'。
- 'packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx' — Surface 和内部组件
  传递 't'，替换所有插件自有可见文案。
- 'packages/clutch-dsh-worktree/src/client/worktree-view.ts' — 'WorktreeViewError'
  details 和 binding error 的结构化原始 reason。
- 'packages/clutch-dsh-worktree/src/client/worktree-connection.ts' — 保留 Host 原始
  message，给 adapter-owned errors 提供 endpoint/code details。
- 'packages/clutch-dsh-worktree/test/client-fixture.mjs' — fake locale 的 register/
  dispose 记录。
- 'packages/clutch-dsh-worktree/test/client-composition.test.mjs' — package metadata、
  Client inject、locale registration 和 dispose 断言。
- 'packages/clutch-dsh-worktree/test/dsh-composition.test.mjs' — package metadata 与
  DSH composition contract。
- 'packages/clutch-dsh-worktree/test/client-surface.test.mjs' — Slot locale 和静态
  文案迁移断言。
- 'packages/clutch-dsh-worktree/test/client-connection.test.mjs' — 原始 message 与
  adapter-owned structured error 新 contract。
- 'packages/clutch-dsh-worktree/README.md' — DSH language-following 公开说明。

---

### Task 1: Define the complete 'worktree' dictionary pair

**Files:**

- Create: 'packages/clutch-dsh-worktree/src/client/locales.ts'
- Create: 'packages/clutch-dsh-worktree/test/client-locale.test.mjs'

**Interfaces:**

- Consumes: DSH LocaleRuntime flat dictionaries with 'zh'/'en' IDs.
- Produces: 'WORKTREE_NS', 'zh', 'WorktreeLocaleKey', and 'en'; later tasks import these
  values and merge 'WorktreeLocaleKey' into 'LocaleNamespaceMap'.

- [ ] **Step 1: Write the failing dictionary contract test**

Create 'test/client-locale.test.mjs':

~~~js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORKTREE_NS,
  en,
  zh,
} from '../lib/client/locales.js';

test('exports the Worktree namespace and balanced zh/en dictionaries', () => {
  assert.equal(WORKTREE_NS, 'worktree');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  assert.ok(Object.keys(zh).length >= 60);
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(typeof value, 'string', 'zh.' + key + ' must be a string');
    assert.ok(value.length > 0, 'zh.' + key + ' must not be empty');
    assert.equal(typeof en[key], 'string', 'en.' + key + ' must be a string');
    assert.ok(en[key].length > 0, 'en.' + key + ' must not be empty');
  }
});

test('keeps parameter placeholders in the translated templates', () => {
  assert.match(zh['workspace.options'], /\{name\}/);
  assert.match(en['workspace.options'], /\{name\}/);
  assert.match(zh['session.expandMore'], /\{count\}/);
  assert.match(en['session.expandMore'], /\{count\}/);
  assert.match(zh['error.sessionBindingFailed'], /\{sessionId\}/);
  assert.match(zh['error.sessionBindingFailed'], /\{reason\}/);
  assert.match(en['error.sessionBindingFailed'], /\{sessionId\}/);
  assert.match(en['error.sessionBindingFailed'], /\{reason\}/);
});
~~~

- [ ] **Step 2: Run the focused test and verify the failure is feature-related**

Run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree exec node --test test/client-locale.test.mjs
~~~

Expected: FAIL because 'lib/client/locales.js' does not exist before the new source module
is compiled. Do not create a test-only stub.

- [ ] **Step 3: Add the dictionary source with the exact key set**

Create 'src/client/locales.ts':

~~~ts
export const WORKTREE_NS = 'worktree' as const

export const zh = {
  'mode.open': '打开 Worktree 模式',
  'mode.exit': '退出 Worktree 模式',
  'mode.label': 'Worktree',
  'mode.navigation': 'Worktree 导航',
  'workspace.rename': '重命名',
  'workspace.delete': '删除',
  'workspace.expand': '展开 {name}',
  'workspace.collapse': '收起 {name}',
  'workspace.options': '工作区选项：{name}',
  'workspace.addWorktree': '向 {name} 添加 Worktree',
  'workspace.add': '添加工作区',
  'workspace.search': '搜索工作区和会话',
  'workspace.noMatches': '没有匹配的工作区',
  'workspace.renameTitle': '重命名工作区',
  'workspace.name': '工作区名称',
  'workspace.duplicate': '已存在同名工作区。',
  'workspace.deleteTitle': '删除工作区',
  'workspace.deleteDescription': '删除“{name}”？这只会移除 DSH 工作区注册。目录、会话和 Git Worktree 会保留。',
  'worktree.title': 'Worktree',
  'worktree.main': 'Main',
  'worktree.detached': '已分离 Worktree',
  'worktree.repair': 'Worktree 需要修复',
  'worktree.ready': '活动 Worktree 已就绪',
  'worktree.expand': '展开 {name}',
  'worktree.collapse': '收起 {name}',
  'worktree.addSession': '向 {name} 添加会话',
  'worktree.noWorktrees': '暂无 Worktree',
  'worktree.createTitle': '新建 Worktree',
  'worktree.createDescription': '“{name}” · Worktree 路径由 DSH 管理。',
  'worktree.baseBranch': 'Worktree 基线分支',
  'worktree.noLocalBranch': '没有本地分支',
  'worktree.noBranches': '此工作区中没有找到本地分支。',
  'worktree.name': 'Worktree 名称',
  'worktree.create': '创建 Worktree',
  'session.options': '会话选项：{name}',
  'session.rename': '重命名会话',
  'session.fork': 'Fork 会话',
  'session.archive': '归档会话',
  'session.expandMore': '展开其余 {count} 个会话',
  'session.collapse': '收起',
  'session.name': '会话名称',
  'dialog.close': '关闭',
  'dialog.closeWorkspaceRename': '关闭重命名工作区对话框',
  'dialog.closeWorkspaceDelete': '关闭删除工作区对话框',
  'dialog.closeWorktreeCreate': '关闭创建 Worktree 对话框',
  'dialog.cancel': '取消',
  'dialog.rename': '重命名',
  'dialog.delete': '删除',
  'action.retry': '重试',
  'action.retryBinding': '重试绑定',
  'action.openCreatedSession': '打开已创建的 Session',
  'status.loading': '正在加载工作区…',
  'error.worktreeDataUnavailable': 'Worktree 数据不可用，请重试。',
  'error.connectionDisposed': 'Worktree 连接已释放，请重新加载插件后重试。',
  'error.connectionFailed': 'Worktree endpoint {endpoint} 调用失败；连接错误，可重试：{reason}',
  'error.invalidResult': 'Worktree endpoint {endpoint} 返回了无效结果，请重试请求。',
  'error.workspaceOrderingUnavailable': '工作区排序不可用，请重新连接后重试。',
  'error.sessionOrderingUnavailable': '会话排序不可用，请重新连接后重试。',
  'error.worktreeCreatedSessionUnavailable': 'Worktree 已创建，但 Session 创建不可用，请重新连接后重试。',
  'error.sessionCreationUnavailable': 'Session 创建不可用，请重新连接后重试。',
  'error.worktreeRecordMissing': 'Worktree 创建未返回 Worktree 记录，请重试请求。',
  'error.workspaceRenameUnavailable': '工作区重命名不可用，请重新连接后重试。',
  'error.workspaceDeleteUnavailable': '工作区删除不可用，请重新连接后重试。',
  'error.sessionRenameUnavailable': '会话重命名不可用，请重新连接后重试。',
  'error.sessionBindingFailed': 'Session {sessionId} 已创建，但 Worktree 绑定失败：{reason}',
  'branch.current': '（当前）',
  'branch.checkedOut': '（已检出）',
} satisfies Record<string, string>

export type WorktreeLocaleKey = keyof typeof zh

export const en = {
  'mode.open': 'Open Worktree mode',
  'mode.exit': 'Exit Worktree mode',
  'mode.label': 'Worktree',
  'mode.navigation': 'Worktree navigation',
  'workspace.rename': 'Rename',
  'workspace.delete': 'Delete',
  'workspace.expand': 'Expand {name}',
  'workspace.collapse': 'Collapse {name}',
  'workspace.options': 'Workspace options for {name}',
  'workspace.addWorktree': 'Add Worktree to {name}',
  'workspace.add': 'Add Workspace',
  'workspace.search': 'Search Workspaces and Sessions',
  'workspace.noMatches': 'No matching Workspaces',
  'workspace.renameTitle': 'Rename Workspace',
  'workspace.name': 'Workspace name',
  'workspace.duplicate': 'A Workspace with this name already exists.',
  'workspace.deleteTitle': 'Delete Workspace',
  'workspace.deleteDescription': 'Delete {name}? This removes only the DSH Workspace registration. The directory, Sessions, and Git Worktrees will be retained.',
  'worktree.title': 'Worktrees',
  'worktree.main': 'Main',
  'worktree.detached': 'Detached Worktree',
  'worktree.repair': 'Worktree needs repair',
  'worktree.ready': 'Active Worktree ready',
  'worktree.expand': 'Expand {name}',
  'worktree.collapse': 'Collapse {name}',
  'worktree.addSession': 'Add Session to {name}',
  'worktree.noWorktrees': 'No Worktrees',
  'worktree.createTitle': 'New Worktree',
  'worktree.createDescription': '{name} · the Worktree path is managed by DSH.',
  'worktree.baseBranch': 'Worktree base branch',
  'worktree.noLocalBranch': 'No local branch',
  'worktree.noBranches': 'No local branches found in this Workspace.',
  'worktree.name': 'Worktree name',
  'worktree.create': 'Create Worktree',
  'session.options': 'Session options for {name}',
  'session.rename': 'Rename session',
  'session.fork': 'Fork session',
  'session.archive': 'Archive session',
  'session.expandMore': 'Expand {count} more',
  'session.collapse': 'Collapse',
  'session.name': 'Session name',
  'dialog.close': 'Close',
  'dialog.closeWorkspaceRename': 'Close Rename Workspace dialog',
  'dialog.closeWorkspaceDelete': 'Close Delete Workspace dialog',
  'dialog.closeWorktreeCreate': 'Close Create Worktree dialog',
  'dialog.cancel': 'Cancel',
  'dialog.rename': 'Rename',
  'dialog.delete': 'Delete',
  'action.retry': 'Retry',
  'action.retryBinding': 'Retry Binding',
  'action.openCreatedSession': 'Open Created Session',
  'status.loading': 'Loading Workspaces…',
  'error.worktreeDataUnavailable': 'Worktree data is unavailable. Retry the request.',
  'error.connectionDisposed': 'Worktree connection is disposed; reload the plugin and retry.',
  'error.connectionFailed': 'Worktree endpoint {endpoint} failed; retryable connection error: {reason}',
  'error.invalidResult': 'Worktree endpoint {endpoint} returned an invalid result; retry the request.',
  'error.workspaceOrderingUnavailable': 'Workspace ordering is unavailable; retry after reconnecting.',
  'error.sessionOrderingUnavailable': 'Session ordering is unavailable; retry after reconnecting.',
  'error.worktreeCreatedSessionUnavailable': 'Worktree created, but Session creation is unavailable; retry after reconnecting.',
  'error.sessionCreationUnavailable': 'Session creation is unavailable; retry after reconnecting.',
  'error.worktreeRecordMissing': 'Worktree creation returned no Worktree record; retry the request.',
  'error.workspaceRenameUnavailable': 'Workspace rename is unavailable; retry after reconnecting.',
  'error.workspaceDeleteUnavailable': 'Workspace delete is unavailable; retry after reconnecting.',
  'error.sessionRenameUnavailable': 'Session rename is unavailable; retry after reconnecting.',
  'error.sessionBindingFailed': 'Session {sessionId} was created, but Worktree binding failed: {reason}',
  'branch.current': ' (current)',
  'branch.checkedOut': ' (checked out)',
} satisfies Record<WorktreeLocaleKey, string>
~~~

- [ ] **Step 4: Build and run the focused test**

Run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree exec node --test test/client-locale.test.mjs
~~~

Expected: the build exits with code 0 and both locale tests pass.

- [ ] **Step 5: Commit the dictionary contract**

~~~bash
git add packages/clutch-dsh-worktree/src/client/locales.ts packages/clutch-dsh-worktree/test/client-locale.test.mjs
git commit -m "feat: add Worktree locale dictionaries"
~~~

---

### Task 2: Wire DSH LocaleRuntime into the Client Fiber

**Files:**

- Modify: 'packages/clutch-dsh-worktree/package.json'
- Modify: 'packages/clutch-dsh-worktree/src/client/entry.ts'
- Modify: 'packages/clutch-dsh-worktree/test/client-fixture.mjs'
- Modify: 'packages/clutch-dsh-worktree/test/client-composition.test.mjs'
- Modify: 'packages/clutch-dsh-worktree/test/dsh-composition.test.mjs'

**Interfaces:**

- Consumes: 'WORKTREE_NS', 'zh', 'en', and 'WorktreeLocaleKey' from Task 1.
- Produces: 'ctx.locale' in 'inject', a Fiber-owned dictionary registration, and
  'locale: WORKTREE_NS' on both plugin Slot entries.

- [ ] **Step 1: Add failing metadata and lifecycle assertions**

Append these assertions to the existing package metadata tests in
'test/dsh-composition.test.mjs':

~~~js
test('depends on and injects the DSH locale service', () => {
  assert.equal(
    packageManifest.peerDependencies['@deepseek-ai/dsh-client-locale'],
    '0.1.0-rc.8',
  );
  assert.equal(
    packageManifest.devDependencies['@deepseek-ai/dsh-client-locale'],
    '0.1.0-rc.8',
  );
  assert.ok(packageManifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
});
~~~

Add this test to 'test/client-composition.test.mjs':

~~~js
test('declares the DSH locale service and namespace on both Client Slots', async () => {
  const source = await readFile(
    path.join(packageDirectory, 'src', 'client', 'entry.ts'),
    'utf8',
  );
  assert.match(source, /@deepseek-ai\/dsh-client-locale\/client/);
  assert.match(source, /locale:\s*WORKTREE_NS/);
  assert.equal(packageManifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'), true);

  const fixture = await loadClientEntry();
  assert.equal(fixture.fakeContext.localeRegistrations.length, 1);
  assert.equal(fixture.fakeContext.localeRegistrations[0].namespace, 'worktree');
  assert.deepEqual(Object.keys(fixture.fakeContext.localeRegistrations[0].dictionaries).sort(), [
    'en',
    'zh',
  ]);
  assert.equal(
    fixture.registrationsBySlot.get('sidebar.footer.action').options.locale,
    'worktree',
  );
  assert.equal(
    fixture.registrationsBySlot.get('shell.overlay').options.locale,
    'worktree',
  );

  for (const dispose of fixture.disposers.reverse()) dispose();
  assert.equal(fixture.fakeContext.localeRegistrations.length, 0);
});
~~~

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree exec node --test test/client-composition.test.mjs test/dsh-composition.test.mjs
~~~

Expected: FAIL because the package manifest has no locale dependency, the Client entry has
no locale registration, the Slot options have no locale field, and the fixture has no
'localeRegistrations' collection.

- [ ] **Step 3: Install the DSH locale package and update metadata**

Modify 'package.json' so the DSH Client metadata and dependency entries contain:

~~~json
"dsh": {
  "client": {
    "inject": [
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-runtime",
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-layout",
      "@deepseek-ai/dsh-client-ui-sidebar"
    ],
    "platform": "web"
  }
},
"peerDependencies": {
  "@deepseek-ai/dsh-client-connection": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-locale": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-ui-layout": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-ui-primitives": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-ui-sidebar": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-ui-slots": "0.1.0-rc.8"
},
"devDependencies": {
  "@deepseek-ai/dsh-client-connection": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-locale": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-ui-layout": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-ui-primitives": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-ui-sidebar": "0.1.0-rc.8",
  "@deepseek-ai/dsh-client-ui-slots": "0.1.0-rc.8"
}
~~~

Preserve all existing dependency entries not shown in the excerpt. Run:

~~~bash
pnpm install
~~~

Expected: pnpm resolves '@deepseek-ai/dsh-client-locale@0.1.0-rc.8' and updates only the
workspace lockfile entries needed for that package and its dependencies.

- [ ] **Step 4: Add the Client context merge, registration, and Slot declarations**

At the top of 'src/client/entry.ts', add:

~~~ts
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type { WorktreeLocaleKey } from './locales.js';
import { WORKTREE_NS, en, zh } from './locales.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    worktree: WorktreeLocaleKey;
  }
}
~~~

Change the Client inject declaration to:

~~~ts
export const inject = ['connection', 'locale', 'slots', 'sessions', 'workspaces'];
~~~

At the start of 'apply', register the dictionaries through the Fiber effect:

~~~ts
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(WORKTREE_NS, { zh, en }),
    'clutch-dsh-worktree: locale dictionaries',
  );
  const manager = createWorktreeConnectionAdapter(ctx.connection.rpc);
~~~

Add 'locale: WORKTREE_NS' to both 'ctx.slots.register' option objects. Keep all existing
injected callbacks on the second registration:

~~~ts
{
  name: 'sidebar.footer.action',
  id: 'clutch-dsh-worktree-mode-action',
  store: viewStore,
  locale: WORKTREE_NS,
  inject: () => ({ available: true }),
}
~~~

~~~ts
{
  name: 'shell.overlay',
  id: 'clutch-dsh-worktree-navigation',
  store: viewStore,
  locale: WORKTREE_NS,
  inject: () => ({
    available: true,
    manager,
  }),
}
~~~

- [ ] **Step 5: Extend the browser fixture with a disposable locale face**

In 'test/client-fixture.mjs', define before 'fakeContext':

~~~js
const localeRegistrations = [];
const locale = {
  register(namespace, dictionaries) {
    const entry = { namespace, dictionaries };
    localeRegistrations.push(entry);
    return () => {
      const index = localeRegistrations.indexOf(entry);
      if (index !== -1) localeRegistrations.splice(index, 1);
    };
  },
};
~~~

Add 'locale' to 'fakeContext', return 'localeRegistrations' through
'fakeContext.localeRegistrations', and keep the existing 'effect' implementation so the
registration disposer is exercised by the same teardown loop as the Connection and Slot
disposers.

In the real Cordis composition test, provide:

~~~js
ctx.provide('locale', {
  register() {
    return () => {};
  },
});
~~~

- [ ] **Step 6: Build and rerun the wiring tests**

Run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree exec node --test test/client-composition.test.mjs test/dsh-composition.test.mjs
~~~

Expected: all selected tests pass, including locale registration removal after fixture
disposal; no 'lib/' or 'dist/' file is staged.

- [ ] **Step 7: Commit the runtime wiring**

~~~bash
git add packages/clutch-dsh-worktree/package.json pnpm-lock.yaml packages/clutch-dsh-worktree/src/client/entry.ts packages/clutch-dsh-worktree/test/client-fixture.mjs packages/clutch-dsh-worktree/test/client-composition.test.mjs packages/clutch-dsh-worktree/test/dsh-composition.test.mjs
git commit -m "feat: wire Worktree UI to DSH locale"
~~~

---

### Task 3: Move footer, tree, menu, search, and dialog copy to 't()'

**Files:**

- Modify: 'packages/clutch-dsh-worktree/src/client/WorktreeModeAction.tsx'
- Modify: 'packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx'
- Modify: 'packages/clutch-dsh-worktree/test/client-surface.test.mjs'

**Interfaces:**

- Consumes: 'WORKTREE_NS', 'WorktreeLocaleKey', 'PropsLocale', and Slot declarations from
  Tasks 1–2.
- Produces: reactive 't()' usage for every plugin-owned visible string while preserving
  dynamic data and current interaction callbacks.

- [ ] **Step 1: Add failing source-contract assertions**

Add this test to 'test/client-surface.test.mjs':

~~~js
test('declares the Worktree locale seat and routes visible copy through t', async () => {
  const actionSource = await readFile(
    new URL('../src/client/WorktreeModeAction.tsx', import.meta.url),
    'utf8',
  );
  const surfaceSource = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(actionSource, /PropsLocale/);
  assert.match(surfaceSource, /PropsLocale/);
  assert.match(surfaceSource, /WORKTREE_NS/);
  assert.match(surfaceSource, /t\('workspace\.search'\)/);
  assert.match(surfaceSource, /t\('session\.expandMore'/);
  assert.match(surfaceSource, /t\('dialog\.closeWorkspaceDelete'\)/);
  assert.doesNotMatch(surfaceSource, /Search Workspaces and Sessions/);
  assert.doesNotMatch(surfaceSource, /Retry Binding/);
  assert.doesNotMatch(surfaceSource, /No matching Workspaces/);
  assert.match(surfaceSource, /sidebar-overlay-geometry/);
});
~~~

Update existing source assertions that look for literal visible labels so they check the
corresponding dictionary key or the registration contract instead. Keep assertions for
data affordances, 'Menu', 'Modal', drag behavior, geometry observers, and no
'Remove Worktree'.

- [ ] **Step 2: Run the surface contract test and verify the failure**

Run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree exec node --test test/client-surface.test.mjs
~~~

Expected: FAIL because the components still have literal visible English copy and no
'PropsLocale' type.

- [ ] **Step 3: Add the locale prop types to the two Slot components**

In 'WorktreeModeAction.tsx', import 'PropsLocale' and 'WORKTREE_NS', then define:

~~~ts
export type WorktreeModeActionProps = PropsRuntime<'sidebar.footer.action'> &
  PropsStore<ReturnType<typeof createWorktreeViewStore>> &
  PropsLocale<typeof WORKTREE_NS> &
  WorktreeModeActionInjected;
~~~

Destructure 't' in 'WorktreeModeAction' and replace the three visible values:

~~~tsx
aria-label={active ? t('mode.exit') : t('mode.open')}
title={active ? t('mode.exit') : t('mode.label')}
{wide && <span className={styles.actionLabel}>{t('mode.label')}</span>}
~~~

In 'WorktreeSurface.tsx', import 'PropsLocale', 'TranslateNS', and 'WORKTREE_NS', then
define:

~~~ts
type WorktreeTranslate = TranslateNS<typeof WORKTREE_NS>;

export type WorktreeSurfaceProps = PropsRuntime<'shell.overlay'> &
  PropsStore<ReturnType<typeof createWorktreeViewStore>> &
  PropsLocale<typeof WORKTREE_NS> &
  WorktreeSurfaceInjected;
~~~

Add 'readonly t: WorktreeTranslate' to the props for
'WorktreeWorkspaceRow', 'WorktreeGroupRow', 'WorktreeSessionRow', and
'WorktreeSessionGroup'. Pass the same 't' value through the existing render tree rather
than binding a second namespace inside a child.

- [ ] **Step 4: Replace static visible strings with dictionary lookups**

Use this mapping while editing 'WorktreeSurface.tsx':

| Existing surface | Replacement |
| --- | --- |
| Workspace menu 'Rename' / 'Delete' | 't('workspace.rename')' / 't('workspace.delete')' |
| Workspace disclosure | 't(expanded ? 'workspace.collapse' : 'workspace.expand', { name: workspace.title })' |
| Workspace options button | 't('workspace.options', { name: workspace.title })' |
| Add Worktree button | 't('workspace.addWorktree', { name: workspace.title })' |
| Main label | 't('worktree.main')' |
| Worktree disclosure | 't(expanded ? 'worktree.collapse' : 'worktree.expand', { name: label })' |
| Worktree add Session button | 't('worktree.addSession', { name: workspaceTitle })' |
| Worktree state labels | 't('worktree.detached')', 't('worktree.repair')', 't('worktree.ready')' |
| Session menu | 't('session.rename')', 't('session.fork')', 't('session.archive')' |
| Session options button | 't('session.options', { name: label })' |
| Session overflow | 't(expanded ? 'session.collapse' : 'session.expandMore', { count: sessionIds.length - 5 })' |
| Surface label/title | 't('mode.navigation')' and 't('worktree.title')' |
| Search input | 't('workspace.search')' for ARIA and placeholder |
| Add Workspace button | 't('workspace.add')' |
| Loading/empty states | 't('status.loading')', 't('workspace.noMatches')', 't('worktree.noWorktrees')' |
| Recovery buttons | 't('action.retryBinding')', 't('action.openCreatedSession')', 't('action.retry')' |
| Rename dialogs | 't('dialog.close')', 't('dialog.cancel')', 't('dialog.rename')', 't('session.rename')', 't('workspace.renameTitle')', 't('workspace.name')', 't('session.name')' |
| Delete Workspace dialog | 't('dialog.closeWorkspaceDelete')', 't('workspace.deleteTitle')', 't('workspace.deleteDescription', { name: workspaceDeleteTarget.title })', 't('dialog.cancel')', 't('dialog.delete')' |
| Create Worktree dialog | 't('dialog.closeWorktreeCreate')', 't('worktree.createTitle')', 't('worktree.createDescription', { name: modalWorkspace.title })', 't('worktree.baseBranch')', 't('worktree.noLocalBranch')', 't('worktree.name')', 't('worktree.create')' |
| Branch suffixes | 't('branch.current')' and 't('branch.checkedOut')' |

Keep 'WT', the branch placeholder 'dsh/12345678', the tree guide character, and all
Workspace/Session/branch/path values unchanged. Keep the four native DSH labels in
'findNewSessionAnchor' unchanged because they are compatibility probes, not surface copy.

- [ ] **Step 5: Pass 't' through every internal render call**

At the top-level component, destructure 't':

~~~tsx
export function WorktreeSurface({
  useStore,
  actions,
  useSessions,
  useWorkspaces,
  t,
  available,
  manager,
  createWorkspace,
  createSessionForWorktree: createSessionCallback,
  createMainSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  insertSessionBefore,
  renameSession,
  forkSession,
  archiveSession,
  ensureSessionWorkspace,
  syncSessionWorkspaces,
  openSession,
}: WorktreeSurfaceProps) {
~~~

Pass 't={t}' to every 'WorktreeWorkspaceRow', 'WorktreeGroupRow', and
'WorktreeSessionGroup' call. 'WorktreeSessionGroup' passes 't' to each
'WorktreeSessionRow'. This keeps menu item creation inside render, so a DSH LocaleFace
revision rebuilds menu labels as well as visible text.

- [ ] **Step 6: Build and run the surface tests**

Run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree exec node --test test/client-surface.test.mjs test/client-composition.test.mjs
~~~

Expected: the surface and composition tests pass; generated 'lib/client.js' remains
ignored and no Worktree request, drag, modal, or geometry behavior changes.

- [ ] **Step 7: Commit the visible-copy migration**

~~~bash
git add packages/clutch-dsh-worktree/src/client/WorktreeModeAction.tsx packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx packages/clutch-dsh-worktree/test/client-surface.test.mjs
git commit -m "feat: localize Worktree navigation copy"
~~~

---

### Task 4: Localize plugin-owned errors while preserving raw DSH/Host messages

**Files:**

- Create: 'packages/clutch-dsh-worktree/src/client/worktree-error-copy.ts'
- Create: 'packages/clutch-dsh-worktree/test/client-error-copy.test.mjs'
- Modify: 'packages/clutch-dsh-worktree/src/client/worktree-view.ts'
- Modify: 'packages/clutch-dsh-worktree/src/client/worktree-connection.ts'
- Modify: 'packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx'
- Modify: 'packages/clutch-dsh-worktree/test/client-surface.test.mjs'
- Modify: 'packages/clutch-dsh-worktree/test/client-connection.test.mjs'

**Interfaces:**

- Consumes: 'WorktreeViewError', 'WorktreeSessionBindingError', 'WorktreeConnectionError',
  and 'TranslateNS<typeof WORKTREE_NS>'.
- Produces: 'formatWorktreeViewError(error, t): string'; known plugin/adapter codes use
  dictionary copy, unknown codes return the original error message.

- [ ] **Step 1: Write the failing formatter tests**

Create 'test/client-error-copy.test.mjs':

~~~js
import assert from 'node:assert/strict';
import test from 'node:test';

import { formatWorktreeViewError } from '../lib/client/worktree-error-copy.js';

function t(key, params = {}) {
  const values = Object.entries(params)
    .map(([name, value]) => name + '=' + String(value))
    .join(',');
  return values.length === 0 ? key : key + ':' + values;
}

test('formats plugin-owned binding errors with translated copy and raw reason', () => {
  assert.equal(
    formatWorktreeViewError(
      {
        code: 'SESSION_BINDING_FAILED',
        message: 'sidecar unavailable',
        retryable: true,
        details: { sessionId: 'session-1' },
      },
      t,
    ),
    'error.sessionBindingFailed:sessionId=session-1,reason=sidecar unavailable',
  );
});

test('formats adapter-owned retryable errors with endpoint and raw reason', () => {
  assert.equal(
    formatWorktreeViewError(
      {
        code: 'CONNECTION_CALL_FAILED',
        message: 'socket closed',
        retryable: true,
        details: { endpoint: 'worktreeManager/listWorktrees' },
      },
      t,
    ),
    'error.connectionFailed:endpoint=worktreeManager/listWorktrees,reason=socket closed',
  );
});

test('keeps an unknown DSH or Host message unchanged', () => {
  assert.equal(
    formatWorktreeViewError(
      {
        code: 'HOST_DOMAIN_ERROR',
        message: 'repository is not a Git repository',
        retryable: false,
      },
      t,
    ),
    'repository is not a Git repository',
  );
});

test('uses translated fallback copy when no raw message exists', () => {
  assert.equal(
    formatWorktreeViewError(
      { code: 'WORKTREE_VIEW_FAILED', message: '', retryable: true },
      t,
    ),
    'error.worktreeDataUnavailable',
  );
});
~~~

- [ ] **Step 2: Run the formatter test and verify the failure**

Run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree exec node --test test/client-error-copy.test.mjs
~~~

Expected: FAIL because the formatter module does not exist.

- [ ] **Step 3: Extend the pure error data contract**

In 'worktree-view.ts', change 'WorktreeViewError' to:

~~~ts
export interface WorktreeViewError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}
~~~

Change 'WorktreeSessionBindingError' so its 'message' is only the raw cause reason, while
the class retains 'sessionId':

~~~ts
constructor(sessionId: string, cause: unknown) {
  const reason = cause instanceof Error ? cause.message : String(cause);
  super(reason);
  this.name = 'WorktreeSessionBindingError';
  this.sessionId = sessionId;
  this.cause = cause;
}
~~~

Update 'toWorktreeViewError' to copy an object error's 'details' when it is a record and to
return an empty message for the non-object fallback:

~~~ts
function recordDetails(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const details = (value as { readonly details?: unknown }).details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return undefined;
  return details as Readonly<Record<string, unknown>>;
}

export function toWorktreeViewError(error: unknown): WorktreeViewError {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly retryable?: unknown;
    };
    const details = error instanceof WorktreeSessionBindingError
      ? { ...(recordDetails(error) ?? {}), sessionId: error.sessionId }
      : recordDetails(error);
    return {
      code: typeof candidate.code === 'string' ? candidate.code : 'WORKTREE_VIEW_FAILED',
      message: typeof candidate.message === 'string' ? candidate.message : '',
      retryable: candidate.retryable !== false,
      ...(details === undefined ? {} : { details }),
    };
  }
  return {
    code: 'WORKTREE_VIEW_FAILED',
    message: '',
    retryable: true,
  };
}
~~~

Keep 'createSessionForWorktree''s behavior unchanged: it still leaves the DSH-created
Session intact and throws 'WorktreeSessionBindingError' with the Session ID.

- [ ] **Step 4: Preserve raw adapter messages and add adapter details**

In 'worktree-connection.ts', make the adapter-owned error constructors structured:

~~~ts
function disposedError(): WorktreeConnectionError {
  return new WorktreeConnectionError({
    code: 'CLIENT_DISPOSED',
    message: '',
    details: {},
    retryable: false,
  });
}

function connectionFailure(
  endpoint: string,
  error: unknown,
  code = 'CONNECTION_CALL_FAILED',
): WorktreeConnectionError {
  const message = error instanceof Error ? error.message : String(error);
  return new WorktreeConnectionError({
    code,
    message,
    details: { endpoint },
    retryable: true,
    cause: error,
  });
}
~~~

Change 'gatewayFailure' to guard the untrusted details value before spreading it:

~~~ts
function gatewayFailure(endpoint: string, result: Extract<ConnectionResult, { ok: false }>): never {
  const rawDetails = isRecord(result.error.details) ? result.error.details : {};
  throw new WorktreeConnectionError({
    code: result.error.code,
    message: result.error.message,
    details: { endpoint, ...rawDetails },
    retryable: true,
  });
}
~~~

Change 'invalidResult' to use an empty message and '{ endpoint }' details. Keep the public
error class, retryable values, and '/api' endpoint behavior unchanged.

- [ ] **Step 5: Implement the UI formatter**

Create 'src/client/worktree-error-copy.ts':

~~~ts
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { WorktreeViewError } from './worktree-view.js';
import { WORKTREE_NS } from './locales.js';

type WorktreeTranslate = TranslateNS<typeof WORKTREE_NS>;

function detail(error: WorktreeViewError, name: string): string {
  const value = error.details?.[name];
  return typeof value === 'string' ? value : '';
}

export function formatWorktreeViewError(
  error: WorktreeViewError,
  t: WorktreeTranslate,
): string {
  switch (error.code) {
    case 'CLIENT_DISPOSED':
      return t('error.connectionDisposed');
    case 'CONNECTION_CALL_FAILED':
      return t('error.connectionFailed', {
        endpoint: detail(error, 'endpoint'),
        reason: error.message,
      });
    case 'WORKTREE_RPC_INVALID_RESULT':
      return t('error.invalidResult', { endpoint: detail(error, 'endpoint') });
    case 'WORKSPACE_ORDER_UNAVAILABLE':
      return t('error.workspaceOrderingUnavailable');
    case 'SESSION_ORDER_UNAVAILABLE':
      return t('error.sessionOrderingUnavailable');
    case 'SESSION_CREATE_UNAVAILABLE':
      return t('error.sessionCreationUnavailable');
    case 'WORKTREE_CREATED_SESSION_UNAVAILABLE':
      return t('error.worktreeCreatedSessionUnavailable');
    case 'WORKTREE_RECORD_MISSING':
      return t('error.worktreeRecordMissing');
    case 'WORKSPACE_RENAME_UNAVAILABLE':
      return t('error.workspaceRenameUnavailable');
    case 'WORKSPACE_DELETE_UNAVAILABLE':
      return t('error.workspaceDeleteUnavailable');
    case 'SESSION_RENAME_UNAVAILABLE':
      return t('error.sessionRenameUnavailable');
    case 'SESSION_BINDING_FAILED':
      return t('error.sessionBindingFailed', {
        sessionId: detail(error, 'sessionId'),
        reason: error.message,
      });
    default:
      return error.message.length > 0 ? error.message : t('error.worktreeDataUnavailable');
  }
}
~~~

The code strings used by the formatter must match the objects created in
'WorktreeSurface.tsx'; use the same exact spelling for
'WORKTREE_CREATED_SESSION_UNAVAILABLE' and 'WORKTREE_RECORD_MISSING'.

- [ ] **Step 6: Replace UI error rendering and error literals**

Import 'formatWorktreeViewError' into 'WorktreeSurface.tsx'. Render both
'actionError' and 'readState.error' with:

~~~tsx
{formatWorktreeViewError(actionError, t)}
~~~

~~~tsx
{formatWorktreeViewError(readState.error, t)}
~~~

Replace plugin-owned literal error objects with empty-message structured codes:

~~~ts
setActionError({
  code: 'WORKSPACE_ORDER_UNAVAILABLE',
  message: '',
  retryable: true,
});
~~~

Use the corresponding code for Session ordering, missing Workspace/Session native
capabilities, missing Worktree record, Worktree-created-but-Session-unavailable, and
Session creation unavailable. For missing rename/delete native capabilities, call
't('error.workspaceRenameUnavailable')', 't('error.workspaceDeleteUnavailable')', or
't('error.sessionRenameUnavailable')' directly. For errors thrown by native DSH APIs, keep
'error.message' or 'String(error)' unchanged.

- [ ] **Step 7: Update connection and surface tests, then run the RED/GREEN cycle**

Update 'test/client-connection.test.mjs' so transport failures assert:

~~~js
assert.equal(error.message, 'endpoint missing');
assert.equal(error.details.endpoint, 'worktreeManager/listWorktrees');
~~~

Keep assertions for 'code', 'retryable', abort behavior, and raw domain error propagation.
Update 'test/client-surface.test.mjs' to require 'formatWorktreeViewError' for both error
render paths and to assert that old plugin-owned literals are absent from the Surface source.

Run:

~~~bash
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree exec node --test test/client-error-copy.test.mjs test/client-connection.test.mjs test/client-surface.test.mjs
~~~

Expected: all selected tests pass; a synthetic unknown Host error remains unchanged while
known adapter/plugin codes use the translator.

- [ ] **Step 8: Commit structured error copy**

~~~bash
git add packages/clutch-dsh-worktree/src/client/worktree-error-copy.ts packages/clutch-dsh-worktree/test/client-error-copy.test.mjs packages/clutch-dsh-worktree/src/client/worktree-view.ts packages/clutch-dsh-worktree/src/client/worktree-connection.ts packages/clutch-dsh-worktree/src/client/WorktreeSurface.tsx packages/clutch-dsh-worktree/test/client-surface.test.mjs packages/clutch-dsh-worktree/test/client-connection.test.mjs
git commit -m "feat: localize Worktree error copy"
~~~

---

### Task 5: Document the DSH language boundary and run the complete verification suite

**Files:**

- Modify: 'packages/clutch-dsh-worktree/README.md'
- Verify: all files changed by Tasks 1–4 and existing package tests

**Interfaces:**

- Consumes: the completed 'worktree' dictionaries, DSH LocaleRuntime wiring, UI formatter,
  and existing package public behavior.
- Produces: public documentation and fresh evidence for package/workspace acceptance.

- [ ] **Step 1: Write the documentation expectation**

Before editing the README, verify the current README has no section that claims the plugin
owns its own language setting:

~~~bash
rg -n -i 'language|语言|locale|i18n|国际化' packages/clutch-dsh-worktree/README.md
~~~

Expected: the command finds no existing user-facing locale contract that must be preserved
verbatim.

- [ ] **Step 2: Add the public language note**

Add this section after the usage instructions and before current limitations:

~~~markdown
## 界面语言

Worktree mode 跟随 DSH 当前界面语言。语言选择和偏好持久化由 DSH 提供；插件不增加
独立的语言设置。当前插件随 DSH 提供中文和 English 文案，切换 DSH 语言后，Worktree
入口、Workspace/Worktree/Session 树、菜单、弹窗、状态和重试提示会同步切换。

Workspace、Session、branch、path 以及 DSH/Host 返回的原始错误信息保持原值，便于
诊断和继续使用 DSH 原生数据。
~~~

Keep the existing source-of-truth, rc.8 compatibility, installation, workaround, and
removal limitation text unchanged.

- [ ] **Step 3: Run targeted package validation**

Run from the workspace root:

~~~bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

Expected: every command exits with code 0; the package test command rebuilds ignored
artifacts and reports no failing Node tests.

- [ ] **Step 4: Run the complete workspace check**

~~~bash
pnpm run check
~~~

Expected: the workspace checker accepts the updated package manifest, patch layer, source
boundaries, and README without requiring changes outside the Worktree package.

- [ ] **Step 5: Inspect the final diff and status**

~~~bash
git diff --check
git status --short
git diff --stat
git diff -- packages/clutch-dsh-worktree/package.json packages/clutch-dsh-worktree/src/client packages/clutch-dsh-worktree/test packages/clutch-dsh-worktree/README.md
~~~

Confirm manually:

- 'lib/' and 'dist/' are not staged;
- no Host/Manage/Provider file changed;
- no new DSH data or sidecar field was introduced;
- no plugin-local language storage or selector was added;
- 'sidebar-overlay-geometry.ts' still recognizes DSH's Chinese and English native labels;
- all plugin-owned visible copy is in 'src/client/locales.ts';
- unknown DSH/Host error messages still appear verbatim.

- [ ] **Step 6: Commit the public documentation and verification-ready state**

~~~bash
git add packages/clutch-dsh-worktree/README.md
git commit -m "docs: document DSH language inheritance"
~~~

After this task, re-run 'git status --short' and report the exact verification commands and
their exit results in the handoff.
