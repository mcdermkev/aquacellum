import React, { useEffect, useRef, useCallback } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared accessible Modal component.
 *
 * Props:
 *  - isOpen (boolean) — controls visibility
 *  - onClose (function) — called on Escape or backdrop click
 *  - children — modal body content
 *  - ariaLabel (string) — accessible label for the dialog
 *  - className (string, optional) — extra class on the inner card
 *  - fullScreenMobile (boolean, default true) — full-screen on ≤640px
 */
export function Modal({
  isOpen,
  onClose,
  children,
  ariaLabel,
  className = "",
  fullScreenMobile = true,
}) {
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Prevent body scroll when open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // Save and restore focus, auto-focus first element on open
  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement;

    // Small delay to let the DOM render
    const timer = setTimeout(() => {
      if (modalRef.current) {
        const focusable = modalRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          modalRef.current.focus();
        }
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      if (previousFocusRef.current && previousFocusRef.current.focus) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Focus trap
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key !== "Tab" || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusableElements.length === 0) return;

      const firstEl = focusableElements[0];
      const lastEl = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    },
    []
  );

  if (!isOpen) return null;

  const cardClasses = [
    "modal-inner-card",
    fullScreenMobile ? "modal-fullscreen-mobile" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="specimen-detail-modal-backdrop modal-backdrop-animate"
      onClick={onClose}
      aria-hidden="true"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cardClasses}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
