# Plugin Authoring Guide

本仓库的根项目名是 `clutch-dsh`。根 package 只提供 workspace 工具，不发布为
plugin。一个 plugin 可以由一个完整 package 组成，也可以在确有独立发布或
替换需求时拆成多个 module package。

## 1. Package 与 plugin identity

默认形式是一个 package：

```text
packages/<plugin>/
package name: <plugin>
```

如果角色需要独立演进，才使用 nested package：

```text
packages/<plugin>/<package-name>/
package name: <package-name>
```

目录名必须与 `package.json.name` 完全一致，package name 必须以所属 plugin
名称加 `-` 为前缀。`manager`、`local`、`ui` 不是通用后缀。

DSH 真正识别的是 package manifest 中的 `dsh.bundle`，而不是 Service
Definition、Provider、Consumer 的数量：

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

`clutchDsh` 是本 workspace 的校验 metadata；`role: plugin` 表示一个 package
内部可以同时拥有多个能力角色。`service-definition`、`provider` 和
`consumer` 仍可用于真正独立的 module package。

## 2. Internal capability roles

一个 atomic plugin package 内部仍然保持单向依赖：

```text
src/contract/  ←  src/provider/
      ↑              ↑
      └──────────── src/manage/  ←  src/host/
      ↑
      └──────────── src/client/  (browser-safe facade / Consumer)
```

Service Definition 只拥有公共类型、服务 interface 和稳定错误码。Provider
实现它并拥有 Git、sidecar 和底层 adapter；Host 是 composition root。
Consumer 只通过 Service Definition 与 browser-safe facade 交互，不导入
Provider 或 Host internals。

只有当这些角色需要独立安装、独立版本、可替换 Provider 或外部 Consumer
时，才把它们提升成不同 package；此时 Provider/Consumer 才需要使用精确的
`workspace:*` 依赖 Service Definition。

## 3. Package files and DSH bundle

每个可运行 package 都必须包含：

```text
package.json
cordis.patch.yml
tsconfig.json
src/index.ts
```

并提供 `build`、`lint`、`typecheck` 和 `test` scripts。真实 DSH bundle 的
manifest 位于 `package.json`：

```json
"dsh": {
  "bundle": {
    "patch": "./cordis.patch.yml"
  }
}
```

`cordis.patch.yml` 本身是 DSH patch layer 的 YAML 数组；它不是 bundle
metadata。`clutch-dsh-worktree` 的 Phase 3 patch 已装载 Host entry，并由 DSH
注入解析后的 Home：

```yaml
- insert:
    - id: clutch-dsh-worktree-host
      name: clutch-dsh-worktree
      config:
        dshHome: !!js dshHomePath()
```

Host package 发布的 `./typert` 由 DSH `typert-loader` 注册。`./remote` 是供
Client Remote assembly 显式选择的生成 contribution；`dsh.bundle` 或
`dsh.client` metadata 本身都不会动态改写已构建的 Remote assembly roster。
发布 `./typert` 的 package 也必须导出 `./package.json`，因为 loader 先从
composition anchor 解析 manifest，再读取其中的 `./typert` target。

## 4. Validation

新增或修改 package 后，在根目录执行：

```bash
pnpm install
pnpm run check:workspace
pnpm run check:patches
pnpm run check
```

`check:workspace` 校验 package 形状、目录/name 一致性、plugin 前缀、metadata
和独立 Provider/Consumer 的依赖。`check:patches` 校验
`package.json.dsh.bundle.patch` 存在、指向 package 内文件，并且该文件是
可解析的 YAML 数组。两个 guard 会扫描 `packages/*` 和 `packages/*/*`，没有
`package.json` 的规划目录会被跳过。

## 5. Boundary rules

- 内部 Service Definition 不依赖 Provider 或 Consumer。
- Provider 不把 Git、sidecar 和 DSH mutation 暴露给 Consumer。
- Consumer 不直接依赖 Provider internals。
- 根项目不承载具体 capability 的 runtime 实现。
- 不把 demo package、构建产物、coverage、临时 sidecar 数据或凭据提交到 Git。
- `my-cap`、`file-cap` 等名称只用于 authoring 文档说明，不是当前仓库要创建的 package。
