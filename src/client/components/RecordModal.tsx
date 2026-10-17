import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent, ReactNode } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

export interface RecordModalProps {
  children: ReactNode;
  closeDisabled?: boolean;
  description?: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  title: ReactNode;
}

export default function RecordModal({
  children,
  closeDisabled = false,
  description,
  footer,
  onClose,
  title,
}: RecordModalProps) {
  const generatedId = useId();
  const titleId = `record-modal-title-${generatedId.replaceAll(':', '')}`;
  const descriptionId = `record-modal-description-${generatedId.replaceAll(':', '')}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (returnFocusRef.current === null) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const trigger = returnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    if (panel !== null) {
      const [firstFocusable] = focusableElements(panel);
      (firstFocusable ?? panel).focus();
    }

    const requestClose = (): void => {
      if (!closeDisabledRef.current) {
        onCloseRef.current?.();
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (!closeDisabledRef.current && onCloseRef.current !== undefined) {
          event.preventDefault();
          requestClose();
        }
        return;
      }

      if (event.key !== 'Tab' || panel === null) {
        return;
      }

      const focusable = focusableElements(panel);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        panel.focus();
        return;
      }

      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected === true) {
        trigger.focus();
      }
    };
  }, []);

  if (typeof document === 'undefined') {
    return null;
  }

  const closeDialog = (): void => {
    if (!closeDisabled) {
      onClose?.();
    }
  };

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      closeDialog();
    }
  };

  return createPortal(
    <div className="modal-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        aria-describedby={description === undefined ? undefined : descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-panel"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="dialog__header">
          <div>
            <h2 className="dialog__title" id={titleId}>
              {title}
            </h2>
            {description === undefined ? null : (
              <p className="muted small" id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          {onClose === undefined ? null : (
            <button
              aria-label="Close dialog"
              className="icon-button"
              disabled={closeDisabled}
              onClick={closeDialog}
              type="button"
            >
              <X aria-hidden="true" focusable="false" size={20} strokeWidth={1.8} />
            </button>
          )}
        </header>
        <div className="dialog__body">{children}</div>
        {footer === undefined ? null : <footer className="dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
