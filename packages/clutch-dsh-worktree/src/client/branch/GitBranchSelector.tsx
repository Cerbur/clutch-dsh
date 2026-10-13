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
  const [fetchError, setFetchError] = useState<WorktreeViewError>();
  const generation = useRef(0);
  const readRequest = useRef<{ source: readonly BranchRecord[]; generation: number; promise: Promise<void> }>();
  const latestSource = useRef(source);
  const latestReload = useRef<() => Promise<void>>();
  latestSource.current = source;
  const scope = useId();
  useEffect(() => {
    alive.current = true;
    // Child picker effects may replay before this parent's setup restores alive.
    // Recover the retired read here too; generation-aware sharing avoids duplicates.
    if (readRequest.current && readRequest.current.generation !== generation.current)
      void latestReload.current?.();
    return () => {
      alive.current = false;
      generation.current++;
      pending.current = false;
      clearTimeout(resetTimer.current);
    };
  }, []);
  const branches = fetched?.source === source ? fetched.branches : source;
  const legacyMatches = branches.filter((branch) => branch.name === props.value ||
    (branch.kind === 'remote' && 'remotes/' + branch.name === props.value));
  const value = props.value.startsWith('refs/') ? props.value
    : legacyMatches.length === 1 ? legacyMatches[0]!.ref ?? legacyMatches[0]!.name : props.value;
  const reload = (): Promise<void> => {
    if (!alive.current || !onLoad || props.disabled || pending.current) return Promise.resolve();
    if (readRequest.current?.source === source && readRequest.current.generation === generation.current)
      return readRequest.current.promise;
    setReading(true);
    setReadError(undefined);
    const token = generation.current;
    const request = { source, generation: token, promise: Promise.resolve() };
    readRequest.current = request;
    request.promise = (async () => {
      try {
        const next = await onLoad();
        if (alive.current && generation.current === token && readRequest.current === request && latestSource.current === source) {
          setFetched({ source, branches: next });
        }
      } catch (error) {
        if (alive.current && generation.current === token && readRequest.current === request && latestSource.current === source) {
          setReadError(toWorktreeViewError(error));
        }
      } finally {
        if (readRequest.current === request && generation.current === token) {
          readRequest.current = undefined;
          if (alive.current) setReading(false);
        }
      }
    })();
    return request.promise;
  };
  latestReload.current = reload;
  const fetchBranches = async () => {
    if (!alive.current || !onFetch || pending.current || reading || status === 'success' || props.disabled || props.loading) return;
    const token = generation.current;
    clearTimeout(resetTimer.current);
    pending.current = true;
    setStatus('pending');
    try {
      const next = await onFetch();
      if (alive.current && generation.current === token) {
        setFetched({ source, branches: next });
        setFetchError(undefined);
        setStatus('success');
        resetTimer.current = setTimeout(() => {
          if (alive.current && generation.current === token) setStatus('idle');
        }, 2000);
      }
    } catch (error) {
      if (alive.current && generation.current === token) {
        setFetchError(toWorktreeViewError(error));
        setStatus('error');
      }
    } finally { if (generation.current === token) pending.current = false; }
  };
  const actionLabel = t(status === 'pending' ? 'branch.fetching' : status === 'success' ? 'branch.fetched'
    : status === 'error' ? 'branch.fetchFailed' : 'branch.fetch');
  const action = onFetch === undefined ? undefined : <button type="button" className={styles.branchFetch}
    data-branch-fetch data-fetch-status={status} title={fetchError === undefined ? actionLabel
      : [actionLabel, fetchError.code, fetchError.message,
        fetchError.details === undefined ? undefined : JSON.stringify(fetchError.details, null, 2)].filter(Boolean).join('\n')}
    aria-label={actionLabel} aria-live="polite" aria-busy={status === 'pending'}
    disabled={props.disabled || props.loading || reading || status === 'pending' || status === 'success'} onClick={() => void fetchBranches()}>
    {status === 'success' ? t('branch.fetched') : status === 'error'
      ? <span role="alert">{t('branch.fetchRetry')}</span>
      : status === 'pending' ? <IconLoadingOutline16 /> : <IconDownloadOutline16 />}
  </button>;
  return { status, notice: <><ErrorToast error={readError} t={t} scope={'branch-read:' + scope}
    context={t('dashboard.searchBranches')}
    actions={[{ label: t('action.retry'), disabled: reading, onClick: () => void reload() }]} />
    <ErrorToast error={fetchError} t={t} scope={'branch-fetch:' + scope}
      context={t('branch.fetch')}
      actions={[{ label: t('branch.fetchRetry'), disabled: props.disabled || props.loading || reading || status === 'pending',
        onClick: () => void fetchBranches() }]} /></>, picker: {
    ...props,
    value,
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
        value: branch.ref ?? branch.name, label: branch.name, group: branch.kind === 'remote' ? 'remote' : 'local',
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
