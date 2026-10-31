import { useEffect, useRef, useState } from 'react';
import type { Actor, Office } from '../../office/types.js';
import type { Copy } from '../locales.js';
import { createKitchenRuntime, type SceneRuntime } from './runtime.js';

function Bubble({
  actor,
  t,
  onOpenSession,
}: {
  actor: Actor;
  t: Copy;
  onOpenSession?: (id: string) => void;
}) {
  const state =
    actor.status ??
    (actor.activity === 'waiting' ? 'question' : actor.activity === 'working' ? 'running' : 'idle');
  return (
    <button
      type="button"
      data-seat={actor.seat}
      data-state={state}
      className="co-bubble"
      disabled={!onOpenSession}
      onClick={() => onOpenSession?.(actor.id)}
      title={`${actor.label} · ${actor.workspaceTitle ?? ''} · ${t(state === 'idle' ? 'sessionIdle' : state)}`}
    >
      <span className="co-bubble-identity">
        <strong>{actor.label}</strong>
        <small>{actor.workspaceTitle}</small>
      </span>
      <span className="co-state" data-state={state}>
        {t(state === 'idle' ? 'sessionIdle' : state)}
      </span>
    </button>
  );
}

export function KitchenCanvas({
  office,
  t,
  onOpenSession,
}: {
  office: Office;
  t: Copy;
  onOpenSession?: (id: string) => void;
}) {
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
        <Bubble key={actor.id} actor={actor} t={t} onOpenSession={onOpenSession} />
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
