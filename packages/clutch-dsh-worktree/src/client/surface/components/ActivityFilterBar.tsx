import { Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import { IconCheckOutline16, IconSlidersTwoOutline16 } from '../../dsh-icons.js';
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
 * Client preference, never a Sidecar or DSH value. The trailing menu only chooses
 * which ranges the bar renders; it never changes membership or Host state.
 */
export function ActivityFilterBar({ t, activity }: ActivityFilterBarProps) {
  const chooseLabel = t('filter.choose');
  // The last visible range stays checked so the bar can never lose every tab.
  const onlyVisible = activity.visibleWindows.length === 1;
  return (
    <div className={styles.activityBar}>
      <div className={styles.activityTabs} role="group" aria-label={t('filter.group')}>
        {ACTIVITY_OPTIONS.filter(({ id }) => activity.isWindowVisible(id)).map(
          ({ id, labelKey }) => {
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
          },
        )}
      </div>
      <Menu
        open={activity.menuOpen}
        onClose={() => {
          activity.setMenuOpen(false);
        }}
        align="end"
        portal
        items={[{ type: 'label', id: 'visible-filters', text: t('filter.visible') }]}
        anchor={
          <button
            type="button"
            className={styles.activityConfig}
            data-activity-config
            aria-label={chooseLabel}
            aria-haspopup="menu"
            aria-expanded={activity.menuOpen}
            title={chooseLabel}
            onClick={() => {
              activity.setMenuOpen(!activity.menuOpen);
            }}
          >
            <IconSlidersTwoOutline16 />
          </button>
        }
      >
        {ACTIVITY_OPTIONS.map(({ id, labelKey }) => {
          const label = t(labelKey);
          const checked = activity.isWindowVisible(id);
          const locked = checked && onlyVisible;
          return (
            <button
              key={id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={checked}
              aria-label={t('filter.count', { label, count: activity.count(id) })}
              className={styles.activityOption}
              data-activity-option={id}
              data-checked={checked || undefined}
              disabled={locked}
              title={locked ? t('filter.keepOne') : undefined}
              onClick={() => {
                activity.setWindowVisible(id, !checked);
              }}
            >
              <span className={styles.activityOptionLabel}>{label}</span>
              <span className={styles.activityOptionCount} aria-hidden="true">
                {activity.count(id)}
              </span>
              <span className={styles.activityOptionCheck} aria-hidden="true">
                {checked && <IconCheckOutline16 />}
              </span>
            </button>
          );
        })}
        <span className={styles.activityMenuSeparator} role="separator" aria-hidden="true" />
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={activity.showInactiveStructure}
          aria-label={t('filter.keepInactive')}
          className={styles.activityOption}
          data-activity-keep-inactive
          data-checked={activity.showInactiveStructure || undefined}
          title={t('filter.keepInactiveHint')}
          onClick={() => {
            activity.setShowInactiveStructure(!activity.showInactiveStructure);
          }}
        >
          <span className={styles.activityOptionLabel}>{t('filter.keepInactive')}</span>
          <span className={styles.activityOptionCheck} aria-hidden="true">
            {activity.showInactiveStructure && <IconCheckOutline16 />}
          </span>
        </button>
      </Menu>
    </div>
  );
}
