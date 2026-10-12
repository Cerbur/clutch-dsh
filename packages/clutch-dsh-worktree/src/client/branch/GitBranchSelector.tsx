import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Input } from '@deepseek-ai/dsh-client-ui-primitives';
import type { BranchRecord } from '../../contract/index.js';
import type { WorktreeTranslate } from '../surface/types.js';
import { IconBranchOutline16, IconCheckOutline16, IconChevronDownOutline14, IconSearchOutline16 } from '../dsh-icons.js';
import styles from './git-branch.css';

interface BranchPickerProps {
  readonly branches: readonly BranchRecord[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly t: WorktreeTranslate;
  readonly disabled?: boolean;
  readonly onClose?: () => void;
  readonly emptyLabel?: string;
}

/** Shared searchable list. Navigation moves focus; only Enter/click changes the value. */
export function GitBranchPicker({ branches, value, onChange, t, disabled, onClose, emptyLabel }: BranchPickerProps) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(value);
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const search = query.trim().toLocaleLowerCase();
  const filtered = branches.filter((branch) => branch.name.toLocaleLowerCase().includes(search));
  const local = filtered.filter((branch) => branch.kind !== 'remote');
  const remote = filtered.filter((branch) => branch.kind === 'remote');
  const options = [
    ...(emptyLabel !== undefined && search.length === 0
      ? [{ name: '', isCurrent: false, checkedOut: false }] : []),
    ...local, ...remote,
  ];
  const active = Math.max(0, options.findIndex((branch) => branch.name === highlight));
  const choose = (name: string) => { if (!disabled) onChange(name); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'Escape' && onClose !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (!disabled && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length > 0) {
      event.preventDefault();
      const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      setHighlight(options[next]!.name);
      refs.current[next]?.scrollIntoView({ block: 'nearest' });
    } else if (!disabled && event.key === 'Enter' && options.length > 0) {
      event.preventDefault();
      choose(options[active]!.name);
    }
  };
  const row = (branch: BranchRecord) => {
    const index = options.indexOf(branch);
    return (
      <button
        type="button" key={branch.name} id={id + '-option-' + index}
        ref={(element) => { refs.current[index] = element; }}
        className={styles.gitBranchOption} role="option" tabIndex={-1}
        title={branch.name || emptyLabel}
        data-git-branch-option={branch.name}
        data-highlighted={index === active ? true : undefined}
        aria-selected={branch.name === value} disabled={disabled}
        onMouseEnter={() => setHighlight(branch.name)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(branch.name)}
      >
        <IconBranchOutline16 />
        <span className={styles.gitBranchName}>{branch.name || emptyLabel}</span>
        {branch.kind === 'remote' && branch.remote && <span className={styles.gitBranchBadge}>{branch.remote}</span>}
        {branch.kind !== 'remote' && (branch.isCurrent
          ? <span className={styles.gitBranchBadge}>{t('branch.current')}</span>
          : branch.checkedOut ? <span className={styles.gitBranchBadge}>{t('branch.checkedOut')}</span> : null)}
        {branch.name === value && <IconCheckOutline16 />}
      </button>
    );
  };
  return (
    <div className={styles.gitBranchPicker} data-git-branch-picker>
      <Input
        icon={<IconSearchOutline16 />} className={styles.gitBranchSearch}
        data-modal-autofocus disabled={disabled} role="combobox"
        aria-label={t('dashboard.searchBranches')} placeholder={t('dashboard.searchBranches')}
        aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={options.length > 0}
        aria-controls={options.length > 0 ? id + '-options' : undefined}
        aria-activedescendant={options.length > 0 ? id + '-option-' + active : undefined}
        data-git-branch-search value={query} onKeyDown={onKeyDown}
        onChange={(event) => { setQuery(event.currentTarget.value); setHighlight(value); }}
      />
      <div className={styles.gitBranchViewport} data-git-branch-options>
        {options.length > 0 ? (
          <div id={id + '-options'} role="listbox" aria-label={t('dashboard.searchBranches')}>
            {emptyLabel !== undefined && search.length === 0 && row(options[0]!)}
            {local.length > 0 && (
              <div role="group" aria-labelledby={id + '-local'}>
                <div id={id + '-local'} className={styles.gitBranchGroup}>{t('branch.local')}</div>
                {local.map(row)}
              </div>
            )}
            {remote.length > 0 && (
              <div role="group" aria-labelledby={id + '-remote'}>
                <div id={id + '-remote'} className={styles.gitBranchGroup}>{t('branch.remote')}</div>
                {remote.map(row)}
              </div>
            )}
          </div>
        ) : <div className={styles.gitBranchEmpty} data-git-branch-empty role="status">{t('dashboard.noMatchingBranches')}</div>}
      </div>
    </div>
  );
}

interface GitBranchSelectorProps extends BranchPickerProps {
  readonly label: string;
  readonly placeholder?: string;
  readonly size?: 'standard' | 'compact';
}

/** Anchored selector for creation and temporary comparisons; owns no domain state. */
export function GitBranchSelector({ label, placeholder, size = 'standard', ...props }: GitBranchSelectorProps) {
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
      const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24);
      const height = popup.current?.offsetHeight ?? 350;
      setPosition({
        width,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, rect.bottom + height + 12 <= window.innerHeight
          ? rect.bottom + 6 : rect.top - height - 6),
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
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  return (
    <div ref={root} className={styles.gitBranchSelector} data-git-branch-selector data-size={size}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(false);
      }}>
      <button ref={trigger} type="button" className={styles.gitBranchTrigger}
        aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        disabled={props.disabled} onClick={() => open ? close() : setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
        }}>
        <IconBranchOutline16 /><span className={styles.gitBranchName} title={props.value}>{props.value || placeholder || label}</span><IconChevronDownOutline14 />
      </button>
      {open && <div ref={popup} id={id} className={styles.gitBranchPopup} style={position} role="dialog" aria-label={label}>
        <GitBranchPicker {...props} onClose={close} onChange={(value) => { props.onChange(value); close(); }} />
      </div>}
    </div>
  );
}
