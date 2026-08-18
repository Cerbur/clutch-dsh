# clutch-dsh

`clutch-dsh` 是一个用于开发 DSH（DeepSeek Harness）plugin 的 pnpm workspace。根项目只负责 workspace 发现、共享工具链、package 规则和 Cordis patch 校验；根 package 保持 private，不作为可发布 plugin。

## Workspace layout

可运行 plugin 位于 `packages/*`，按三类 package 拆分：

- Service Definition：导出 capability 的公共 contract。
- Provider：实现 Service Definition，并通过 `workspace:*` 依赖它。
- Consumer：提供面向用户或上层流程的入口，只依赖 Service Definition。

没有 `package.json` 的目录可以作为规划入口存在，不会被 workspace guard 当作可运行 package。当前 `packages/clutch-dsh-worktree/` 仍是规划入口，真实 runtime package 按独立计划推进。

## Commands

```bash
pnpm install
pnpm run check
pnpm run build
pnpm run test
```

新增或修改 package 后，也可以分别运行：

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm run format:check
pnpm run lint
pnpm run typecheck
```

具体命名、依赖和 patch 规则见 [plugin authoring guide](docs/PLUGIN_AUTHORING.md)。
