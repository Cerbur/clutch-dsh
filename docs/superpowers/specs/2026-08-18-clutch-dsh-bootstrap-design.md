# clutch-dsh Workspace Bootstrap Design

## Goal

将 clutch-dsh 初始化为一个可持续扩展的 pnpm workspace，用统一的根目录工具管理 DSH plugin，并用校验脚本与 authoring 文档明确 Service Definition、Provider、Consumer 的边界。

## Scope

本次初始化包含：

- private 的 pnpm workspace root，仅发现 `packages/*`；
- 根级 TypeScript、ESLint、Prettier 配置与统一检查命令；
- package 形状、plugin 前缀、metadata、workspace 依赖和 Cordis patch 校验脚本；
- 根 README 和 plugin authoring 文档。

本次不创建 demo capability package，不实现真实 DSH runtime API、外部服务凭据、发布流程，或 `clutch-dsh-worktree` 的 Provider/Consumer。`my-cap` 等名称只在 authoring 文档中作为示例。`packages/clutch-dsh-worktree/` 保持现有 README、AGENTS.md 和独立计划作为后续实现入口。

## Architecture

根 package 只承载 workspace 和开发工具，不发布运行时能力。每个 plugin package 都包含 `package.json`、`cordis.patch.yml`、`tsconfig.json` 和 `src/index.ts`，并可独立运行 build、lint、typecheck、test scripts。

可运行 package 位于 `packages/<plugin>-<module>/`，目录名必须与 `package.json.name` 完全一致，package name 必须以所属 plugin 名称加 `-` 为前缀。模块名由 plugin 功能决定，不由 workspace 规定固定后缀。每个 package 的 `clutchDsh` metadata 声明 `plugin`、`role` 和 `serviceDefinition`；Provider 与 Consumer 用精确的 `workspace:*` 依赖 Service Definition，所有 package 的 `dsh.bundle` 都指向该 Service Definition。

## Components and Boundaries

| Component            | Responsibility                                           | Boundary                                 |
| -------------------- | -------------------------------------------------------- | ---------------------------------------- |
| Workspace root       | workspace discovery, shared tooling, validation commands | 不包含具体 capability 实现               |
| Service Definition   | capability name and public TypeScript contract           | 不依赖 Provider 或 Consumer              |
| Provider             | implementation of the contract                           | 不重新定义公共 contract                  |
| Consumer             | user-facing entry targeting the contract                 | 不直接依赖 Provider                      |
| Workspace validators | deterministic package and patch checks                   | 只读取 package metadata、目录结构和 YAML |

## Metadata Contract

```json
{
  "name": "clutch-dsh-worktree-local",
  "clutchDsh": {
    "plugin": "clutch-dsh-worktree",
    "role": "provider",
    "serviceDefinition": "clutch-dsh-worktree-manager"
  },
  "dependencies": {
    "clutch-dsh-worktree-manager": "workspace:*"
  }
}
```

`role` 只能是 `service-definition`、`provider` 或 `consumer`。Service Definition 的 `serviceDefinition` 必须等于自身 package name；Provider 和 Consumer 对声明的 Service Definition 使用精确的 `workspace:*`。

## Validation and Failure Behavior

- 缺少必需文件、scripts、目录/name 一致性、plugin 前缀、metadata 或精确 `workspace:*` 依赖时，workspace validator 输出 package 路径和原因并以状态码 1 退出。
- YAML 解析失败、缺少 `dsh.bundle`、缺少 metadata 中的 Service Definition 或 bundle 不等于该 Service Definition 时，patch validator 输出文件路径和原因并以状态码 1 退出。
- `packages/` 下没有 `package.json` 的规划目录不视为可运行 package；根工具链必须允许这类目录存在。
- 一旦新增 package，所有含 `package.json` 的 package 必须通过相同的 shape、metadata、依赖和 patch guard。

## Testing Strategy

- 根配置通过 format、lint 和 typecheck 检查。
- 根级检查脚本在当前只有规划目录时成功运行，并能在临时 fixture 中识别 package 结构、plugin 前缀、metadata、依赖和 patch 错误。
- 根级 `check` 串联 workspace、patch、format、lint、typecheck 和 test，作为最终验收入口；没有实际 package 时，递归 package 命令安全地无操作成功。

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

没有 demo package 或 demo 构建产物被加入仓库；`dist/`、coverage、临时文件和本地凭据不进入 Git。新增真实 package 后，workspace、`workspace:*` 依赖和 `dsh.bundle` 规则由根级 guard 统一验证。

## Implementation Reference

具体文件清单、代码接口、命令和任务顺序以 [`2026-08-18-clutch-dsh-bootstrap.md`](../plans/2026-08-18-clutch-dsh-bootstrap.md) 为准。
