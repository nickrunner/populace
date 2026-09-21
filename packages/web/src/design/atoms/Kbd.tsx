import { type ReactNode, forwardRef } from "react";
import { cn } from "../cn.js";

/**
 * Kbd — a key on the reader's keyboard.
 *
 * **Sans, not mono**, and that is the whole argument for this atom existing: a key is a *named
 * control*, so §3.1's law puts it in Space Grotesk, whereas mono would file it under machine
 * speech and steal the evidence seam for something the target app never said.
 *
 * **`t-ui`, the chrome step, not `t-meta`.** A key is a control, and §3.3 gives every control
 * `t-ui`'s 13px: a `Kbd` sits inline with button text, menu text and help text, all of which are
 * `t-ui`, and 12px beside 13px on the same baseline reads as a rendering fault rather than as a
 * quieter register. `t-meta` is for counts, timestamps and secondary chrome facts — a key is none
 * of those; it is the thing the reader is being told to press.
 *
 * 6px radius, because §5.2 files `kbd` with the controls. The 2px bottom border is the keycap —
 * a physical read that costs one token and no shadow, and that survives dark, where
 * `--shadow-card` is literally `none`. The ground follows the control shell's structural flip
 * (§2.5): a control is lighter than the page in light and darker than it in dark.
 */
const kbdStyles = [
  "t-ui text-ink-soft",
  "inline-flex h-[22px] min-w-[22px] items-center justify-center px-1",
  "rounded-sm border border-rule-strong border-b-2",
  "bg-surface dark:bg-sunk",
  "align-baseline",
].join(" ");

export interface KbdProps {
  children: ReactNode;
}

export const Kbd = forwardRef<HTMLElement, KbdProps>(function Kbd({ children }, ref) {
  return (
    <kbd ref={ref} className={cn(kbdStyles)}>
      {children}
    </kbd>
  );
});
