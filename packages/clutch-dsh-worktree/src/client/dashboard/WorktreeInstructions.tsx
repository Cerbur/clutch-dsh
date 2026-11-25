import { worktreeNotifications } from '../surface/notification-center.js';
import { useEffect, useRef, useState } from 'react';
import type { WorktreeTranslate } from '../surface/types.js';
import { NotificationRecovery } from '../surface/components/NotificationRecovery.js';
import { toWorktreeViewError, type WorktreeViewError } from '../view/worktree-view.js';
import { formatWorktreeViewError } from '../view/worktree-error-copy.js';
import styles from './dashboard.css';

export function WorktreeInstructions({
  value,
  onSave,
  t,
  disabled,
  context,
}: {
  value: string;
  onSave?: (text: string, expected: string) => Promise<string>;
  t: WorktreeTranslate;
  disabled: boolean;
  context?: string;
}) {
  const [saved, setSaved] = useState(value);
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<WorktreeViewError>();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setSaved(value);
  }, [value]);
  const expected = useRef(value);
  const save = async () => {
    if (busy.current || draft === undefined || !onSave) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      const result = await onSave(draft, expected.current);
      if (alive.current) {
        if (error?.reportId) worktreeNotifications.resolve(error.reportId);
        setSaved(result);
        setDraft(undefined);
      }
    } catch (cause) {
      if (alive.current) {
        const failure = toWorktreeViewError(cause);
        setError(worktreeNotifications.reportError(failure, { context, message: translate =>
          translate('dashboard.instructionsSaveFailed') +
          (failure.code === 'WORKTREE_VIEW_FAILED' ? '' : ' ' + formatWorktreeViewError(failure, translate)) }));
      }
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  };
  return (
    <div>
      <p>{t('dashboard.instructionsHint')}</p>
      {draft === undefined ? (
        <>
          <p className={styles.dashboardInstructionsText}>
            {saved || t('dashboard.noInstructions')}
          </p>
          <button
            type="button"
            className={styles.dashboardButton}
            disabled={disabled || !onSave}
            onClick={() => {
              expected.current = saved;
              setDraft(saved);
              setError(undefined);
            }}
          >
            {t('dashboard.edit')}
          </button>
        </>
      ) : (
        <>
          <textarea
            className={styles.dashboardInstructionsInput}
            aria-label={t('dashboard.instructions')}
            value={draft}
            maxLength={32000}
            rows={8}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className={styles.dashboardInstructionActions}>
            <button
              type="button"
              className={styles.dashboardButton}
              disabled={pending || disabled}
              onClick={() => void save()}
            >
              {t(pending ? 'dashboard.savingInstructions' : 'dashboard.saveInstructions')}
            </button>
            <button
              type="button"
              className={styles.dashboardButton}
              disabled={pending}
              onClick={() => {
                setDraft(undefined);
                setError(undefined);
              }}
            >
              {t('dashboard.cancelInstructions')}
            </button>
          </div>
          <NotificationRecovery
            notices={
              error === undefined
                ? []
                : [
                    {
                      key: JSON.stringify(['instructions', context, error.code, error.details]),
                      context, error,
                      actions: [{ label: t('action.retry'), disabled: pending || disabled,
                        onClick: () => { void save(); } }],
                      describe: (translate) => translate('dashboard.instructions') + ' · ' + (context ?? ''),
                      message: (translate) => translate('dashboard.instructionsSaveFailed') +
                        (error.code === 'WORKTREE_VIEW_FAILED' ? '' : ' ' + formatWorktreeViewError(error, translate)),
                      text:
                        t('dashboard.instructionsSaveFailed') +
                        (error.code === 'WORKTREE_VIEW_FAILED'
                          ? ''
                          : ' ' + formatWorktreeViewError(error, t)),
                    },
                  ]
            }
          />
        </>
      )}
    </div>
  );
}
