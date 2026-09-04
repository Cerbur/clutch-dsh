# 礼花工具调用强化与提示词优化 (Fireworks Tool Calling & Prompt Optimization) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强 `@cerbur/clutch-dsh-fireworks` 的工具描述与系统行为准则注入，消除模型因极简主义偏置（Parsimony Bias）与触发主观性导致的“不愿主动调用 `happy_fireworks`”问题，使其在大任务收尾时自然、准确地触发庆祝。

**Architecture:** 采用“契约描述具象化 + 系统行为准则注入”双层强化策略。底层在 `src/contract/index.ts` 与 `src/fireworks-tool.ts` 中重构工具描述，显式鼓励调用、枚举四大具体触发里程碑（设计文档完成、Feature 研发验证、复杂 Bug 修复、全量测试通过）并建立日常琐碎操作的负向边界；顶层在 `src/index.ts` 中通过 `ctx.inject(['systemPrompt'])` 注入系统级策略 section（order 2950），在模型最终收尾轮直接提供决策心智。

**Tech Stack:** TypeScript, Cordis 4.0.1, `@deepseek-ai/dsh-tools`, Node.js native test runner (`node:test`, `node:assert`).

**Spec:** 会话 `session-df05f24f-c082-4840-8dfa-6675fbab4585` 讨论的“工具自身 Description 具象化 + `systemPrompt.section` 系统行为准则注入 + 单元测试与双语文档同步”实施方案。

## Global Constraints

- 遵循 clutch-dsh 根目录 `AGENTS.md` 规范与 Feature Worktree 变更边界，不越界修改无关 package。
- 保持 Cordis 服务的可选注入解耦特性：`sessionProjections` 与 `systemPrompt` 均采用 `ctx.inject` 延迟挂载，在宿主未提供时平滑降级，不阻断插件加载。
- 变更必须满足严苛的类型与测试校验：`pnpm --filter @cerbur/clutch-dsh-fireworks typecheck` 和 `pnpm --filter @cerbur/clutch-dsh-fireworks test` 必须全量通过。
- 遵循双语文档规范：同步更新 `packages/clutch-dsh-fireworks/README.md` 与 `README.zh.md`。

---

### Task 1: 声明系统提示词契约与工具描述常量

**Files:**

- Modify: `packages/clutch-dsh-fireworks/src/contract/index.ts`
- Test: `packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs`

**Interfaces:**

- Consumes: 无
- Produces:
  - `FIREWORKS_GUIDANCE_SECTION_NAME: 'tool:fireworks'`
  - `FIREWORKS_GUIDANCE_SECTION_ORDER: 2950`
  - `FIREWORKS_GUIDANCE_PROMPT: string`
  - `FIREWORKS_TOOL_DESCRIPTION: string`
  - `FIREWORKS_MESSAGE_DESCRIPTION: string`

- [ ] **Step 1: 编写失败的契约常量单测**

在 `packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs` 顶部引入新增的常量，并编写针对新增契约常量的验证用例：

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIREWORKS_GUIDANCE_PROMPT,
  FIREWORKS_GUIDANCE_SECTION_NAME,
  FIREWORKS_GUIDANCE_SECTION_ORDER,
  FIREWORKS_MESSAGE_DESCRIPTION,
  FIREWORKS_META_KIND,
  FIREWORKS_PROJECTION_KEY,
  FIREWORKS_TOOL_DESCRIPTION,
  FIREWORKS_TOOL_NAME,
} from '../lib/contract/index.js';
// ... 保持原有导入 ...

test('exports complete guidance and description contract constants', () => {
  assert.equal(FIREWORKS_GUIDANCE_SECTION_NAME, 'tool:fireworks');
  assert.equal(FIREWORKS_GUIDANCE_SECTION_ORDER, 2950);
  assert.match(FIREWORKS_GUIDANCE_PROMPT, /major milestone/i);
  assert.match(FIREWORKS_GUIDANCE_PROMPT, /happy_fireworks/);
  assert.match(FIREWORKS_TOOL_DESCRIPTION, /explicitly expected and encouraged/i);
  assert.match(FIREWORKS_TOOL_DESCRIPTION, /Do not call for trivial routine steps/i);
  assert.match(FIREWORKS_MESSAGE_DESCRIPTION, /celebration banner/i);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @cerbur/clutch-dsh-fireworks test`
Expected: FAIL（报错提示 `FIREWORKS_GUIDANCE_SECTION_NAME` 等未在 `../lib/contract/index.js` 中导出）。

- [ ] **Step 3: 在 `src/contract/index.ts` 中实现常量导出**

修改 `packages/clutch-dsh-fireworks/src/contract/index.ts`，新增以下定义并导出：

```typescript
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types';

export const FIREWORKS_TOOL_NAME = 'happy_fireworks' as const;
export const FIREWORKS_PROJECTION_KEY = 'fireworks' as const;
export const FIREWORKS_META_KIND = 'clutch-dsh-fireworks' as const;
export const FIREWORKS_DURATION_MS = 3_200;
export const MAX_FIREWORKS_MESSAGE_CHARS = 120;

export const FIREWORKS_GUIDANCE_SECTION_NAME = 'tool:fireworks' as const;
export const FIREWORKS_GUIDANCE_SECTION_ORDER = 2950;
export const FIREWORKS_GUIDANCE_PROMPT =
  'When you reach a major milestone—such as finishing an architecture/design document or implementation plan, ' +
  'completing a feature implementation and verifying it, resolving a complex bug, or passing full verification—' +
  'invoke the `happy_fireworks` tool to celebrate the achievement with the user in your concluding turn. ' +
  'Do not invoke it for routine intermediate actions (such as reading a file or running git status).';

export const FIREWORKS_TOOL_DESCRIPTION =
  'Celebrate the completion of a significant work milestone by launching festive fireworks in the Web UI. ' +
  'You are explicitly expected and encouraged to invoke this tool upon reaching a major milestone, including: ' +
  '(1) finishing the design or specification of a document or plan, ' +
  '(2) completing the implementation and verification of a feature, ' +
  '(3) resolving and verifying a complex bug, or ' +
  '(4) passing the entire test suite after a refactor or migration. ' +
  'Do not call for trivial routine steps (e.g., reading a file, inspecting git status, running a single check). ' +
  'Provide an encouraging short message summarizing the achievement in the celebration banner.';

export const FIREWORKS_MESSAGE_DESCRIPTION =
  'Optional brief, congratulatory summary of what was accomplished to display in the celebration banner (e.g. "Worktree feature implemented & all tests passing!").';

export interface FireworksSignal {
  readonly id: string;
  readonly message?: string;
}

export type FireworksProjection = FireworksSignal | null;

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    fireworks: FireworksProjection;
  }

  interface SessionProjectionStateMap {
    fireworks: FireworksProjection;
  }
}

export type { SessionProjectionMap };
```

- [ ] **Step 4: 运行构建与测试验证通过**

Run: `pnpm --filter @cerbur/clutch-dsh-fireworks build && pnpm --filter @cerbur/clutch-dsh-fireworks test`
Expected: PASS（契约常量测试全部通过）。

- [ ] **Step 5: 提交改动**

```bash
git add packages/clutch-dsh-fireworks/src/contract/index.ts packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs
git commit -m "feat(fireworks): define prompt guidance and tool description contract constants"
```

---

### Task 2: 重构 `happyFireworksTool` 的 Description 与 Parameter 定义

**Files:**

- Modify: `packages/clutch-dsh-fireworks/src/fireworks-tool.ts`
- Test: `packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs`

**Interfaces:**

- Consumes:
  - `FIREWORKS_TOOL_DESCRIPTION`, `FIREWORKS_MESSAGE_DESCRIPTION` from `./contract/index.js`
- Produces:
  - `happyFireworksTool.description === FIREWORKS_TOOL_DESCRIPTION`
  - `happyFireworksTool.parameters.message.description === FIREWORKS_MESSAGE_DESCRIPTION`

- [ ] **Step 1: 在单测中增加对工具描述和参数描述的精确校验**

在 `packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs` 中的 `registers the happy_fireworks tool with no required input` 测试中补充断言：

```javascript
test('registers the happy_fireworks tool with no required input', async () => {
  assert.equal(name, 'clutch-dsh-fireworks');
  assert.deepEqual(inject, ['tools']);
  assert.equal(happyFireworksTool.name, FIREWORKS_TOOL_NAME);
  assert.equal(happyFireworksTool.description, FIREWORKS_TOOL_DESCRIPTION);
  assert.equal(
    happyFireworksTool.parameters.properties.message.description,
    FIREWORKS_MESSAGE_DESCRIPTION,
  );
  assert.deepEqual(await happyFireworksTool.execute({ message: '  MVP shipped!  ' }, directExec), {
    id: 'call-42',
    message: 'MVP shipped!',
  });
  assert.deepEqual(await happyFireworksTool.execute({}, directExec), { id: 'call-42' });
  assert.deepEqual(
    happyFireworksTool.output.presentationMeta({}, { id: 'call-42', message: 'MVP shipped!' }),
    { kind: FIREWORKS_META_KIND, id: 'call-42', message: 'MVP shipped!' },
  );
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @cerbur/clutch-dsh-fireworks test`
Expected: FAIL（`happyFireworksTool.description` 与 `FIREWORKS_TOOL_DESCRIPTION` 不一致）。

- [ ] **Step 3: 修改 `packages/clutch-dsh-fireworks/src/fireworks-tool.ts`**

在 `packages/clutch-dsh-fireworks/src/fireworks-tool.ts` 中引入新常量，并替换内联的描述字符串：

```typescript
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  FIREWORKS_MESSAGE_DESCRIPTION,
  FIREWORKS_META_KIND,
  FIREWORKS_TOOL_DESCRIPTION,
  FIREWORKS_TOOL_NAME,
} from './contract/index.js';
import { normalizeFireworksMessage } from './fireworks-projection.js';

export const happyFireworksTool = defineTool({
  name: FIREWORKS_TOOL_NAME,
  description: FIREWORKS_TOOL_DESCRIPTION,
  parameters: {
    message: {
      type: 'string',
      description: FIREWORKS_MESSAGE_DESCRIPTION,
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        message: { type: 'string' },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text:
          value.message === undefined
            ? 'Happy fireworks launched! 🎉'
            : `Happy fireworks launched: ${value.message} 🎉`,
      },
    ],
    presentationMeta: (_args, value) => ({
      kind: FIREWORKS_META_KIND,
      id: value.id,
      ...(value.message === undefined ? {} : { message: value.message }),
    }),
  },
  presentCall: () => ({
    card: 'generic',
    title: 'Launch happy fireworks',
    kind: 'other',
  }),
  presentResult: (_args, result) => ({
    card: 'generic',
    title: result.isError ? 'Fireworks failed' : 'Happy fireworks 🎉',
    content: result.content,
  }),
  execute(args, exec) {
    const message = normalizeFireworksMessage(args.message);
    return Promise.resolve({
      id: String(exec.callId),
      ...(message === undefined ? {} : { message }),
    });
  },
});
```

- [ ] **Step 4: 运行构建与测试验证通过**

Run: `pnpm --filter @cerbur/clutch-dsh-fireworks build && pnpm --filter @cerbur/clutch-dsh-fireworks test`
Expected: PASS（工具描述与参数断言全部通过）。

- [ ] **Step 5: 提交改动**

```bash
git add packages/clutch-dsh-fireworks/src/fireworks-tool.ts packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs
git commit -m "feat(fireworks): update tool description and parameters with explicit milestone triggers"
```

---

### Task 3: 在 `src/index.ts` 中注入 `systemPrompt.section` 并完善宿主测试

**Files:**

- Modify: `packages/clutch-dsh-fireworks/src/index.ts`
- Test: `packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs`

**Interfaces:**

- Consumes:
  - `FIREWORKS_GUIDANCE_SECTION_NAME`, `FIREWORKS_GUIDANCE_SECTION_ORDER`, `FIREWORKS_GUIDANCE_PROMPT` from `./contract/index.js`
  - Cordis `systemPrompt` service via `ctx.inject(['systemPrompt'], ...)`
- Produces:
  - `ctx.systemPrompt.section({ name, order, text })` 注册

- [ ] **Step 1: 编写对 `systemPrompt` 注入及优雅降级的测试用例**

在 `packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs` 中，将原有的注册测试升级为全面覆盖 `sessionProjections`、`systemPrompt` 与工具注册的用例，并增加可选服务缺失时的平稳运行测试：

```javascript
test('registers the projection, system prompt guidance section, and the tool', () => {
  const tools = [];
  const projections = [];
  const promptSections = [];
  apply({
    tools: { register: (tool) => tools.push(tool) },
    inject: (deps, callback) => {
      if (deps.includes('sessionProjections')) {
        callback({
          sessionProjections: { register: (definition) => projections.push(definition) },
        });
      }
      if (deps.includes('systemPrompt')) {
        callback({ systemPrompt: { section: (section) => promptSections.push(section) } });
      }
    },
  });
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [FIREWORKS_TOOL_NAME],
  );
  assert.deepEqual(
    projections.map((definition) => definition.key),
    [FIREWORKS_PROJECTION_KEY],
  );
  assert.deepEqual(promptSections, [
    {
      name: FIREWORKS_GUIDANCE_SECTION_NAME,
      order: FIREWORKS_GUIDANCE_SECTION_ORDER,
      text: FIREWORKS_GUIDANCE_PROMPT,
    },
  ]);
});

test('operates safely when optional dependencies are absent', () => {
  const tools = [];
  apply({
    tools: { register: (tool) => tools.push(tool) },
    inject: () => {},
  });
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [FIREWORKS_TOOL_NAME],
  );
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @cerbur/clutch-dsh-fireworks test`
Expected: FAIL（因尚未在 `apply` 中调用 `ctx.inject(['systemPrompt'])`，导致 `promptSections` 断言失败）。

- [ ] **Step 3: 在 `src/index.ts` 中实现类型声明与 `systemPrompt.section` 注入**

修改 `packages/clutch-dsh-fireworks/src/index.ts`：

```typescript
import type { Context } from '@deepseek-ai/cordis';
import {
  FIREWORKS_GUIDANCE_PROMPT,
  FIREWORKS_GUIDANCE_SECTION_NAME,
  FIREWORKS_GUIDANCE_SECTION_ORDER,
} from './contract/index.js';
import { createFireworksProjectionDefinition } from './fireworks-projection.js';
import { happyFireworksTool } from './fireworks-tool.js';

export * from './contract/index.js';
export { createFireworksProjectionDefinition } from './fireworks-projection.js';
export { happyFireworksTool } from './fireworks-tool.js';

export const name = 'clutch-dsh-fireworks';
export const inject = ['tools'];

interface SystemPromptService {
  section(section: {
    name: string;
    order: number;
    text: string | ((context: { scope?: unknown }) => string);
  }): () => void;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    systemPrompt?: SystemPromptService;
  }
}

export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionContext) => {
    projectionContext.sessionProjections.register(createFireworksProjectionDefinition());
  });
  ctx.inject(['systemPrompt'], (promptContext) => {
    promptContext.systemPrompt?.section({
      name: FIREWORKS_GUIDANCE_SECTION_NAME,
      order: FIREWORKS_GUIDANCE_SECTION_ORDER,
      text: FIREWORKS_GUIDANCE_PROMPT,
    });
  });
  ctx.tools.register(happyFireworksTool);
}
```

- [ ] **Step 4: 运行构建、类型检查与全量测试验证通过**

Run:
`pnpm --filter @cerbur/clutch-dsh-fireworks build`
`pnpm --filter @cerbur/clutch-dsh-fireworks typecheck`
`pnpm --filter @cerbur/clutch-dsh-fireworks test`
Expected: 全部 PASS（构建正常、类型检查零错误、13 个单元测试全部通过）。

- [ ] **Step 5: 提交改动**

```bash
git add packages/clutch-dsh-fireworks/src/index.ts packages/clutch-dsh-fireworks/test/fireworks-host.test.mjs
git commit -m "feat(fireworks): register systemPrompt guidance section for milestone celebration"
```

---

### Task 4: 同步中英文文档并完成全工作区校验

**Files:**

- Modify: `packages/clutch-dsh-fireworks/README.md`
- Modify: `packages/clutch-dsh-fireworks/README.zh.md`

**Interfaces:**

- Consumes: 前述 Task 1-3 实现的全部特性
- Produces: 更新后的中英文文档，准确反映工具触发机制与系统提示词引导

- [ ] **Step 1: 更新 `packages/clutch-dsh-fireworks/README.md`**

在 `## Capabilities` 中补充系统级提示词准则及触发边界说明，并在 `## Usage` 中说明大模型在设计、特性验证与复杂 Bug 解决等重大里程碑场景下的自主调用机制。保持原有的四个核心段落顺序（Overview / Capabilities / Installation / Usage）。

- [ ] **Step 2: 同步更新 `packages/clutch-dsh-fireworks/README.zh.md`**

在 `## 能力` 中同步补充系统行为准则（System Prompt Section）注入与具象化触发边界说明，并在 `## 详细使用` 中说明 Agent 遇到架构设计完成、Feature 研发验证、复杂 Bug 修复等里程碑时的主动调用行为。

- [ ] **Step 3: 运行全工作区语法、类型与测试校验**

Run:

```bash
pnpm --filter @cerbur/clutch-dsh-fireworks typecheck
pnpm --filter @cerbur/clutch-dsh-fireworks test
pnpm run check:workspace
git status
```

Expected: 所有测试全绿、类型检查通过、工作区依赖校验通过。

- [ ] **Step 4: 提交文档改动**

```bash
git add packages/clutch-dsh-fireworks/README.md packages/clutch-dsh-fireworks/README.zh.md
git commit -m "docs(fireworks): document explicit milestone triggers and system prompt guidance"
```
