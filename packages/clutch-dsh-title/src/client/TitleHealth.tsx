import { useId, useState } from 'react';
import {
  Button,
  DisclosureRow,
  IconChevronDownOutlineRegular,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { PageState, TemplateStore } from './store.js';
import type { Translate } from './locales.js';

interface HealthProps {
  controller: TemplateStore;
  state: PageState;
  t: Translate;
}

export function RetrySettingsSection({
  controller,
  state,
  t,
  locked,
}: HealthProps & { locked: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="clutch-title-stats-section" aria-label={t('retrySettings')}>
      <DisclosureRow
        icon={<IconChevronDownOutlineRegular />}
        title={t('retrySettings')}
        open={open}
        expandable
        expandOnRowClick
        previewChevron={false}
        rowClassName="clutch-title-retry-toggle"
        titleClassName="clutch-title-retry-title"
        onToggle={() => {
          setOpen(!open);
          if (!open) void controller.load();
        }}
      >
        <div className="clutch-title-retry-content">
          <RepairSettings controller={controller} state={state} t={t} locked={locked} />
          <DiagnosticsPanel controller={controller} state={state} t={t} />
        </div>
      </DisclosureRow>
    </section>
  );
}

/** Native menu keeps the bounded setting usable without a numeric draft. */
export function RepairSettings({
  controller,
  state,
  t,
  locked,
}: HealthProps & { locked: boolean }) {
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const labelId = useId();
  const valueId = `${labelId}-value`;
  const options = [
    { id: '0', label: t('repairDisabled') },
    { id: '1', label: t('repairDefault') },
    { id: '2', label: '2' },
    { id: '3', label: '3' },
  ];
  const selectedId = String(state.templates.config.repairAttempts);
  return (
    <section className="clutch-title-repair-setting" aria-labelledby={labelId}>
      <div className="clutch-title-repair-row">
        <div className="clutch-title-repair-copy">
          <h3 id={labelId}>{t('repairAttempts')}</h3>
          <p>{t('repairHelp')}</p>
        </div>
        <Menu
          open={menuOpen && !locked}
          onClose={() => setMenuOpen(false)}
          selectedId={selectedId}
          items={options.map((option) => ({ ...option, disabled: locked }))}
          align="end"
          portal
          onSelect={async (id) => {
            setMenuOpen(false);
            if (locked || id === selectedId) return;
            setError('');
            try {
              await controller.write({ kind: 'repairAttempts', value: Number(id) }, state.revision);
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure));
            }
          }}
          anchor={
            <Button
              variant="ghost"
              className="clutch-title-repair-select"
              aria-labelledby={`${labelId} ${valueId}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen && !locked}
              disabled={locked}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <span id={valueId}>{options.find((option) => option.id === selectedId)?.label}</span>
              <IconChevronDownOutlineRegular />
            </Button>
          }
        />
      </div>
      {error && (
        <p className="clutch-title-alert" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function DiagnosticsPanel({ controller, state, t }: HealthProps) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState('');
  const diagnostics = state.diagnostics;
  const hasDiagnostics =
    diagnostics.totalIncidents > 0 ||
    diagnostics.totalRepairAttempts > 0 ||
    diagnostics.totalRecovered > 0 ||
    diagnostics.lastRepairAt !== undefined ||
    diagnostics.recentIncidents.length > 0;
  return (
    <section className="clutch-title-stats-section" aria-label={t('diagnostics')}>
      <h3 className="clutch-title-current-title">{t('diagnostics')}</h3>
      <div className="clutch-title-diagnostics-content">
        <div className="clutch-title-stats-grid clutch-title-diagnostics-grid">
          {(
            [
              ['totalIncidents', diagnostics.totalIncidents],
              ['totalRepairAttempts', diagnostics.totalRepairAttempts],
              ['totalRecovered', diagnostics.totalRecovered],
            ] as const
          ).map(([label, value]) => (
            <div className="clutch-title-stat-item" key={label}>
              <span className="clutch-title-stat-label">{t(label)}</span>
              <span className="clutch-title-stat-value">{value.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="clutch-title-stats-header">
          <p>
            {t('lastRepair')}:{' '}
            {diagnostics.lastRepairAt === undefined
              ? t('noRepair')
              : new Date(diagnostics.lastRepairAt).toLocaleString()}
          </p>
          <div className="clutch-title-actions">
            <Button size="sm" disabled={state.busy} onClick={() => void controller.load()}>
              {t('retry')}
            </Button>
            <Button
              size="sm"
              disabled={state.busy || !controller.canResetDiagnostics || !hasDiagnostics}
              onClick={() => setConfirmReset(true)}
            >
              {t('diagnosticsReset')}
            </Button>
          </div>
        </div>
        {confirmReset && (
          <div
            className="clutch-title-confirm"
            role="group"
            aria-label={t('diagnosticsResetConfirm')}
          >
            <p>{t('diagnosticsResetConfirm')}</p>
            <div className="clutch-title-actions">
              <Button size="sm" disabled={state.busy} onClick={() => setConfirmReset(false)}>
                {t('cancel')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={state.busy || !controller.canResetDiagnostics}
                onClick={async () => {
                  setError('');
                  try {
                    await controller.resetDiagnostics();
                    setConfirmReset(false);
                  } catch (failure) {
                    setError(failure instanceof Error ? failure.message : String(failure));
                  }
                }}
              >
                {t('diagnosticsReset')}
              </Button>
            </div>
          </div>
        )}
        {state.diagnosticsStatus === 'idle' && <p role="status">{t('loading')}</p>}
        {state.diagnosticsStatus === 'error' && (
          <p role="alert" className="clutch-title-alert">
            {t('diagnosticsUnavailable')} {state.diagnosticsError}
          </p>
        )}
        {error && (
          <p role="alert" className="clutch-title-alert">
            {error}
          </p>
        )}
        {state.diagnosticsStatus === 'ready' && diagnostics.recentIncidents.length === 0 && (
          <p className="clutch-title-stats-empty">{t('diagnosticsEmpty')}</p>
        )}
        {diagnostics.recentIncidents.length > 0 && (
          <div
            className="clutch-title-diagnostics-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={t('recentIncidents')}
          >
            <table className="clutch-title-diagnostics-table">
              <caption>{t('recentIncidents')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('incidentTime')}</th>
                  <th scope="col">{t('incidentModel')}</th>
                  <th scope="col">{t('incidentResult')}</th>
                  <th scope="col">{t('incidentError')}</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.recentIncidents.map((incident, index) => (
                  <tr key={`${incident.timestamp}-${index}`}>
                    <td>{new Date(incident.timestamp).toLocaleString()}</td>
                    <td>
                      {incident.provider}
                      <br />
                      {incident.model}
                    </td>
                    <td>
                      <span
                        className="clutch-title-badge"
                        data-tone={incident.recovered ? 'active' : 'error'}
                      >
                        {t(incident.recovered ? 'incidentRecovered' : 'incidentFallback')}
                      </span>
                    </td>
                    <td>
                      <p>{incident.error || incident.attempts.at(-1)?.error}</p>
                      <details className="clutch-title-incident-details">
                        <summary>{t('incidentDetails')}</summary>
                        <p>
                          {t('incidentMessages')}: {incident.messageSeqs.join(', ')}
                        </p>
                        <p>
                          {t('totalRepairAttempts')}: {incident.repairAttempts ?? '—'}
                        </p>
                        {incident.attempts.map((attempt, attemptIndex) => (
                          <div key={attemptIndex}>
                            <strong>
                              {t('incidentAttempt')} {attempt.attempt}
                            </strong>
                            <p>{attempt.error}</p>
                            <pre>{attempt.output || t('incidentNoOutput')}</pre>
                          </div>
                        ))}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
