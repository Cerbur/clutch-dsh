import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { emojiFireworksRenderer, type FireworksVisual } from './fireworks-renderer.js';
import type { FireworksController } from './fireworks-controller.js';
import type { FireworksLaunchEvent } from '../contract/index.js';
import styles from './fireworks.css';

interface FireworksOverlayProps {
  readonly controller: FireworksController;
  readonly openSession: (sessionId: string) => void;
}

function VisualNode({ visual }: { visual: FireworksVisual }) {
  const style = {
    left: `${visual.left}%`,
    top: `${visual.top}%`,
    '--fireworks-delay': `${visual.delayMs}ms`,
    '--fireworks-duration': `${visual.durationMs}ms`,
    '--fireworks-rotation': `${visual.rotationDeg}deg`,
    '--fireworks-scale': String(visual.scale),
  } as CSSProperties;

  if (visual.kind === 'svg') {
    return (
      <img className={styles.particle} src={visual.src} alt={visual.alt ?? ''} style={style} />
    );
  }
  return (
    <span className={styles.particle} aria-hidden="true" style={style}>
      {visual.glyph}
    </span>
  );
}

export function FireworksOverlay({ controller, openSession }: FireworksOverlayProps) {
  const { burst, toast } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (burst === undefined && toast === undefined) return null;
  return (
    <div className={styles.overlay}>
      {toast !== undefined && (
        <FireworksToast
          key={`toast:${JSON.stringify([toast.sessionId, toast.id])}`}
          toast={toast}
          openSession={openSession}
          dismiss={controller.dismissToast}
        />
      )}
      {burst !== undefined && (
        <div
          className={styles.particles}
          key={`burst:${JSON.stringify([burst.sessionId, burst.id])}`}
          aria-hidden="true"
        >
          {emojiFireworksRenderer.createVisuals(burst).map((visual, index) => (
            <VisualNode key={index} visual={visual} />
          ))}
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
