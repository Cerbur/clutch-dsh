import { useCallback, useLayoutEffect, useState } from 'react';
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots';
import { HoverCard } from '@deepseek-ai/dsh-client-ui-primitives';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { WorktreeContextInjected } from './WorktreeContext.js';
import type { WorktreeContextState } from './worktree-context-store.js';
import { WORKTREE_NS } from './locales.js';
import styles from './worktree-context.css';

type WorktreeTranslate = TranslateNS<typeof WORKTREE_NS>;

export type WorktreeHeroContextProps =
  PropsRuntime<'shell.overlay'> &
  PropsLocale<typeof WORKTREE_NS> &
  InjectFace<WorktreeContextInjected>;

interface HeroPlacement {
  readonly left: number;
  readonly top: number;
}

function labelFor(state: WorktreeContextState): string | undefined {
  if (
    state.status !== 'ready' ||
    state.workspaceTitle === undefined ||
    state.value.kind === 'none'
  ) {
    return undefined;
  }
  return `${state.workspaceTitle} (${state.value.label})`;
}

function elementWithClassSuffix(root: ParentNode, suffix: string): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>('[class]');
  for (const candidate of candidates) {
    if ([...candidate.classList].some((token) => token === suffix || token.endsWith(`_${suffix}`))) {
      return candidate;
    }
  }
  return null;
}

function headlineElement(root: ParentNode): HTMLElement | null {
  // Anchor to the visible end of the native title line. The headline wrapper
  // spans the whole content column, so using it would place the suffix at the
  // far edge instead of immediately after the title and preview badge.
  return elementWithClassSuffix(root, 'previewBadge')
    ?? elementWithClassSuffix(root, 'headlineText')
    ?? elementWithClassSuffix(root, 'headline');
}

function positionedAncestor(element: HTMLElement): HTMLElement | null {
  if (element.offsetParent instanceof HTMLElement) return element.offsetParent;

  for (let ancestor = element.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
    if (getComputedStyle(ancestor).position !== 'static') return ancestor;
  }
  return null;
}

function overlayFor(element: HTMLElement): HTMLElement | null {
  const host = element.closest<HTMLElement>('[data-worktree-hero-host]');
  return positionedAncestor(host ?? element);
}

function measurePlacement(element: HTMLElement): HeroPlacement | null {
  const hero = document.querySelector<HTMLElement>('[data-phase="hero"]');
  // The Slot renderer inserts a display: contents wrapper before the actual
  // shell overlay layer, so the direct parent is not the containing block.
  const overlay = overlayFor(element);
  const headline = hero === null ? null : headlineElement(hero);
  if (hero === null || headline === null || overlay === null) return null;

  const anchor = headline.getBoundingClientRect();
  const frame = overlay.getBoundingClientRect();
  const width = element.getBoundingClientRect().width;
  const afterHeadlineLeft = anchor.right - frame.left + 8;
  const fitsAfterHeadline = afterHeadlineLeft + width <= frame.width - 8;
  return {
    left: fitsAfterHeadline
      ? afterHeadlineLeft
      : Math.max(8, frame.width - width - 8),
    top: fitsAfterHeadline
      ? Math.max(8, anchor.top - frame.top + (anchor.height - 22) / 2)
      : Math.max(8, anchor.bottom - frame.top + 8),
  };
}

function contextAriaLabel(state: WorktreeContextState, t: WorktreeTranslate): string | undefined {
  if (state.value.kind === 'main') return t('context.main', { name: state.value.label });
  if (state.value.kind === 'worktree') return t('context.worktree', { name: state.value.label });
  return undefined;
}

/**
 * Browser-local Hero suffix. It intentionally uses the frame overlay because
 * rc.8 exposes no additive slot beside the native Hero headline.
 */
export function WorktreeHeroContext({
  useWorktreeContext,
  t,
}: WorktreeHeroContextProps) {
  const state = useWorktreeContext((snapshot) => snapshot);
  const label = labelFor(state);
  const [placement, setPlacement] = useState<HeroPlacement | null>(null);

  const measure = useCallback((element: HTMLElement | null): void => {
    if (element === null) {
      setPlacement(null);
      return;
    }
    setPlacement(measurePlacement(element));
  }, []);

  useLayoutEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const element = document.querySelector<HTMLElement>('[data-worktree-hero-context]');
    if (element === null) return undefined;

    let frameRequest: number | undefined;
    const schedule = (): void => {
      if (frameRequest !== undefined) window.cancelAnimationFrame(frameRequest);
      frameRequest = window.requestAnimationFrame(() => {
        frameRequest = undefined;
        measure(element);
      });
    };

    const mutationObserver = typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(schedule);
    mutationObserver?.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'data-phase'],
    });
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(schedule);
    resizeObserver?.observe(overlayFor(element) ?? element);
    window.addEventListener('resize', schedule);
    schedule();

    return () => {
      if (frameRequest !== undefined) window.cancelAnimationFrame(frameRequest);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [label, measure]);

  const ariaLabel = contextAriaLabel(state, t);
  if (label === undefined) return null;

  return (
    <span
      className={styles.heroContextHost}
      data-worktree-hero-host
      style={placement === null ? { visibility: 'hidden' } : {
        left: `${placement.left}px`,
        top: `${placement.top}px`,
      }}
    >
      <HoverCard
        anchor={(
          <span
            ref={measure}
            className={styles.heroContext}
            data-worktree-hero-context
            aria-label={ariaLabel}
            title={label}
          >
            {label}
          </span>
        )}
        content={<div className={styles.contextHoverTitle}>{label}</div>}
        openDelayMs={500}
      />
    </span>
  );
}
