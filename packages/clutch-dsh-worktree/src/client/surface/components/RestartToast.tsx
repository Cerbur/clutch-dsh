import { useSyncExternalStore } from 'react';
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { RestartNotice } from '../../restart-notice.js';

export function RestartToast({
  notice,
  t,
}: PropsRuntime<'shell.overlay'> & PropsLocale<'worktree'> & { readonly notice: RestartNotice }) {
  const visible = useSyncExternalStore(notice.subscribe, notice.getSnapshot, notice.getSnapshot);
  if (!visible) return null;
  return <Toast text={t('restartRequired')} holdMs={8_000} onDone={notice.dismiss} />;
}
