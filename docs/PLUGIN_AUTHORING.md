# Plugin Authoring Guide

本仓库的根项目名是 `clutch-dsh`。根 package 只提供 workspace 工具，不发布为 plugin；实际 plugin package 放在 `packages/*` 下。

## 1. Service Definition

先创建 `packages/<capability>/`，并将 package 命名为 `dsh-<capability>`。Service Definition 只导出公共类型、Service 接口和 capability identity，不引用 Provider 或 Consumer。

例如 capability 名为 `file-cap` 时：

```text
packages/file-cap/
package name: dsh-file-cap
```

## 2. Provider

创建 `packages/<capability>-local/`，并将 package 命名为 `dsh-<capability>-local`。Provider 在 `dependencies` 中使用精确的 workspace 依赖：

```json
{
  "dependencies": {
    "dsh-file-cap": "workspace:*"
  }
}
```

Provider 实现 Service Definition 的 contract，不重新定义公共类型，也不把 Consumer 行为放进实现中。

## 3. Consumer

创建 `packages/tool-<capability>/`，并将 package 命名为 `dsh-tool-<capability>`。Consumer 只依赖 Service Definition：

```json
{
  "dependencies": {
    "dsh-file-cap": "workspace:*"
  }
}
```

Consumer 不直接依赖 Provider，也不复制 Provider 的实现。

## 4. Package files and patch

每个可运行 package 都必须包含：

```text
package.json
cordis.patch.yml
tsconfig.json
src/index.ts
```

并提供 `build`、`lint`、`typecheck` 和 `test` scripts。

三个 package 的 `cordis.patch.yml` 都指向同一个 Service Definition bundle。`file-cap` 的 canonical YAML 形式是：

```yaml
dsh:
  bundle: dsh-file-cap
```

对应关系为：

```text
packages/file-cap       -> dsh-file-cap
packages/file-cap-local -> dsh-file-cap-local
packages/tool-file-cap  -> dsh-tool-file-cap
dsh.bundle              -> dsh-file-cap
```

`file-cap` 只是文档示例；新增 capability 时替换为真实名称。

## 5. Validation

新增实际 package 后，在根目录执行：

```bash
pnpm install
pnpm run check:workspace
pnpm run check:patches
pnpm run check
```

`check:workspace` 会校验 package 形状、命名、必需 scripts 和 Provider/Consumer 的 `workspace:*` 依赖。`check:patches` 会校验 `dsh.bundle` 是否与目录推导出的 Service Definition 一致。没有 `package.json` 的规划目录会被两个 guard 跳过。

## 6. Boundary rules

- Service Definition 不依赖 Provider 或 Consumer。
- Provider 只实现 Service Definition，不改写公共 contract。
- Consumer 不直接依赖 Provider。
- 根项目不承载具体 capability 的 runtime 实现。
- 不把 demo package、构建产物、coverage、临时 sidecar 数据或凭据提交到仓库。
