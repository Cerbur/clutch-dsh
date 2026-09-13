import type { ReactNode } from 'react';
import type { WorktreeTranslate } from '../surface/types.js';
import { vscodeFolderUrl } from './vscode-url.js';
import styles from './dashboard.css';

/** Open the recorded Worktree directory through the browser's VS Code protocol handler. */
export function OpenInAppButton({
  path,
  t,
}: {
  readonly path: string;
  readonly t: WorktreeTranslate;
}): ReactNode {
  return (
    <a
      className={styles.dashboardButton}
      href={vscodeFolderUrl(path)}
      data-dashboard-action="open-editor"
    >
      {t('dashboard.openEditor')}
    </a>
  );
}
