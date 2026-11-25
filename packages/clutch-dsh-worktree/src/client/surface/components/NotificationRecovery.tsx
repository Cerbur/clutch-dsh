import { Toast } from '@deepseek-ai/dsh-client-ui-primitives';
import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { failureToastKey, type WorktreeNotification } from '../notification-queue.js';
import { worktreeNotifications } from '../notification-center.js';
import { formatWorktreeViewError } from '../../view/worktree-error-copy.js';
import type { WorktreeTranslate } from '../types.js';
import type { WorktreeViewError } from '../../view/worktree-view.js';

export function NotificationPresenter({ t, openSettings }: {
  t: WorktreeTranslate;
  openSettings?: () => boolean;
}) {
  const current = useSyncExternalStore(worktreeNotifications.subscribe, worktreeNotifications.getSnapshot);
  const key = current?.key;
  const onDone = useCallback(() => { if (key !== undefined) worktreeNotifications.dismiss(key); }, [key]);
  if (!current) return null;
  return <Toast key={key} text={(current.message?.(t) ?? current.text) + ' ' + t('settings.toastHint')}
    actions={openSettings && [{ label: t('settings.errors'), onClick: openSettings }]}
    holdMs={8000} onDone={onDone} />;
}

/** Bind live recovery controls to known occurrence IDs after React commits. */
export function NotificationRecovery({ notices }: { notices: readonly WorktreeNotification[] }) {
  const id = useId();
  const latest = useRef(notices);
  const alive = useRef(true);
  latest.current = notices;
  const signature = JSON.stringify(
    notices.map(({ key, reportId, text, context, error, origin, failures, toastKey, actions }) => [
      key, reportId, text, context, error, origin, failures, toastKey, actions?.map(({ label, disabled, leaveSettings }) => [label, disabled, leaveSettings]),
    ]),
  );
  useEffect(() => {
    const registered = latest.current.map((notice) => ({
      ...notice,
      actions: notice.actions?.map((action) => ({
        leaveSettings: action.leaveSettings,
        disabled: action.disabled,
        label: action.label,
        onClick: () => {
          const reportId = notice.reportId ?? notice.error?.reportId;
          const current = latest.current.find((item) => item.key === notice.key &&
            (item.reportId ?? item.error?.reportId) === reportId)?.actions
            ?.find((item) => item.label === action.label);
          if (alive.current && !current?.disabled) current?.onClick();
        },
      })),
    }));
    worktreeNotifications.updateRecovery(id, registered);
  }, [id, signature]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      worktreeNotifications.deactivate(id);
    };
  }, [id]);
  return null;
}

export function ErrorRecovery({
  error,
  t,
  scope,
  context,
  actions,
  describe,
  origin,
}: {
  readonly error?: WorktreeViewError;
  readonly t: WorktreeTranslate;
  readonly scope: string;
  readonly origin?: WorktreeNotification['origin'];
  readonly context?: string;
  readonly actions?: WorktreeNotification['actions'];
  readonly describe?: WorktreeNotification['describe'];
}) {
  const text = error === undefined ? undefined : formatWorktreeViewError(error, t);
  return (
    <NotificationRecovery
      notices={
        text === undefined ? [] : [{
          key: JSON.stringify([scope, error?.code, error?.details]),
          text,
          error,
          toastKey: failureToastKey(error!),
          ...(context !== undefined ? { context } : {}),
          ...(actions !== undefined ? { actions } : {}),
          ...(describe !== undefined ? { describe } : {}),
          ...(origin !== undefined ? { origin } : {}),
        }]
      }
    />
  );
}
