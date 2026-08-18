# clutch-dsh Workspace Bootstrap Design

## Goal

将 clutch-dsh 初始化为一个可持续扩展的 pnpm workspace，用统一的根目录工具管理 DSH plugin，并用一组三包 reference vertical slice 验证 Service Definition、Provider、Consumer 的边界。

## Scope

本次初始化包含：

- private 的 pnpm workspace root，仅发现 `packages/*`；
- 根级 TypeScript、ESLint、Prettier 配置与统一检查命令；
- package 形状、命名、workspace 依赖和 Cordis patch 校验脚本；
- `my-cap`、`my-cap-local`、`tool-my-cap` 三个最小可构建 package；
- 根 README 和 plugin authoring 文档。

本次不实现真实 DSH runtime API、外部服务凭据、发布流程，或 `clutch-dsh-worktree` 的 Provider/Consumer。`packages/clutch-dsh-worktree/` 保持现有 README、AGENTS.md 和独立计划作为后续实现入口。

## Architecture

根 package 只承载 workspace 和开发工具，不发布运行时能力。每个 plugin package 都包含 `package.json`、`cordis.patch.yml`、`tsconfig.json` 和 `src/index.ts`，并可独立运行 build、lint、typecheck、test。

`dsh-my-cap` 只导出 capability 名称和公共 service contract。`dsh-my-cap-local` 实现该 contract 的最小 echo provider；`dsh-tool-my-cap` 只引用 Service Definition，作为 consumer 入口。Provider 与 Consumer 通过 `workspace:*` 依赖 Service Definition，三者的 `dsh.bundle` 都解析为 `dsh-my-cap`。

## Components and Boundaries

| Component | Responsibility | Boundary |
| --- | --- | --- |
| Workspace root | workspace discovery, shared tooling, validation commands | 不包含具体 capability 实现 |
| Service Definition | capability name and public TypeScript contract | 不依赖 Provider 或 Consumer |
| Provider | local implementation of the contract | 不重新定义公共 contract |
| Consumer | user-facing/tool entry targeting the contract | 不直接依赖 Provider |
| Workspace validators | deterministic package and patch checks | 只读取 package metadata、目录结构和 YAML |

## Validation and Failure Behavior

- 缺少必需文件、脚本、规范命名或 `workspace:*` 依赖时，workspace validator 输出 package 路径和原因并以状态码 1 退出。
- YAML 解析失败、缺少 `dsh.bundle` 或 bundle 不符合 package capability 推导规则时，patch validator 输出文件路径和原因并以状态码 1 退出。
- 空的 `packages/` 目录允许根工具链先行校验；加入 reference packages 后，所有 package 必须通过相同的 guard。

## Testing Strategy

- 根配置通过 format、lint 和 typecheck 检查。
- 三个 package 分别通过独立 typecheck、build 和 test script。
- Provider smoke test 验证 contract name 和 echo 行为。
- Consumer smoke test 验证只绑定 `my-cap` Service Definition。
- 根级 `check` 串联 workspace、patch、format、lint、typecheck 和 test，作为最终验收入口。

## Acceptance Criteria

完成后，以下命令全部成功：

```text
pnpm install --frozen-lockfile
pnpm run check:workspace
pnpm run check:patches
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run test
pnpm run check
```

构建产物只出现在各 package 的 `dist/` 中，`dist/`、coverage、临时文件和本地凭据不进入 Git；三个 reference package 被 workspace 发现，Provider/Consumer 的 Service Definition 依赖均为 `workspace:*`，三份 patch 均解析为 `dsh-my-cap`。

## Implementation Reference

具体文件清单、代码接口、命令和任务顺序以 [`2026-08-18-clutch-dsh-bootstrap.md`](../plans/2026-08-18-clutch-dsh-bootstrap.md) 为准。
