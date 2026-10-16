import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client';
import {
  FIREWORKS_DURATION_MS,
  FIREWORKS_LIMITS,
  type FireworksShowPreferences,
  type FireworksSignal,
} from '../contract/index.js';
import { emojiFireworksRenderer, type FireworksVisual } from './fireworks-renderer.js';
import { mountFireworksShow } from './fireworks-show.js';
import { selectCurrentFireworksSession } from './fireworks-session.js';
import styles from './fireworks.css';

interface FireworksOverlayProps {
  readonly useSessions: UseSessions;
  readonly prefs: FireworksShowPreferences;
}

interface Burst {
  readonly key: string;
  readonly signal: FireworksSignal;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
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

export function FireworksOverlay({ useSessions, prefs }: FireworksOverlayProps) {
  const current = useSessions(selectCurrentFireworksSession);
  const seen = useRef(new Map<string, string | null>());
  const activeSession = useRef<string | undefined>();
  const [burst, setBurst] = useState<Burst | undefined>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const mode = prefs.mode ?? 'realistic';
  const reducedMotion = prefersReducedMotion();
  const useShow = mode === 'realistic' && !reducedMotion;

  useEffect(() => {
    if (current === undefined) {
      activeSession.current = undefined;
      setBurst(undefined);
      return;
    }

    const marker = current.signal?.id ?? null;
    const sessionChanged = activeSession.current !== current.sessionId;
    activeSession.current = current.sessionId;

    if (!seen.current.has(current.sessionId)) {
      seen.current.set(current.sessionId, marker);
      if (sessionChanged) setBurst(undefined);
      return;
    }

    const previous = seen.current.get(current.sessionId) ?? null;
    seen.current.set(current.sessionId, marker);
    if (sessionChanged) {
      setBurst(undefined);
      return;
    }
    if (current.signal !== undefined && current.signal !== null && marker !== previous) {
      setBurst({
        key: `${current.sessionId}:${current.signal.id}`,
        signal: current.signal,
      });
    }
  }, [current?.sessionId, current?.signal?.id, current?.signal?.message, current?.signal?.splash]);

  // Emoji celebration keeps the fixed lifetime; the canvas show ends when the
  // scene burns out, with a wall-clock guard for paused background frames.
  useEffect(() => {
    if (burst === undefined || useShow) return undefined;
    const timer = window.setTimeout(() => setBurst(undefined), FIREWORKS_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [burst, useShow]);

  useEffect(() => {
    if (burst === undefined || !useShow) return undefined;
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const windowMs = Math.min(
      FIREWORKS_LIMITS.maxDurationMs,
      Math.max(FIREWORKS_LIMITS.minDurationMs, prefs.showDurationMs ?? FIREWORKS_DURATION_MS),
    );
    const handle = mountFireworksShow(
      canvas,
      burst.signal,
      {
        showDurationMs: windowMs,
        showRatePerSec: prefs.showRatePerSec,
      },
      () => setBurst(undefined),
    );
    const guard = window.setTimeout(
      () => setBurst(undefined),
      windowMs + 12_000,
    );
    return () => {
      window.clearTimeout(guard);
      handle.dispose();
    };
  }, [burst, useShow, prefs.showDurationMs, prefs.showRatePerSec]);

  if (burst === undefined) return null;
  let celebration: ReactNode;
  if (useShow) {
    celebration = <canvas ref={canvasRef} className={styles.show} aria-hidden="true" />;
  } else {
    celebration = (
      <div className={styles.particles} aria-hidden="true">
        {emojiFireworksRenderer.createVisuals(burst.signal).map((visual, index) => (
          <VisualNode key={`${burst.key}:${index}`} visual={visual} />
        ))}
      </div>
    );
  }
  return (
    <div className={styles.overlay} key={burst.key} aria-live="polite">
      <div className={styles.banner} role="status">
        {burst.signal.message ?? 'A big milestone deserves fireworks!'} 🎉
      </div>
      {celebration}
    </div>
  );
}

/** Minimal reactive view of the plugin settings namespace. */
export interface PreferencesScope {
  subscribe(listener: () => void): () => void;
  getSnapshot(): FireworksShowPreferences;
}

/** Bind the overlay to a settings scope for slot registration. */
export function createFireworksOverlay(scope: PreferencesScope) {
  return function FireworksOverlayConnected(props: { readonly useSessions: UseSessions }) {
    const prefs = useSyncExternalStore(
      scope.subscribe,
      scope.getSnapshot,
      scope.getSnapshot,
    );
    return <FireworksOverlay {...props} prefs={prefs} />;
  };
}
