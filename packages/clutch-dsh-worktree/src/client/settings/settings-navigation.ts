/** The rc.1 native Settings shell shares one viewing store between mouse and command entry. */
export function openWorktreeErrorSettings(slots: {
  readonly entriesOfSlot: (name: 'sidebar.settings') => readonly {
    readonly store?: unknown;
  }[];
}): boolean {
  const store = slots.entriesOfSlot('sidebar.settings')[0]?.store as
    { create?: () => { actions?: { openSection?: (id: string) => void } } } | undefined;
  if (typeof store?.create !== 'function') return false;
  const instance = store.create();
  if (typeof instance?.actions?.openSection !== 'function') return false;
  instance.actions.openSection('clutch-dsh-worktree');
  return true;
}
