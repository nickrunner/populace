import * as ToastPrimitive from "@radix-ui/react-toast";
import { cva } from "class-variance-authority";
import { forwardRef, type ComponentRef, type ReactNode } from "react";

import { cn } from "../cn.js";
import { focusRing, surfaceBase } from "../variants.js";
import { Badge, IconButton, Inline, Stack, Text } from "../atoms/index.js";

/**
 * Toast — ATOMIC-INVENTORY §3, organism 11. Radix `react-toast`. Six sites.
 *
 * **What it replaces is a pile.** LiveRun stacks four mutation-error strips that never clear:
 * fail to stop an execution twice and a fifth of the screen is error, none of it dismissible,
 * all of it still there after the next attempt succeeds. This is one region instead, it is
 * dismissible, and the call site clears it on the next successful mutation.
 *
 * **Announcement.** Radix renders its own live region for the toast's text and chooses the
 * urgency from `type`: `foreground` announces assertively — which is what `role="alert"` buys —
 * and `background` announces politely. `tone` picks between them, so a failed act interrupts and
 * a neutral confirmation waits its turn. The primitive puts the urgency on a dedicated announce
 * region rather than on the visible node, which is what stops a re-render from re-reading the
 * whole toast; that is the nearest correct thing to the inventory's "one `role="alert"` region",
 * and it is strictly better behaved than the literal attribute would be.
 *
 * **It does not expire.** `duration={Infinity}` — Radix's own escape hatch for this — because a
 * message about an act that failed must not vanish while its reader is still reading the number
 * in it. It leaves when the reader dismisses it, when they swipe it, or when the call site drops
 * it because the act finally worked.
 *
 * **Never colour alone** (§4.2). A `bad` toast carries the word *Problem* in a `Badge` beside
 * the critical ink, so the register survives a greyscale screen and a colour-blind reader.
 *
 * **Elevation is a composite token, never a theme branch** (§2.5, §6.2). `surfaceBase({ level:
 * "overlay" })` gives the 12px container radius (§5.2 names toasts among the containers), the
 * `surface` ground, `--shadow-over`, and a boundary that is a hairline in light and
 * `rule-strong` in dark. Dark elevation is **border-led**, because `#2C3730` on `#202823` is
 * 1.22:1 and no fill difference will read there.
 *
 * **Mounting.** `ToastRegion` wraps the app once — in `AppShell` — and supplies both the Radix
 * provider and the one viewport every toast portals into. A `Toast` rendered anywhere beneath it
 * appears in that region, in arrival order, with one tab stop for the whole stack.
 */

const toastPanel = cva(
  [
    "populace-toast",
    surfaceBase({ level: "overlay" }),
    focusRing,
    "p-3.5",
    "outline-none",
    // Swipe-to-dismiss, wired to the custom properties Radix writes during the gesture. It is a
    // transform on a pointer drag, not an animation, so `prefers-reduced-motion` leaves it alone
    // — the finger is the motion.
    "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
    "data-[swipe=cancel]:translate-x-0",
  ].join(" "),
  {
    variants: {
      /**
       * The edge moves; the ground does not. A filled critical panel would be the largest block
       * of `critical` anywhere in the product, and §4.1 keeps that colour for severity, errors
       * and destruction rather than for decoration. A 1px critical left edge is the same
       * grammar `Badge`'s `bad` variant uses for the `error` caption over a payload well — and
       * it is 1px, because the system has no 2px border outside the focus ring, the well's
       * evidence edge and the selected row (§2.6).
       */
      tone: {
        neutral: "",
        bad: "border-l-critical",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

/**
 * Entry and exit, per §5.1: `opacity` 0→1 with a 4px travel, 240ms in on `--ease`, 180ms out —
 * 0.75× the entry — on `--ease-exit`. The travel is horizontal here because the region is
 * anchored to the right edge and a toast should look like it came from off-screen, not like it
 * grew out of the content it is reporting on.
 *
 * Under `prefers-reduced-motion` theme.css collapses the durations to 0.01ms, and
 * `animation-fill-mode: both` holds the final frame, so a toast simply appears and simply goes.
 */
const TOAST_CSS = `
.populace-toast[data-state="open"] {
  animation: populace-toast-in var(--dur-enter) var(--ease) both;
}
.populace-toast[data-state="closed"] {
  animation: populace-toast-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}
.populace-toast[data-swipe="end"] {
  animation: populace-toast-swipe-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}

@keyframes populace-toast-in {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes populace-toast-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@keyframes populace-toast-swipe-out {
  from { transform: translateX(var(--radix-toast-swipe-end-x)); }
  to   { transform: translateX(calc(100% + 1rem)); }
}
`;

export interface ToastRegionProps {
  children: ReactNode;
  /**
   * The viewport's accessible name. `{hotkey}` is substituted by Radix with the key that jumps
   * focus to the region, so it earns its place in the string.
   */
  label?: string;
}

/**
 * The region, mounted **once**, in `AppShell`. It is both the Radix provider — which every
 * `Toast` beneath it needs for its context — and the single viewport they all portal into.
 *
 * `z-toast` (60) outranks the dialog layer (50) on purpose: an act that failed while a dialog
 * was open has to be readable over that dialog, or the reader is told nothing at all.
 */
export const ToastRegion = forwardRef<
  ComponentRef<typeof ToastPrimitive.Viewport>,
  ToastRegionProps
>(function ToastRegion({ children, label = "Notifications ({hotkey})" }, ref) {
  return (
    // `duration` here is the provider default; every Toast below overrides it with Infinity.
    // It is set anyway so a toast rendered without this file's component still behaves.
    <ToastPrimitive.Provider swipeDirection="right" duration={Infinity}>
      {children}
      <ToastPrimitive.Viewport
        ref={ref}
        label={label}
        className={cn(
          "fixed bottom-4 right-4 z-[var(--z-toast)]",
          "m-0 flex w-[min(24rem,calc(100vw-2rem))] list-none flex-col gap-2 p-0",
          "outline-none",
        )}
      />
      {/* React 19 hoists and de-duplicates this by `href`, so N toasts emit one rule set. */}
      <style href="populace-toast" precedence="medium">
        {TOAST_CSS}
      </style>
    </ToastPrimitive.Provider>
  );
});

export interface ToastProps {
  tone: "neutral" | "bad";
  /** What happened, in the product's own words — "Could not stop this execution". */
  title: string;
  /**
   * What to do about it, and the machine's own words quoted in a mono well beneath rather than
   * paraphrased into prose (§7.4). Optional: a neutral confirmation is usually one line.
   */
  body?: ReactNode;
  /** Called on the close button, on Escape and on a swipe. The caller drops the toast. */
  onDismiss: () => void;
}

export const Toast = forwardRef<ComponentRef<typeof ToastPrimitive.Root>, ToastProps>(
  function Toast({ tone, title, body, onDismiss }, ref) {
    return (
      <ToastPrimitive.Root
        ref={ref}
        // Rendering it IS opening it. The caller owns the list; Radix is only told when the
        // reader asked for it to go, which it does through `onDismiss`.
        open
        onOpenChange={(next) => {
          if (!next) onDismiss();
        }}
        // A message about a failed act must not vanish mid-sentence. Radix treats Infinity as
        // "no timer" explicitly, so there is no clamped-setTimeout surprise here.
        duration={Infinity}
        type={tone === "bad" ? "foreground" : "background"}
        className={cn(toastPanel({ tone }))}
      >
        <Stack gap={2}>
          <Inline gap={2} align="start">
            <Stack gap={1} className="min-w-0 flex-1">
              {tone === "bad" ? (
                <div>
                  <Badge variant="bad">Problem</Badge>
                </div>
              ) : null}
              <ToastPrimitive.Title asChild>
                {/*
                  Chrome, not prose: a toast is a dense overlay and §3.1's threshold rule puts
                  its text in Space Grotesk even when it is a whole sentence. The ink is a token
                  name handed to `Text`, not a class string assembled here.
                */}
                <Text size="name" as="div" tone={tone === "bad" ? "critical" : "ink"}>
                  {title}
                </Text>
              </ToastPrimitive.Title>
            </Stack>
            <ToastPrimitive.Close asChild>
              <IconButton icon="x" label="Dismiss" size="sm" className="-mr-1 -mt-0.5" />
            </ToastPrimitive.Close>
          </Inline>

          {body === undefined ? null : (
            <ToastPrimitive.Description asChild>
              <Text size="ui" tone="soft" as="div">
                {body}
              </Text>
            </ToastPrimitive.Description>
          )}
        </Stack>
      </ToastPrimitive.Root>
    );
  },
);
