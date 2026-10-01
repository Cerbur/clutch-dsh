import { useLayoutEffect, useRef, useState } from 'react';
import type { WorktreeTranslate } from '../surface/types.js';
import type { WorktreeViewError } from '../view/worktree-view.js';
import { formatWorktreeViewError } from '../view/worktree-error-copy.js';
import { mountDashboardOverlay, type DashboardPlacement } from './dashboard-overlay.js';
import styles from './dashboard.css';

/** Present a header request while its target read settles, without expanding navigation. */
export function DashboardRequest({
  t,
  error,
  onRetry,
  onClose,
}: {
  readonly t: WorktreeTranslate;
  readonly error?: WorktreeViewError;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [placement, setPlacement] = useState<DashboardPlacement>();
  useLayoutEffect(() => {
    if (!ref.current) return;
    return mountDashboardOverlay(ref.current, (next) =>
      setPlacement((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next)),
    );
  }, []);
  useLayoutEffect(() => {
    if (!placement) return;
    const previous = document.activeElement;
    const element = ref.current;
    element?.focus({ preventScroll: true });
    return () => {
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (element?.contains(document.activeElement) || document.activeElement === document.body)
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [placement !== undefined]);
  return (
    <section
      ref={ref}
      className={styles.dashboardSurface}
      data-worktree-dashboard-request
      aria-label={t('dashboard.title')}
      aria-busy={error === undefined}
      tabIndex={-1}
      style={placement ?? { visibility: 'hidden', height: 0 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={styles.dashboardPage}>
        <div className={styles.dashboardTopline}>
          <span>{t('dashboard.title')}</span>
          <button type="button" className={styles.dashboardButton} onClick={onClose}>
            {t('dashboard.back')}
          </button>
        </div>
        <p role={error ? 'alert' : 'status'}>
          {error ? formatWorktreeViewError(error, t) : t('status.loading')}
        </p>
        {error && (
          <button type="button" className={styles.dashboardButton} onClick={onRetry}>
            {t('action.retry')}
          </button>
        )}
      </div>
    </section>
  );
}
