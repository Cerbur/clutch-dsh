import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives';
import type { WorktreeTranslate } from './surface/types.js';
import styles from './plugin-attribution.css';

const PACKAGE_NAME = '@cerbur/clutch-dsh-worktree';
const PACKAGE_URL = 'https://github.com/Cerbur/clutch-dsh';

/** UI-only attribution. Keep the interactive card open across the portal gap. */
export function PluginAttribution({ t }: { readonly t: WorktreeTranslate }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const restoringFocus = useRef(false);
  const closeTimer = useRef<number>();
  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);
  const show = () => { cancelClose(); setOpen(true); };
  const dismiss = () => { cancelClose(); setOpen(false); };
  const leave = () => {
    cancelClose();
    // Match native hover-card grace so crossing the 8px portal gap remains usable.
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined;
      setOpen(false);
    }, 200);
  };
  useEffect(() => cancelClose, [cancelClose]);
  const id = useId();
  const contains = (target: EventTarget | null) =>
    target instanceof Node && (trigger.current?.contains(target) || card.current?.contains(target));
  const restoreFocus = () => {
    restoringFocus.current = true;
    trigger.current?.focus({ preventScroll: true });
    restoringFocus.current = false;
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !card.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(320, Math.max(0, window.innerWidth - 16));
      const height = Math.min(card.current.scrollHeight, window.innerHeight - 16);
      const below = rect.bottom + 8;
      setPosition({
        width,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(
          below + height <= window.innerHeight - 8 ? below : rect.top - height - 8,
          window.innerHeight - height - 8,
        )),
        maxHeight: Math.max(0, window.innerHeight - 16),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(trigger.current!);
    observer.observe(card.current!);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!contains(event.target)) dismiss();
    };
    const focus = (event: FocusEvent) => {
      if (!contains(event.target)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      restoreFocus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', focus);
    // Capture before the parent popover's document-bubble Escape listener.
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  return <div className={styles.attributionFooter}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}>
    <button ref={trigger} type="button" className={styles.attributionTrigger}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') show(); }}
      onPointerLeave={leave}
      onFocus={() => { if (!restoringFocus.current) show(); }}
      onClick={show}
      onKeyDown={(event) => {
        if (open && (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey))) {
          event.preventDefault();
          event.stopPropagation();
          link.current?.focus();
        }
      }}>
      {t('attribution.label', { plugin: PACKAGE_NAME })}
    </button>
    {open && createPortal(<MenuSurface ref={card} id={id} role="dialog"
      aria-label={t('attribution.label', { plugin: PACKAGE_NAME })}
      onPointerEnter={cancelClose} onPointerLeave={leave} onFocus={cancelClose}
      className={styles.attributionCard} style={position}>
      {t('attribution.before')}
      <a ref={link} href={PACKAGE_URL} target="_blank" rel="noopener noreferrer"
        className={styles.attributionLink}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          restoreFocus();
          if (event.shiftKey) event.preventDefault();
          else dismiss();
        }}>
        <svg className={styles.attributionGithubIcon} viewBox="0 0 24 24" fill="currentColor"
          aria-hidden="true" focusable="false">
          <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.104.768-.244.768-.542 0-.267-.01-.975-.015-1.914-3.13.68-3.791-1.508-3.791-1.508-.512-1.3-1.25-1.646-1.25-1.646-1.022-.7.078-.686.078-.686 1.13.08 1.725 1.16 1.725 1.16 1.005 1.723 2.635 1.225 3.277.937.103-.728.394-1.225.716-1.507-2.499-.284-5.126-1.25-5.126-5.565 0-1.23.44-2.233 1.16-3.02-.116-.285-.503-1.43.11-2.98 0 0 .945-.303 3.094 1.154A10.78 10.78 0 0 1 12 6.178c.956.004 1.918.13 2.816.379 2.148-1.457 3.092-1.154 3.092-1.154.615 1.55.228 2.695.112 2.98.722.787 1.158 1.79 1.158 3.02 0 4.326-2.632 5.278-5.139 5.557.404.35.766 1.043.766 2.1 0 1.516-.014 2.74-.014 3.112 0 .3.203.65.774.54A11.252 11.252 0 0 0 12 .75Z" />
        </svg>
        {PACKAGE_NAME}</a>
      {t('attribution.after')}
    </MenuSurface>, document.body)}
  </div>;
}
