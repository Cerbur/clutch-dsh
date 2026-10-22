import { useState, useSyncExternalStore } from 'react';
import type { FireworksController } from './fireworks-controller.js';
import type { FireworksLaunchEvent } from '../contract/index.js';
import styles from './fireworks.css';
import { AnimationSurface, EmojiFallback } from './AnimationSurface.js';

interface FireworksOverlayProps {
  readonly controller: FireworksController;
  readonly openSession: (sessionId: string) => void;
}

export function FireworksOverlay({ controller, openSession }: FireworksOverlayProps) {
  const { burst, toast, animation, preview } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  if (burst === undefined && toast === undefined) return null;
  return (
    <div className={styles.overlay}>
      {toast !== undefined && (
        <FireworksToast
          key={`toast:${JSON.stringify([toast.sessionId, toast.id])}`}
          toast={toast}
          openSession={openSession}
          dismiss={() => controller.dismissToast(toast)}
        />
      )}
      {burst !== undefined && (
        <div
          className={styles.particles}
          key={`burst:${JSON.stringify([burst.sessionId, burst.id])}`}
          aria-hidden="true"
        >
          {animation ? (
            <AnimationSurface
              template={animation}
              signal={burst}
              preview={preview !== undefined}
              onStatus={(status, message) => controller.reportPlayback(burst, status, message)}
            />
          ) : (
            <EmojiFallback signal={burst} />
          )}
        </div>
      )}
    </div>
  );
}

function FireworksToast({
  toast,
  openSession,
  dismiss,
}: {
  readonly toast: FireworksLaunchEvent;
  readonly openSession: (sessionId: string) => void;
  readonly dismiss: () => void;
}) {
  const [navigationError, setNavigationError] = useState<string>();
  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <button
        className={styles.toastAction}
        type="button"
        onClick={() => {
          try {
            openSession(toast.sessionId);
            setNavigationError(undefined);
            dismiss();
          } catch {
            setNavigationError('Unable to open this session. Please try again.');
          }
        }}
      >
        <span>{toast.message ?? 'A big milestone deserves fireworks!'} 🎉</span>
        <span className={styles.toastHint}>Open session →</span>
      </button>
      <button
        className={styles.dismiss}
        type="button"
        aria-label="Dismiss celebration"
        onClick={() => {
          setNavigationError(undefined);
          dismiss();
        }}
      >
        ×
      </button>
      {navigationError !== undefined && <span role="alert">{navigationError}</span>}
    </div>
  );
}
