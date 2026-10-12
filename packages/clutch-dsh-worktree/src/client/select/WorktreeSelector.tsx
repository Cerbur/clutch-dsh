import type { WorktreeImportCandidate } from '../../contract/index.js';
import type { WorktreeTranslate } from '../surface/types.js';
import { IconBranchOutline16 } from '../dsh-icons.js';
import { SearchableSingleSelect } from './SearchableSingleSelect.js';

interface WorktreeSelectorProps {
  readonly candidates: readonly WorktreeImportCandidate[];
  readonly value: string;
  readonly onChange: (path: string) => void;
  readonly t: WorktreeTranslate;
  readonly disabled?: boolean;
}

/** Path is the selection identity; both branch and path participate in search. */
export function WorktreeSelector({ candidates, t, ...props }: WorktreeSelectorProps) {
  return <SearchableSingleSelect {...props}
    label={t('worktree.tabImport')} placeholder={t('worktree.importPlaceholder')}
    searchLabel={t('worktree.searchWorktrees')} noMatchesLabel={t('worktree.noMatchingWorktrees')}
    icon={<IconBranchOutline16 />}
    options={candidates.map((candidate) => ({
      value: candidate.absolutePath, label: candidate.branch, description: candidate.absolutePath,
      icon: <IconBranchOutline16 />,
    }))} />;
}
