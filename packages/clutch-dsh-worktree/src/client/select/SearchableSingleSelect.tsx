import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Input, MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives';
import { IconCheckOutline16, IconChevronDownOutline14, IconSearchOutline16 } from '../dsh-icons.js';
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
  readonly onClose?: () => void;
}

/** Domain-neutral single selection. Arrow navigation never commits a value. */
export function SingleSelectPicker({ options, groups = [], allLabel, value, onChange,
  searchLabel, noMatchesLabel, disabled, onClose }: SingleSelectPickerProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [highlight, setHighlight] = useState(value);
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const search = query.trim().toLocaleLowerCase();
  const matched = options.filter((option) =>
    (filter === undefined || option.group === filter) &&
    (option.searchText ?? [option.label, option.description].join(' ')).toLocaleLowerCase().includes(search));
  const sections = [
    { value: undefined, label: undefined, action: undefined, options: matched.filter((option) => option.group === undefined || !groups.some((group) => group.value === option.group)) },
    ...groups.map((group) => ({ ...group, options: matched.filter((option) => option.group === group.value) })),
  ];
  const visible = sections.flatMap((section) => section.options);
  const active = Math.max(0, visible.findIndex((option) => option.value === highlight));
  const choose = (next: string) => { if (!disabled) onChange(next); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'Escape' && onClose !== undefined) {
      event.preventDefault(); event.stopPropagation(); onClose();
    } else if (!disabled && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && visible.length > 0) {
      event.preventDefault();
      const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
      setHighlight(visible[next]!.value);
      refs.current[next]?.scrollIntoView({ block: 'nearest' });
    } else if (!disabled && event.key === 'Enter' && visible.length > 0) {
      event.preventDefault(); choose(visible[active]!.value);
    }
  };
  const row = (option: SingleSelectOption) => {
    const index = visible.indexOf(option);
    return <button type="button" key={option.value} id={id + '-option-' + index}
      ref={(element) => { refs.current[index] = element; }}
      className={styles.singleSelectOption} role="option" tabIndex={-1}
      title={[option.label, option.description].filter(Boolean).join(' — ')}
      data-single-select-option={option.value} data-highlighted={index === active ? true : undefined}
      aria-selected={option.value === value} disabled={disabled}
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
  return <div className={styles.singleSelectPicker} data-single-select-picker>
    <Input icon={<IconSearchOutline16 />} className={styles.singleSelectSearch}
      data-modal-autofocus disabled={disabled} role="combobox" aria-label={searchLabel} placeholder={searchLabel}
      aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={visible.length > 0}
      aria-controls={visible.length > 0 ? id + '-options' : undefined}
      aria-activedescendant={visible.length > 0 ? id + '-option-' + active : undefined}
      data-single-select-search value={query} onKeyDown={onKeyDown}
      onChange={(event) => { setQuery(event.currentTarget.value); setHighlight(value); }} />
    {allLabel !== undefined && groups.length > 0 && <div className={styles.singleSelectFilters} aria-label={searchLabel} role="group">
      {[{ value: undefined, label: allLabel }, ...groups].map((group) =>
        <button type="button" key={group.value ?? 'all'} aria-pressed={filter === group.value}
          disabled={disabled} onClick={() => { setFilter(group.value); setHighlight(value); }}>
          {group.label}
        </button>)}
    </div>}
    <div className={styles.singleSelectViewport} data-single-select-options>
      {visible.length > 0 || sections.some((section) => section.action && (filter === undefined || filter === section.value)) ? <div id={id + '-options'} role="listbox" aria-label={searchLabel}>
        {sections.filter((section) => section.options.length > 0 || (section.action && (filter === undefined || filter === section.value))).map((section) =>
          <div key={section.value ?? 'ungrouped'} role={section.label ? 'group' : undefined}
            aria-labelledby={section.label ? id + '-group-' + section.value : undefined}>
            {section.label && <div className={styles.singleSelectGroup}>
              <span id={id + '-group-' + section.value}>{section.label}</span>{section.action}
            </div>}
            {section.options.map(row)}
          </div>)}
      </div> : null}
      {visible.length === 0 && <div className={styles.singleSelectEmpty} data-single-select-empty role="status">{noMatchesLabel}</div>}
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
  const [position, setPosition] = useState({ left: 0, top: 0, width: 320 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => { if (props.disabled) setOpen(false); }, [props.disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 320), Math.max(0, window.innerWidth - 24));
      const height = popup.current?.offsetHeight ?? 390;
      setPosition({ width,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 4 : rect.top - height - 4),
      });
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
  const selected = props.options.find((option) => option.value === props.value);
  return <div ref={root} className={styles.singleSelectRoot} data-single-select data-size={size}
    onKeyDown={(event) => {
      if (open && event.key === 'Escape' && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); close();
      }
    }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(false);
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
    {open && <MenuSurface ref={popup} id={id} className={styles.singleSelectPopup} style={position} role="dialog" aria-label={label}>
      <SingleSelectPicker {...props} onClose={close} onChange={(value) => { props.onChange(value); close(); }} />
    </MenuSurface>}
  </div>;
}
