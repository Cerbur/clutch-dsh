import { useSyncExternalStore } from 'react';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '../dsh-slot-contract.js';
import type { SteerState } from './steer-state.js';
import { visibleSteerRows } from './steer-state.js';
import styles from './steer.css';

export interface SteerDockInjected {
  readonly steer: ObservableSnapshot<SteerState | undefined>;
}

export function SteerDock({ useProjection, steer, t }: PropsRuntime<'conversation.input.dock'> & PropsLocale<'worktree'> & SteerDockInjected) {
  const state = useSyncExternalStore(steer.subscribe, steer.getSnapshot, steer.getSnapshot);
  const rows = visibleSteerRows(state, useProjection('inbox'));
  if (rows.length === 0) return null;
  return <section className={styles.strip} aria-label={t('steer.title')}>
    <div className={styles.title}>{t('steer.title')} · {rows.length}</div>
    <div className={styles.items}>
      {rows.map(row => <details key={row.id} className={styles.item} data-worktree-steer={row.status}>
        <summary>
          <span className={styles.status}>{t(`steer.${row.status}`)}</span>
          <span className={styles.preview}>{row.text}</span>
        </summary>
        <div className={styles.body}>
          <div className={styles.sender}>{t('steer.sender', { sender: row.sender })}</div>
          <p>{row.text}</p>
          <small>{t('steer.receiptHint')}</small>
        </div>
      </details>)}
    </div>
  </section>;
}
