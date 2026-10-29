/**
 * Esc v hoste zruší zvýraznenie z show_in_3d (#94).
 * Po show_in_3d je fokus v chate hosta, takže Esc do iframe viewera nepríde.
 */

/** Selektor otvoreného dialógu alebo popoveru (Radix/shadcn): Esc patrí jemu, nie viewerovi. */
export const OPEN_OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

/** Cieľ udalosti, ktorý píše text: Esc tam patrí poľu (zrušenie úpravy, zatvorenie návrhov). */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export interface EscapeEventLike {
  key: string;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
}

/** Čistá podmienka: má Esc poslať CLEAR_FOCUS do viewera? `overlayOpen` = je otvorený dialóg alebo popover. */
export function shouldClearFocusOnEscape(e: EscapeEventLike, overlayOpen: boolean): boolean {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || overlayOpen) return false;
  const t = e.target as Element | null;
  if (t && typeof t.closest === "function" && t.closest(EDITABLE_SELECTOR)) return false;
  return true;
}
