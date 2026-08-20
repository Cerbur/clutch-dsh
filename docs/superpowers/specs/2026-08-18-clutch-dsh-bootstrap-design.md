# clutch-dsh Workspace Bootstrap Design

## Goal

将 `clutch-dsh` 初始化为一个可持续扩展的 pnpm workspace，用统一的根目录
工具管理 DSH plugin，并用 workspace guard 与 authoring 文档明确 package
身份、能力角色和真实 DSH bundle manifest 的边界。

## Scope

本次 bootstrap 包含：

- private pnpm workspace root，发现 `packages/*` 和 `packages/*/*`；
- 根级 TypeScript、ESLint、Prettier 配置与统一检查命令；
- package 形状、plugin identity、role metadata、workspace 依赖和 DSH bundle
  manifest 校验脚本；
- 根 README 与 plugin authoring 文档。

本次 bootstrap 不创建 demo capability package，不实现真实 DSH Host Remote、
外部服务凭据、发布流程或完整 Worktree UI。`my-cap` 等名称只在 authoring
文档中作为示例。

## Architecture

根 package 只承载 workspace 和开发工具，不发布运行时能力。默认一个 plugin
就是一个可安装 package：

```text
packages/<plugin>/
├── package.json
├── cordis.patch.yml
├── tsconfig.json
└── src/index.ts
```

一个 package 可以同时拥有 Service Definition、Provider 和 Consumer。只有
角色需要独立安装、独立版本或可替换实现时，才在
`packages/<plugin>/<package-name>/` 下创建 nested package。nested package
目录名必须等于 `package.json.name`，且使用 plugin 前缀。

`clutch-dsh-worktree` 采用默认的一包形态：

```text
packages/clutch-dsh-worktree/
├── package.json
├── cordis.patch.yml
├── src/contract/                 # stable types and interfaces
├── src/provider/                 # Git, sidecar and DSH read adapters
├── src/manage/                   # Worktree/Session orchestration
└── src/client/                   # future browser Consumer
```

## Metadata Contract

workspace metadata 与 DSH bundle metadata 分开：

```json
{
  "name": "clutch-dsh-worktree",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "clutchDsh": {
    "plugin": "clutch-dsh-worktree",
    "role": "plugin",
    "serviceDefinition": "clutch-dsh-worktree"
  }
}
```

`clutchDsh.role` 可以是 `plugin`、`service-definition`、`provider` 或
`consumer`。`plugin` 表示一个 package 内含多个角色；独立 Provider 和
Consumer 才需要对独立 Service Definition 使用精确的 `workspace:*`。

`cordis.patch.yml` 是 DSH patch layer 的 YAML 数组，不包含 `dsh.bundle`
字段。`package.json.dsh.bundle.patch` 必须是 package 内的相对文件路径。

## Components and Boundaries

| Module           | Responsibility                              | Boundary                           |
| ---------------- | ------------------------------------------- | ---------------------------------- |
| Workspace root   | workspace discovery、shared tooling、guards | 不包含 capability runtime          |
| `src/contract/`  | 稳定类型、Service interface、错误码         | 不依赖 Provider 或 Consumer        |
| `src/provider/`  | Git、sidecar、DSH read adapter              | 不写 DSH 原始数据                  |
| `src/manage/`    | Worktree/Session 用例编排                   | 不暴露底层实现细节                 |
| `src/client/`    | Web UI Consumer                             | 不执行 Git、不读 sidecar           |
| Workspace guards | deterministic package/manifest checks       | 只读 package metadata、目录和 YAML |

## Validation and Failure Behavior

- 缺少必需文件、scripts、目录/name 不一致、plugin identity、role metadata
  或独立 package 的精确 `workspace:*` 依赖时，workspace validator 输出
  package 路径和原因并以状态码 1 退出。
- 缺少、越界或不可解析的 `dsh.bundle.patch`，以及非数组 patch YAML，patch
  validator 输出 package patch 路径和原因并以状态码 1 退出。
- `packages/` 下没有 `package.json` 的规划目录不视为可运行 package。
- 任何真实 package 都必须通过相同的 shape、metadata 和 bundle guard。

## Testing Strategy

- 根配置通过 format、lint、typecheck 和 test 检查。
- guard tests 覆盖 atomic plugin package、独立三角色 package、名称/目录、
  plugin prefix、role、service identity、workspace dependency、bundle
  manifest、patch path、YAML root 和规划目录跳过。
- `clutch-dsh-worktree` package tests 覆盖 contract、Git、sidecar、binding、
  cwd、恢复和 DSH fixture 不变式。

## Acceptance Criteria

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

不加入 demo package、dist、coverage、sidecar、临时文件或凭据。完整
Worktree Remote/UI composition 由 plugin 自己的后续实现计划负责。

## Implementation Reference

workspace guard 的已实施约定见
[`2026-08-19-clutch-dsh-package-naming.md`](../plans/2026-08-19-clutch-dsh-package-naming.md)；
Worktree package 合并见
[`2026-08-20-clutch-dsh-worktree-package-consolidation.md`](../../../packages/clutch-dsh-worktree/docs/superpowers/plans/2026-08-20-clutch-dsh-worktree-package-consolidation.md)。
