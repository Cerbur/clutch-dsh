import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import {
  FIREWORKS_DURATION_MS,
  type FireworksProjection,
  type FireworksSignal,
} from '../contract/index.js';
import { emojiFireworksRenderer, type FireworksVisual } from './fireworks-renderer.js';
import styles from './fireworks.css';

type FireworksOverlayProps = PropsRuntime<'shell.overlay'>;

interface Burst {
  readonly key: string;
  readonly signal: FireworksSignal;
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

export function FireworksOverlay({ useSessions }: FireworksOverlayProps) {
  const current = useSessions((state) => {
    const sessionId = state.current;
    if (sessionId === undefined) return undefined;
    const signal = state.byId[sessionId]?.projectionValues?.fireworks as
      FireworksProjection | undefined;
    return { sessionId: String(sessionId), signal };
  });
  const seen = useRef(new Map<string, string | null>());
  const activeSession = useRef<string | undefined>();
  const [burst, setBurst] = useState<Burst | undefined>();

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
  }, [current?.sessionId, current?.signal?.id, current?.signal?.message]);

  useEffect(() => {
    if (burst === undefined) return undefined;
    const timer = window.setTimeout(() => setBurst(undefined), FIREWORKS_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [burst]);

  if (burst === undefined) return null;
  return (
    <div className={styles.overlay} key={burst.key} aria-live="polite">
      <div className={styles.banner} role="status">
        {burst.signal.message ?? 'A big milestone deserves fireworks!'} 🎉
      </div>
      <div className={styles.particles} aria-hidden="true">
        {emojiFireworksRenderer.createVisuals(burst.signal).map((visual, index) => (
          <VisualNode key={`${burst.key}:${index}`} visual={visual} />
        ))}
      </div>
    </div>
  );
}
