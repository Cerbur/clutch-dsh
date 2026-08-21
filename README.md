# @cerbur/clutch-dsh

`@cerbur/clutch-dsh` 是一个用于开发 DSH（DeepSeek Harness）plugin 的 pnpm workspace。根项目只负责 workspace 发现、共享工具链、package 规则和 Cordis patch 校验；根 package 保持 private，不作为可发布 plugin。

## Workspace layout

每个直接位于 `packages/*` 下的目录可以是一个完整 plugin package，也可以
是包含若干独立 module package 的 plugin 根目录。Service Definition、Provider
和 Consumer 是能力角色，不是必须拆开的 package；只有角色需要独立替换、
独立发布或独立安装时才拆分。

没有 `package.json` 的目录可以作为规划入口存在，不会被 workspace guard
当作可运行 package。当前 `packages/clutch-dsh-worktree/` 直接就是完整的
`@cerbur/clutch-dsh-worktree` package，其内部通过 `src/contract/`、`src/provider/`、
`src/manage/`、`src/host/` 和 `src/client/` 保留角色 seam，并包含已接入 DSH Web UI
的 Host 与 Client entry。该 package 的具体架构和权责见
`packages/clutch-dsh-worktree/AGENTS.md`。

若确实需要独立 module package，仍可使用
`packages/<plugin>/<package-name>/`；目录名必须与 `package.json.name` 完全
一致，并以所属 plugin 名称加 `-` 为前缀。模块数量、模块名和角色组合由
plugin 功能决定，workspace 不强制固定后缀。workspace 同时兼容直接位于
`packages/*` 下的 package 和一层 nested package。

可安装 DSH bundle 使用真实 DSH manifest：`package.json` 的
`dsh.bundle.patch` 指向同 package 内的 `cordis.patch.yml`。clutch-dsh
额外的 `clutchDsh` metadata 只用于 workspace 结构校验和记录角色。

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

## 已发布 plugin

当前可安装的 plugin package 是 `@cerbur/clutch-dsh-worktree`。在已安装 DSH CLI
的环境中使用：

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-worktree
dsh web
```

本地 checkout 安装、版本同步和发布流程分别见
[`packages/clutch-dsh-worktree/README.md`](packages/clutch-dsh-worktree/README.md)
和 [`packages/clutch-dsh-worktree/docs/RELEASING.md`](packages/clutch-dsh-worktree/docs/RELEASING.md)。
