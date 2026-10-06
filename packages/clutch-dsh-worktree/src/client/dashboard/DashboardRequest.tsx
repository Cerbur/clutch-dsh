import { useLayoutEffect, useRef, useState } from 'react';
import type { WorktreeTranslate } from '../surface/types.js';
import type { WorktreeViewError } from '../view/worktree-view.js';
import { mountDashboardOverlay, type DashboardPlacement } from './dashboard-overlay.js';
import styles from './dashboard.css';
import { ErrorToast } from '../surface/components/NotificationToasts.js';

/** Present a header request while its target read settles, without expanding navigation. */
export function DashboardRequest({
  t,
  error,
  onRetry,
  onClose,
  context,
}: {
  readonly t: WorktreeTranslate;
  readonly error?: WorktreeViewError;
  readonly onRetry: () => void;
  readonly onClose: () => void;
  readonly context?: string;
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
      <header className={styles.dashboardTopline} data-dashboard-topbar data-window-drag>
        <span
          style={{
            marginInlineStart: `max(0px, calc(var(--dsh-frame-leading-clearance, 0px) - ${placement?.left ?? 0}px - 20px))`,
          }}
        >
          {t('dashboard.title')}
        </span>
        <div className={styles.dashboardToplineActions}>
          <button type="button" className={styles.dashboardButton} onClick={onClose}>
            {t('dashboard.back')}
          </button>
        </div>
      </header>
      <div className={styles.dashboardPage}>
        {error === undefined && <p role="status">{t('status.loading')}</p>}
        <ErrorToast error={error} t={t} scope="dashboard-request"
          context={context ?? t('dashboard.title')}
          actions={[{ label: t('action.retry'), onClick: onRetry }]} />
      </div>
    </section>
  );
}
