import { forwardRef, useCallback, useEffect, useState } from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";
import { Button } from "../atoms/index.js";

/**
 * ThemeToggle — ATOMIC-INVENTORY §2, molecule 30. Radix `ToggleGroup`. New; 2 sites.
 *
 * Three positions, and the third is the important one: **light · system · dark**. "System" is
 * the default and it is a real, selectable state rather than the absence of a choice, because a
 * reader who has set their OS to switch at dusk wants the dashboard to follow and needs to be
 * able to get back to that after trying the other two.
 *
 * **It must agree exactly with the pre-paint script in `index.html`** (DESIGN-SYSTEM §2.9). That
 * script is the contract, and it is short enough to restate:
 *
 *   - the key is `populace:theme`;
 *   - the values are the two literal strings `"light"` and `"dark"`, and nothing else;
 *   - an explicit choice sets `data-theme` on `<html>`; **"system" is spelled by the attribute
 *     being ABSENT**, which is how the `prefers-color-scheme` media query in `theme.css` gets to
 *     apply at all;
 *   - the toggle writes the key or **removes** it; nothing else may touch the attribute.
 *
 * So this component writes exactly those three outcomes and never a fourth — no `"system"` in
 * storage, no `data-theme="system"` on the element. Either of those would leave the pre-paint
 * script reading a value it ignores, and the page would flash the wrong theme on the next load
 * while looking correct in this session.
 *
 * **The switch is instant** (§5.1): no colour transition anywhere. A 200ms cross-fade over every
 * token on a dense screen is nauseating, and it advertises any unthemed corner as a flicker. The
 * only motion here is the segment's own 90ms hover, which is the press tempo every control has.
 *
 * **Words, not glyphs** — the inventory says so, and §6 agrees: an instrument is labelled. There
 * is no sun, no moon and no half-filled circle, which is just as well, because a half-filled
 * circle is not in the mark's grammar and "system" has no glyph anyone reads correctly.
 *
 * Radix's single-value `ToggleGroup` gives the group `role="radiogroup"`, each segment
 * `role="radio"` with `aria-checked`, and roving tabindex — one tab stop, arrows to move — which
 * is what §6 asks of every segmented composite.
 */

/** The three positions. `system` is a UI state, never a stored value. */
export type ThemeChoice = "light" | "system" | "dark";

/** The one key, shared with the pre-paint script. Changing it here changes nothing there. */
const STORAGE_KEY = "populace:theme";

/** Sentence case, per §7.4: the only upper case in the product is `t-label`'s four data roles. */
const POSITIONS: readonly { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
];

function isThemeChoice(value: string): value is ThemeChoice {
  return value === "light" || value === "system" || value === "dark";
}

/** What the pre-paint script would read right now. Anything unrecognised means "system". */
function storedChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Storage is off or blocked. The system preference applies, which is the default anyway.
    return "system";
  }
}

/**
 * The two writes, in the order that matters: the attribute first, so the page is already correct
 * if the storage write throws in a hardened browser.
 */
function applyChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);

  try {
    if (choice === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Storage is off: the choice holds for this document and is forgotten on reload. That is
    // the honest outcome, and it is better than failing the click.
  }
}

/**
 * A segmented control: 6px outer radius, because §5.2 names the theme toggle among the controls.
 * `rule-strong` bounds it — WCAG 1.4.11 asks 3:1 of anything bounding an interactive element and
 * the decorative hairline is 1.37–2.62:1 — and the ground flips structurally, lighter than the
 * page in light and darker than it in dark, exactly as `variants.ts`'s `control` shell does.
 *
 * Deliberately NOT `overflow-hidden`: the focus ring is a `box-shadow`, and an overflow clip on
 * the group would cut the ring off the first and last segments. The end segments round
 * themselves instead.
 */
const group = cva(
  [
    "inline-flex rounded-sm border border-rule-strong",
    "bg-surface dark:bg-sunk",
    // §4.6: a control on a non-page ground publishes the colour immediately behind it, so the
    // focus ring's 2px separator band is drawn in the group's own fill rather than the page's.
    "[--focus-sep:var(--color-surface)] dark:[--focus-sep:var(--color-sunk)]",
  ].join(" "),
);

/**
 * A segment is a `Button`, slotted in — never a re-implementation of one. The atom already owns
 * the two control heights, the press tempo, the focus ring and the coarse-pointer hit box, so
 * what is left here is only what makes a button a *segment*: square between neighbours, rounded
 * at the two ends so the fill follows the group's own corner, and a hairline tick between one
 * segment and the next, which is decorative separation rather than a boundary of its own (§4.1).
 *
 * The tick is a `::before`, not a left border, for two reasons. The atom already sets a
 * transparent border on all four sides, and re-colouring one edge would leave two utilities in
 * the same class group racing on stylesheet order rather than on `cn()`'s. And a *short* tick —
 * the same 12–16px hairline §4.5 puts between facts — is the shape this system uses to divide
 * things that belong to one scale, where a full-height rule would read as two separate controls.
 *
 * Selection is `primary-wash` + `primary` ink — one of the three sanctioned reasons for a tinted
 * ground (§1.3 rule 7) — and the word is still there, so the state never rests on colour alone.
 */
const segment = cva(
  [
    "rounded-none first:rounded-l-sm last:rounded-r-sm",
    "before:absolute before:left-0 before:top-1/2 before:w-px before:-translate-y-1/2",
    "before:bg-rule before:content-[''] first:before:hidden",
    "data-[state=on]:bg-primary-wash data-[state=on]:text-primary",
    "data-[state=on]:hover:bg-primary-wash data-[state=on]:hover:text-primary",
  ].join(" "),
  {
    variants: {
      compact: {
        /** The `sm` height keeps its own smaller step; `cn()` resolves it against `t-ui`. */
        true: "t-meta before:h-3",
        false: "before:h-4",
      },
    },
    defaultVariants: { compact: false },
  },
);

export interface ThemeToggleProps {
  /** 24px segments and the `t-meta` step, for a dense band. Still words, never glyphs. */
  compact?: boolean;
}

export const ThemeToggle = forwardRef<HTMLDivElement, ThemeToggleProps>(function ThemeToggle(
  { compact = false },
  ref,
) {
  // Seeded from storage rather than from the attribute, because storage is what the pre-paint
  // script reads and therefore what the NEXT load will honour. Lazily, so the read happens once.
  const [choice, setChoice] = useState<ThemeChoice>(storedChoice);

  const select = useCallback((value: string) => {
    // Radix reports "" when a pressed segment is pressed again. A theme is always one of three,
    // so an empty value is a de-selection we simply do not have a state for: ignore it and the
    // current segment stays lit.
    if (!isThemeChoice(value)) return;
    setChoice(value);
    applyChoice(value);
  }, []);

  // Two tabs of the same dashboard are one reader. `storage` fires in every OTHER document of
  // the origin, so a choice made in one window follows into the others without a reload.
  useEffect(() => {
    function onStorage(event: StorageEvent): void {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      const next = storedChoice();
      setChoice(next);
      applyChoice(next);
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      type="single"
      value={choice}
      onValueChange={select}
      // The group is a `radiogroup`; this is its name. "Theme" is the reader's word for it, and
      // it is not drawn, because the three segments already say what the control does.
      aria-label="Theme"
      className={cn(group())}
    >
      {POSITIONS.map((position) => (
        <ToggleGroupPrimitive.Item key={position.value} value={position.value} asChild>
          <Button variant="quiet" size={compact ? "sm" : "md"} className={cn(segment({ compact }))}>
            {position.label}
          </Button>
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
});
