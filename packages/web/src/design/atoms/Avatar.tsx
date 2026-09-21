import { forwardRef } from "react";
import * as RadixAvatar from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../cn.js";
import { initials } from "../../format.js";

/**
 * Avatar — a person, drawn (ATOMIC-INVENTORY §1, atom 20).
 *
 * Initials only. Nobody in a population has a photograph, so there is no `Image` slot and no
 * network request to fall back from; Radix's `Fallback` is the whole component.
 *
 * Full radius, always. §1.2 M6: a filled circle is an individual in the mark's own grammar
 * (§8.6), and a row of stadium avatars above a table of square cells reads instantly as
 * *these are people, that is the measurement*.
 *
 * The initials are `aria-hidden` and the ring carries the name: a screen reader is told
 * "Priya Raman", not "PR".
 */

const avatar = cva(
  [
    "inline-grid shrink-0 place-items-center",
    "rounded-full border border-rule bg-sunk text-ink-soft",
    "select-none",
  ].join(" "),
  {
    variants: {
      /** The three control heights (§0.3): 24 / 32 / 40px. */
      size: {
        sm: "size-6 t-label",
        md: "size-8 t-label",
        lg: "size-10 t-ui",
      },
      /**
       * Mid-visit. Deliberately the SAME geometry as `focusRing` — 2px at an offset of 2 — so
       * "someone is here" and "you are here" rhyme.
       *
       * Drawn in `focus`/`primary` rather than in literal lime: `--color-focus` equals
       * `--color-primary` in both themes, which makes it forest in light and lime in dark. A
       * literal lime ring would be 1.08:1 on paper and therefore invisible on exactly the theme
       * most people run (§1.2 M5, §5.4).
       */
      active: {
        true: "outline-2 outline-offset-2 outline-primary",
        false: "",
      },
    },
    defaultVariants: { size: "md", active: false },
  },
);

export type AvatarVariants = VariantProps<typeof avatar>;

export interface AvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  /** They are in a visit right now. */
  active?: boolean;
}

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, size = "md", active = false },
  ref,
) {
  return (
    <RadixAvatar.Root
      ref={ref}
      role="img"
      aria-label={name}
      className={cn(avatar({ size, active }))}
    >
      {/* delayMs 0: there is no image to wait for, so the fallback is the first paint. */}
      <RadixAvatar.Fallback delayMs={0} aria-hidden="true">
        {initials(name)}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
});
