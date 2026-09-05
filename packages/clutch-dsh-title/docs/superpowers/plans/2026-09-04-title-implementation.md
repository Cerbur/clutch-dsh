# @cerbur/clutch-dsh-title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH 原生 @deepseek-ai/dsh-session-title / ctx.sessionTitle seam 上新增 @cerbur/clutch-dsh-title，以一个可覆盖的 default preset、受控 template DSL 和单次结构化 LLM extraction 生成确定性的 Session Title；保留 DSH 原生 persistence、fallback、rename、refresh、fork、取消、并发和 stale-result 语义。

**Architecture:** 一个 atomic、host-only 的 Cordis function plugin 注册唯一的 first-prompt provider。配置解析器先将 default preset 与用户覆盖合并并编译模板；provider 从 DSH request 中选取首次 human message，确定性解析 datetime/literal 字段，再用一次 ctx.llm.stream 提取全部 llm-* 字段，严格校验后渲染 title。bundle patch 通过禁用当前 DSH 默认 provider，再插入本 provider，避免引入第二套 title service 或绕过原生 event/persistence。

**Tech Stack:** TypeScript ES2022/NodeNext、pnpm workspace、@deepseek-ai/cordis 4.0.1、@deepseek-ai/dsh-session-title >=0.1.2-rc.1、@deepseek-ai/dsh-session-title-llm 的 request-event/timeout seam、@deepseek-ai/dsh-llm BlockAssembler 与 ctx.llm.stream、@deepseek-ai/schemastery 3.18.1、Node built-in test runner、YAML patch validation、Prettier、ESLint、tsc。

## Global Constraints

- 所有实现和验证都在 /Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_9127140b-5786-4435-a56d-b24fd813d8d0，也就是 wt-session-0.1.0/release；不修改 /Users/yuancheng/Documents/Code/deepseek-harness 源码。
- 用户已有的 packages/clutch-dsh-title/docs/superpowers/specs/2026-09-04-title-design.md 必须保留并作为设计 source of truth；若实现必须偏离，先更新该 spec 并在本计划对应任务中记录原因。
- peer dependency 的 DSH 下界固定为 >=0.1.2-rc.1，不能恢复上限，也不能写成 workspace:*；@deepseek-ai/cordis 固定为 4.0.1。
- automatic mode 固定为 first-prompt；v0.1 不实现 all-prompts、全局 custom prompt、条件/循环/表达式模板、独立字段请求、后台摘要、自有 UI 或历史 title migration。
- plugin 只注册 @deepseek-ai/dsh-session-title provider，不创建第二个 title service，不复制 session/title persistence、fallback、rename、refresh、fork 或 concurrency coordinator。
- provider 结果不在 plugin 内实现最终 maxTitleBytes 策略；字段级 maxCharacters 在 renderer 前校验，最终 UTF-8 title 限制继续由 DSH native service 处理。
- LLM 只返回结构化字段，不返回最终 title。JSON 非法、字段缺失、enum 非法、文本超长、模板无法渲染、取消、超时、空输出、tool call 或非 stop finish 都必须让 provider reject，使 DSH native fallback 接管。
- 所有 LLM 字段每次 generation 合并为一次 extraction request；datetime/literal 不进入 LLM prompt。
- 所有模板插值必须是安全的 ${identifier} placeholder；不执行 eval，不支持函数、表达式、条件或循环。字段值在渲染前 trim、单行化并清理控制字符。
- provider 不保存跨请求可变状态，不缓存 title 或字段；这样 DSH 的 request revision、取消、并发和 stale-result 防护仍是唯一 authority。
- 新 package 使用仓库现有 package convention：源码在 src/，Node test 文件在 test/*.test.mjs，测试先构建 lib 后通过 test/load-module.mjs 加载；不额外引入 Vitest。
- 可运行 package 必须同时拥有 package.json、cordis.patch.yml、tsconfig.json、src/index.ts、build/lint/typecheck/test scripts、README.md、README.zh.md、assets/screenshots/ 和 package-specific docs/RELEASING.md。
- README.md 与 README.zh.md 的公开章节顺序必须是：功能介绍（含截图）、能力、安装（先 npm 再源码）、详细使用（含相关图片）。README 不重复当前 package version。
- 本计划只描述实现步骤，不执行 commit、push、npm publish、外部 DSH bundle 安装或历史数据修改。计划中的 commit 命令是执行者在每个任务完成并检查干净后使用的指令。

---

## 1. 当前 seam、行为和文件映射

### 1.1 必须遵循的 DSH contract

实现者先以当前 DSH 0.1.2-rc.1 的公开类型为准，不凭记忆改写接口：

```ts
export interface SessionTitleProviderRequest {
  readonly session: Session;
  readonly messages: readonly SessionTitleUserMessage[];
  readonly route?: SessionTitleModelProvenance;
  readonly signal: AbortSignal;
}

export interface SessionTitleProviderResult {
  readonly title: string;
  readonly messageSeqs: readonly SessionSeq[];
  readonly model?: SessionTitleModelProvenance;
}

export interface SessionTitleProvider {
  readonly id: SessionTitleProviderId;
  readonly automatic: 'first-prompt' | 'all-prompts';
  generate(request: SessionTitleProviderRequest): Promise<SessionTitleProviderResult>;
}
```

当前默认 provider 的 id 是 session-title-first-prompt-llm，inject 为 sessionTitle、llm、sessions，并通过 DSH 的 session-title-llm helper 选择首条 eligible human message。新 provider 继续注入相同的三个 service，provider id 改为 clutch-dsh-title。

当前可复用的原生 auxiliary request event 是 session/title-llm-request，payload 包含 titleProvider、messageSeqs、route、system、messages 和 maxTokens。新 extractor 必须在实际 ctx.llm.stream dispatch 前写入该 event，并将 source message seq 设置为真正参与 extraction 的首条 message。

### 1.2 目标文件映射

下表是完整文件地图；除标记为 update 的文件外，不应把实现散落到根 workspace 或 DSH checkout。

```text
packages/clutch-dsh-title/
├── package.json                                      [new]
├── cordis.patch.yml                                  [new]
├── tsconfig.json                                     [new]
├── README.md                                         [new]
├── README.zh.md                                      [new]
├── RELEASE-LOG.md                                    [new]
├── assets/screenshots/title-default.svg              [new]
├── docs/RELEASING.md                                 [new]
├── docs/superpowers/specs/2026-09-04-title-design.md [existing]
├── docs/superpowers/plans/2026-09-04-title-implementation.md [this plan]
├── src/
│   ├── index.ts                                      [new]
│   ├── types.ts                                      [new]
│   ├── config.ts                                     [new]
│   ├── provider.ts                                   [new]
│   ├── extractor.ts                                  [new]
│   ├── renderer.ts                                   [new]
│   ├── fields.ts                                     [new]
│   └── presets/default.ts                            [new]
└── test/
    ├── load-module.mjs                               [new]
    ├── package-manifest.test.mjs                     [new]
    ├── config.test.mjs                               [new]
    ├── renderer.test.mjs                             [new]
    ├── fields.test.mjs                               [new]
    ├── extractor.test.mjs                            [new]
    ├── composition.test.mjs                          [new]
    ├── bundle-patch.test.mjs                         [new]
    └── readme-parity.test.mjs                        [new]

pnpm-lock.yaml                                        [update: pnpm install after manifest changes]
```

设计 spec 中使用 tests/ 作为概念目录；本计划使用 test/，因为当前 clutch-dsh-fireworks、clutch-dsh-discuss 和 workspace test script 都采用 test/*.test.mjs。

### 1.3 公开 TypeScript 接口

为避免配置、renderer、field resolver 和 provider 各自发明不兼容的 shape，先在 src/types.ts 固定以下类型。字段名开放，但字段 kind 封闭：

```ts
export type DateTimeFieldConfig = {
  readonly kind: 'datetime';
  readonly source: 'session.createdAt';
  readonly format: string;
  readonly timezone: string;
};

export type LiteralFieldConfig = {
  readonly kind: 'literal';
  readonly value: string;
};

export type LlmEnumFieldConfig = {
  readonly kind: 'llm-enum';
  readonly instruction: string;
  readonly values: readonly string[];
};

export type LlmTextFieldConfig = {
  readonly kind: 'llm-text';
  readonly instruction: string;
  readonly maxCharacters: number;
};

export type TitleFieldConfig =
  DateTimeFieldConfig | LiteralFieldConfig | LlmEnumFieldConfig | LlmTextFieldConfig;

export interface CompiledTemplate {
  readonly source: string;
  readonly segments: readonly (
    | { readonly kind: 'literal'; readonly text: string }
    | { readonly kind: 'field'; readonly name: string }
  )[];
}

export interface TitleConfig {
  readonly preset?: string;
  readonly template?: string;
  readonly fields?: Readonly<Record<string, TitleFieldConfig>>;
  readonly maxInputBytes?: number;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
  readonly provider?: string;
  readonly model?: string;
}

export interface ResolvedTitleConfig {
  readonly preset: 'default';
  readonly template: string;
  readonly fields: Readonly<Record<string, TitleFieldConfig>>;
  readonly compiledTemplate: CompiledTemplate;
  readonly maxInputBytes: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly provider?: string;
  readonly model?: string;
}
```

实现时保持以下函数边界，不把 prompt 组装、日期格式化或 template parsing 塞进 provider：

```ts
export function compileTemplate(
  template: string,
  declaredFields: ReadonlySet<string>,
): CompiledTemplate;

export function renderTemplate(
  template: CompiledTemplate,
  values: Readonly<Record<string, string>>,
): string;

export function formatDateTime(timestampMs: number, format: string, timezone: string): string;

export function resolveDeterministicFields(
  fields: Readonly<Record<string, TitleFieldConfig>>,
  createdAt: number,
): Readonly<Record<string, string>>;

export function validateExtractedFields(
  fields: Readonly<Record<string, TitleFieldConfig>>,
  candidate: unknown,
): Readonly<Record<string, string>>;
```

extractor 的 runtime API 固定为一次请求、一次结果：

```ts
export interface ExtractedLlmFields {
  readonly values: Readonly<Record<string, string>>;
  readonly model: SessionTitleModelProvenance;
}

export function extractLlmFields(
  ctx: Context,
  config: ResolvedTitleConfig,
  request: SessionTitleProviderRequest,
  selectedMessages: readonly SessionTitleUserMessage[],
  titleProvider: SessionTitleProviderId,
): Promise<ExtractedLlmFields>;
```

provider 工厂只接收已解析配置：

```ts
export function createTitleProvider(
  ctx: Context,
  config: ResolvedTitleConfig,
): SessionTitleProvider;
```

---

## 2. 执行任务

### Task 1: 建立 package manifest、host-only bundle contract 和测试入口

**Files:**

- Create packages/clutch-dsh-title/package.json.
- Create packages/clutch-dsh-title/tsconfig.json.
- Create packages/clutch-dsh-title/cordis.patch.yml.
- Create packages/clutch-dsh-title/test/package-manifest.test.mjs.
- Create packages/clutch-dsh-title/test/load-module.mjs.
- Update pnpm-lock.yaml through pnpm install; do not hand-edit lockfile entries.

- [ ] **Step 1 — Write the failing manifest test**

先写 Node built-in test，读取 package.json 与 cordis.patch.yml，锁定 package identity、host-only exports、runtime script、metadata 和 peer range：

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { load } from 'yaml';

const root = path.resolve(import.meta.dirname, '..');

test('declares the atomic host-only title plugin contract', async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

  assert.equal(packageJson.name, '@cerbur/clutch-dsh-title');
  assert.equal(packageJson.type, 'module');
  assert.deepEqual(packageJson.exports['.'], {
    types: './lib/index.d.ts',
    import: './lib/index.js',
    default: './lib/index.js',
  });
  assert.equal(packageJson.exports['./package.json'], './package.json');
  assert.deepEqual(packageJson.files, ['lib', 'cordis.patch.yml', 'assets']);
  assert.deepEqual(packageJson.publishConfig, {
    access: 'public',
    registry: 'https://registry.npmjs.org/',
  });
  assert.deepEqual(packageJson.dsh, { bundle: { patch: './cordis.patch.yml' } });
  assert.deepEqual(packageJson.clutchDsh, {
    plugin: '@cerbur/clutch-dsh-title',
    role: 'plugin',
    serviceDefinition: '@cerbur/clutch-dsh-title',
  });
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-session-title'], '>=0.1.2-rc.1');
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-session-title-llm'], '>=0.1.2-rc.1');
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-llm'], '>=0.1.2-rc.1');
  assert.equal(packageJson.scripts.build, 'tsc -p tsconfig.json');
  assert.equal(packageJson.scripts.test, 'pnpm run build && node --test test/*.test.mjs');
});

test('keeps the patch document available next to the package entrypoint', async () => {
  const patchText = await readFile(path.join(root, 'cordis.patch.yml'), 'utf8');
  const patch = load(patchText);

  assert.equal(patch[0].id, 'session-title-llm');
  assert.equal(patch[0].name, '@deepseek-ai/dsh-session-title-first-prompt-llm');
  assert.equal(patch[0].disabled, true);
  assert.equal(patch[1].insert[0].id, 'clutch-dsh-title');
  assert.equal(patch[1].insert[0].name, '@cerbur/clutch-dsh-title');
  assert.deepEqual(patch[1].insert[0].config, { preset: 'default' });
});
```

Run the focused test before creating the package files:

```bash
node --test packages/clutch-dsh-title/test/package-manifest.test.mjs
```

Expected result before implementation is a file-not-found failure for package.json; do not weaken the test to make the missing package pass.

- [ ] **Step 2 — Implement the package shape**

使用与 clutch-dsh-fireworks/discuss 相同的发布元数据，package.json 的初始 version 设为 0.1.0，README 不复制该版本。实现以下 contract：

- package name 为 @cerbur/clutch-dsh-title，license 为 MIT，repository directory 为 packages/clutch-dsh-title，homepage 指向对应 GitHub tree。
- publishConfig 固定为 access public 和官方 registry https://registry.npmjs.org/，不在 package metadata 中加入其他发布入口。
- exports 只提供根 host entry 和 ./package.json；不添加 client、contract 或 browser entry。
- files 为 lib、cordis.patch.yml、assets；README 与 package.json 由 npm 默认包含，仓库 docs 和 RELEASE-LOG.md 不进入 package tarball。
- scripts 为 prepublishOnly、build、lint、typecheck、test；build 为 tsc -p tsconfig.json，lint 为 eslint src，typecheck 为 tsc --noEmit -p tsconfig.json，test 为 pnpm run build && node --test test/*.test.mjs。
- clutchDsh 为 plugin role，serviceDefinition 为自身 package name。
- dependencies 直接声明 @deepseek-ai/schemastery，版本跟随当前 lockfile 的 3.18.1 兼容线；直接 import 的 DSH runtime packages 作为 peerDependencies，不复制 host service。
- peerDependencies 至少包括 @deepseek-ai/cordis、@deepseek-ai/dsh-llm、@deepseek-ai/dsh-session、@deepseek-ai/dsh-session-title、@deepseek-ai/dsh-session-title-llm、@deepseek-ai/dsh-timeout 和 @deepseek-ai/dsh-util-values；除 cordis 外全部 DSH peer 使用 >=0.1.2-rc.1，不设上限。
- devDependencies 使用当前 DSH 0.1.2-rc.1 与 root 已有工具版本，另外加入真实 patch composition 所需的 @deepseek-ai/cordis-plugin-include、@deepseek-ai/cordis-plugin-loader、@deepseek-ai/dsh-agent-loop、@deepseek-ai/dsh-session-projection、@types/node、typescript 和 yaml。
- tsconfig.json extends ../../tsconfig.base.json，rootDir 为 src，outDir 为 lib，include 为 src/**/*.ts。

test/load-module.mjs 使用当前 package 的 compiled lib，保持测试与发布产物一致：

```js
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const libraryRoot =
  process.env.CLUTCH_DSH_TITLE_TEST_LIB ?? path.resolve(import.meta.dirname, '../lib');

export async function loadPackageModule(name) {
  return import(pathToFileURL(path.join(libraryRoot, name + '.js')).href);
}
```

cordis.patch.yml 必须精确使用当前 DSH base row 的 id/name guard：

```yaml
- id: session-title-llm
  name: '@deepseek-ai/dsh-session-title-first-prompt-llm'
  disabled: true

- insert:
    - id: clutch-dsh-title
      name: '@cerbur/clutch-dsh-title'
      config:
        preset: default
```

创建一个空的 src 目录和 test 目录不等于完成 package；本任务只要求 manifest/patch 测试可独立运行，src/index.ts 和完整运行时入口在 Task 6 形成，之后再通过 workspace guard。

- [ ] **Step 3 — Install and verify the manifest**

```bash
pnpm install
node --test packages/clutch-dsh-title/test/package-manifest.test.mjs
```

Expected output contains:

```text
TAP version 13
1..2
# tests 2
# pass 2
# fail 0
```

Task 1 的 check:workspace 在 src/index.ts 尚未形成前可以暂不作为 task gate；实现者应在 Task 6 形成入口后重新运行，不能通过新增 no-op plugin 来绕过必需入口。

- [ ] **Step 4 — Commit**

```bash
git add packages/clutch-dsh-title/package.json packages/clutch-dsh-title/tsconfig.json packages/clutch-dsh-title/cordis.patch.yml packages/clutch-dsh-title/test/package-manifest.test.mjs packages/clutch-dsh-title/test/load-module.mjs pnpm-lock.yaml
git commit -m "feat(title): scaffold session title plugin"
```

### Task 2: 实现 default preset、配置合并和 schema validation

**Files:**

- Create packages/clutch-dsh-title/src/types.ts.
- Create packages/clutch-dsh-title/src/presets/default.ts.
- Create packages/clutch-dsh-title/src/config.ts.
- Create packages/clutch-dsh-title/test/config.test.mjs.

- [ ] **Step 1 — Write failing config tests**

先覆盖用户确认的默认配置和 whole-config replacement 下的 partial override。默认值必须是：

```js
const resolved = resolveTitleConfig({});

assert.equal(resolved.preset, 'default');
assert.equal(resolved.template, '${daytime}|${type}|${desc}');
assert.deepEqual(resolved.fields.type, {
  kind: 'llm-enum',
  instruction: '判断这个 session 的任务类型',
  values: ['前端', '后端', '配置', '文档'],
});
assert.deepEqual(resolved.fields.desc, {
  kind: 'llm-text',
  instruction: '总结首次 prompt，保留具体任务含义',
  maxCharacters: 32,
});
assert.equal(resolved.fields.daytime.kind, 'datetime');
assert.equal(resolved.fields.daytime.source, 'session.createdAt');
assert.equal(resolved.fields.daytime.format, 'MMDD');
assert.equal(resolved.fields.daytime.timezone, 'Asia/Shanghai');
assert.equal(resolved.maxInputBytes, 4096);
assert.equal(resolved.maxOutputTokens, 512);
assert.equal(resolved.timeoutMs, 60000);
```

再写以下失败案例：unknown preset；template 引用未声明字段；非法 field identifier；datetime 的 source 不是 session.createdAt；literal 缺少非空 value；llm-enum 的 values 为空、重复或含空字符串；llm-text 的 maxCharacters 非正整数；provider/model 只给一边；预算非正整数或 timeout 超出 MAX_TIMER_DELAY_MS；顶层或 field 中出现未知 key。

partial override 测试必须证明字段按名字合并、单个 field definition 整体替换：

```js
const resolved = resolveTitleConfig({
  preset: 'default',
  template: '${type}: ${desc}',
  fields: {
    desc: {
      kind: 'llm-text',
      instruction: '用不超过 20 个字总结首次 prompt',
      maxCharacters: 20,
    },
    scope: {
      kind: 'literal',
      value: 'work',
    },
  },
});

assert.equal(resolved.template, '${type}: ${desc}');
assert.equal(resolved.fields.daytime.kind, 'datetime');
assert.deepEqual(resolved.fields.scope, { kind: 'literal', value: 'work' });
assert.equal(resolved.fields.desc.maxCharacters, 20);
```

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/config.test.mjs
```

Expected result before source implementation is an import/build failure; after the red phase, all config cases pass.

- [ ] **Step 2 — Implement the schema and resolver**

在 src/presets/default.ts 导出不可变 DEFAULT_PRESET：

```ts
export const DEFAULT_PRESET = {
  preset: 'default',
  template: '${daytime}|${type}|${desc}',
  fields: {
    daytime: {
      kind: 'datetime',
      source: 'session.createdAt',
      format: 'MMDD',
      timezone: 'Asia/Shanghai',
    },
    type: {
      kind: 'llm-enum',
      instruction: '判断这个 session 的任务类型',
      values: ['前端', '后端', '配置', '文档'],
    },
    desc: {
      kind: 'llm-text',
      instruction: '总结首次 prompt，保留具体任务含义',
      maxCharacters: 32,
    },
  },
} as const;
```

在 src/config.ts：

- 用 @deepseek-ai/schemastery 的 z.object、z.union、z.const、z.dict、z.array、.default() 声明可被 DSH loader 静态发现的 Config schema。
- fields 使用 dynamic dictionary，但 resolver 手动验证 field identifier；允许 project、scope、action 等合法名字，不允许点号、空格、placeholder 符号或原型污染 key。
- schema 的可选预算默认是 4096 bytes、64 output tokens、60000 ms；provider/model 都是 optional，但 resolver 必须执行成对检查。
- resolveTitleConfig 先复制 default preset，再按 preset name 选择当前唯一 preset，最后用显式 template 覆盖 template，并按 field name 替换 field definition。field definition 不做 property-level merge。
- resolver 对输入做 deepFreeze，返回 ResolvedTitleConfig；在返回前调用 compileTemplate，确保错误在 config load 阶段暴露，而不是第一次请求时暴露。
- 只允许 preset default；unknown preset 必须报错，不静默回退。

- [ ] **Step 3 — Run focused tests**

```bash
pnpm --filter @cerbur/clutch-dsh-title typecheck
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/config.test.mjs
```

确认 resolveTitleConfig 不修改 caller-owned fields object，且返回的 compiledTemplate 与最终 template 同步。

- [ ] **Step 4 — Commit**

```bash
git add packages/clutch-dsh-title/src/types.ts packages/clutch-dsh-title/src/presets/default.ts packages/clutch-dsh-title/src/config.ts packages/clutch-dsh-title/test/config.test.mjs
git commit -m "feat(title): add preset configuration resolver"
```

### Task 3: 实现安全 template compiler 和 deterministic renderer

**Files:**

- Create packages/clutch-dsh-title/src/renderer.ts.
- Create packages/clutch-dsh-title/test/renderer.test.mjs.
- Update packages/clutch-dsh-title/src/config.ts only to connect compiledTemplate.

- [ ] **Step 1 — Write failing renderer tests**

```js
const compiled = compileTemplate(
  '${daytime}|类型[${type}]|描述[${desc}]',
  new Set(['daytime', 'type', 'desc']),
);

assert.deepEqual(compiled.segments, [
  { kind: 'field', name: 'daytime' },
  { kind: 'literal', text: '|类型[' },
  { kind: 'field', name: 'type' },
  { kind: 'literal', text: ']|描述[' },
  { kind: 'field', name: 'desc' },
  { kind: 'literal', text: ']' },
]);
assert.equal(
  renderTemplate(compiled, {
    daytime: '0903',
    type: '配置',
    desc: '优化 session title 生成规则',
  }),
  '0903|类型[配置]|描述[优化 session title 生成规则]',
);
```

另加纯 literal、中文 punctuation、unknown field、未闭合 placeholder、空 placeholder、非法 identifier、嵌套 placeholder、缺少 runtime value、函数/路径/条件/表达式注入等测试。renderer 只能拼接已验证值，不得执行代码或截断最终 title。

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/renderer.test.mjs
```

- [ ] **Step 2 — Implement the compiler**

在 src/renderer.ts 使用单次线性扫描构造 literal/field segments：

- 识别 ${identifier}，identifier 规则为 ASCII letter/underscore 开头，后续只允许 ASCII letter、digit、underscore。
- 每个 placeholder 立即和 declaredFields 比较；失败抛出带 template source 和 field name 的 Error。
- 普通 $ 按 literal 处理；出现 ${ 后若没有完整合法 identifier 和 }，直接抛错，避免静默当作普通文本。
- 不使用 new Function、eval 或 expression engine。

renderTemplate 只遍历 segments，从 values 取 string；不存在的 key 或非 string 直接抛错。值的 trim、单行化和控制字符清理由 fields validation 完成，renderer 不复制第二套 normalization。

- [ ] **Step 3 — Run focused tests**

```bash
pnpm --filter @cerbur/clutch-dsh-title typecheck
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/renderer.test.mjs packages/clutch-dsh-title/test/config.test.mjs
```

- [ ] **Step 4 — Commit**

```bash
git add packages/clutch-dsh-title/src/renderer.ts packages/clutch-dsh-title/src/config.ts packages/clutch-dsh-title/test/renderer.test.mjs
git commit -m "feat(title): add safe template renderer"
```

### Task 4: 实现 deterministic field resolver 和严格 LLM field validation

**Files:**

- Create packages/clutch-dsh-title/src/fields.ts.
- Create packages/clutch-dsh-title/test/fields.test.mjs.

- [ ] **Step 1 — Write failing field tests**

日期必须从 session.createdAt 固定计算，而不是使用 generation 当前时间：

```js
const timestamp = Date.UTC(2026, 8, 3, 16, 0);

assert.equal(formatDateTime(timestamp, 'MMDD', 'Asia/Shanghai'), '0904');
assert.equal(formatDateTime(timestamp, 'MMDD', 'UTC'), '0903');
assert.equal(formatDateTime(timestamp, 'YYYY-MM-DD', 'Asia/Shanghai'), '2026-09-04');
```

测试确定性字段和严格 dynamic field validation：

```js
const values = resolveDeterministicFields(
  {
    daytime: {
      kind: 'datetime',
      source: 'session.createdAt',
      format: 'MMDD',
      timezone: 'Asia/Shanghai',
    },
    scope: { kind: 'literal', value: '  work  ' },
  },
  timestamp,
);

assert.deepEqual(values, { daytime: '0904', scope: 'work' });
```

llm-enum 只接受 exact declared value；llm-text trim 后按 Unicode code point 计算 maxCharacters；缺失、null、array、number、nested object、extra key、清理后为空和超长都 reject。换行、回车、NUL 等控制字符要被清理成单行值。invalid timezone、unknown date token、非安全 timestamp、空 literal 也要在 boundary 失败。

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/fields.test.mjs
```

- [ ] **Step 2 — Implement date formatting and field validation**

在 src/fields.ts：

- formatDateTime 使用 Intl.DateTimeFormat 的完整 options { timeZone, hourCycle: 'h23' }.formatToParts；先验证 timezone，再按有限 token map 组装结果。
- v0.1 支持 YYYY、MM、DD、DDD、HH、mm；MMDD 是默认格式。未知 token 直接报错，不执行任意日期表达式。
- format 由有限 token 与非字母分隔符组成；任何未支持的 ASCII letter 都直接报错，避免把拼写错误当作字面日期。
- DDD 为该 timezone 下的 day-of-year，使用 timezone-local calendar date 计算，不隐含 UTC 偏移。
- resolveDeterministicFields 只处理 datetime/literal；llm-* 不写入 values。
- normalizeFieldValue 在 length check 前执行 trim、CRLF/CR/LF 转空格、控制字符移除和重复 whitespace collapse；使用 Array.from(value).length 计算字符数。
- validateExtractedFields 要求 candidate 是 plain object、exact dynamic keys，enum 做 exact membership，text 做 code-point limit。
- 返回 deep-frozen plain object。

- [ ] **Step 3 — Run focused tests**

```bash
pnpm --filter @cerbur/clutch-dsh-title typecheck
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/fields.test.mjs
```

确认实现没有读取 Date.now()；同一 session.createdAt 多次解析必须完全相同。

- [ ] **Step 4 — Commit**

```bash
git add packages/clutch-dsh-title/src/fields.ts packages/clutch-dsh-title/test/fields.test.mjs
git commit -m "feat(title): add deterministic field validation"
```

### Task 5: 实现单次结构化 extraction prompt 和 native request event

**Files:**

- Create packages/clutch-dsh-title/src/extractor.ts.
- Create packages/clutch-dsh-title/test/extractor.test.mjs.
- Create packages/clutch-dsh-title/test/llm-fixture.mjs if a reusable deterministic stream fixture is needed.

- [ ] **Step 1 — Write failing extractor tests with a fake ctx.llm.stream**

fake stream 必须记录完整 GenerateOptions、session append 顺序和 finish reason，不调用真实网络：

```js
const events = [];
const requests = [];
const ctx = {
  llm: {
    async *stream(options) {
      requests.push(options);
      yield {
        type: 'text-delta',
        index: 0,
        text: '{"type":"配置","desc":"优化 session title 生成规则"}',
      };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  },
};
const request = {
  session: {
    id: 'title-session',
    append(type, data) {
      events.push({ type, data });
    },
  },
  messages: [{ seq: 7, text: '请优化 session title 生成规则' }],
  route: { provider: 'main-route', model: 'main-model' },
  signal: new AbortController().signal,
};
```

断言 system prompt 含 instruction/enum values、只返回一个 JSON object、无 Markdown/解释/额外 key、human message 是 data；datetime/literal 不进入 schema；user message 使用 JSON framing；requests[0] 的 purpose、sessionId、signal、maxTokens 正确；session/title-llm-request 在 stream 第一次执行前写入且 payload 与 dispatch 完全一致；返回 values 经过 validateExtractedFields，model 是最终 route；所有 llm fields 只触发一次 stream。

失败协议逐一覆盖 invalid JSON、Markdown code fence、extra/missing field、非法 enum、超长 text、非 object root、input bytes 超限、dispatch 前/stream 中 abort、SESSION_TITLE_TIMEOUT、empty text、tool-call、max-tokens、error、aborted 和未知 finish。

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/extractor.test.mjs
```

- [ ] **Step 2 — Implement the extractor against public DSH primitives**

src/extractor.ts 只复用原生 low-level seam，不调用原生“直接生成纯文本 title”的 helper：

- 按 declaration order 选择 llm-enum/llm-text，生成稳定 system prompt；enum values 使用 JSON 编码，instruction 以 field label 分隔。
- selectedMessages 至少含首条 message；用 JSON.stringify 包在一条 createUserMessage 中，source 为 { kind: 'plugin', plugin: 'clutch-dsh-title' }。
- 使用 @deepseek-ai/dsh-llm 的 BlockAssembler、StreamChunk/GenerateOptions、createUserMessage；任何 tool-call block 都 reject。
- 使用 @deepseek-ai/dsh-timeout 的 deadline 和 MAX_TIMER_DELAY_MS；timeout code 使用 SESSION_TITLE_TIMEOUT_CODE。
- config.provider/config.model 必须成对；没有 override 时使用 request.route，没有 route 则 reject。
- options 传 provider、model、messages、system、maxTokens、request.session.id、purpose session-title 和 deadline.signal。
- 在 ctx.llm.stream 前追加 session/title-llm-request，类型使用 SessionTitleLlmRequestEventData。
- 完成后检查 finish reason、只保留 text blocks、strict JSON.parse(text.trim())，然后调用 validateExtractedFields。
- 用 deepFreeze detach values、route 和 messages；不暴露 request.messages 原始数组。
- extractor 只返回 values 和 model，不生成最终 title。

- [ ] **Step 3 — Run focused tests**

```bash
pnpm --filter @cerbur/clutch-dsh-title typecheck
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/extractor.test.mjs
```

- [ ] **Step 4 — Commit**

```bash
git add packages/clutch-dsh-title/src/extractor.ts packages/clutch-dsh-title/test/extractor.test.mjs packages/clutch-dsh-title/test/llm-fixture.mjs
git commit -m "feat(title): add structured title extraction"
```

### Task 6: 接入 DSH provider、原生 title service 和 first-prompt lifecycle

**Files:**

- Create packages/clutch-dsh-title/src/provider.ts.
- Create packages/clutch-dsh-title/src/index.ts.
- Create packages/clutch-dsh-title/test/composition.test.mjs.
- Create packages/clutch-dsh-title/test/dsh-fixture.mjs if a reusable real Context fixture is needed.

- [ ] **Step 1 — Write failing provider/composition tests**

fixture 参考 DSH 当前 session-title-first-prompt-llm 的 provider.spec.ts/provider.e2e.ts，但使用 Node built-in test 和 fake LlmAdapter。Context 至少加载 LlmRuntime、SessionStore、SessionProjectionRegistry、turnBoundaryProjectionDefinition、SessionTitleService，再加载本 plugin。

```js
class RecordingAdapter extends LlmAdapter {
  requests = [];
  response = '{"type":"配置","desc":"优化 session title 生成规则"}';

  async *stream(options) {
    this.requests.push(options);
    yield { type: 'text-delta', index: 0, text: this.response };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
```

先写这些行为断言：

- apply(ctx, { preset: 'default' }) 注册 id clutch-dsh-title、automatic first-prompt，不注册另一个 service。
- session.createdAt 为 Date.UTC(2026, 8, 3, 16, 0) 时 refresh 产生 0904|配置|优化 session title 生成规则，source.provider 为 clutch-dsh-title，source.model 是 adapter route。
- title event 和 provider result 的 messageSeqs 只包含首次 eligible human message seq。
- 自动 generation 和 explicit refresh 都只把首条 prompt 传给 extractor；第二条 prompt 不会自动触发，也不能出现在首条 extraction payload。
- adapter 返回 invalid JSON 时保留/回到 DSH native fallback，不出现 plugin 半成品 title。
- rename 后 title 被 native pin；后续 prompt 和 refresh 不覆盖，除非走 DSH 原生显式 unpin。
- refresh 使用同一 createdAt；配置变化只在新的 explicit refresh 生效，已有 title event 不迁移。
- fork 继承已有 title events；两个 provider 注册触发 DSH native single-provider invariant。
- 两个并发 generation 使用各自 request/session/message snapshot，一个 request 的结果不能写入另一个 session。

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/composition.test.mjs
```

- [ ] **Step 2 — Implement provider.ts and index.ts**

createTitleProvider 的 generate 流程必须保持以下顺序：

```ts
async generate(request) {
  const first = request.messages[0]
  if (first === undefined) {
    throw new Error('clutch-dsh-title requires one human message')
  }
  const deterministic = resolveDeterministicFields(
    config.fields,
    request.session.header.createdAt,
  )
  const extracted = hasLlmFields(config.fields)
    ? await extractLlmFields(ctx, config, request, [first], titleProvider)
    : undefined
  const values = mergeFieldValues(deterministic, extracted?.values)
  const rendered = renderTemplate(config.compiledTemplate, values)
  const title = normalizeSessionTitle(rendered, Number.MAX_SAFE_INTEGER)
  if (title.length === 0) {
    throw new Error('clutch-dsh-title renderer produced an empty title')
  }
  return {
    title,
    messageSeqs: [first.seq],
    ...(extracted === undefined ? {} : { model: extracted.model }),
  }
}
```

实际代码中将 helper 落到 provider.ts 或从 fields/renderer 导入，不保留伪代码。provider id 使用 SessionTitleProviderId('clutch-dsh-title')，automatic 固定 first-prompt；不读当前时间，不寻找后续 message，不调用 ctx.sessionTitle.refresh，不维护 cache/pending map/debounce timer。merge 要求 template 所需 fields 全部存在；冲突 key reject。render 后只做 native normalizeSessionTitle 的非长度清理或等价单行校验，maxTitleBytes 仍由 DSH 处理。提取失败直接 throw，不 catch 后自写 fallback。

provider.ts 需要把两个内部 helper 固定为纯函数，便于单元测试和避免隐式共享状态：

```ts
function hasLlmFields(fields: Readonly<Record<string, TitleFieldConfig>>): boolean;

function mergeFieldValues(
  deterministic: Readonly<Record<string, string>>,
  extracted: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>>;
```

mergeFieldValues 遇到同名 key、缺失 template field 或非 string value 必须抛错；它不能以后写值覆盖先写值。

src/index.ts 遵循 named export：

```ts
export const name = 'clutch-dsh-title';
export const inject = ['sessionTitle', 'llm', 'sessions'];
export type Config = TitleConfig;
export const Config: z<Config> = TitleConfigSchema;

export function apply(ctx: Context, config: Config): void {
  ctx.sessionTitle.register(createTitleProvider(ctx, resolveTitleConfig(config)));
}
```

- [ ] **Step 3 — Run integration tests and workspace checks**

```bash
pnpm --filter @cerbur/clutch-dsh-title typecheck
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/composition.test.mjs
pnpm run check:workspace
```

Expected output includes composition tests passing and workspace shape ok。

- [ ] **Step 4 — Commit**

```bash
git add packages/clutch-dsh-title/src/index.ts packages/clutch-dsh-title/src/provider.ts packages/clutch-dsh-title/test/composition.test.mjs packages/clutch-dsh-title/test/dsh-fixture.mjs
git commit -m "feat(title): register native session title provider"
```

### Task 7: 验证 bundle patch 替换和 Loader composition

**Files:**

- Create packages/clutch-dsh-title/test/bundle-patch.test.mjs.
- Update packages/clutch-dsh-title/test/composition.test.mjs if the loader test shares the Context fixture.
- Update packages/clutch-dsh-title/cordis.patch.yml only if current DSH base row verification proves the id/name changed; any such change must also update the design spec.

- [ ] **Step 1 — Write failing patch-fold and Loader tests**

第一组测试使用 @deepseek-ai/cordis-plugin-include 的 entryListSchema 与 applyEntryPatches 读取真实 patch：

```js
const base = [
  {
    id: 'session-title-llm',
    name: '@deepseek-ai/dsh-session-title-first-prompt-llm',
    config: { targetWords: 5 },
  },
];
const composed = applyEntryPatches(base, patch, () => {});

assert.equal(composed.find((entry) => entry.id === 'session-title-llm').disabled, true);
assert.deepEqual(
  composed.find((entry) => entry.id === 'clutch-dsh-title'),
  {
    id: 'clutch-dsh-title',
    name: '@cerbur/clutch-dsh-title',
    config: { preset: 'default' },
  },
);
```

再用 name 被改写的 base row 验证 patch 不会把同 id 的未知 package 静默禁用；按当前 include API 断言 warning 或 disabled 状态。Loader composition 测试加载 DSH llm/session/projection/title 与本 plugin，断言没有未加载且未 disabled entry，fake adapter 生成 deterministic title；同时启用默认 provider 和本 plugin 时断言 native single-provider error。

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/bundle-patch.test.mjs packages/clutch-dsh-title/test/composition.test.mjs
```

- [ ] **Step 2 — Implement patch/composition assertions**

- patch 测试必须使用 package 内真实 cordis.patch.yml，不复制硬编码 YAML 作为唯一输入。
- 用 yaml.load(patchText, { schema: entryListSchema }) 解析，确保 patch shape 可被 DSH loader 接受。
- 用 applyEntryPatches 复现 DSH 单次 patch fold，不修改 DSH checkout 的 base manifest。
- 保持顺序为 disable default，再 insert custom；custom row 只提供 preset default，让 resolver 填充其余默认值。
- 明确记录直接修改 existing row name 不可用：name 不匹配时 patch 应跳过，id/name guard 是升级审查契约。

- [ ] **Step 3 — Run repository-level validation**

```bash
pnpm --filter @cerbur/clutch-dsh-title typecheck
pnpm --filter @cerbur/clutch-dsh-title build
node --test packages/clutch-dsh-title/test/bundle-patch.test.mjs packages/clutch-dsh-title/test/composition.test.mjs
pnpm run check:patches
```

如果 DSH 当前 base bundle 不再使用 expected id/name，停止任务，更新 spec 与 patch，不扩大为 fuzzy matching。

- [ ] **Step 4 — Commit**

```bash
git add packages/clutch-dsh-title/test/bundle-patch.test.mjs packages/clutch-dsh-title/test/composition.test.mjs packages/clutch-dsh-title/cordis.patch.yml
git commit -m "test(title): verify bundle provider replacement"
```

### Task 8: 完成双语公开文档、release metadata 和 screenshot

**Files:**

- Create packages/clutch-dsh-title/README.md.
- Create packages/clutch-dsh-title/README.zh.md.
- Create packages/clutch-dsh-title/RELEASE-LOG.md.
- Create packages/clutch-dsh-title/docs/RELEASING.md.
- Create packages/clutch-dsh-title/assets/screenshots/title-default.svg.
- Create packages/clutch-dsh-title/test/readme-parity.test.mjs.

- [ ] **Step 1 — Write documentation contract tests**

readme-parity.test.mjs 读取两份 README，验证章节顺序、截图、安装命令、配置 key parity 和 peer range：

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const readme = await readFile(path.join(root, 'README.md'), 'utf8');
const readmeZh = await readFile(path.join(root, 'README.zh.md'), 'utf8');

const requiredEnglish = [
  '## Feature overview',
  '## Capabilities',
  '## Installation',
  '### npm registry',
  '### Source checkout',
  '## Usage',
];
const requiredChinese = [
  '## 功能介绍',
  '## 能力',
  '## 安装',
  '### npm registry',
  '### 源码 checkout',
  '## 详细使用',
];

for (const heading of requiredEnglish) assert.notEqual(readme.indexOf(heading), -1);
for (const heading of requiredChinese) assert.notEqual(readmeZh.indexOf(heading), -1);
assert.ok(readme.indexOf('## Feature overview') < readme.indexOf('## Capabilities'));
assert.ok(readme.indexOf('## Capabilities') < readme.indexOf('## Installation'));
assert.ok(readme.indexOf('## Installation') < readme.indexOf('## Usage'));
assert.ok(readme.includes('assets/screenshots/title-default.svg'));
assert.ok(readmeZh.includes('assets/screenshots/title-default.svg'));
assert.ok(readme.includes('dsh plugin --profile web add @cerbur/clutch-dsh-title'));
assert.ok(readmeZh.includes('dsh plugin --profile web add @cerbur/clutch-dsh-title'));
assert.ok(
  readme.includes(
    'dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-title',
  ),
);
assert.ok(
  readmeZh.includes(
    'dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-title',
  ),
);
assert.ok(readme.includes('>=0.1.2-rc.1'));
assert.ok(readmeZh.includes('>=0.1.2-rc.1'));
assert.ok(!/0\.1\.0/.test(readme));
assert.ok(!/0\.1\.0/.test(readmeZh));

const requiredKeys = [
  'preset',
  'template',
  'fields',
  'daytime',
  'type',
  'desc',
  'kind',
  'instruction',
  'values',
  'maxCharacters',
  'format',
  'timezone',
];
for (const key of requiredKeys) {
  assert.ok(readme.includes(key));
  assert.ok(readmeZh.includes(key));
}
```

两份 README 的 public config example 必须包含相同 YAML keys：preset、template、fields、daytime、type、desc、kind、instruction、values、maxCharacters、format、timezone。翻译只允许出现在 prose，不允许翻译 key 或 package name。

- [ ] **Step 2 — Write the public docs and visual asset**

两份 README 都要说明：

- plugin 通过 DSH native ctx.sessionTitle 替换 session-title-first-prompt-llm；
- default title shape 和以下精确 YAML：

```yaml
preset: default

template: '${daytime}|${type}|${desc}'

fields:
  daytime:
    kind: datetime
    source: session.createdAt
    format: MMDD
    timezone: Asia/Shanghai

  type:
    kind: llm-enum
    instruction: 判断这个 session 的任务类型
    values: [前端, 后端, 配置, 文档]

  desc:
    kind: llm-text
    instruction: 总结首次 prompt，保留具体任务含义
    maxCharacters: 32
```

- custom template、任意 field name 和 values [优化, 功能, 修复] 的示例；
- 所有 LLM field 一次 JSON request，datetime/literal deterministic；
- DSL 安全且不支持函数/表达式；
- error 进入 DSH native fallback；maxTitleBytes、persistence、rename pin、refresh、fork、cancellation、stale-result 保持 native；
- 现有 session 只有 explicit refresh 才使用新配置，不批量迁移 title；
- 只能有一个 provider，不得重新启用默认 provider 或安装另一个 title provider。

title-default.svg 是不依赖网络或外部字体的小型文档截图，展示示例 title 0903|配置|优化 session title 生成规则 以及 refresh/rename 说明；README 以相对路径引用。

docs/RELEASING.md 只记录实际 package 参数并引用根 docs/RELEASING.md：

```md
# @cerbur/clutch-dsh-title 发布与安装

通用流程见仓库根目录的 ../../../docs/RELEASING.md。

| 参数             | 值                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------- |
| npm package      | @cerbur/clutch-dsh-title                                                                 |
| plugin directory | packages/clutch-dsh-title                                                                |
| release name     | title                                                                                    |
| release worktree | wt-title-<version>/release                                                               |
| release tag      | title-release-<version>                                                                  |
| bundle patch     | cordis.patch.yml                                                                         |
| source install   | pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-title |

本包为 host-only atomic plugin，peer DSH 下界为 >=0.1.2-rc.1；发布前必须验证 disable default + insert custom 的 patch composition，npm pack 只能在 release worktree 执行。
```

RELEASE-LOG.md 初始写 0.1.0 条目，中文在上、英文在下；每项新增功能各用一句中文和一句英文，不写 commit hash 或 subject。根 README.md 当前的表格只列已发布 plugin，本次 execution 不把尚未发布的 title package 写入该表；package-specific 文档全部留在 plugin 目录。

- [ ] **Step 3 — Run documentation tests and formatting**

```bash
node --test packages/clutch-dsh-title/test/readme-parity.test.mjs
pnpm exec prettier --check packages/clutch-dsh-title README.md
pnpm exec eslint packages/clutch-dsh-title/src
```

Expected output is documentation parity pass, Prettier pass and no ESLint errors。README 不出现 0.1.0，只有 RELEASE-LOG.md 可以出现该版本。

- [ ] **Step 4 — Commit**

```bash
git add packages/clutch-dsh-title/README.md packages/clutch-dsh-title/README.zh.md packages/clutch-dsh-title/RELEASE-LOG.md packages/clutch-dsh-title/docs/RELEASING.md packages/clutch-dsh-title/assets/screenshots/title-default.svg packages/clutch-dsh-title/test/readme-parity.test.mjs
git commit -m "docs(title): document installation and title templates"
```

### Task 9: 执行完整验证、打包预览和交接检查

**Files:**

- No new source files; verify all files in the file map.
- Generated lib/ and local build metadata must remain untracked or excluded according to existing package convention; do not add coverage or temporary fixture output.

- [ ] **Step 1 — Run focused package checks**

```bash
pnpm --filter @cerbur/clutch-dsh-title typecheck
pnpm --filter @cerbur/clutch-dsh-title build
pnpm --filter @cerbur/clutch-dsh-title test
```

Expected result: tsc succeeds and all package Node tests pass, including config, renderer, fields, extractor, composition, patch and README parity.

- [ ] **Step 2 — Run workspace checks**

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run check
```

Expected result includes workspace shape ok, patch validation success, no formatting/type/lint failures and zero test failures。若全量 test 因其他 package 的既有问题失败，记录实际 package、命令和错误，不修改无关 plugin；title package focused checks 仍必须通过。

- [ ] **Step 3 — Inspect package contents in the release worktree**

只在当前 release worktree 执行构建后的 dry-run，不 publish：

```bash
pnpm --filter @cerbur/clutch-dsh-title build
cd packages/clutch-dsh-title
npm pack --dry-run
cd ../..
git diff --check
git status --short --untracked-files=all
```

tarball preview 必须包含 README.md、README.zh.md、package.json、cordis.patch.yml、assets/ 和 lib/；不应包含 src/、test/、docs/、RELEASE-LOG.md、coverage 或临时输出。

- [ ] **Step 4 — Review against the acceptance matrix**

逐项给出测试或文件证据：

- package 被 workspace 发现，patch schema 和 root patch checker 通过；
- patch composition 后默认 provider disabled，clutch-dsh-title 是唯一 provider；
- 首次 prompt 只产生一条 native extraction request event 和最终 title event；
- default preset 生成 MMDD|type|desc deterministic title；
- template、field name、enum values、instruction 和 maxCharacters 可配置；
- invalid JSON、missing/invalid fields、over-limit text、timeout/cancel/tool-call 均走 native fallback；
- 后续 prompt 不自动生成，refresh 显式重试，rename pin、fork inheritance、persistence 和 stale-result 仍由 DSH 管理；
- result messageSeqs 和 model provenance 正确；
- peer constraint 是 >=0.1.2-rc.1，没有误加旧上限；
- 双语 README、package release doc、release log 和 screenshot 路径完整。

- [ ] **Step 5 — Commit the final implementation slice**

只有在实现和文档完成、git diff --check 通过、没有无关改动时创建最终 scoped commit。若前面每个 task 已提交，Task 9 不制造空 commit；若采用一次 inline execution，则使用：

```bash
git add packages/clutch-dsh-title pnpm-lock.yaml
git commit -m "feat(title): add configurable session title plugin"
```

不要在本计划执行中执行 git push、npm publish、release merge、main merge 或 annotated tag；这些动作遵循根 docs/RELEASING.md 并需要用户单独授权。

---

## 3. 设计到实现的验收矩阵

| 设计决策                                 | 实现位置                                | 最小验证                              |
| ---------------------------------------- | --------------------------------------- | ------------------------------------- |
| 原生 @deepseek-ai/dsh-session-title seam | src/index.ts、src/provider.ts           | composition.test.mjs                  |
| 只替换默认 provider                      | cordis.patch.yml、bundle-patch.test.mjs | patch fold + single-provider error    |
| first-prompt                             | src/provider.ts                         | 首条/第二条 prompt lifecycle test     |
| default preset                           | src/presets/default.ts、src/config.ts   | config.test.mjs                       |
| 用户 template                            | src/renderer.ts                         | renderer.test.mjs + README example    |
| 动态 field kind                          | src/fields.ts、src/extractor.ts         | fields/extractor tests                |
| 单次 JSON extraction                     | src/extractor.ts                        | fake stream call count = 1            |
| native request event                     | src/extractor.ts                        | event-before-dispatch assertion       |
| native fallback                          | provider rejects without fallback catch | invalid JSON/timeout composition test |
| native maxTitleBytes                     | no plugin final byte policy             | native service integration assertion  |
| createdAt/timezone determinism           | src/fields.ts                           | UTC/Asia-Shanghai test + refresh test |
| rename/refresh/fork/concurrency          | DSH SessionTitleService                 | composition lifecycle tests           |
| peer >=0.1.2-rc.1                        | package.json/docs/README                | manifest/readme tests                 |
| bilingual public docs                    | README.md、README.zh.md                 | readme-parity.test.mjs                |

## 4. 预计执行顺序和停止条件

执行顺序必须是 Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9。每个 task 完成后先运行该 task 的 focused tests，再决定是否创建该 task 的 scoped commit。

遇到以下情况立即停止实现并回到设计确认，而不是通过兼容性猜测继续：

- DSH 当前 session-title-llm base row 的 id/name 与 spec 不一致；
- SessionTitleProvider、SessionTitleLlmRequestEventData 或 ctx.llm.stream 的公开类型无法支持本计划的 request/result；
- DSH loader 的 patch name guard 语义改变；
- native SessionTitleService 不再负责本计划假设的 fallback、rename、refresh 或 stale-result 语义；
- schemastery dynamic dictionary 无法表达安全的 field schema，且 workaround 会把任意代码执行引入配置；
- 必须修改 deepseek-harness 源码或新增 client/contract package 才能满足目标。

在最终交接中只报告实际完成的代码、测试命令、失败项和未执行的外部动作；不要把计划中的命令描述成已经运行过的命令。

## 5. Execution notes (2026-09-04)

The MVP implementation was completed in this release worktree in the same session. The package tests (43/43), package typecheck/lint, workspace structure and patch checks, formatting, root lint/typecheck, and frozen offline installation passed.

The full workspace test still has one compatibility failure in the existing `clutch-dsh-fireworks` host fixture: pnpm's generated peer graph combines the old `@deepseek-ai/dsh-session@0.1.1-rc.2` fixture with `@deepseek-ai/dsh-llm@0.1.2-rc.1`, which does not export `CallId`. The same fixture passes in the untouched baseline checkout. No DSH source or unrelated plugin source was changed to mask this mixed-version issue.

No commit, publish, push, release merge, main merge, or annotated tag was performed.
