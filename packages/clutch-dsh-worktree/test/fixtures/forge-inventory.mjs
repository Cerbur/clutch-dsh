// listBundles identifies the loader entries; listPlugins describes their live state.
export function forgeRows(declarations = [
  { id: 'worktree', name: '@deepseek-ai/dsh-experimental-worktree' },
  { id: 'forge-panel', name: '@deepseek-ai/dsh-experimental-client-ui-forge' },
]) {
  return declarations.map(({ id, name }) => ({ rowId: id, moduleName: name, entryId: `include/${id}` }));
}

export function forgePlugins(rows, live) {
  return rows.map(({ entryId, moduleName }) => ({ entryId, moduleName, enabled: live, fiberPhase: live ? 'active' : null }));
}
