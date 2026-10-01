import { useSyncExternalStore } from 'react';
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives';
import type { RestartNotice } from './restart-notice.js';
import type { Translate } from './locales.js';

export function RestartToast({ notice, t }: { notice: RestartNotice; t: Translate }) {
  const visible = useSyncExternalStore(notice.subscribe, notice.getSnapshot, notice.getSnapshot);
  if (!visible) return null;
  return <Toast text={t('restartRequired')} holdMs={8_000} onDone={notice.dismiss} />;
}
