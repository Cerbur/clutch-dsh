import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Button, Input, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { DEFAULT_TEMPLATE, validateTemplate } from '../templates.js';
import type { TemplateAction } from '../templates.js';
import type { TemplateStore } from './store.js';
import type { Translate } from './locales.js';
import { templateStyles } from './styles.js';
import { previewTemplate } from '../preview.js';

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
  const [previewTimestamp] = useState(() => Date.now());
  const helpId = useId();
  const validationId = useId();
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
  const editor = draft && (
    <form
      className="clutch-title-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!stale)
          void act(
            { kind: draft.create ? 'create' : 'save', id: draft.id, source: draft.source },
            draft.revision,
          );
      }}
    >
      {draft.create && (
        <label className="clutch-title-field">
          <span>{t('name')}</span>
          <Input
            autoFocus
            placeholder={t('namePlaceholder')}
            value={draft.id}
            disabled={state.busy}
            maxLength={64}
            onChange={(event) => setDraft({ ...draft, id: event.target.value })}
          />
        </label>
      )}
      <div className="clutch-title-code">
        <div className="clutch-title-codebar">
          <span>{t('source')}</span>
          <span className="clutch-title-language">
            {draft.id === 'default' ? t('readOnlyLabel') : 'YAML'}
          </span>
        </div>
        <textarea
          aria-label={t('source')}
          aria-describedby={`${helpId}${validation ? ` ${validationId}` : ''}`}
          aria-invalid={!!validation}
          value={draft.source}
          readOnly={draft.id === 'default' || state.busy}
          maxLength={65536}
          rows={Math.min(16, Math.max(7, draft.source.split('\n').length + 1))}
          spellCheck={false}
          onChange={(event) => setDraft({ ...draft, source: event.target.value })}
        />
      </div>
      <p id={helpId} className="clutch-title-muted clutch-title-help">
        {t('help')}
      </p>
      {validation && (
        <pre id={validationId} role="alert" className="clutch-title-alert">
          {validation}
        </pre>
      )}
      {stale && (
        <p role="alert" className="clutch-title-alert">
          {t('stale')}
        </p>
      )}
      <div className="clutch-title-editor-footer">
        <span className="clutch-title-validation">
          {!validation && !stale && draft.id !== 'default' && (
            <>
              <span aria-hidden="true">✓</span> {t('valid')}
            </>
          )}
        </span>
        <div className="clutch-title-actions">
          <Button size="sm" type="button" disabled={state.busy} onClick={() => setDraft(null)}>
            {t(draft.id === 'default' ? 'close' : 'cancel')}
          </Button>
          {draft.id !== 'default' && (
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={locked || stale || !!validation || !draft.id.trim()}
            >
              {t('save')}
            </Button>
          )}
        </div>
      </div>
    </form>
  );

  return (
    <section className="clutch-title" aria-label={t('nav')}>
      <style>{templateStyles}</style>
      <header className="clutch-title-heading">
        <h2>{t('nav')}</h2>
        <p>{t('intro')}</p>
      </header>
      <div className="clutch-title-preference">
        <div className="clutch-title-preference-copy">
          <label htmlFor={`${helpId}-enabled`}>{t('enabled')}</label>
          <p>{t('native')}</p>
        </div>
        <input
          id={`${helpId}-enabled`}
          className="clutch-title-switch"
          type="checkbox"
          role="switch"
          checked={state.templates.enabled}
          disabled={locked || draft !== null}
          onChange={(event) => {
            void act({ kind: 'enabled', enabled: event.target.checked });
          }}
        />
      </div>
      <div className="clutch-title-current">
        <span
          className="clutch-title-status-dot"
          data-enabled={state.templates.enabled}
          aria-hidden="true"
        />
        {t('effective')}
        <strong>{state.templates.enabled ? state.templates.effective : t('nativeMode')}</strong>
      </div>
      {state.status === 'idle' && (
        <p className="clutch-title-muted" role="status">
          {t('loading')}
        </p>
      )}
      {state.status !== 'idle' && !state.writable && (
        <p className="clutch-title-muted">{t('readonly')}</p>
      )}
      {state.error && (
        <p role="alert" className="clutch-title-alert">
          {state.error}
        </p>
      )}
      {state.templates.errors.map((error) => (
        <p role="alert" className="clutch-title-alert" key={error}>
          {error}
        </p>
      ))}
      <div className="clutch-title-toolbar">
        <h3>
          {t('templates')} <span className="clutch-title-count">{state.templates.rows.length}</span>
        </h3>
        <div className="clutch-title-actions">
          <Button
            size="sm"
            disabled={state.busy}
            onClick={() => {
              void controller.load();
            }}
          >
            {t('retry')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={<IconPlusOutline16 />}
            disabled={locked || draft !== null}
            onClick={() => {
              setDraft({
                id: '',
                source: DEFAULT_TEMPLATE,
                revision: state.revision,
                create: true,
              });
              setFailure('');
              setDeleting(null);
            }}
          >
            {t('add')}
          </Button>
        </div>
      </div>
      {draft?.create && (
        <article className="clutch-title-card" data-editing="true">
          <div className="clutch-title-new-heading">{t('add')}</div>
          {editor}
        </article>
      )}
      <div className="clutch-title-list">
        {state.templates.rows.map((row) => {
          const expanded = draft !== null && !draft.create && draft.id === row.id;
          const effective = state.templates.enabled && row.id === state.templates.effective;
          const preview = previewTemplate(
            expanded ? draft.source : row.source,
            t('sampleText'),
            previewTimestamp,
          );
          return (
            <article
              key={row.id}
              className="clutch-title-card"
              data-current={effective}
              data-editing={expanded}
            >
              <div className="clutch-title-row">
                <span className="clutch-title-template-icon" aria-hidden="true">
                  {'{ }'}
                </span>
                <div className="clutch-title-identity">
                  <div className="clutch-title-name">
                    <strong>{row.id}</strong>
                    {row.error ? (
                      <span className="clutch-title-badge" data-tone="error">
                        {t('needsRepair')}
                      </span>
                    ) : (
                      row.id === state.templates.active && (
                        <span className="clutch-title-badge" data-tone="active">
                          {t('active')}
                        </span>
                      )
                    )}
                  </div>
                  <p className="clutch-title-row-caption">
                    {t(row.id === 'default' ? 'builtin' : row.error ? 'invalid' : 'custom')}
                  </p>
                  <p className="clutch-title-preview" title={t('sampleHelp')}>
                    <span>{t('sample')}: </span>
                    {preview === null ? t('sampleInvalid') : <code>{preview}</code>}
                  </p>
                </div>
                <div className="clutch-title-actions clutch-title-row-actions">
                  <Button
                    size="sm"
                    disabled={locked || draft !== null}
                    onClick={() => {
                      setDraft({
                        id: '',
                        source: row.source,
                        revision: state.revision,
                        create: true,
                      });
                      setFailure('');
                      setNotice('');
                      setDeleting(null);
                    }}
                  >
                    {t('duplicate')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={state.busy || (draft !== null && !expanded)}
                    aria-expanded={expanded}
                    onClick={() => {
                      setDraft(
                        expanded
                          ? null
                          : {
                              id: row.id,
                              source: row.source,
                              revision: state.revision,
                              create: false,
                            },
                      );
                      setFailure('');
                      setDeleting(null);
                    }}
                  >
                    {t(expanded ? 'collapse' : row.id === 'default' ? 'view' : 'edit')}
                  </Button>
                  {row.id !== state.templates.active && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={locked || !!row.error || draft !== null}
                      onClick={() => {
                        void act({ kind: 'activate', id: row.id });
                      }}
                    >
                      {t('activate')}
                    </Button>
                  )}
                  {row.id !== 'default' && (
                    <Button
                      size="sm"
                      className="clutch-title-delete"
                      disabled={locked || draft !== null}
                      onClick={() => setDeleting(row.id)}
                    >
                      {t('remove')}
                    </Button>
                  )}
                </div>
              </div>
              {row.error && !expanded && (
                <details className="clutch-title-error-details">
                  <summary>{t('validationDetails')}</summary>
                  <pre className="clutch-title-row-error">{row.error}</pre>
                </details>
              )}
              {expanded && editor}
              {deleting === row.id && (
                <div className="clutch-title-confirm" role="group" aria-label={t('confirm')}>
                  <p>{t('confirm')}</p>
                  <div className="clutch-title-actions">
                    <Button size="sm" onClick={() => setDeleting(null)}>
                      {t('cancel')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="clutch-title-delete"
                      disabled={locked}
                      onClick={() => {
                        void act({ kind: 'delete', id: row.id });
                      }}
                    >
                      {t('remove')}
                    </Button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {failure && (
        <p role="alert" className="clutch-title-alert">
          {failure}
        </p>
      )}
      <footer className="clutch-title-footer">
        <p>{t('history')}</p>
        <span role="status" className="clutch-title-saved">
          {notice}
        </span>
      </footer>
    </section>
  );
}
