import type { FireworksProjection } from '../contract/index.js';

interface FireworksSessionRow {
  readonly id?: unknown;
  readonly retainedBy?: {
    readonly mainView?: number;
  };
  readonly projectionValues?: Readonly<{
    readonly fireworks?: FireworksProjection;
  }>;
}

interface SessionListSnapshot {
  readonly byId?: object | null;
}

/**
 * DSH 0.1.7 selects the main-view Session through retainedBy.mainView; older
 * hosts exposed the selected id directly as current. Read that legacy field
 * dynamically so the plugin stays type-safe against both host contracts.
 */
export function selectCurrentFireworksSession(
  state: SessionListSnapshot,
): { readonly sessionId: string; readonly signal: FireworksProjection | undefined } | undefined {
  const sessions = (state.byId ?? {}) as Record<
    string,
    FireworksSessionRow | null | undefined
  >;
  const hasLegacyCurrent = Object.hasOwn(state, 'current');
  const legacyCurrentId = Reflect.get(state, 'current');
  const selected = hasLegacyCurrent
    ? typeof legacyCurrentId === 'string'
      ? sessions[legacyCurrentId]
      : undefined
    : Object.values(sessions).find((session) => (session?.retainedBy?.mainView ?? 0) > 0);

  if (selected == null) return undefined;
  const sessionId =
    typeof selected.id === 'string'
      ? selected.id
      : hasLegacyCurrent && typeof legacyCurrentId === 'string'
        ? legacyCurrentId
        : undefined;
  if (sessionId === undefined) return undefined;

  return {
    sessionId,
    signal: selected.projectionValues?.fireworks,
  };
}
