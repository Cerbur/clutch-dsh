import { useSyncExternalStore } from 'react';
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { RestartNotice } from '../../restart-notice.js';

export function RestartToast({
  notice,
  t,
}: PropsRuntime<'shell.overlay'> & PropsLocale<'worktree'> & { readonly notice: RestartNotice }) {
  const reason = useSyncExternalStore(notice.subscribe, notice.getReasonSnapshot, notice.getReasonSnapshot);
  if (reason === undefined) return null;
  const presetMissing = reason === 'permission-preset-unavailable';
  return <Toast
    key={reason}
    text={t(presetMissing ? 'permission.presetRestartRequired' : 'restartRequired')}
    holdMs={presetMissing ? 12_000 : 8_000}
    onDone={() => notice.dismissReason(reason)}
  />;
}
