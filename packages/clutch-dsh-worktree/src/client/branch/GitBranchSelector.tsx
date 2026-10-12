import { useEffect, useRef, useState } from 'react';
import type { BranchRecord } from '../../contract/index.js';
import type { WorktreeTranslate } from '../surface/types.js';
import { IconBranchOutline16, IconDownloadOutline16, IconLoadingOutline16 } from '../dsh-icons.js';
import { SearchableSingleSelect, SingleSelectPicker } from '../select/SearchableSingleSelect.js';
import styles from './git-branch.css';

interface BranchPickerProps {
  readonly branches: readonly BranchRecord[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly t: WorktreeTranslate;
  readonly disabled?: boolean;
  readonly onClose?: () => void;
  readonly emptyLabel?: string;
  readonly onFetch?: () => Promise<readonly BranchRecord[]>;
}

/** Branch facts and translations adapt to the shared single-selection view. */
function useBranchPickerProps({ branches: source, t, emptyLabel, onFetch, ...props }: BranchPickerProps) {
  const [fetched, setFetched] = useState<{ source: readonly BranchRecord[]; branches: readonly BranchRecord[] }>();
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const branches = fetched?.source === source ? fetched.branches : source;
  const fetchBranches = async () => {
    if (!onFetch || pending.current || props.disabled) return;
    pending.current = true;
    setStatus('pending');
    try {
      const next = await onFetch();
      if (alive.current) { setFetched({ source, branches: next }); setStatus('success'); }
    } catch {
      if (alive.current) setStatus('error');
    } finally { pending.current = false; }
  };
  const action = onFetch === undefined ? undefined : <button type="button" className={styles.branchFetch}
    data-branch-fetch title={t(status === 'pending' ? 'branch.fetching' : 'branch.fetch')}
    aria-label={t(status === 'pending' ? 'branch.fetching' : 'branch.fetch')} aria-busy={status === 'pending'}
    disabled={props.disabled || status === 'pending'} onClick={() => void fetchBranches()}>
    {status === 'pending' ? <IconLoadingOutline16 /> : <IconDownloadOutline16 />}
  </button>;
  return { status, picker: {
    ...props,
    feedback: <FetchStatus status={status} t={t} />,
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
  const { picker } = useBranchPickerProps(props);
  return <SingleSelectPicker {...picker} />;
}

function FetchStatus({ status, t }: { status: 'idle' | 'pending' | 'success' | 'error'; t: WorktreeTranslate }) {
  return status === 'idle' ? null : <div className={styles.branchFetchStatus} role={status === 'error' ? 'alert' : 'status'}>
    {t(status === 'error' ? 'branch.fetchFailed' : status === 'pending' ? 'branch.fetching' : 'branch.fetched')}
  </div>;
}

interface GitBranchSelectorProps extends BranchPickerProps {
  readonly label: string;
  readonly placeholder?: string;
  readonly size?: 'standard' | 'compact';
}

export function GitBranchSelector({ label, placeholder, size, ...props }: GitBranchSelectorProps) {
  const { picker } = useBranchPickerProps(props);
  return <SearchableSingleSelect {...picker} label={label} placeholder={placeholder}
    size={size} icon={<IconBranchOutline16 />} />;
}
