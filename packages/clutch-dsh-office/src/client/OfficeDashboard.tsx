import { useEffect, useMemo, useRef, useState } from 'react';
import { activityClocks, elapsedTime, type ActivityClock } from './session-time.js';
import type { RecentSession, SessionBoard } from '../office/types.js';
import { projectSessionBoard } from '../office/session-board.js';
import type { Copy } from './locales.js';
import { KitchenCanvas } from './scene/KitchenCanvas.js';

export interface DashboardProps {
  readonly board: SessionBoard;
  readonly version: string;
  readonly phase: 'loading' | 'ready' | 'error';
  readonly t: Copy;
  readonly onOpenSession: (id: string) => void;
}

export function OfficeDashboard({ board, phase, t, onOpenSession, version }: DashboardProps) {
  const [preview, setPreview] = useState(false);
  const [count, setCount] = useState(4);
  const [previewEpoch] = useState(Date.now);
  const demo: RecentSession[] = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: `preview-${i}`,
        label: [t('sampleBuild'), t('sampleReview'), t('sampleDone'), t('samplePlan')][i],
        workspaceTitle: ['clutch-dsh', 'whale-studio', 'kitchen', 'clutch-dsh'][i],
        eligible: true,
        activity: i === 1 || i === 3 ? 'waiting' : i === 2 ? 'idle' : 'working',
        status: (['running', 'question', 'unread', 'approval'] as const)[i],
        running: i === 0,
        unread: i === 2,
        updatedAt: previewEpoch - (i === 0 ? 20_000 : 65_000),
      })),
    [count, t, previewEpoch],
  );
  const display = useMemo(
    () => (preview ? projectSessionBoard(demo) : board),
    [preview, demo, board],
  );
  const ready = preview || phase === 'ready';
  const office = ready
    ? display.office
    : { ...display.office, actors: [], activeCount: 0, overflow: 0 };
  const rows = useMemo(() => (ready ? display.sessions : []), [ready, display.sessions]);
  const previousClocks = useRef<ReadonlyMap<string, ActivityClock>>(new Map());
  const [now, setNow] = useState(Date.now);
  const clocks = useMemo(() => activityClocks(previousClocks.current, rows, Date.now()), [rows]);
  useEffect(() => {
    previousClocks.current = clocks;
    setNow(Date.now());
  }, [clocks]);
  const hasRunning = rows.some((row) => row.status === 'running');
  useEffect(() => {
    if (!hasRunning) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (!document.hidden) {
        setNow(Date.now());
        timer = setInterval(() => setNow(Date.now()), 1000);
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      if (timer !== undefined) clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [hasRunning]);
  return (
    <section className="co-office" aria-label={t('nav')}>
      <header className="co-header">
        <div>
          <div className="co-eyebrow">
            DSH Office{' '}
            <span
              className="co-version"
              title={t('previewVersionHint')}
              onDoubleClick={() => setPreview((value) => !value)}
            >
              v{version}
            </span>
          </div>
          <h1>{t('boardTitle')}</h1>
        </div>
        <div className="co-header-right">
          <span className="co-count" role="status">
            {ready ? `${office.activeCount} ${t('attentionSessions')}` : t('loading')}
          </span>
        </div>
      </header>
      {preview && (
        <div className="co-preview-controls">
          <strong>{t('previewLabel')}</strong>
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              className="co-chip"
              aria-pressed={count === n}
              onClick={() => setCount(n)}
            >
              {n} {t('actors')}
            </button>
          ))}
          <small>{t('previewNote')}</small>
        </div>
      )}
      <article className="co-room">
        <KitchenCanvas office={office} t={t} onOpenSession={preview ? undefined : onOpenSession} />
        {!ready && (
          <div className="co-scene-caption" role="status">
            {t(phase === 'error' ? 'unavailable' : 'loading')}
          </div>
        )}
      </article>
      <section className="co-recent" aria-label={t('recentSessions')}>
        <header>
          <h2>{t('recentSessions')}</h2>
          <span className="co-count">{ready ? rows.length : '—'}</span>
        </header>
        {!ready ? (
          <p role="status">{t(phase === 'error' ? 'unavailable' : 'loading')}</p>
        ) : rows.length === 0 ? (
          <p className="co-vacant">{t('noRecent')}</p>
        ) : (
          <ul className="co-session-list">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  className="co-session-row"
                  disabled={preview}
                  onClick={() => onOpenSession(row.id)}
                  data-office-session={row.id}
                >
                  <span className="co-session-identity">
                    <strong>{row.label}</strong>
                    <span>{row.workspaceTitle}</span>
                  </span>
                  <span className="co-session-meta">
                    {row.status === 'running' ? (
                      <>
                        <span
                          className="co-running-icon"
                          role="img"
                          aria-label={t('running')}
                          title={t('running')}
                        />
                        <time
                          title={
                            clocks.get(row.id)?.since === undefined
                              ? undefined
                              : new Date(clocks.get(row.id)!.since!).toLocaleString()
                          }
                        >
                          {elapsedTime(clocks.get(row.id)?.since, now) === undefined
                            ? t('timeUnknown')
                            : `${t('runningFor')} ${elapsedTime(clocks.get(row.id)?.since, now)}`}
                        </time>
                      </>
                    ) : row.status === 'unread' ? (
                      <>
                        <span
                          className="co-done-icon"
                          role="img"
                          aria-label={t('unread')}
                          title={t('unread')}
                        >
                          ✓
                        </span>
                        <time
                          dateTime={
                            clocks.get(row.id)?.since === undefined
                              ? undefined
                              : new Date(clocks.get(row.id)!.since!).toISOString()
                          }
                          title={
                            clocks.get(row.id)?.since === undefined
                              ? undefined
                              : new Date(clocks.get(row.id)!.since!).toLocaleString()
                          }
                        >
                          {clocks.get(row.id)?.since === undefined
                            ? t('timeUnknown')
                            : `${t('completedAt')} ${new Date(clocks.get(row.id)!.since!).toLocaleTimeString()}`}
                        </time>
                      </>
                    ) : (
                      <span className="co-state" data-state={row.status}>
                        {t(row.status === 'idle' ? 'sessionIdle' : row.status)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
