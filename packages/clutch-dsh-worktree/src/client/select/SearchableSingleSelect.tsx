import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { Input, MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives';
import { IconCheckOutline16, IconChevronDownOutline14, IconLoadingOutline16, IconSearchOutline16 } from '../dsh-icons.js';
import styles from './single-select.css';

export interface SingleSelectOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly searchText?: string;
  readonly icon?: ReactNode;
  readonly badge?: string;
  readonly group?: string;
}

export interface SingleSelectGroup {
  readonly value: string;
  readonly label: string;
  readonly action?: ReactNode;
}

const NO_GROUPS: readonly SingleSelectGroup[] = [];

export interface SingleSelectPickerProps {
  readonly options: readonly SingleSelectOption[];
  readonly groups?: readonly SingleSelectGroup[];
  /** Supplying this label enables group filtering alongside text search. */
  readonly allLabel?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly searchLabel: string;
  readonly noMatchesLabel: string;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  readonly onClose?: () => void;
  /** Opening shells defer candidate work until the browser has painted. */
  readonly preparing?: boolean;
  /** Revalidate domain data after opening and when returning to an open picker. */
  readonly onRefresh?: () => void;
}

/** Domain-neutral single selection. Arrow navigation never commits a value. */
export function SingleSelectPicker({ options, groups = NO_GROUPS, allLabel, value, onChange,
  searchLabel, noMatchesLabel, disabled, loading = false, loadingLabel = 'Loading…', onClose,
  preparing = false, onRefresh }: SingleSelectPickerProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [highlight, setHighlight] = useState(value);
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const canRefresh = onRefresh !== undefined;
  useEffect(() => {
    if (preparing || !canRefresh) return;
    const revalidate = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refresh.current?.();
    };
    revalidate();
    if (typeof window === 'undefined') return;
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [preparing, canRefresh]);
  const search = query.trim().toLocaleLowerCase();
  const busy = loading || preparing;
  const { sections, visible, height } = useMemo(() => {
    const matched = preparing ? [] : options.filter((option) =>
      (filter === undefined || option.group === filter) &&
      (option.searchText ?? [option.label, option.description].join(' ')).toLocaleLowerCase().includes(search));
    let top = 0;
    let index = 0;
    const sections = [
      { value: undefined, label: undefined, action: undefined, options: matched.filter((option) => option.group === undefined || !groups.some((group) => group.value === option.group)) },
      ...groups.map((group) => ({ ...group, options: matched.filter((option) => option.group === group.value) })),
    ].filter((section) => section.options.length > 0 || (section.action && (filter === undefined || filter === section.value)))
      .map((section) => {
        const offset = top;
        if (section.label) top += 36;
        const rows = section.options.map((option) => {
          const row = { option, index: index++, top, height: option.description ? 48 : 34 };
          top += row.height;
          return row;
        });
        return { ...section, rows, top: offset, height: top - offset };
      });
    return { sections, visible: sections.flatMap((section) => section.rows), height: top };
  }, [options, groups, filter, search, preparing]);
  const virtual = visible.length > 80;
  const windowTop = Math.min(scrollTop, Math.max(0, height - 300)) - (busy ? 80 : 0);
  const rendered = virtual ? visible.filter((row) => row.top + row.height >= windowTop - 120 && row.top <= windowTop + 420) : visible;
  const renderedIndexes = new Set(rendered.map((row) => row.index));
  const active = Math.max(0, visible.findIndex((row) => row.option.value === highlight));
  const choose = (next: string) => { if (!disabled && !busy) onChange(next); };
  const resetScroll = () => {
    setScrollTop(0);
    if (viewport.current) viewport.current.scrollTop = 0;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'Escape' && onClose !== undefined) {
      event.preventDefault(); event.stopPropagation(); onClose();
    } else if (!disabled && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && visible.length > 0) {
      event.preventDefault();
      const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
      setHighlight(visible[next]!.option.value);
      if (virtual && !renderedIndexes.has(next)) {
        const top = Math.max(0, visible[next]!.top - 120 + (busy ? 80 : 0));
        setScrollTop(top);
        if (viewport.current) viewport.current.scrollTop = top;
      } else refs.current[next]?.scrollIntoView({ block: 'nearest' });
    } else if (!disabled && event.key === 'Enter' && visible.length > 0) {
      event.preventDefault(); choose(visible[active]!.option.value);
    }
  };
  const row = ({ option, index, top, height }: typeof visible[number], sectionTop: number) => {
    return <button type="button" key={option.value} id={id + '-option-' + index}
      ref={(element) => { refs.current[index] = element; }}
      className={styles.singleSelectOption} role="option" tabIndex={-1}
      style={virtual ? { position: 'absolute', top: top - sectionTop, height } : undefined}
      data-description={option.description ? true : undefined}
      aria-posinset={index + 1} aria-setsize={visible.length}
      title={[option.label, option.description].filter(Boolean).join(' — ')}
      data-single-select-option={option.value} data-highlighted={index === active ? true : undefined}
      aria-selected={option.value === value} disabled={disabled || busy}
      onMouseEnter={() => setHighlight(option.value)} onMouseDown={(event) => event.preventDefault()}
      onClick={() => choose(option.value)}>
      {option.icon}
      <span className={styles.singleSelectText}>
        <span className={styles.singleSelectName}>{option.label}</span>
        {option.description && <span className={styles.singleSelectDescription}>{option.description}</span>}
      </span>
      {option.badge && <span className={styles.singleSelectBadge}>{option.badge}</span>}
      {option.value === value && <IconCheckOutline16 />}
    </button>;
  };
  return <div className={styles.singleSelectPicker} data-single-select-picker data-preparing={preparing || undefined} aria-busy={busy}>
    <Input icon={<IconSearchOutline16 />} className={styles.singleSelectSearch}
      data-modal-autofocus disabled={disabled} role="combobox" aria-label={searchLabel} placeholder={searchLabel}
      aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={visible.length > 0}
      aria-controls={visible.length > 0 ? id + '-options' : undefined}
      aria-activedescendant={renderedIndexes.has(active) ? id + '-option-' + active : undefined}
      data-single-select-search value={query} onKeyDown={onKeyDown}
      onChange={(event) => { setQuery(event.currentTarget.value); setHighlight(value); resetScroll(); }} />
    {allLabel !== undefined && groups.length > 0 && <div className={styles.singleSelectFilters} aria-label={searchLabel} role="group">
      {[{ value: undefined, label: allLabel }, ...groups].map((group) =>
        <button type="button" key={group.value ?? 'all'} aria-pressed={filter === group.value}
          disabled={disabled} onClick={() => { setFilter(group.value); setHighlight(value); resetScroll(); }}>
          {group.label}
        </button>)}
    </div>}
    <div ref={viewport} className={styles.singleSelectViewport} data-single-select-options
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      {busy && <div className={styles.singleSelectLoading} data-single-select-loading role="status">
        <IconLoadingOutline16 /><span>{loadingLabel}</span>
      </div>}
      {sections.length > 0 ? <div id={id + '-options'} role="listbox" aria-label={searchLabel}
        data-single-select-virtual={virtual || undefined} style={virtual ? { position: 'relative', height } : undefined}>
        {sections.map((section) =>
          <div key={section.value ?? 'ungrouped'} role={section.label ? 'group' : undefined}
            style={virtual ? { position: 'absolute', top: section.top, height: section.height, width: '100%' } : undefined}
            aria-labelledby={section.label ? id + '-group-' + section.value : undefined}>
            {section.label && <div className={styles.singleSelectGroup}>
              <span id={id + '-group-' + section.value}>{section.label}</span>{section.action}
            </div>}
            {section.rows.filter((row) => renderedIndexes.has(row.index)).map((item) => row(item, section.top))}
          </div>)}
      </div> : null}
      {!busy && visible.length === 0 && <div className={styles.singleSelectEmpty} data-single-select-empty role="status">{noMatchesLabel}</div>}
    </div>
  </div>;
}

export interface SearchableSingleSelectProps extends SingleSelectPickerProps {
  readonly label: string;
  readonly placeholder?: string;
  readonly icon?: ReactNode;
  readonly size?: 'standard' | 'compact';
}

/** Anchored dropdown using DSH's menu material, including its macOS backing. */
export function SearchableSingleSelect({ label, placeholder, icon, size = 'standard', ...props }: SearchableSingleSelectProps) {
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 320, viewportHeight: 220 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (restoreFocus = true) => {
    setOpen(false);
    setPrepared(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => { if (props.disabled) { setOpen(false); setPrepared(false); } }, [props.disabled]);
  useEffect(() => {
    if (!open) return;
    // Two frames leave a paint opportunity before candidate work begins.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPrepared(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 320), Math.max(0, window.innerWidth - 24));
      const viewport = popup.current?.querySelector<HTMLElement>('[data-single-select-options]');
      const chromeHeight = popup.current && viewport
        ? popup.current.offsetHeight - viewport.offsetHeight : 90;
      const below = Math.max(0, window.innerHeight - 12 - rect.bottom - 4);
      const above = Math.max(0, rect.top - 4 - 12);
      // Prefer a shorter list below, keeping room for a heading and at least one row.
      const downward = below >= chromeHeight + 96 || below >= above;
      const viewportHeight = Math.min(220, Math.max(0, (downward ? below : above) - chromeHeight));
      const height = chromeHeight + Math.min(viewport?.scrollHeight ?? viewportHeight, viewportHeight);
      const next = { width,
        viewportHeight,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, downward ? rect.bottom + 4 : rect.top - height - 4),
      };
      setPosition((current) => current.width === next.width && current.left === next.left && current.top === next.top && current.viewportHeight === next.viewportHeight
        ? current : next);
    };
    place();
    popup.current?.querySelector<HTMLInputElement>('input')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (popup.current) observer.observe(popup.current);
    if (trigger.current) observer.observe(trigger.current);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  const selected = useMemo(() => props.options.find((option) => option.value === props.value), [props.options, props.value]);
  return <div ref={root} className={styles.singleSelectRoot} data-single-select data-size={size}
    onKeyDown={(event) => {
      if (open && event.key === 'Escape' && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); close();
      }
    }}>
    <button ref={trigger} type="button" className={styles.singleSelectTrigger}
      aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      disabled={props.disabled} onClick={() => open ? close() : setOpen(true)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}>
      {icon}<span className={styles.singleSelectName} title={selected?.description ?? props.value}>
        {selected?.label ?? (props.value || placeholder || label)}
      </span><IconChevronDownOutline14 />
    </button>
    {open && <MenuSurface ref={popup} id={id} className={styles.singleSelectPopup}
      style={{ left: position.left, top: position.top, width: position.width,
        '--single-select-viewport-height': position.viewportHeight + 'px' } as CSSProperties} role="dialog" aria-label={label}>
      <SingleSelectPicker {...props} preparing={!prepared} onClose={close} onChange={(value) => { props.onChange(value); close(); }} />
    </MenuSurface>}
  </div>;
}
