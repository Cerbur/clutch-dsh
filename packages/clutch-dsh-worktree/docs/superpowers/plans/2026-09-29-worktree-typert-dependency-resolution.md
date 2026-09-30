# Isolate Worktree Typert Type Dependencies

Ported into `wt-worktree-0.1.16/feat-workspace-delete` from the
`wt-worktree-0.1.16/feat-sidebar-optimize` worktree so that a fresh full-workspace
`pnpm install` can build this package, and re-verified on this branch.

## Finding

With Node 26.3.1 and pnpm 10.32.1, the package TypeScript compile and Client bundle pass, but Typert
generation fails after a full workspace install exposes Client-only DSH declaration graphs:

```text
TypertAnalysisError: typert(host): node_modules/.pnpm/@deepseek-ai+dsh-agent@0.1.7-rc.2_.../node_modules/@deepseek-ai/dsh-agent/lib/types/types.d.ts:23:9: duplicate TypertLookupMap key agent
```

The DSH Client Locale and Workspace types transitively import API-remotes rc1 types; that graph adds a
second `dsh-agent` `TypertLookupMap.agent` declaration. The rc.1 `dsh-agent` copy is installed as a
peer variant for rc.1 DSH packages that other workspace packages still pull (for example
`dsh-session-title@0.1.7-rc.1`, `dsh-tools@0.1.7-rc.1`, `dsh-user-approval@0.1.7-rc.1`,
`dsh-sandbox-policy@0.1.7-rc.1`, `dsh-agent-preset-registry@0.1.7-rc.1`), so the failure reproduces on
unmodified baseline sources and is independent of the package's own diff. The Worktree runtime does not
use API-remotes and intentionally stays on the existing `/api` Connection. A package-scoped
`pnpm install --filter @cerbur/clutch-dsh-worktree...` hides the problem by never installing that graph,
which is not a reproducible environment.

## Decision

`tsconfig.host.json` maps the DSH Client Locale and Workspace type-only imports to small local
build-only Context projections. The Host Typert Program only needs the locale Context marker and the
three `uiWorkspace` methods Worktree calls, so it does not need those Client UI declarations or their
transitive Remote graph. The ordinary package `tsconfig` and DSH runtime keep using the real DSH
modules; no API-remotes peer, dev dependency, injection, or runtime bundle is added.

## Verification results

| Check                                                                                                 | Result                                                                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm --filter @cerbur/clutch-dsh-worktree build` (Node 26.3.1, pnpm 10.32.1, full workspace install) | PASS; before the mapping it failed with `duplicate TypertLookupMap key agent` |
| `pnpm --filter @cerbur/clutch-dsh-worktree typecheck`                                                 | PASS                                                                          |
| `pnpm --filter @cerbur/clutch-dsh-worktree test`                                                      | PASS; 725 tests                                                               |
| `pnpm run check:workspace`                                                                            | PASS                                                                          |
| `pnpm run check:patches`                                                                              | PASS; existing YAML `!!js dshHomePath()` warning                              |
| `node --test test/readme-parity.test.mjs`                                                             | PASS                                                                          |
| Prettier check on changed files                                                                       | PASS                                                                          |

The generated `lib/typert.host.js` and `lib/typert.remote-client.js` are byte-identical to the artifacts
produced from the unmodified baseline sources in an isolated package-scoped environment, confirming the
projection changes no Host or Remote face.
