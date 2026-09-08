import { Toast } from '@deepseek-ai/dsh-client-ui-primitives';
import { useCallback, useEffect, useState } from 'react';
import {
  reconcileNotifications,
  type NotificationQueue,
  type WorktreeNotification,
} from '../notification-queue.js';

/** One native toast at a time; recovery controls remain available after it fades. */
export function NotificationToasts({
  notices,
  detailsLabel,
}: {
  notices: readonly WorktreeNotification[];
  detailsLabel: string;
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
  const text = current.text.length > 240 ? current.text.slice(0, 240) + '…' : current.text;
  return (
    <Toast key={current.key} text={text + ' · ' + detailsLabel} holdMs={6000} onDone={onDone} />
  );
}
