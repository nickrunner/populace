import { cva } from "class-variance-authority";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../cn.js";

/**
 * Code — a quotation of the machine, inline, with its ground.
 *
 * §4.3's last bullet: `t-code-inline`, `evidence` on `evidence-wash`, `px-1`, **square**, no
 * border. Square because machine output is data and data has no radius (§5.2); no border because
 * the wash already draws the seam and a border here would compete with the payload well's 2px
 * `evidence` left edge, which is the only content border the system spends.
 *
 * `inProse` is the line-box switch, not a style switch. Inside a serif paragraph the mono step
 * is `t-code-inline`, whose 24px leading is pinned to `t-read`'s so a tool name never opens the
 * paragraph's line box; `.t-read-sm .t-code-inline` drops it to 12/20 from the stylesheet, so a
 * sentence in a dense row needs nothing extra here (§3.4). In chrome the step is `t-code`.
 */
const codeStyles = cva("bg-evidence-wash text-evidence rounded-none px-1", {
  variants: {
    inProse: {
      true: "t-code-inline",
      false: "t-code",
    },
  },
  defaultVariants: { inProse: false },
});

export interface CodeProps {
  /** True when this sits inside a serif sentence. Default false — chrome. */
  inProse?: boolean;
  children: ReactNode;
  className?: string;
}

export const Code = forwardRef<HTMLElement, CodeProps>(function Code(
  { inProse = false, children, className },
  ref,
) {
  return (
    <code ref={ref} className={cn(codeStyles({ inProse }), className)}>
      {children}
    </code>
  );
});
