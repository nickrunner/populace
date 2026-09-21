import { forwardRef, type ForwardedRef, type ReactNode } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn.js";

/**
 * The column — ATOMIC-INVENTORY §1 atom 24.
 *
 * Replaces ~35 hand-written `flex flex-col gap-*` strings. The point is not brevity: it is that
 * `gap` is a **closed token scale**, never a raw number. The survey found twelve different
 * vertical rhythms on the same screen because every one of those strings chose its own. The
 * union below is the whole vocabulary — 4, 8, 12, 16, 24, 32 and 48px off the 4px base — and a
 * thirteenth rhythm is now a compile error rather than a taste.
 *
 * `as` exists because a list of people, cohorts or findings is a `<ul>`, and a stack that is a
 * list must say so for a screen reader to count it. Markers are suppressed; the ledger's own
 * hairline does the separating (§4.5).
 */
const stack = cva("flex flex-col", {
  variants: {
    /** The 4px base scale: 1→4px, 2→8px, 3→12px, 4→16px, 6→24px, 8→32px, 12→48px. */
    gap: {
      1: "gap-1",
      2: "gap-2",
      3: "gap-3",
      4: "gap-4",
      6: "gap-6",
      8: "gap-8",
      12: "gap-12",
    },
    /** Cross-axis. `stretch` is the flex default and the right answer for full-width rows. */
    align: {
      start: "items-start",
      center: "items-center",
      stretch: "items-stretch",
    },
    list: {
      true: "list-none p-0 m-0",
      false: "",
    },
  },
  defaultVariants: { gap: 3, align: "stretch", list: false },
});

export interface StackProps {
  gap?: 1 | 2 | 3 | 4 | 6 | 8 | 12;
  align?: "start" | "center" | "stretch";
  as?: "div" | "ul" | "ol" | "section";
  className?: string;
  children: ReactNode;
}

/**
 * One callback that satisfies every tag's `ref` slot. A `ForwardedRef<HTMLElement>` cannot be
 * handed straight to a `<ul>`, whose slot wants `HTMLUListElement`, and the alternative is an
 * `ElementType` whose props are untyped — which this codebase does not allow. A callback taking
 * the widest element type is assignable to all four by ordinary parameter contravariance.
 */
function assignTo(ref: ForwardedRef<HTMLElement>): (node: HTMLElement | null) => void {
  return (node) => {
    if (typeof ref === "function") ref(node);
    else if (ref !== null) ref.current = node;
  };
}

export const Stack = forwardRef<HTMLElement, StackProps>(function Stack(
  { gap = 3, align = "stretch", as = "div", className, children },
  ref,
) {
  const list = as === "ul" || as === "ol";
  const classes = cn(stack({ gap, align, list }), className);
  const attach = assignTo(ref);

  if (as === "ul") {
    return (
      <ul ref={attach} className={classes}>
        {children}
      </ul>
    );
  }
  if (as === "ol") {
    return (
      <ol ref={attach} className={classes}>
        {children}
      </ol>
    );
  }
  if (as === "section") {
    return (
      <section ref={attach} className={classes}>
        {children}
      </section>
    );
  }
  return (
    <div ref={attach} className={classes}>
      {children}
    </div>
  );
});
