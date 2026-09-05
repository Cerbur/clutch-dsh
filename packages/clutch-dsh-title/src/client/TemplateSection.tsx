import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { DEFAULT_TEMPLATE, validateTemplate } from '../templates.js';
import type { TemplateAction } from '../templates.js';
import type { TemplateStore } from './store.js';
import type { Translate } from './locales.js';

export interface TemplateSectionProps {
  controller: TemplateStore;
  t: Translate;
}
interface Draft {
  id: string;
  source: string;
  revision: number;
  create: boolean;
}

export function TemplateSection({ controller, t }: TemplateSectionProps) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    void controller.load();
  }, [controller]);
  const locked = !state.writable || state.busy;
  const stale = draft !== null && draft.revision !== state.revision;
  let validation = '';
  if (draft && draft.id !== 'default') {
    try {
      validateTemplate(draft.source);
    } catch (error) {
      validation = error instanceof Error ? error.message : String(error);
    }
  }
  const act = async (action: TemplateAction, revision = state.revision) => {
    setFailure('');
    setNotice('');
    try {
      await controller.write(action, revision);
      setNotice(t('saved'));
      if (action.kind === 'save' || action.kind === 'create') setDraft(null);
      setDeleting(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section style={{ display: 'grid', gap: 16, maxWidth: 760, padding: 20 }} aria-label={t('nav')}>
      <h2>{t('nav')}</h2>
      <label>
        <input
          type="checkbox"
          checked={state.templates.enabled}
          disabled={locked}
          onChange={(event) => {
            void act({ kind: 'enabled', enabled: event.target.checked });
          }}
        />{' '}
        {t('enabled')}
      </label>
      <p>{t('native')}</p>
      {state.status === 'idle' && <p role="status">{t('loading')}</p>}
      {state.status !== 'idle' && !state.writable && <p>{t('readonly')}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      <Button
        onClick={() => {
          void controller.load();
        }}
      >
        {t('retry')}
      </Button>
      <p>
        {t('effective')}:{' '}
        <strong>{state.templates.enabled ? state.templates.effective : 'DSH'}</strong>
      </p>
      {state.templates.errors.map((error) => (
        <p role="alert" key={error}>
          {error}
        </p>
      ))}
      <div style={{ display: 'grid', gap: 10 }}>
        {state.templates.rows.map((row) => (
          <article
            key={row.id}
            style={{ border: '1px solid var(--dsw-border, #8886)', borderRadius: 10, padding: 14 }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ overflowWrap: 'anywhere' }}>{row.id}</strong>
              {row.id === 'default' && <small>{t('builtin')}</small>}
              {row.id === state.templates.active && <small>{t('active')}</small>}
              {row.error && <small>{t('invalid')}</small>}
              <Button
                disabled={state.busy || draft !== null}
                onClick={() => {
                  setDraft({
                    id: row.id,
                    source: row.source,
                    revision: state.revision,
                    create: false,
                  });
                  setFailure('');
                }}
              >
                {t(row.id === 'default' ? 'view' : 'edit')}
              </Button>
              <Button
                disabled={
                  locked || !!row.error || row.id === state.templates.active || draft !== null
                }
                onClick={() => {
                  void act({ kind: 'activate', id: row.id });
                }}
              >
                {t('activate')}
              </Button>
              {row.id !== 'default' && (
                <Button disabled={locked || draft !== null} onClick={() => setDeleting(row.id)}>
                  {t('remove')}
                </Button>
              )}
            </div>
            {row.error && (
              <pre role="alert" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {row.error}
              </pre>
            )}
            {deleting === row.id && (
              <div role="group" aria-label={t('confirm')}>
                <p>{t('confirm')}</p>
                <Button
                  disabled={locked}
                  onClick={() => {
                    void act({ kind: 'delete', id: row.id });
                  }}
                >
                  {t('remove')}
                </Button>{' '}
                <Button onClick={() => setDeleting(null)}>{t('cancel')}</Button>
              </div>
            )}
          </article>
        ))}
      </div>
      <Button
        disabled={locked || draft !== null}
        onClick={() => {
          setDraft({ id: '', source: DEFAULT_TEMPLATE, revision: state.revision, create: true });
          setFailure('');
        }}
      >
        {t('add')}
      </Button>
      {draft && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!stale)
              void act(
                { kind: draft.create ? 'create' : 'save', id: draft.id, source: draft.source },
                draft.revision,
              );
          }}
          style={{ display: 'grid', gap: 12 }}
        >
          <label>
            {t('name')}
            <Input
              value={draft.id}
              readOnly={!draft.create}
              disabled={state.busy}
              maxLength={64}
              onChange={(event) => setDraft({ ...draft, id: event.target.value })}
            />
          </label>
          <label>
            {t('source')}
            <textarea
              aria-label={t('source')}
              value={draft.source}
              readOnly={draft.id === 'default' || state.busy}
              maxLength={65536}
              rows={18}
              spellCheck={false}
              onChange={(event) => setDraft({ ...draft, source: event.target.value })}
              style={{
                display: 'block',
                width: '100%',
                boxSizing: 'border-box',
                resize: 'vertical',
                fontFamily: 'monospace',
                padding: 12,
                borderRadius: 8,
                color: 'inherit',
                background: 'transparent',
                border: '1px solid var(--dsw-border, #8886)',
              }}
            />
          </label>
          <p>{t('help')}</p>
          {validation && (
            <pre role="alert" style={{ whiteSpace: 'pre-wrap' }}>
              {validation}
            </pre>
          )}
          {stale && <p role="alert">{t('stale')}</p>}
          <div>
            {draft.id !== 'default' && (
              <Button
                variant="primary"
                type="submit"
                disabled={locked || stale || !!validation || !draft.id.trim()}
              >
                {t('save')}
              </Button>
            )}{' '}
            <Button type="button" disabled={state.busy} onClick={() => setDraft(null)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
      {failure && <p role="alert">{failure}</p>}
      <p role="status">{notice}</p>
      <p>{t('history')}</p>
    </section>
  );
}
