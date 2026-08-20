# clutch-dsh Package and Plugin Identity Design

## Goal

让 workspace 同时支持两种清晰的发布形态：默认的一个 plugin 一个 package，
以及只有在角色需要独立演进时才使用的 nested module packages。package
命名、能力角色和 DSH bundle manifest 必须分别表达各自的语义。

## Decision

### Atomic plugin package

默认一个 plugin 直接占用一个 package：

```text
packages/clutch-dsh-worktree/
package name: @cerbur/clutch-dsh-worktree
```

一个 package 可以在内部拥有 Service Definition、Provider 和 Consumer。
本 workspace 用 `clutchDsh.role: "plugin"` 表达这个事实：

```json
{
  "name": "@cerbur/clutch-dsh-worktree",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "clutchDsh": {
    "plugin": "@cerbur/clutch-dsh-worktree",
    "role": "plugin",
    "serviceDefinition": "@cerbur/clutch-dsh-worktree"
  }
}
```

Atomic package 内部通过 `src/contract/`、`src/provider/`、`src/manage/` 和
`src/client/` 保留依赖方向，不把每个内部角色都变成 workspace package。

### Independent module packages

当 Service Definition、Provider 或 Consumer 需要独立安装、独立版本、独立
替换或被外部 package 使用时，才允许：

```text
packages/<plugin>/<package-name>/
package name: <package-name>
```

目录名必须与 `package.json.name` 的 unscoped 部分一致；scoped package 使用
`@scope/<directory>` 形式。package name 必须等于 plugin 名称或以 `${plugin}-`
开头。独立 Provider/Consumer 对 Service Definition
使用精确的 `workspace:*` 依赖；角色名称不从 `manager`、`local`、`ui`
等后缀推导。

### DSH bundle manifest

DSH loader 以 package.json 的 `dsh.bundle` 判断一个 package 是否是可安装
bundle：

```json
"dsh": {
  "bundle": {
    "patch": "./cordis.patch.yml"
  }
}
```

`cordis.patch.yml` 是 YAML patch 数组，不包含 `dsh.bundle` 元数据，也不把
bundle 名称与 Service Definition 名称进行字符串比较。`clutchDsh` 是本
workspace 的结构校验 metadata，不替代 DSH manifest。

## Validation Boundaries

`check-workspace.mjs` 校验：

- package 目录名与 `package.json.name` 一致；
- atomic package 名称等于 plugin，独立 module 名称使用 plugin 前缀；
- `clutchDsh.plugin`、`role` 和 `serviceDefinition` 的合法性；
- atomic/plugin 和 Service Definition 的 service identity 等于 package 名；
- 独立 Provider/Consumer 的精确 `workspace:*` 依赖。

`validate-cordis-patches.mjs` 校验：

- `package.json.dsh.bundle.patch` 存在且是相对 package 的路径；
- 目标文件位于 package 内；
- 目标文件可解析，且 YAML 根值是 patch 数组；
- 没有 `package.json` 的规划目录继续被跳过。

## Worktree application

`@cerbur/clutch-dsh-worktree` 采用 atomic package：

```text
packages/clutch-dsh-worktree/
├── src/contract/                 # stable types and interfaces
├── src/provider/                 # Git, sidecar and DSH read adapters
├── src/manage/                   # Worktree/Session orchestration
└── src/client/                   # future browser Consumer
```

Provider 只能依赖内部 contract；未来 browser Consumer 只能依赖 browser-safe
contract 和 Remote/client facade。Host 与 browser 可以有不同 build entrypoint，
但仍由同一个 DSH bundle package 发布。

## Testing

测试覆盖 atomic plugin package、独立 Service Definition/Provider/Consumer
package、package 前缀、角色 metadata、精确 `workspace:*` 依赖、真实 DSH
bundle manifest、缺失/越界 patch 路径、非数组 YAML 和规划目录跳过行为。
