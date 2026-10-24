import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Small right-aligned hint, e.g. a shortcut. */
  hint?: string;
}

interface Props {
  /** Contents of the trigger button. */
  trigger: ReactNode;
  /** Accessible name when the trigger is icon-only. */
  label?: string;
  items: (MenuItem | 'separator')[];
  align?: 'left' | 'right';
  className?: string;
}

/** Dropdown menu button with keyboard support (arrows, Home/End, Escape) per the WAI-ARIA menu button pattern. */
export function Menu({ trigger, label, items, align = 'right', className = 'btn' }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    // Focus the first enabled item when the menu opens.
    requestAnimationFrame(() => itemRefs.current.find((b) => b && !b.disabled)?.focus());
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function focusItem(dir: 1 | -1 | 'first' | 'last') {
    const enabled = itemRefs.current.filter((b): b is HTMLButtonElement => !!b && !b.disabled);
    if (enabled.length === 0) return;
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      dir === 'first' ? 0 : dir === 'last' ? enabled.length - 1 : (i + dir + enabled.length) % enabled.length;
    enabled[next].focus();
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }

  let itemIndex = -1;
  return (
    <div className="menu-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={`menu-popover menu-${align}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), focusItem(1));
            else if (e.key === 'ArrowUp') (e.preventDefault(), focusItem(-1));
            else if (e.key === 'Home') (e.preventDefault(), focusItem('first'));
            else if (e.key === 'End') (e.preventDefault(), focusItem('last'));
            else if (e.key === 'Escape') (e.preventDefault(), close());
            else if (e.key === 'Tab') close(false);
          }}
        >
          {items.map((item, i) => {
            if (item === 'separator') return <div key={`sep-${i}`} className="menu-separator" role="separator" />;
            itemIndex += 1;
            const idx = itemIndex;
            return (
              <button
                key={item.label}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                className={`menu-item ${item.danger ? 'danger' : ''}`}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {item.icon && <Icon name={item.icon} />}
                <span className="menu-item-label">{item.label}</span>
                {item.hint && <span className="menu-item-hint">{item.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
