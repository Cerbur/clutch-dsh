import { useRef } from 'react';
import { type SessionListLike } from '../session/session-view.js';
import type { WorktreeFullAccessConfirmationInput } from '../permission/worktree-permission.js';
import type { WorktreeForkRecovery, WorktreeForkRecoveryStore } from '../session/worktree-session-fork.js';
import {
  stableWorkspaceIds,
  toWorktreeViewError,
  type WorktreeViewError,
} from '../view/worktree-view.js';
import type { ReadState, WorkspaceLike, WorktreePermissionNotice } from './types.js';
export function toNativeWorktreeViewError(error: unknown): WorktreeViewError {
  const viewError = toWorktreeViewError(error);
  if (typeof error === 'object' && error !== null) return viewError;
  return { ...viewError, message: String(error) };
}
export const EMPTY_READ_STATE: ReadState = { status: 'idle', views: [] };
export const EMPTY_PERMISSION_NOTICE: WorktreePermissionNotice | undefined = undefined;
export const EMPTY_PERMISSION_NOTICE_SUBSCRIBE = (): (() => void) => () => {};
export const EMPTY_PERMISSION_NOTICE_SNAPSHOT = (): WorktreePermissionNotice | undefined =>
  EMPTY_PERMISSION_NOTICE;
export const EMPTY_FULL_ACCESS_CONFIRMATION_SUBSCRIBE = (): (() => void) => () => {};
export const EMPTY_FULL_ACCESS_CONFIRMATION_SNAPSHOT = ():
  WorktreeFullAccessConfirmationInput | undefined => undefined;
export const EMPTY_FORK_RECOVERY_SNAPSHOT = {
  revision: 0,
  pending: [],
  affectedWorkspaceIds: [],
} as const;
export const EMPTY_FORK_RECOVERY_STORE: WorktreeForkRecoveryStore = {
  getSnapshot: () => EMPTY_FORK_RECOVERY_SNAPSHOT,
  subscribe: () => () => {},
};
export type ExpandedSessionGroups = Record<string, boolean>;
export function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
export interface WorktreeCreateDefaults {
  readonly baseBranch?: string;
  readonly newBranch?: string;
}
export interface CurrentSessionRevealState {
  readonly sessionId: string;
  readonly suppressedKeys: Readonly<Record<string, true>>;
}
export interface SessionOrderInput {
  readonly accountKey: string;
  readonly sessionIds: readonly string[];
  readonly updatedAtById: Readonly<Record<string, number | undefined>>;
}
export function updatedAtById(
  sessionIds: readonly string[],
  sessions: SessionListLike,
): Readonly<Record<string, number | undefined>> {
  return Object.fromEntries(
    sessionIds.map((sessionId) => [sessionId, sessions.byId[sessionId]?.updatedAt]),
  );
}
export function forkRecoveryError(recovery: WorktreeForkRecovery): WorktreeViewError {
  const error = toNativeWorktreeViewError(recovery.error);
  return {
    ...error,
    code: error.code === 'WORKTREE_VIEW_FAILED' ? 'SESSION_BINDING_FAILED' : error.code,
    details: {
      ...(error.details ?? {}),
      sessionId: recovery.childSessionId,
    },
  };
}
export function useStableWorkspaceIds(workspaces: readonly WorkspaceLike[]): readonly string[] {
  const next = workspaces.map((workspace) => workspace.workspaceId);
  const previousRef = useRef<readonly string[]>([]);
  const stable = stableWorkspaceIds(previousRef.current, next);
  if (stable !== previousRef.current) previousRef.current = stable;
  return previousRef.current;
}
export function IconCollapseAll16({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M9 11h6v1H9v-1zm6-3H9v1h6V8zm-6-3h6v1H9V5zM4.15 2.15l-.71.7L5.59 5H1v1h4.59L3.44 8.15l.71.7L7.5 5.5 4.15 2.15zm0 6l-.71.7L5.59 11H1v1h4.59l-2.15 2.15.71.7L7.5 11.5 4.15 8.15z" />
    </svg>
  );
}
