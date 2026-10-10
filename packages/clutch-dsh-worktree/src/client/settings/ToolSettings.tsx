import { Switch, Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { useEffect, useRef, useState } from 'react';
import {
  WORKTREE_TOOL_IDS,
  type WorktreeToolSelection,
  type WorktreeToolSettingsManager,
  type WorktreeToolSettingsScope,
} from '../../contract/tool-settings.js';
import type { WorktreeTranslate } from '../surface/types.js';
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
  const [value, setValue] = useState<WorktreeToolSelection>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const identity = JSON.stringify(scope);
  useEffect(() => {
    alive.current = true;
    generation.current++;
    busy.current = false;
    setPending(false);
    let current = true;
    setFailed(false);
    if (!manager?.getToolSettings) setFailed(true);
    else
      void manager.getToolSettings({ scope }).then(
        (selection) => {
          if (current) setValue(selection);
        },
        () => {
          if (current) setFailed(true);
        },
      );
    return () => {
      current = false;
      alive.current = false;
    };
    // Serialized scope identity prevents a new inline object from restarting the read.
  }, [manager, identity, revision]);

  const save = async (selection: WorktreeToolSelection) => {
    if (!value || !manager?.updateToolSettings || busy.current) return;
    busy.current = true;
    const current = generation.current;
    setPending(true);
    setFailed(false);
    try {
      const result = await manager.updateToolSettings({ scope, selection, expected: value });
      if (alive.current && current === generation.current) setValue(result);
    } catch {
      if (alive.current && current === generation.current) setFailed(true);
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
          disabled={!value || pending || failed}
          onChange={(enabled) =>
            void save({
              enabled,
              tools: value!.tools.length ? value!.tools : WORKTREE_TOOL_IDS,
            })
          }
        />
      </div>
      {!value && !failed && <p role="status">{t('tools.loading')}</p>}
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
                  disabled={pending || failed}
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
          <p>{t('tools.failed')}</p>
          <Button size="sm" variant="outline" onClick={() => setRevision((current) => current + 1)}>
            {t('action.retry')}
          </Button>
        </div>
      )}
    </section>
  );
}
