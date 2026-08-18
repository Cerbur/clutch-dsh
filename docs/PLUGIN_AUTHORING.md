# Plugin Authoring Guide

本仓库的根项目名是 `clutch-dsh`。根 package 只提供 workspace 工具，不发布为 plugin；实际 plugin package 放在 `packages/*` 下。

## 1. Naming and package metadata

每个可运行 package 使用以下形式：

```text
packages/<plugin>-<module>/
package name: <plugin>-<module>
```

目录名必须与 `package.json.name` 完全一致，且 package name 必须以所属 plugin 名称加 `-` 为前缀。`<module>` 由 plugin 的实际功能决定，workspace 不规定 `manager`、`local`、`ui`、`tool` 或其他固定后缀。

每个可运行 package 还要声明 `clutchDsh` metadata：

```json
{
  "name": "clutch-dsh-worktree-manager",
  "clutchDsh": {
    "plugin": "clutch-dsh-worktree",
    "role": "service-definition",
    "serviceDefinition": "clutch-dsh-worktree-manager"
  }
}
```

`role` 是架构角色，只能是 `service-definition`、`provider` 或 `consumer`；它不限制 module 名称。

## 2. Service Definition

Service Definition 只导出公共类型、Service 接口和 capability identity，不引用 Provider 或 Consumer。Service Definition 的 `clutchDsh.serviceDefinition` 必须等于自身 package name。

例如 `clutch-dsh-worktree-manager` 可以作为 Service Definition：

```text
packages/clutch-dsh-worktree-manager/
package name: clutch-dsh-worktree-manager
serviceDefinition: clutch-dsh-worktree-manager
```

`manager` 只是这个 plugin 的一个模块选择，不是通用命名要求。

## 3. Provider

Provider 实现 Service Definition 的 contract，不重新定义公共类型，也不把 Consumer 行为放进实现中。Provider 的 package name 可以按功能选择，例如 `clutch-dsh-worktree-local`，并在 `dependencies` 中使用精确的 workspace 依赖：

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

## 4. Consumer

Consumer 提供面向用户或上层流程的入口，只依赖 Service Definition。例如 UI 模块可以命名为 `clutch-dsh-worktree-ui`：

```json
{
  "name": "clutch-dsh-worktree-ui",
  "clutchDsh": {
    "plugin": "clutch-dsh-worktree",
    "role": "consumer",
    "serviceDefinition": "clutch-dsh-worktree-manager"
  },
  "dependencies": {
    "clutch-dsh-worktree-manager": "workspace:*"
  }
}
```

Consumer 不直接依赖 Provider，也不复制 Provider 的实现。Provider 和 Consumer 的 `serviceDefinition` 必须指向对应 Service Definition，并在 `dependencies` 中使用精确的 `workspace:*`。

## 5. Package files and patch

每个可运行 package 都必须包含：

```text
package.json
cordis.patch.yml
tsconfig.json
src/index.ts
```

并提供 `build`、`lint`、`typecheck` 和 `test` scripts。

每个 package 的 `cordis.patch.yml` 都指向其 `clutchDsh.serviceDefinition`。上面示例的 canonical YAML 形式是：

```yaml
dsh:
  bundle: clutch-dsh-worktree-manager
```

对应关系为：

```text
packages/clutch-dsh-worktree-manager -> clutch-dsh-worktree-manager
packages/clutch-dsh-worktree-local   -> clutch-dsh-worktree-manager
packages/clutch-dsh-worktree-ui      -> clutch-dsh-worktree-manager
dsh.bundle                           -> clutch-dsh-worktree-manager
```

这些 module 名称只用于说明一种 plugin 结构；实际 plugin 可以根据功能选择不同模块名。

## 6. Validation

新增实际 package 后，在根目录执行：

```bash
pnpm install
pnpm run check:workspace
pnpm run check:patches
pnpm run check
```

`check:workspace` 会校验 package 形状、目录/name 一致性、plugin 前缀、metadata、必需 scripts 和 Provider/Consumer 的 `workspace:*` 依赖。`check:patches` 会校验 `dsh.bundle` 是否等于 metadata 声明的 Service Definition。没有 `package.json` 的规划目录会被两个 guard 跳过。

## 7. Boundary rules

- Service Definition 不依赖 Provider 或 Consumer。
- Provider 只实现 Service Definition，不改写公共 contract。
- Consumer 不直接依赖 Provider。
- 根项目不承载具体 capability 的 runtime 实现。
- 不把 demo package、构建产物、coverage、临时 sidecar 数据或凭据提交到仓库。
- `my-cap`、`file-cap` 等名称只用于 authoring 文档说明，不是当前仓库要创建的 package。
