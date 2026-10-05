import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { useId, useState, useSyncExternalStore } from 'react';
import type { WorktreeTranslate } from '../surface/types.js';
import { formatWorktreeViewError } from '../view/worktree-error-copy.js';
import { worktreeDiagnostics } from './diagnostics.js';
import styles from './settings.css';

export function WorktreeSettings({ t, close }: { readonly t: WorktreeTranslate; readonly close: () => void }) {
  const entries = useSyncExternalStore(
    worktreeDiagnostics.subscribe, worktreeDiagnostics.getSnapshot, worktreeDiagnostics.getSnapshot,
  );
  const [tab, setTab] = useState<'overview' | 'errors'>('errors');
  const id = useId();
  return (
    <section className={styles.settings} data-worktree-settings>
      <h2>{t('settings.title')}</h2>
      <div role="tablist" aria-label={t('settings.title')} className={styles.tabs}>
        {(['overview', 'errors'] as const).map((key) => (
          <button key={key} type="button" role="tab" id={id + key}
            aria-controls={id + 'panel'} aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'errors'
                : key === 'overview' ? 'errors' : 'overview';
              setTab(next);
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                '[id="' + id + next + '"]',
              )?.focus();
            }}
            onClick={() => setTab(key)}>
            {t(key === 'overview' ? 'settings.overview' : 'settings.errors')}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={id + 'panel'} aria-labelledby={id + tab}>
        {tab === 'overview' ? <p>{t('settings.description')}</p> : (
          <>
            <p>{t('settings.retention')}</p>
            <Button variant="outline" onClick={() => worktreeDiagnostics.clearHistory()}>
              {t('settings.clearHistory')}
            </Button>
            {entries.length === 0 && <p>{t('settings.empty')}</p>}
            {[...entries].reverse().map((entry) => (
              <article key={entry.key} className={styles.issue} data-worktree-diagnostic>
                <h3>{entry.describe?.(t) ?? entry.context ?? t('settings.operation')}</h3>
                <span>{t(entry.status === 'active' ? 'settings.active'
                  : entry.status === 'resolved' ? 'settings.resolved' : 'settings.inactive')}</span>
                <p>{entry.message?.(t) ?? (entry.error === undefined ? entry.text : formatWorktreeViewError(entry.error, t))}</p>
                {entry.status === 'inactive' && <p>{t('settings.reopen')}</p>}
                <div className={styles.actions}>
                  {entry.actions.map((action, index) => (
                    <Button key={index} variant="outline" disabled={action.disabled}
                      onClick={() => {
                        if (action.leaveSettings) close();
                        action.onClick();
                      }}>{action.label}</Button>
                  ))}
                </div>
                {entry.error !== undefined && (
                  <details>
                    <summary>{t('settings.diagnostics')}</summary>
                    <pre>{JSON.stringify({
                      code: entry.error.code, message: entry.error.message,
                      details: entry.error.details,
                    }, null, 2)}</pre>
                  </details>
                )}
              </article>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
