import styles from '../../worktree.css';
import type { WorktreeLocaleKey } from '../../locales.js';
import type { ActivityFilterView, ActivityWindowId } from '../../view/activity-filter.js';
import { cx } from '../shared.js';
import type { WorktreeTranslate } from '../types.js';

/** Short labels keep four ranges readable in a narrow Sidebar. */
const ACTIVITY_OPTIONS: readonly {
  readonly id: ActivityWindowId;
  readonly labelKey: WorktreeLocaleKey;
}[] = [
  { id: 'today', labelKey: 'filter.today' },
  { id: 'last24h', labelKey: 'filter.last24h' },
  { id: 'last7d', labelKey: 'filter.last7d' },
  { id: 'all', labelKey: 'filter.all' },
];

export interface ActivityFilterBarProps {
  readonly t: WorktreeTranslate;
  readonly activity: ActivityFilterView;
}

/**
 * Browser-only range selector above the Worktree tree.
 *
 * It scopes an existing projection and adds no read: counts come from the Session
 * list and presentations already held by the surface, and the selected range is a
 * Client preference, never a Sidecar or DSH value.
 */
export function ActivityFilterBar({ t, activity }: ActivityFilterBarProps) {
  return (
    <div className={styles.activityBar} role="group" aria-label={t('filter.group')}>
      {ACTIVITY_OPTIONS.map(({ id, labelKey }) => {
        const label = t(labelKey);
        const selected = activity.window === id;
        const count = activity.count(id);
        const accessibleLabel = t('filter.count', { label, count });
        return (
          <button
            key={id}
            type="button"
            className={cx(styles.activitySegment, selected && styles.activitySegmentActive)}
            data-activity-window={id}
            data-selected={selected || undefined}
            aria-pressed={selected}
            aria-label={accessibleLabel}
            title={accessibleLabel}
            onClick={() => {
              activity.setWindow(id);
            }}
          >
            <span className={styles.activityLabel}>{label}</span>
            {count > 0 && (
              <span className={styles.activityCount} aria-hidden="true">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
