import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One line under the title. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons row, right-aligned. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Element to focus on open (defaults to the first focusable field). */
  initialFocusSelector?: string;
  /** Keep the title for screen readers only (e.g. the command palette). */
  titleHidden?: boolean;
}

/**
 * Modal built on the native <dialog>: showModal() gives focus trapping, inert background,
 * Escape to close and focus restore for free.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  initialFocusSelector,
  titleHidden,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      const target =
        (initialFocusSelector && d.querySelector<HTMLElement>(initialFocusSelector)) ||
        d.querySelector<HTMLElement>(
          '.dialog-body input, .dialog-body select, .dialog-body textarea, .dialog-body button',
        ) ||
        d.querySelector<HTMLElement>('.dialog-footer .btn-primary');
      target?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open, initialFocusSelector]);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${size}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        // Click on the backdrop (the dialog element itself, outside the panel) closes.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog-panel">
          {titleHidden ? (
            <h2 id={titleId} className="sr-only">
              {title}
            </h2>
          ) : (
            <div className="dialog-head">
              <div>
                <h2 id={titleId} className="dialog-title">
                  {title}
                </h2>
                {description && <p className="dialog-desc">{description}</p>}
              </div>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
          )}
          {children && <div className={titleHidden ? 'dialog-body dialog-body-flush' : 'dialog-body'}>{children}</div>}
          {footer && <div className="dialog-footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
