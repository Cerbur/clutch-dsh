import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconBranchOutline16 } from '../dsh-icons.js';
import type { WorktreeTranslate } from '../surface/types.js';
import styles from './settings.css';

const ATTRIBUTE = 'data-worktree-settings-nav-icon';

/** The native settings shell has no section-icon slot; decorate only our nav row. */
export function WorktreeSettingsNavIcon({ t }: { t: WorktreeTranslate }) {
  const [target, setTarget] = useState<Element>();
  const label = t('settings.title');
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let active = true;
    let queued = false;
    const scan = () => {
      if (!active || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!active) return;
        const rows = Array.from(
          document.querySelectorAll('[data-shortcut-modal="settings"] nav button'),
        ).filter((row) =>
          row.textContent?.trim() === label && row.querySelector(':scope > svg') !== null,
        );
        // Ambiguous labels or changed shell markup leave the native icon intact.
        setTarget(rows.length === 1 ? rows[0] : undefined);
      });
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    scan();
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [label]);

  useLayoutEffect(() => {
    if (!target) return;
    target.setAttribute(ATTRIBUTE, '');
    return () => target.removeAttribute(ATTRIBUTE);
  }, [target]);

  return target
    ? createPortal(<IconBranchOutline16 size={16} className={styles.settingsNavIcon} />, target)
    : null;
}
