import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { Icon } from './Icon.js';

export interface FilterSelectOption {
  readonly label: string;
  readonly value: string;
}

export interface FilterSelectProps {
  readonly emptyLabel?: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly FilterSelectOption[];
  readonly value: string;
}

const EMPTY_VALUE = '';

export const FilterSelect = ({
  emptyLabel = 'Все',
  label,
  onChange,
  options,
  value,
}: FilterSelectProps) => {
  const labelId = useId();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const items = useMemo(
    () => [{ label: emptyLabel, value: EMPTY_VALUE }, ...options],
    [emptyLabel, options],
  );

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  const selectedLabel = items[selectedIndex]?.label ?? emptyLabel;
  const hasValue = value !== EMPTY_VALUE;

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const openMenu = useCallback(() => {
    setHighlight(selectedIndex);
    setOpen(true);
  }, [selectedIndex]);

  const toggle = useCallback(() => {
    if (open) {
      close();
      return;
    }
    openMenu();
  }, [close, open, openMenu]);

  const choose = useCallback(
    (next: string) => {
      onChange(next);
      setOpen(false);
    },
    [onChange],
  );

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (root === null || event.target instanceof Node === false) return;
      if (!root.contains(event.target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    if (active != null && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight, open]);

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setHighlight((current) => {
        if (event.key === 'ArrowDown') {
          return (current + 1) % items.length;
        }
        return (current - 1 + items.length) % items.length;
      });
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const item = items[highlight];
      if (item !== undefined) {
        choose(item.value);
      }
      return;
    }

    if (event.key === 'Home' && open) {
      event.preventDefault();
      setHighlight(0);
      return;
    }

    if (event.key === 'End' && open) {
      event.preventDefault();
      setHighlight(items.length - 1);
    }
  };

  return (
    <div
      className={['filter-select', open ? 'is-open' : '', hasValue ? 'is-active' : '']
        .filter(Boolean)
        .join(' ')}
      ref={rootRef}
    >
      <span className="filter-select__label" id={labelId}>
        {label}
      </span>
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={labelId}
        className="filter-select__trigger"
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
        type="button"
      >
        <span className="filter-select__value">{selectedLabel}</span>
        <span aria-hidden="true" className="filter-select__chevron">
          <Icon name="chevron" size={16} />
        </span>
      </button>

      {open ? (
        <ul
          aria-labelledby={labelId}
          className="filter-select__panel"
          id={listboxId}
          ref={listRef}
          role="listbox"
        >
          {items.map((item, index) => {
            const selected = item.value === value;
            const highlighted = index === highlight;
            return (
              <li
                aria-selected={selected}
                className={[
                  'filter-select__option',
                  selected ? 'is-selected' : '',
                  highlighted ? 'is-highlighted' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-highlighted={highlighted ? 'true' : undefined}
                key={`${item.value || 'all'}-${item.label}`}
                onClick={() => choose(item.value)}
                onMouseEnter={() => setHighlight(index)}
                role="option"
              >
                <span className="filter-select__option-label">{item.label}</span>
                {selected ? (
                  <span aria-hidden="true" className="filter-select__check">
                    <Icon name="check" size={15} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};
