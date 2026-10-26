import { useState } from 'react';
import type { Activity, Office } from '../office/types.js';
import type { Copy } from './locales.js';
import { KitchenCanvas } from './scene/KitchenCanvas.js';

export interface DashboardProps {
  readonly offices: readonly Office[];
  readonly phase: 'loading' | 'ready' | 'error';
  readonly t: Copy;
}

const previewActivities = [
  ['working', 'demoWorking'],
  ['waiting', 'demoWaiting'],
  ['searching', 'demoSearching'],
  ['editing', 'demoEditing'],
  ['idle', 'demoIdle'],
] as const;

export function OfficeDashboard({ offices, phase, t }: DashboardProps) {
  const [focus, setFocus] = useState<string>();
  const [preview, setPreview] = useState(false);
  const [activity, setActivity] = useState<Activity>('working');
  const [two, setTwo] = useState(true);
  const demo: Office = {
    id: 'office-local-preview',
    title: t('previewLabel'),
    activeCount: two ? 2 : 1,
    overflow: 0,
    actors: [
      { id: 'preview-a', label: 'Mio', activity, seat: 0 },
      ...(two
        ? [
            {
              id: 'preview-b',
              label: 'Nami',
              activity: activity === 'working' ? ('waiting' as const) : ('working' as const),
              seat: 1 as const,
            },
          ]
        : []),
    ],
  };
  const visible = preview
    ? [demo]
    : focus
      ? offices.filter((office) => office.id === focus)
      : offices;
  const total = offices.reduce((sum, office) => sum + office.activeCount, 0);
  return (
    <section className="co-office" aria-label={t('nav')}>
      <header className="co-header">
        <div>
          <div className="co-eyebrow">
            DSH OFFICE <span>·</span> KITCHEN SERIES
          </div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <button
          className={preview ? 'co-button co-selected' : 'co-button'}
          onClick={() => {
            setPreview(!preview);
            setFocus(undefined);
          }}
        >
          {preview ? t('overview') : t('preview')}
        </button>
      </header>
      <div className="co-toolbar">
        {focus && !preview ? (
          <button className="co-back" onClick={() => setFocus(undefined)}>
            ← {t('back')}
          </button>
        ) : (
          <span className="co-section-label">{preview ? t('previewLabel') : t('overview')}</span>
        )}
        {!preview && phase === 'ready' && (
          <span className="co-count">
            {offices.length} / {total} {t('active')}
          </span>
        )}
      </div>
      {preview && (
        <div className="co-preview-controls">
          <div>
            {previewActivities.map(([value, key]) => (
              <button
                key={value}
                className={activity === value ? 'co-chip co-selected' : 'co-chip'}
                aria-pressed={activity === value}
                onClick={() => setActivity(value)}
              >
                {t(key)}
              </button>
            ))}
          </div>
          <button className="co-chip" aria-pressed={two} onClick={() => setTwo(!two)}>
            {two ? t('single') : t('double')}
          </button>
          <small>{t('previewNote')}</small>
        </div>
      )}
      {!preview && phase !== 'ready' ? (
        <div className="co-empty" role="status">
          {t(phase === 'error' ? 'unavailable' : 'loading')}
        </div>
      ) : visible.length === 0 ? (
        <div className="co-empty">
          <div className="co-empty-icon" aria-hidden="true">
            ☕
          </div>
          <h2>{t(focus ? 'focusedEmpty' : 'empty')}</h2>
          <p>{t('emptyBody')}</p>
        </div>
      ) : (
        <div className={focus || preview ? 'co-grid co-focused' : 'co-grid'}>
          {visible.map((office) => (
            <article className="co-room" key={office.id}>
              <div className="co-room-heading">
                <div>
                  <span className="co-live-dot" data-active={office.activeCount > 0} />{' '}
                  <h2>{office.title}</h2>
                </div>
                <span className="co-count">
                  {office.activeCount} {t('active')}
                </span>
              </div>
              <KitchenCanvas office={office} t={t} />
              <div className="co-room-footer">
                <span>
                  {t('whitebox')}
                  {office.overflow > 0 && (
                    <>
                      {' '}
                      · +{office.overflow} {t('overflow')}
                    </>
                  )}
                </span>
                {!preview && !focus && (
                  <button className="co-back" onClick={() => setFocus(office.id)}>
                    {t('focus')} ↗
                  </button>
                )}
              </div>
              <div className="co-roster">
                {office.actors.length === 0 && <p className="co-vacant">{t('roomEmpty')}</p>}
                {office.actors.map((actor) => (
                  <div key={actor.id}>
                    <span className={`co-avatar co-seat-${actor.seat}`} aria-hidden="true">
                      ◡
                    </span>
                    <span className="co-roster-name" title={actor.label}>
                      {actor.label}
                    </span>
                    <span className="co-status">{t(actor.activity)}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
