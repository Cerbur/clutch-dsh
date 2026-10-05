import { Toast } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  reconcileNotifications,
  failureToastKey,
  type NotificationQueue,
  type WorktreeNotification,
} from '../notification-queue.js';
import { formatWorktreeViewError } from '../../view/worktree-error-copy.js';
import type { WorktreeTranslate } from '../types.js';
import type { WorktreeViewError } from '../../view/worktree-view.js';
import { worktreeDiagnostics } from '../../settings/diagnostics.js';

type Publish = (source: string, notices: readonly WorktreeNotification[]) => void;
const Notifications = createContext<Publish | undefined>(undefined);

/** One queue for the list, dialogs and Dashboard; unmount removes a source's notices. */
export function NotificationProvider({ children, t, openSettings }: {
  children: ReactNode;
  t: WorktreeTranslate;
  openSettings?: () => boolean;
}) {
  const [sources, setSources] = useState<ReadonlyMap<string, readonly WorktreeNotification[]>>(
    new Map(),
  );
  const publish = useCallback<Publish>((source, notices) => {
    setSources((current) => {
      if (!current.has(source) && notices.length === 0) return current;
      const next = new Map(current);
      if (notices.length === 0) next.delete(source);
      else next.set(source, notices);
      return next;
    });
  }, []);
  return (
    <Notifications.Provider value={publish}>
      {children}
      <ToastQueue notices={[...sources.values()].flat()} hint={t('settings.toastHint')}
        settingsAction={openSettings === undefined ? undefined
          : { label: t('settings.errors'), onClick: openSettings }} />
    </Notifications.Provider>
  );
}

/** Register resolved copy while retaining live callbacks for recovery actions. */
export function NotificationToasts({ notices }: { notices: readonly WorktreeNotification[] }) {
  const publish = useContext(Notifications);
  const id = useId();
  const latest = useRef(notices);
  const alive = useRef(true);
  latest.current = notices;
  const signature = JSON.stringify(
    notices.map(({ key, text, context, error, actions }) => [
      key, text, context, error, actions?.map(({ label, disabled, leaveSettings }) => [label, disabled, leaveSettings]),
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
          const current = latest.current.find((item) => item.key === notice.key)?.actions
            ?.find((item) => item.label === action.label);
          if (alive.current && !current?.disabled) current?.onClick();
        },
      })),
    }));
    worktreeDiagnostics.publish(id, registered);
    publish?.(id, registered);
  }, [publish, id, signature]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      worktreeDiagnostics.deactivate(id);
      publish?.(id, []);
    };
  }, [publish, id]);
  return publish === undefined ? <ToastQueue notices={notices} /> : null;
}

export function ErrorToast({
  error,
  t,
  scope,
  context,
  actions,
  describe,
}: {
  readonly error?: WorktreeViewError;
  readonly t: WorktreeTranslate;
  readonly scope: string;
  readonly context?: string;
  readonly actions?: WorktreeNotification['actions'];
  readonly describe?: WorktreeNotification['describe'];
}) {
  const text = error === undefined ? undefined : formatWorktreeViewError(error, t);
  return (
    <NotificationToasts
      notices={
        text === undefined ? [] : [{
          key: JSON.stringify([scope, error?.code, error?.details]), text, error, context, actions, describe,
          toastKey: failureToastKey(error!),
        }]
      }
    />
  );
}

function ToastQueue({ notices, hint, settingsAction }: {
  notices: readonly WorktreeNotification[];
  hint?: string;
  settingsAction?: { readonly label: string; readonly onClick: () => void };
}) {
  const [queue, setQueue] = useState<NotificationQueue>({ seen: [], pending: [] });
  useEffect(() => {
    setQueue((current) => reconcileNotifications(current, notices));
  }, [notices]);
  const current = queue.pending[0];
  const key = current?.key;
  const onDone = useCallback(() => {
    setQueue((state) => ({
      ...state,
      pending: state.pending.filter((notice) => notice.key !== key),
    }));
  }, [key]);
  if (current === undefined) return null;
  // Never truncate recovery guidance. Resolve actions from the current render.
  const active = notices.find((notice) => (notice.toastKey ?? notice.key) === current.key);
  return (
    <Toast
      key={current.key}
      text={[active?.text ?? current.text, hint].filter(Boolean).join(' ')}
      actions={settingsAction === undefined ? undefined : [settingsAction]}
      holdMs={8000}
      onDone={onDone}
    />
  );
}
