import { Button, SegmentedTabs, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { useId, useState, useSyncExternalStore } from 'react';
import type { WorktreeTranslate } from '../surface/types.js';
import { formatWorktreeViewError } from '../view/worktree-error-copy.js';
import { worktreeDiagnostics } from './diagnostics.js';
import styles from './settings.css';

export function WorktreeSettings({
  t,
  close,
}: {
  readonly t: WorktreeTranslate;
  readonly close: () => void;
}) {
  const entries = useSyncExternalStore(
    worktreeDiagnostics.subscribe,
    worktreeDiagnostics.getSnapshot,
    worktreeDiagnostics.getSnapshot,
  );
  const [tab, setTab] = useState<'overview' | 'errors'>('errors');
  const id = useId();
  return (
    <section className={styles.settings} data-worktree-settings>
      <h2 className={styles.settingsTitle}>{t('settings.title')}</h2>
      <SegmentedTabs
        label={t('settings.title')}
        className={styles.settingsTabs}
        value={tab}
        onChange={setTab}
        items={[
          {
            value: 'overview',
            label: t('settings.overview'),
            id: id + 'overview',
            panelId: id + 'panel',
          },
          {
            value: 'errors',
            label: t('settings.errors'),
            id: id + 'errors',
            panelId: id + 'panel',
          },
        ]}
      />
      <div
        className={styles.settingsPanel}
        role="tabpanel"
        id={id + 'panel'}
        aria-labelledby={id + tab}
      >
        {tab === 'overview' ? (
          <p className={styles.settingsDescription}>{t('settings.description')}</p>
        ) : (
          <>
            <div className={styles.settingsToolbar}>
              <p className={styles.settingsHint}>{t('settings.retention')}</p>
              <Button
                className={styles.settingsAction}
                size="sm"
                variant="outline"
                disabled={!entries.some((entry) => entry.status !== 'active')}
                onClick={() => worktreeDiagnostics.clearHistory()}
              >
                {t('settings.clearHistory')}
              </Button>
            </div>
            {entries.length === 0 && <p className={styles.settingsEmpty}>{t('settings.empty')}</p>}
            <div className={styles.issueList}>
              {[...entries].reverse().map((entry) => (
                <article key={entry.key} className={styles.issue} data-worktree-diagnostic>
                  <div className={styles.issueHeader}>
                    <h3 className={styles.issueTitle}>
                      {entry.describe?.(t) ?? entry.context ?? t('settings.operation')}
                    </h3>
                    <Tag
                      className={styles.issueStatus}
                      tone={
                        entry.status === 'active'
                          ? 'danger'
                          : entry.status === 'resolved'
                            ? 'quiet'
                            : 'neutral'
                      }
                    >
                      {t(
                        entry.status === 'active'
                          ? 'settings.active'
                          : entry.status === 'resolved'
                            ? 'settings.resolved'
                            : 'settings.inactive',
                      )}
                    </Tag>
                  </div>
                  <p className={styles.issueMessage}>
                    {entry.message?.(t) ??
                      (entry.error === undefined
                        ? entry.text
                        : formatWorktreeViewError(entry.error, t))}
                  </p>
                  {entry.status === 'inactive' && (
                    <p className={styles.settingsHint}>{t('settings.reopen')}</p>
                  )}
                  {entry.actions.length > 0 && (
                    <div className={styles.issueActions}>
                      {entry.actions.map((action, index) => (
                        <Button
                          key={index}
                          className={styles.settingsAction}
                          size="sm"
                          variant="outline"
                          disabled={action.disabled}
                          onClick={() => {
                            if (action.leaveSettings) close();
                            action.onClick();
                          }}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {entry.error !== undefined && (
                    <details className={styles.issueDiagnostics}>
                      <summary>{t('settings.diagnostics')}</summary>
                      <pre>
                        {JSON.stringify(
                          {
                            code: entry.error.code,
                            message: entry.error.message,
                            details: entry.error.details,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
