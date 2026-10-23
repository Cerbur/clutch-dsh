import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnimationTemplate } from '../animation.js';
import type { FireworksSignal } from '../contract/index.js';
import { animationDocument } from './animation-sandbox.js';
import { emojiFireworksRenderer } from './fireworks-renderer.js';
import styles from './fireworks.css';

export interface AnimationSurfaceProps {
  readonly template: AnimationTemplate;
  readonly signal: FireworksSignal;
  readonly preview?: boolean;
  readonly onStatus?: (status: 'ready' | 'done' | 'error', message?: string) => void;
}

export function AnimationSurface({
  template,
  signal,
  preview = false,
  onStatus,
}: AnimationSurfaceProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const callback = useRef(onStatus);
  callback.current = onStatus;
  const [error, setError] = useState(false);
  const document = useMemo(() => {
    let seed = 0;
    for (const char of signal.id) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0;
    const token = crypto.randomUUID();
    return { token, html: animationDocument(template, token, seed, signal.message) };
  }, [template, signal.id, signal.message]);
  useEffect(() => {
    let ready = false;
    const fail = (message: string) => {
      setError(true);
      callback.current?.('error', message);
    };
    const startup = setTimeout(() => {
      if (!ready) fail('动画载入超时 / Animation did not start');
    }, 2500);
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.token !== document.token)
        return;
      const type = event.data.type;
      if (type === 'clutch_fireworks/ready') {
        ready = true;
        clearTimeout(startup);
        callback.current?.('ready');
      } else if (type === 'clutch_fireworks/error') {
        ready = true;
        clearTimeout(startup);
        fail(String(event.data.message));
      } else if (type === 'clutch_fireworks/done') callback.current?.('done');
    };
    window.addEventListener('message', listener);
    return () => {
      clearTimeout(startup);
      window.removeEventListener('message', listener);
    };
  }, [document]);
  // A failed or unsupported script never owns or suppresses the toast.
  if (error) return preview ? null : <EmojiFallback signal={signal} />;
  return (
    <iframe
      ref={frame}
      className={styles.animationFrame}
      title={preview ? '动画预览' : 'clutch_fireworks animation'}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={document.html}
      aria-hidden={!preview}
      tabIndex={-1}
    />
  );
}

export function EmojiFallback({ signal }: { signal: FireworksSignal }) {
  return (
    <div className={styles.particles} aria-hidden="true">
      {emojiFireworksRenderer.createVisuals(signal).map((visual, index) =>
        visual.kind === 'emoji' ? (
          <span
            key={index}
            className={styles.particle}
            style={
              {
                left: visual.left + '%',
                top: visual.top + '%',
                '--fireworks-delay': visual.delayMs + 'ms',
                '--fireworks-duration': visual.durationMs + 'ms',
                '--fireworks-rotation': visual.rotationDeg + 'deg',
                '--fireworks-scale': String(visual.scale),
              } as React.CSSProperties
            }
          >
            {visual.glyph}
          </span>
        ) : null,
      )}
    </div>
  );
}
