import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import type { WorktreeRecord } from '../../contract/index.js';
import type { WorktreeTranslate } from '../surface/types.js';
import { formatWorktreeViewError } from '../view/worktree-error-copy.js';
import { NotificationToasts } from '../surface/components/NotificationToasts.js';
import { canManageWorktree, runWorktreeBatch, type BatchWorktreeAction, type BatchWorktreeResult } from './batch-manage.js';
import styles from './dashboard.css';
import { isMainWorktreeId } from './dashboard-selection.js';

export interface BatchManageWorktreesProps {
  readonly workspaceId: string;
  readonly worktrees: readonly WorktreeRecord[];
  readonly t: WorktreeTranslate;
  readonly actionPending: boolean;
  readonly onManage?: (action: BatchWorktreeAction, record: WorktreeRecord, isCurrent: () => boolean) => Promise<void>;
}

export function BatchManageWorktrees({ workspaceId, worktrees, t, actionPending, onManage }: BatchManageWorktreesProps) {
  const rows = worktrees.filter((record) => record.workspaceId === workspaceId && !isMainWorktreeId(record.worktreeId));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmation, setConfirmation] = useState<{ action: BatchWorktreeAction; records: readonly WorktreeRecord[] }>();
  const [results, setResults] = useState<readonly BatchWorktreeResult[]>([]);
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    busy.current = false;
    setPending(false);
    setConfirmation(undefined);
    setSelected(new Set());
    setResults([]);
    return () => { generation.current++; };
  }, [workspaceId, onManage]);
  const picked = rows.filter((record) => selected.has(record.worktreeId));
  const disabled = pending || actionPending || onManage === undefined;
  const allSelected = rows.length > 0 && picked.length === rows.length;
  const close = () => { if (!busy.current) setConfirmation(undefined); };
  const submit = async () => {
    if (busy.current || actionPending || !confirmation || !onManage ||
      (confirmation.action === 'clean' && !stopped)) return;
    busy.current = true;
    setPending(true);
    setResults([]);
    const lifetime = generation.current;
    const isCurrent = () => generation.current === lifetime;
    try {
      await runWorktreeBatch(confirmation.action, confirmation.records, onManage, isCurrent, (result) => {
        setResults((current) => [...current, result]);
        if (!result.error) setSelected((current) => {
          const next = new Set(current);
          next.delete(result.record.worktreeId);
          return next;
        });
      });
    } finally {
      if (isCurrent()) { busy.current = false; setPending(false); setConfirmation(undefined); }
    }
  };
  return <section data-dashboard-batch-manage aria-busy={pending}>
    <h2>{t('dashboard.tab.manage')}</h2>
    <p>{t('dashboard.manage.description')}</p>
    <div className={styles.dashboardManageToolbar}>
      <label><input type="checkbox" checked={allSelected} disabled={disabled || rows.length === 0}
        aria-label={t('dashboard.manage.selectAll')}
        onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((record) => record.worktreeId)))} />
        {t('dashboard.manage.selectAll')}</label>
      <span role="status">{t('dashboard.manage.selected', { count: picked.length })}</span>
      {(['archive', 'clean', 'forget'] as const).map((action) => <Button key={action} variant="outline"
        data-batch-action={action}
        disabled={disabled || !picked.some((record) => canManageWorktree(record, action))}
        onClick={() => { setStopped(false); setConfirmation({ action, records: picked.filter((record) => canManageWorktree(record, action)) }); }}>
        {t(`dashboard.manage.${action}`)} ({picked.filter((record) => canManageWorktree(record, action)).length})
      </Button>)}
    </div>
    <p className={styles.dashboardManageHint}>{t('dashboard.manage.availability')}</p>
    {rows.length === 0 ? <p>{t('dashboard.manage.empty')}</p> : <ul className={styles.dashboardManageList}>
      {rows.map((record) => <li key={record.worktreeId}>
        <label><input type="checkbox" checked={selected.has(record.worktreeId)} disabled={disabled}
          aria-label={record.branch + ' · ' + record.absolutePath}
          onChange={() => setSelected((current) => {
            const next = new Set(current);
            if (next.has(record.worktreeId)) next.delete(record.worktreeId); else next.add(record.worktreeId);
            return next;
          })} />
          <span className={styles.dashboardSessionLabel}><strong>{record.currentHead?.name ?? record.currentBranch ?? record.branch}</strong>
            <code className={styles.dashboardChildPath}>{record.absolutePath}</code></span>
          <span className={styles.dashboardChildState}>
            <span>{t(record.status === 'active' ? 'dashboard.manage.active' : 'dashboard.archived')}</span>
            <span>{t(record.health === 'ready' ? 'worktree.ready' : record.health === 'repair' ? 'worktree.repair'
              : record.health === 'recovery-needed' ? 'worktree.recovery' : record.health === 'branch-drift'
                ? 'worktree.branchDrift' : record.health === 'cleaned' ? 'dashboard.cleaned' : 'dashboard.unknown')}</span>
          </span>
        </label>
      </li>)}
    </ul>}
    <ul className={styles.dashboardManageResults} aria-live="polite">
      {results.map(({ record, error }) => <li key={record.worktreeId} data-batch-result={error ? 'failed' : 'success'}>
        <strong>{record.branch}</strong> · {record.absolutePath} · {error
          ? t('dashboard.manage.failed') + ' ' + formatWorktreeViewError(error, t)
          : t('dashboard.manage.success')}
      </li>)}
    </ul>
    <NotificationToasts notices={results.flatMap(({ record, error }) => error ? [{
      key: 'batch:' + record.worktreeId, error, context: record.branch + ' · ' + record.absolutePath,
      text: formatWorktreeViewError(error, t), message: (translate: WorktreeTranslate) => formatWorktreeViewError(error, translate),
    }] : [])} />
    <Modal open={confirmation !== undefined} onClose={close} closeLabel={t('dialog.cancel')}
      title={confirmation ? t(`dashboard.manage.${confirmation.action}`) : ''}
      description={confirmation ? t(`dashboard.manage.confirm.${confirmation.action}`) : ''}
      footer={<>
        <Button variant="outline" disabled={pending} onClick={close}>{t('dialog.cancel')}</Button>
        <Button variant="primary" data-batch-confirm disabled={pending || actionPending || (confirmation?.action === 'clean' && !stopped)}
          onClick={() => void submit()}>{t(pending ? 'dashboard.manage.running' : 'dashboard.manage.confirm')}</Button>
      </>}>
      <div data-dashboard-batch-dialog>
        <p>{t('dashboard.manage.selected', { count: confirmation?.records.length ?? 0 })}</p>
        <ul className={styles.dashboardManageConfirmList}>{confirmation?.records.map((record) => <li key={record.worktreeId}>
          <strong>{record.branch}</strong><code>{confirmation.action === 'clean' ? record.gitRootPath ?? record.absolutePath : record.absolutePath}</code>
        </li>)}</ul>
        {confirmation?.action === 'clean' && <label className={styles.dashboardManageStopped}>
          <input type="checkbox" checked={stopped} disabled={pending} onChange={(event) => setStopped(event.currentTarget.checked)} />
          {t('dashboard.manage.stopped')}
        </label>}
      </div>
    </Modal>
  </section>;
}
