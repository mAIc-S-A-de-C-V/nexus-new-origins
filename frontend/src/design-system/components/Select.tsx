/**
 * Select — drop-in replacement for native <select> with typeahead, keyboard
 * navigation, and theme-matching styling. Native <select> renders with native
 * OS chrome (dark on macOS) and has no search; this component fixes both.
 *
 * Usage:
 *   <Select
 *     value={objectTypeId}
 *     onChange={setObjectTypeId}
 *     options={[
 *       { value: 'a1', label: 'Devices', hint: '12k records' },
 *       { value: 'b2', label: 'Tickets' },
 *     ]}
 *     placeholder="Select an object type…"
 *   />
 *
 * API mirrors a controlled <select> (value, onChange) so swapping at the call
 * site is mechanical. Options may be `string[]` for simple cases.
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, Check, X, Search } from 'lucide-react';
import { colors } from '../tokens';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  hint?: string;
  disabled?: boolean;
  group?: string;
}

interface SelectProps<V extends string = string> {
  value: V | '';
  onChange: (value: V) => void;
  options: SelectOption<V>[] | string[];
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** Width of the trigger button. Pass '100%' to fill parent. */
  width?: string | number;
  /** Height of the trigger button. */
  height?: string | number;
  /** Inline style overrides applied to the trigger. */
  style?: React.CSSProperties;
  /** Auto-focus the search input when opened. Default true. */
  autoFocusSearch?: boolean;
  /** Render before label inside the row (icon, dot, etc.) */
  renderRowPrefix?: (opt: SelectOption<V>) => React.ReactNode;
  /** Custom trigger label (overrides selected option's label). */
  triggerLabel?: React.ReactNode;
  /** ARIA / form id for the trigger button. */
  id?: string;
}

const C = colors;

function normalizeOptions<V extends string>(
  raw: SelectOption<V>[] | string[],
): SelectOption<V>[] {
  if (raw.length === 0) return [];
  if (typeof raw[0] === 'string') {
    return (raw as string[]).map((v) => ({ value: v as V, label: v }));
  }
  return raw as SelectOption<V>[];
}

export function Select<V extends string = string>({
  value,
  onChange,
  options: rawOptions,
  placeholder = 'Select…',
  disabled = false,
  clearable = false,
  width = '100%',
  height = 32,
  style,
  autoFocusSearch = true,
  renderRowPrefix,
  triggerLabel,
  id,
}: SelectProps<V>) {
  const options = useMemo(() => normalizeOptions(rawOptions), [rawOptions]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint || '').toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Group filtered options if any have `group`
  const grouped = useMemo(() => {
    const groups: { name: string | null; items: SelectOption<V>[] }[] = [];
    const map = new Map<string | null, SelectOption<V>[]>();
    for (const opt of filtered) {
      const key = opt.group || null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(opt);
    }
    map.forEach((items, name) => groups.push({ name, items }));
    return groups;
  }, [filtered]);

  // Flatten ordered list for keyboard nav
  const flatList = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current && !popoverRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Focus search when opening
  useEffect(() => {
    if (open && autoFocusSearch) {
      setTimeout(() => searchRef.current?.focus(), 30);
    }
    if (!open) setQuery('');
  }, [open, autoFocusSearch]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-select-item]');
    const node = items[highlightIdx] as HTMLElement | undefined;
    if (node) node.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, open]);

  const commit = useCallback(
    (v: V) => {
      onChange(v);
      setOpen(false);
    },
    [onChange],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = flatList[highlightIdx];
      if (opt && !opt.disabled) commit(opt.value);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  const triggerStyles: React.CSSProperties = {
    width,
    height,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 8px 0 10px',
    border: `1px solid ${open ? C.interactive : C.border}`,
    borderRadius: 4,
    backgroundColor: disabled ? '#F1F5F9' : C.surface,
    color: selected ? C.text : C.textSubtle,
    fontSize: 13,
    fontFamily: 'inherit',
    textAlign: 'left',
    cursor: disabled ? 'not-allowed' : 'pointer',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 80ms ease-out',
    boxShadow: open ? `0 0 0 2px ${C.interactiveDim}` : 'none',
    ...style,
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={triggerStyles}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {triggerLabel ?? (selected?.label || placeholder)}
        </span>
        {clearable && selected && !disabled && (
          <span
            role="button"
            aria-label="Clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange('' as V);
            }}
            style={{ display: 'inline-flex', color: C.textSubtle, padding: 2, lineHeight: 0, cursor: 'pointer' }}
          >
            <X size={11} />
          </span>
        )}
        <ChevronDown size={13} color={C.textSubtle} style={{ transition: 'transform 80ms ease-out', transform: open ? 'rotate(180deg)' : undefined, flexShrink: 0 }} />
      </button>

      {open && (
        <SelectPopover
          anchorRef={triggerRef}
          ref={popoverRef}
          query={query}
          onQueryChange={setQuery}
          searchRef={searchRef}
          onKeyDown={onKeyDown}
          listRef={listRef}
          grouped={grouped as { name: string | null; items: SelectOption<string>[] }[]}
          highlightIdx={highlightIdx}
          setHighlightIdx={setHighlightIdx}
          flatList={flatList as SelectOption<string>[]}
          selectedValue={value}
          onCommit={(v) => commit(v as V)}
          renderRowPrefix={renderRowPrefix as ((opt: SelectOption<string>) => React.ReactNode) | undefined}
        />
      )}
    </>
  );
}

// ── Popover (positioned with fixed coordinates so it floats above any container clipping) ──

interface PopoverProps<V extends string> {
  anchorRef: React.MutableRefObject<HTMLButtonElement | null>;
  query: string;
  onQueryChange: (q: string) => void;
  searchRef: React.MutableRefObject<HTMLInputElement | null>;
  onKeyDown: (e: React.KeyboardEvent) => void;
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  grouped: { name: string | null; items: SelectOption<V>[] }[];
  highlightIdx: number;
  setHighlightIdx: (n: number) => void;
  flatList: SelectOption<V>[];
  selectedValue: V | '';
  onCommit: (v: V) => void;
  renderRowPrefix?: (opt: SelectOption<V>) => React.ReactNode;
}

const SelectPopover = React.forwardRef<HTMLDivElement, PopoverProps<string>>(
  function SelectPopoverInner(props, forwardedRef) {
    const {
      anchorRef, query, onQueryChange, searchRef, onKeyDown, listRef,
      grouped, highlightIdx, flatList, selectedValue, onCommit, renderRowPrefix,
    } = props;

    // Position relative to anchor (fixed positioning so we escape overflow:hidden)
    const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
    useEffect(() => {
      const reposition = () => {
        const a = anchorRef.current;
        if (!a) return;
        const r = a.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left, width: r.width });
      };
      reposition();
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
      return () => {
        window.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
      };
    }, [anchorRef]);

    if (!pos) return null;

    const flatIndexOf = (opt: SelectOption<string>) => flatList.indexOf(opt);

    return (
      <div
        ref={forwardedRef}
        role="listbox"
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          minWidth: pos.width,
          maxWidth: Math.max(pos.width, 360),
          backgroundColor: C.surface,
          border: `1px solid ${C.borderEmphasis}`,
          borderRadius: 5,
          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12), 0 4px 12px rgba(15, 23, 42, 0.06)',
          zIndex: 9999,
          maxHeight: 360,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.base }}>
          <Search size={12} color={C.textSubtle} />
          <input
            ref={(el) => { searchRef.current = el; }}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search…"
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontSize: 12, color: C.text, fontFamily: 'inherit',
            }}
          />
          {flatList.length > 0 && (
            <span style={{ fontSize: 10, color: C.textSubtle }}>
              {flatList.length} match{flatList.length !== 1 ? 'es' : ''}
            </span>
          )}
        </div>

        {/* List */}
        <div ref={(el) => { listRef.current = el; }} style={{ overflowY: 'auto', flex: 1 }}>
          {flatList.length === 0 && (
            <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: C.textSubtle }}>
              No matches
            </div>
          )}
          {grouped.map((group, gi) => (
            <div key={group.name ?? `__nogroup_${gi}`}>
              {group.name && (
                <div style={{ padding: '6px 12px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: C.textSubtle, backgroundColor: C.base, borderBottom: `1px solid ${C.border}` }}>
                  {group.name}
                </div>
              )}
              {group.items.map((opt) => {
                const i = flatIndexOf(opt);
                const isSelected = opt.value === selectedValue;
                const isHighlighted = i === highlightIdx;
                return (
                  <div
                    key={opt.value}
                    data-select-item
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => props.setHighlightIdx(i)}
                    onClick={() => !opt.disabled && onCommit(opt.value)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 12px',
                      cursor: opt.disabled ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                      color: opt.disabled ? C.textSubtle : C.text,
                      backgroundColor: isHighlighted ? C.interactiveDim : 'transparent',
                      borderLeft: isSelected ? `2px solid ${C.interactive}` : '2px solid transparent',
                    }}
                  >
                    {renderRowPrefix && renderRowPrefix(opt)}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                    {opt.hint && (
                      <span style={{ fontSize: 11, color: C.textSubtle, fontFamily: 'monospace' }}>{opt.hint}</span>
                    )}
                    {isSelected && <Check size={12} color={C.interactive} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  },
);
SelectPopover.displayName = 'SelectPopover';

export default Select;
