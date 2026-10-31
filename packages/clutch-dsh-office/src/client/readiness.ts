export type OfficePhase = 'loading' | 'ready' | 'error';

/** A cached domain baseline alone cannot establish current connectivity. */
export function officePhase(input: {
  readonly online: boolean;
  readonly connection: string | undefined;
  readonly generation: object | undefined;
  readonly workspaceState: 'idle' | 'loading' | 'error';
  readonly workspacePhase: 'pending' | 'ready';
  readonly sessionPhase: 'pending' | 'ready';
}): OfficePhase {
  if (!input.online || input.connection !== 'connected' || input.generation === undefined)
    return 'loading';
  if (input.workspaceState === 'error') return 'error';
  if (
    input.workspaceState === 'loading' ||
    input.workspacePhase !== 'ready' ||
    input.sessionPhase !== 'ready'
  )
    return 'loading';
  return 'ready';
}
