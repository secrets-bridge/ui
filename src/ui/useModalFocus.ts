/**
 * Focus rules for dialogs and drawers (handoff, accessibility):
 *
 * - focus moves inside when the layer opens (to `[data-autofocus]`, else
 *   the first focusable element, else the layer itself);
 * - Tab and Shift+Tab stay inside the layer;
 * - Escape closes the top layer only, so a dialog over a drawer closes
 *   first;
 * - on close, focus returns to the element that opened the layer, or,
 *   when that element is gone, to `fallbackFocus()` (the state heading
 *   or the page h1);
 * - the page behind does not scroll while a layer is open.
 */

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Open layers, oldest first. Only the last one reacts to Escape.
const layers: symbol[] = [];

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

function defaultFallback(): HTMLElement | null {
  return document.getElementById('page-title');
}

export function useModalFocus(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  fallbackFocus: () => HTMLElement | null = defaultFallback,
  /** Return false to leave focus alone on close (someone else moves it). */
  shouldRestore: () => boolean = () => true,
): void {
  // The trigger is whatever had focus when the layer first rendered.
  // Captured during render, before any effect moves focus, so a
  // StrictMode effect re-run can't mistake an element inside the layer
  // for the trigger.
  const openerRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  // Keep the latest callbacks without re-running the open/close effect.
  const onCloseRef = useRef(onClose);
  const fallbackRef = useRef(fallbackFocus);
  const shouldRestoreRef = useRef(shouldRestore);
  useEffect(() => {
    onCloseRef.current = onClose;
    fallbackRef.current = fallbackFocus;
    shouldRestoreRef.current = shouldRestore;
  });

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const id = Symbol('layer');
    layers.push(id);
    const opener = openerRef.current;

    const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(root)[0] ?? root;
    first.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (layers[layers.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstItem || !root.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (active === lastItem || !root.contains(active))) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const at = layers.indexOf(id);
      if (at >= 0) layers.splice(at, 1);
      if (layers.length === 0) document.body.style.overflow = previousOverflow;
      // Return focus after React has finished removing the layer. A layer
      // that is still on the page (StrictMode re-running effects) keeps
      // it, and so does a layer opened in the meantime (the phone menu
      // closing as the sign-out dialog opens).
      window.setTimeout(() => {
        if (root.isConnected && root.contains(document.activeElement)) return;
        if (layers.length > 0) return;
        if (!shouldRestoreRef.current()) return;
        const target = opener && opener.isConnected ? opener : fallbackRef.current();
        target?.focus();
      }, 0);
    };
  }, [ref]);
}
