import { useEffect, useRef, useState } from 'react';
import type { Actor, Office } from '../../office/types.js';
import type { Copy } from '../locales.js';
import { createKitchenRuntime, type SceneRuntime } from './runtime.js';

function Bubble({ actor, t }: { actor: Actor; t: Copy }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    setShow(true);
    if (actor.activity === 'waiting') return;
    const timer = setTimeout(() => setShow(false), 5500);
    return () => clearTimeout(timer);
  }, [actor.activity]);
  return (
    <div
      data-seat={actor.seat}
      data-waiting={actor.activity === 'waiting'}
      className="co-bubble"
      style={{ visibility: show ? 'visible' : 'hidden' }}
      aria-hidden="true"
    >
      {t(actor.activity)}
    </div>
  );
}

export function KitchenCanvas({ office, t }: { office: Office; t: Copy }) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<SceneRuntime>();
  const latestActors = useRef(office.actors);
  latestActors.current = office.actors;
  const [failure, setFailure] = useState<'webgl' | 'contextLost'>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let failed = false;
    const observer = new IntersectionObserver(([entry]) => {
      // Offscreen rooms release their contexts, so a long overview cannot exhaust WebGL's context limit.
      if (!entry.isIntersecting) {
        runtime.current?.dispose();
        runtime.current = undefined;
        return;
      }
      if (failed || runtime.current) return;
      try {
        runtime.current = createKitchenRuntime(element, (kind) => {
          failed = true;
          setFailure(kind);
        });
        runtime.current.update(latestActors.current);
      } catch (error) {
        console.warn('clutch-dsh-office: WebGL initialization failed', error);
        failed = true;
        setFailure('webgl');
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      runtime.current?.dispose();
      runtime.current = undefined;
    };
  }, [attempt]);
  useEffect(() => {
    runtime.current?.update(office.actors);
  }, [office.actors]);
  return (
    <div className="co-canvas" ref={container} aria-label={office.title}>
      {office.actors.map((actor) => (
        <Bubble key={actor.id} actor={actor} t={t} />
      ))}
      {failure && (
        <div className="co-scene-error" role="alert">
          {t(failure)}
          <button
            className="co-button"
            onClick={() => {
              setFailure(undefined);
              setAttempt((value) => value + 1);
            }}
          >
            {t('retry')}
          </button>
        </div>
      )}
    </div>
  );
}
