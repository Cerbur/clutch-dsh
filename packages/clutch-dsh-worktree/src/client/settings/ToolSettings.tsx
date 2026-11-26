import { Switch, Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { useEffect, useRef, useState } from 'react';
import {
  WORKTREE_TOOL_IDS,
  type WorktreeToolSelection,
  type WorktreeToolSettingsManager,
  type WorktreeToolSettingsScope,
  type WorktreeToolSettingsView,
} from '../../contract/tool-settings.js';
import type { WorktreeTranslate } from '../surface/types.js';
import { worktreeNotifications } from '../surface/notification-center.js';
import { toWorktreeViewError, type ReportId } from '../view/worktree-view-errors.js';
import styles from './settings.css';

const capabilities = ['create', 'worktrees', 'delegate', 'models', 'sessions', 'message'] as const;

/** Both settings surfaces share persisted selections and never refresh Workspace projections. */
export function ToolSettings({
  manager,
  scope,
  t,
}: {
  manager?: Partial<WorktreeToolSettingsManager>;
  scope: WorktreeToolSettingsScope;
  t: WorktreeTranslate;
}) {
  const [snapshot, setSnapshot] = useState<{
    manager: typeof manager; identity: string; value: WorktreeToolSettingsView;
  }>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<'settings' | 'runtime'>();
  const [revision, setRevision] = useState(0);
  const alive = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const saveVersion = useRef(0);
  const retryRuntime = useRef(false);
  const readReports = useRef<ReportId[]>([]);
  const runtimeReports = useRef(new Set<ReportId>());
  const saveReports = useRef<{ selection: WorktreeToolSelection; reportId: ReportId }[]>([]);
  const identity = JSON.stringify(scope);
  const value = snapshot && snapshot.manager === manager && snapshot.identity === identity ? snapshot.value : undefined;
  const context = scope.kind === 'general' ? 'Worktree · /cluworktree'
    : scope.workspaceId + ' · ' + (scope.kind === 'local' ? 'Local/Main' : scope.worktreeId);
  useEffect(() => {
    alive.current = true;
    generation.current++;
    return () => {
      alive.current = false;
      readReports.current = [];
      runtimeReports.current.clear();
      saveReports.current = [];
      retryRuntime.current = false;
    };
  }, [manager, identity]);
  useEffect(() => {
    busy.current = true;
    setPending(true);
    let current = true;
    setFailed(undefined);
    if (!manager?.getToolSettings) {
      setFailed('settings');
      setPending(false);
      busy.current = false;
    } else {
      void manager.getToolSettings({ scope }).then(
        (selection) => {
          if (current) {
            setSnapshot({ manager, identity, value: selection });
            readReports.current.splice(0).forEach(id => worktreeNotifications.resolve(id));
            busy.current = false;
            setPending(false);
          }
        },
        (error) => {
          const { reportId } = worktreeNotifications.reportError(toWorktreeViewError(error), { context, origin: current ? undefined : 'retired' });
          if (current) {
            readReports.current.push(reportId);
            setFailed('settings');
            busy.current = false;
            setPending(false);
          }
        },
      );
    }
    return () => {
      current = false;
    };
    // Serialized scope identity prevents a new inline object from restarting the read.
  }, [manager, identity, revision]);

  useEffect(() => {
    if (failed || pending || !value?.runtime || !manager?.getToolRuntime) return;
    let current = true;
    const owner = generation.current;
    const version = saveVersion.current;
    const delay = value.runtime === 'loading' ? 500 : value.runtime === 'waiting' ? 3000 : 10000;
    const poll = async (explicit = false) => {
      if (!current || busy.current) return;
      const priorReports = [...runtimeReports.current];
      try {
        const { runtime, loadError } = await manager.getToolRuntime!();
        if (!alive.current || generation.current !== owner) return;
        for (const id of priorReports) {
          if (runtimeReports.current.delete(id)) worktreeNotifications.resolve(id);
        }
        if (!current || version !== saveVersion.current) return;
        if (runtime === value.runtime && loadError === value.loadError) {
          timer = window.setTimeout(poll, delay);
        } else {
          setSnapshot(previous => previous?.manager === manager && previous.identity === identity
            ? { ...previous, value: { ...previous.value, runtime, loadError } } : previous);
        }
      } catch (error) {
        const retired = !alive.current || generation.current !== owner;
        const { reportId } = worktreeNotifications.reportError(toWorktreeViewError(error), {
          context, origin: retired ? 'retired' : explicit ? undefined : 'cached-refresh',
        });
        if (!retired) runtimeReports.current.add(reportId);
        if (current && version === saveVersion.current) setFailed('runtime');
      }
    };
    let timer: number | undefined;
    if (retryRuntime.current) {
      retryRuntime.current = false;
      void poll(true);
    } else {
      timer = window.setTimeout(poll, delay);
    }
    return () => { current = false; window.clearTimeout(timer); };
  }, [manager, identity, value, failed, pending]);

  const save = async (selection: WorktreeToolSelection) => {
    if (!value || !manager?.updateToolSettings || busy.current) return;
    busy.current = true;
    saveVersion.current++;
    const current = generation.current;
    setPending(true);
    setFailed(undefined);
    try {
      const result = await manager.updateToolSettings({ scope, selection, expected: { enabled: value.enabled, tools: value.tools } });
      if (alive.current && current === generation.current) {
        setSnapshot({ manager, identity, value: result });
        saveReports.current = saveReports.current.filter(previous => {
          const wanted = previous.selection;
          if (wanted.enabled !== result.enabled || wanted.tools.length !== result.tools.length ||
            !wanted.tools.every(tool => result.tools.includes(tool))) return true;
          worktreeNotifications.resolve(previous.reportId);
          return false;
        });
      }
    } catch (error) {
      const active = alive.current && current === generation.current;
      const { reportId } = worktreeNotifications.reportError(toWorktreeViewError(error), { context, origin: active ? undefined : 'retired' });
      if (active) {
        saveReports.current.push({ selection, reportId });
        setFailed('settings');
      }
    } finally {
      if (current === generation.current) {
        busy.current = false;
        if (alive.current) setPending(false);
      }
    }
  };
  const auto = scope.kind !== 'general';
  const local = scope.kind === 'local';
  const title = t(auto ? 'tools.auto' : 'tools.command');
  return (
    <section className={styles.toolSettings} data-worktree-tool-settings>
      <div className={styles.toolHeader}>
        <div>
          <div className={styles.toolTitle}>
            <h3>{title}</h3>
            <Tag tone="info">{t('tools.experimental')}</Tag>
          </div>
          <p>{t(local ? 'tools.localAutoHint' : auto ? 'tools.autoHint' : 'tools.commandHint')}</p>
        </div>
        <Switch
          label={title}
          checked={value?.enabled ?? false}
          disabled={!value || pending || failed === 'settings'}
          onChange={(enabled) =>
            void save({
              enabled,
              tools: value!.tools.length ? value!.tools : WORKTREE_TOOL_IDS,
            })
          }
        />
      </div>
      {!value && !failed && <p role="status">{t('tools.loading')}</p>}
      {value?.runtime === 'failed' && <p role="alert">{t('tools.loadFailed')} {value.loadError}</p>}
      {value?.runtime === 'waiting' && <p role="status">{t('tools.waiting')}</p>}
      {value?.enabled && (
        <div className={styles.toolOptions} data-worktree-tool-options>
          <div className={styles.toolOptionsHeading}>
            <h4>{t('tools.selection')}</h4>
            <p>
              {t(local ? 'tools.localAutoSelectionHint' : auto ? 'tools.autoSelectionHint' : 'tools.commandSelectionHint')}
              {' '}{t('tools.runtimeHint')}
              {auto && <>{' '}{t('tools.commandSelectionHint')}{' '}{t('tools.reportHint')}</>}
            </p>
          </div>
          <div className={styles.toolList}>
            {WORKTREE_TOOL_IDS.map((tool, index) => (
              <div key={tool} className={styles.toolRow}>
                <div>
                  <h5>{t(`tools.${capabilities[index]}.title`)}</h5>
                  <p>{t(`tools.${capabilities[index]}.hint`)}</p>
                </div>
                <Switch
                  label={t(`tools.${capabilities[index]}.title`)}
                  checked={value.tools.includes(tool)}
                  disabled={pending || failed === 'settings'}
                  onChange={(checked) => {
                    const tools = checked
                      ? [...value.tools, tool]
                      : value.tools.filter((id) => id !== tool);
                    void save({ enabled: tools.length > 0, tools });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {failed && (
        <div role="alert">
          <p>{t(failed === 'runtime' ? 'tools.runtimeReadFailed' : 'tools.failed')}</p>
          <Button size="sm" variant="outline" onClick={() => {
            if (failed === 'runtime') {
              retryRuntime.current = true;
              setFailed(undefined);
            } else {
              setRevision((current) => current + 1);
            }
          }}>
            {t('action.retry')}
          </Button>
        </div>
      )}
    </section>
  );
}
