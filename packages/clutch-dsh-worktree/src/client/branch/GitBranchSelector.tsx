import { useEffect, useId, useRef, useState } from 'react';
import type { BranchRecord } from '../../contract/index.js';
import type { WorktreeTranslate } from '../surface/types.js';
import { IconBranchOutline16, IconDownloadOutline16, IconLoadingOutline16 } from '../dsh-icons.js';
import { SearchableSingleSelect, SingleSelectPicker } from '../select/SearchableSingleSelect.js';
import styles from './git-branch.css';
import { ErrorToast } from '../surface/components/NotificationToasts.js';
import { toWorktreeViewError, type WorktreeViewError } from '../view/worktree-view.js';

interface BranchPickerProps {
  readonly branches: readonly BranchRecord[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly t: WorktreeTranslate;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly onClose?: () => void;
  readonly emptyLabel?: string;
  readonly onFetch?: () => Promise<readonly BranchRecord[]>;
  readonly onLoad?: () => Promise<readonly BranchRecord[]>;
}

/** Branch facts and translations adapt to the shared single-selection view. */
function useBranchPickerProps({ branches: source, t, emptyLabel, onFetch, onLoad, ...props }: BranchPickerProps) {
  const [fetched, setFetched] = useState<{ source: readonly BranchRecord[]; branches: readonly BranchRecord[] }>();
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const pending = useRef(false);
  const alive = useRef(true);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<WorktreeViewError>();
  const readRequest = useRef<{ source: readonly BranchRecord[]; promise: Promise<void> }>();
  const latestSource = useRef(source);
  latestSource.current = source;
  const scope = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(resetTimer.current);
    };
  }, []);
  const branches = fetched?.source === source ? fetched.branches : source;
  const reload = (): Promise<void> => {
    if (!onLoad || props.disabled || pending.current) return Promise.resolve();
    if (readRequest.current?.source === source) return readRequest.current.promise;
    setReading(true);
    setReadError(undefined);
    const request = { source, promise: Promise.resolve() };
    readRequest.current = request;
    request.promise = (async () => {
      try {
        const next = await onLoad();
        if (alive.current && readRequest.current === request && latestSource.current === source) {
          setFetched({ source, branches: next });
        }
      } catch (error) {
        if (alive.current && readRequest.current === request && latestSource.current === source) {
          setReadError(toWorktreeViewError(error));
        }
      } finally {
        if (readRequest.current === request) {
          readRequest.current = undefined;
          if (alive.current) setReading(false);
        }
      }
    })();
    return request.promise;
  };
  const fetchBranches = async () => {
    if (!onFetch || pending.current || reading || props.disabled || props.loading) return;
    clearTimeout(resetTimer.current);
    pending.current = true;
    setStatus('pending');
    try {
      const next = await onFetch();
      if (alive.current) {
        setFetched({ source, branches: next });
        setStatus('success');
        resetTimer.current = setTimeout(() => {
          if (alive.current) setStatus('idle');
        }, 2000);
      }
    } catch {
      if (alive.current) setStatus('error');
    } finally { pending.current = false; }
  };
  const actionLabel = t(status === 'pending' ? 'branch.fetching' : status === 'success' ? 'branch.fetched'
    : status === 'error' ? 'branch.fetchFailed' : 'branch.fetch');
  const action = onFetch === undefined ? undefined : <button type="button" className={styles.branchFetch}
    data-branch-fetch data-fetch-status={status} title={actionLabel}
    aria-label={actionLabel} aria-live="polite" aria-busy={status === 'pending'}
    disabled={props.disabled || props.loading || reading || status === 'pending' || status === 'success'} onClick={() => void fetchBranches()}>
    {status === 'success' ? t('branch.fetched') : status === 'error'
      ? <span role="alert">{t('branch.fetchRetry')}</span>
      : status === 'pending' ? <IconLoadingOutline16 /> : <IconDownloadOutline16 />}
  </button>;
  return { status, notice: <ErrorToast error={readError} t={t} scope={'branch-read:' + scope}
    context={t('dashboard.searchBranches')}
    actions={[{ label: t('action.retry'), disabled: reading, onClick: () => void reload() }]} />, picker: {
    ...props,
    loading: props.loading || reading,
    onRefresh: onLoad === undefined ? undefined : () => { void reload(); },
    loadingLabel: t('select.loading'),
    searchLabel: t('dashboard.searchBranches'),
    noMatchesLabel: t('dashboard.noMatchingBranches'),
    allLabel: t('branch.all'),
    groups: [{ value: 'local', label: t('branch.local') }, { value: 'remote', label: t('branch.remote'), action }],
    options: [
      ...(emptyLabel !== undefined ? [{ value: '', label: emptyLabel, icon: <IconBranchOutline16 /> }] : []),
      ...branches.map((branch) => ({
        value: branch.name, label: branch.name, group: branch.kind === 'remote' ? 'remote' : 'local',
        icon: <IconBranchOutline16 />,
        badge: branch.kind === 'remote' ? branch.remote
          : branch.isCurrent ? t('branch.current') : branch.checkedOut ? t('branch.checkedOut') : undefined,
      })),
    ],
  } };
}

export function GitBranchPicker(props: BranchPickerProps) {
  const { picker, notice } = useBranchPickerProps(props);
  return <><SingleSelectPicker {...picker} />{notice}</>;
}

interface GitBranchSelectorProps extends BranchPickerProps {
  readonly label: string;
  readonly placeholder?: string;
  readonly size?: 'standard' | 'compact';
}

export function GitBranchSelector({ label, placeholder, size, ...props }: GitBranchSelectorProps) {
  const { picker, notice } = useBranchPickerProps(props);
  return <><SearchableSingleSelect {...picker} label={label} placeholder={placeholder}
    size={size} icon={<IconBranchOutline16 />} />{notice}</>;
}
