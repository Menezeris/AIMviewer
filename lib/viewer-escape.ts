/**
 * Esc in the host cancels the highlight from show_in_3d (#94).
 * After show_in_3d the focus is in the host chat, so Esc does not reach the viewer iframe.
 */

/** Selector of an open dialog or popover (Radix/shadcn): Esc belongs to it, not to the viewer. */
export const OPEN_OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

/** Event target that takes text input: Esc belongs to the field there (cancelling an edit, closing suggestions). */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export interface EscapeEventLike {
  key: string;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
}

/** Pure condition: should Esc send CLEAR_FOCUS to the viewer? `overlayOpen` = a dialog or popover is open. */
export function shouldClearFocusOnEscape(e: EscapeEventLike, overlayOpen: boolean): boolean {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || overlayOpen) return false;
  const t = e.target as Element | null;
  if (t && typeof t.closest === "function" && t.closest(EDITABLE_SELECTOR)) return false;
  return true;
}
