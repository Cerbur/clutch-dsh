import type { BranchRecord } from '../../contract/index.js';
import type { WorktreeTranslate } from '../surface/types.js';
import { IconBranchOutline16 } from '../dsh-icons.js';
import { SearchableSingleSelect, SingleSelectPicker } from '../select/SearchableSingleSelect.js';

interface BranchPickerProps {
  readonly branches: readonly BranchRecord[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly t: WorktreeTranslate;
  readonly disabled?: boolean;
  readonly onClose?: () => void;
  readonly emptyLabel?: string;
}

/** Branch facts and translations adapt to the shared single-selection view. */
function branchPickerProps({ branches, t, emptyLabel, ...props }: BranchPickerProps) {
  return {
    ...props,
    searchLabel: t('dashboard.searchBranches'),
    noMatchesLabel: t('dashboard.noMatchingBranches'),
    allLabel: t('branch.all'),
    groups: [{ value: 'local', label: t('branch.local') }, { value: 'remote', label: t('branch.remote') }],
    options: [
      ...(emptyLabel !== undefined ? [{ value: '', label: emptyLabel, icon: <IconBranchOutline16 /> }] : []),
      ...branches.map((branch) => ({
        value: branch.name, label: branch.name, group: branch.kind === 'remote' ? 'remote' : 'local',
        icon: <IconBranchOutline16 />,
        badge: branch.kind === 'remote' ? branch.remote
          : branch.isCurrent ? t('branch.current') : branch.checkedOut ? t('branch.checkedOut') : undefined,
      })),
    ],
  };
}

export function GitBranchPicker(props: BranchPickerProps) {
  return <SingleSelectPicker {...branchPickerProps(props)} />;
}

interface GitBranchSelectorProps extends BranchPickerProps {
  readonly label: string;
  readonly placeholder?: string;
  readonly size?: 'standard' | 'compact';
}

export function GitBranchSelector({ label, placeholder, size, ...props }: GitBranchSelectorProps) {
  return <SearchableSingleSelect {...branchPickerProps(props)} label={label} placeholder={placeholder}
    size={size} icon={<IconBranchOutline16 />} />;
}
