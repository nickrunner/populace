import { forwardRef, type MouseEvent } from "react";
import { cn } from "../cn.js";
import { focusRing, pressTransition } from "../variants.js";

/**
 * The first focusable thing on the page — ATOMIC-INVENTORY §1 atom 32, DESIGN-SYSTEM §6.
 *
 * The sidebar is thirty-odd tab stops wide. Without this, reaching the transcript on a keyboard
 * means traversing every project, every screen link and the theme control first, on every single
 * route. One tab stop, before all of them, that jumps to the content.
 *
 * It is hidden until it is focused and then it is emphatically visible — `--z-skip` is the top
 * of the seven-step stack precisely so that nothing sticky, no rail and no dialog backdrop can
 * cover it. It is rendered once, by the app shell, as the first child of `<body>`'s React root.
 *
 * The `href` alone moves the browser's reading position; the click handler additionally moves
 * *focus*, because a fragment jump leaves focus on the link in several browsers and the next Tab
 * would then walk back into the rail. The target — `<main tabindex="-1">` — is what makes that
 * focus call legal on a non-interactive element.
 */
export interface SkipLinkProps {
  /** The id of the element focus lands on. The shell's `<main tabindex="-1">`. */
  targetId: string;
}

export const SkipLink = forwardRef<HTMLAnchorElement, SkipLinkProps>(function SkipLink(
  { targetId },
  ref,
) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    const target = document.getElementById(targetId);
    if (target === null) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView({ block: "start" });
  }

  return (
    <a
      ref={ref}
      href={`#${targetId}`}
      onClick={handleClick}
      className={cn(
        // Out of the layout entirely until a keyboard reaches it.
        "sr-only",
        // Focused: a control-shaped plate pinned to the top-left corner, above everything.
        "focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[var(--z-skip)]",
        "focus:inline-flex focus:h-8 focus:items-center focus:px-3",
        "t-ui text-ink rounded-sm border border-rule-strong bg-surface shadow-over",
        "[--focus-sep:var(--color-surface)]",
        pressTransition,
        focusRing,
      )}
    >
      Skip to content
    </a>
  );
});
