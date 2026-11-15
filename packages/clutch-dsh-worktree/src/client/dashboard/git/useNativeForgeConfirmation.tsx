import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import type { WorktreeTranslate } from '../../surface/types.js';
import type { ConfirmNativeForge } from './native-forge-activation.js';

/** The action owns cancellation; the UI owns only the pending user decision. */
export function useNativeForgeConfirmation(t: WorktreeTranslate) {
  const [open, setOpen] = useState(false);
  const pending = useRef<(confirmed: boolean) => void>();
  const confirm = useCallback<ConfirmNativeForge>((signal) => {
    pending.current?.(false);
    if (signal.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const finish = (confirmed: boolean) => {
        signal.removeEventListener('abort', abort);
        if (pending.current === finish) pending.current = undefined;
        setOpen(false);
        resolve(confirmed);
      };
      const abort = () => finish(false);
      pending.current = finish;
      signal.addEventListener('abort', abort, { once: true });
      setOpen(true);
    });
  }, []);
  useEffect(() => () => pending.current?.(false), []);
  return {
    confirm,
    dialog: <Modal open={open} onClose={() => pending.current?.(false)} closeLabel={t('dialog.cancel')}
      title={t('dashboard.git.native.enableTitle')} description={t('dashboard.git.native.enableDescription')}
      footer={<>
        <Button variant="outline" onClick={() => pending.current?.(false)}>{t('dialog.cancel')}</Button>
        <Button variant="primary" data-native-forge-confirm onClick={() => pending.current?.(true)}>
          {t('dashboard.git.native.enableConfirm')}
        </Button>
      </>}>
      <p>{t('dashboard.git.native.enableRetention')}</p>
    </Modal>,
  };
}
