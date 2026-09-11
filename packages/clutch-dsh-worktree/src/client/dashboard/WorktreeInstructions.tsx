import { useEffect, useRef, useState } from 'react';
import type { WorktreeTranslate } from '../surface/types.js';
import styles from './dashboard.css';

export function WorktreeInstructions({
  value,
  onSave,
  t,
  disabled,
}: {
  value: string;
  onSave?: (text: string, expected: string) => Promise<string>;
  t: WorktreeTranslate;
  disabled: boolean;
}) {
  const [saved, setSaved] = useState(value);
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState(false);
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
    setError(false);
    try {
      const result = await onSave(draft, expected.current);
      if (alive.current) {
        setSaved(result);
        setDraft(undefined);
      }
    } catch {
      if (alive.current) setError(true);
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
              setError(false);
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
                setError(false);
              }}
            >
              {t('dashboard.cancelInstructions')}
            </button>
          </div>
          {error && <p role="alert">{t('dashboard.instructionsSaveFailed')}</p>}
        </>
      )}
    </div>
  );
}
