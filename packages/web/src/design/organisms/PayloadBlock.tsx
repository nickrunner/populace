import { forwardRef, useState } from "react";
import { JsonValueSchema } from "@populace/contract";

import { cn } from "../cn.js";
import { surfaceBase } from "../variants.js";
import { Badge, Inline, Link, ScrollArea, Text } from "../atoms/index.js";
// The molecule itself, not the barrel: `StateBlock` renders its failure through this organism
// (§4.3 has one well, not three), and going through `molecules/index.js` would make that import a
// module cycle. `CopyButton` depends on nothing above an atom.
import { CopyButton } from "../molecules/CopyButton.js";

/**
 * PayloadBlock — the payload half of the evidence seam (DESIGN-SYSTEM §4.3).
 *
 * This is what the target app actually said, quoted. The seam recognises it by three things at
 * once — its **face** (IBM Plex Mono, `t-code-sm`), its **position** (a recessed `sunk` well with
 * the system's only 2px content border, in `evidence`, on the left) and its **ink**. The well is
 * **square** (§5.2: radius 0 is the data kind), because a quotation of a machine is a record and
 * a record has no corner radius. `surfaceBase({ level: "well" })` owns all of that, which is why
 * nothing here writes a ground, a border or a radius of its own.
 *
 * **Nothing is ever cut.** The screen this replaces truncates every payload at 600 characters
 * with `slice(0, 600)` — silently, with no affordance, in the one place in the product where the
 * bytes are the evidence. Here a long payload **collapses** to `maxLines` with a
 * `Show all N lines` control, and the full text is always one press away and always on the
 * clipboard. Losing evidence to a layout constraint is the failure this component exists to fix.
 *
 * **It wraps rather than stretching the page.** `whitespace-pre-wrap` plus `break-words` means a
 * 4,000-character single-line JSON body reflows inside its column instead of giving the page a
 * horizontal scrollbar, and `tab-size: 2` keeps an already-indented payload from marching off to
 * the right. Expanded, the well is a `ScrollArea`, so a 300-line body is bounded and scrollable
 * with a thumb drawn in our own tokens rather than pushing the rest of the screen below the fold.
 *
 * **Pretty-printing is the organism's job, not the caller's** — the inventory is explicit. A
 * caller hands over whatever string it has: `JSON.stringify(call.arguments)` straight off the
 * record, or the raw `result.text` the model saw. If it parses as JSON it is re-emitted at
 * 2-space indent; if it does not, it is printed verbatim, because a target's plain-text error is
 * evidence too and mangling it would be a lie about what came back.
 *
 * **An error is a word, never a colour** (§4.2). `error` is set in a `Badge` beside the caption
 * *and* the well's left edge moves from `evidence` to `critical`. Either channel alone would fail
 * a greyscale render or a screen reader; together they say the same thing twice.
 *
 * **The body is inked `evidence`, like every other machine utterance** (§4.3, §4.7's table). This
 * is the most-seen machine-output surface in the product, so it is the last place the seam may be
 * dropped: an `ink-soft` payload reads as the product paraphrasing the target instead of quoting
 * it, and it would be the one well in the system not wearing the seam's colour. `Mono`'s default
 * ink is the same value, which is what makes `StateBlock`'s quoted failure and this well identical
 * rather than merely similar.
 *
 * **It is the system's one well.** §4.3 specifies a single recessed, square, 2px-`evidence`-edged
 * quotation, so `ToolCallBlock` and `StateBlock` both render theirs through this component rather
 * than spelling a third and fourth version of it.
 */

/** §4.3's default fold. Above this the well collapses and offers the rest. */
const DEFAULT_MAX_LINES = 24;

/**
 * JSON in, JSON at 2-space out; anything else verbatim.
 *
 * `JSON.parse` is typed `any`, which ADR-0001 forbids, so the result goes straight into zod at
 * the boundary and comes back as `JsonValue` — the same discipline every other JSON crossing in
 * this repo uses. Passing `any` into a parameter typed `unknown` is the one direction the lint
 * allows, so no disable comment is needed and no `any` ever names a variable here.
 */
function prettyPrint(raw: string): string {
  const trimmed = raw.trim();
  // Cheap gate first: most payloads that reach this component are a target's prose or an error
  // string, and running them through JSON.parse only to catch would be the common path.
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return raw;
  try {
    const parsed = JsonValueSchema.safeParse(JSON.parse(trimmed));
    return parsed.success ? JSON.stringify(parsed.data, null, 2) : raw;
  } catch {
    // Not JSON after all — a truncated body, a log line that opens with a brace. Print what came
    // back, exactly as it came back.
    return raw;
  }
}

export interface PayloadBlockProps {
  /** `WHAT THEY SENT` / `WHAT CAME BACK`. Written sentence case; `t-label` sets the caps. */
  caption: string;
  /** The machine's own words. Pretty-printed here, never by the caller, and never truncated. */
  value: string;
  /** The target returned an error: the word `error`, plus a 2px `critical` left edge. */
  error?: boolean;
  /** Lines shown before the well folds. Default 24. */
  maxLines?: number;
  /** A `Copy` control in the well's top-right corner. Default true. */
  copyable?: boolean;
}

export const PayloadBlock = forwardRef<HTMLElement, PayloadBlockProps>(function PayloadBlock(
  { caption, value, error = false, maxLines = DEFAULT_MAX_LINES, copyable = true },
  ref,
) {
  const [expanded, setExpanded] = useState(false);

  const pretty = prettyPrint(value);
  const lines = pretty.split("\n");
  // A caller passing 0 would fold the well to nothing and hide the affordance's own subject.
  const fold = Math.max(1, maxLines);
  const overflows = lines.length > fold;
  const shown = overflows && !expanded ? lines.slice(0, fold).join("\n") : pretty;

  const body = (
    <pre
      className={cn(
        "t-code-sm text-evidence",
        "m-0 whitespace-pre-wrap break-words [tab-size:2]",
        // Room for the copy control, which sits over the well's top-right corner.
        copyable ? "pr-7" : "",
      )}
    >
      {shown}
    </pre>
  );

  return (
    <figure ref={ref} className="group m-0 flex flex-col gap-1.5">
      <Inline gap={2} align="baseline">
        <Text as="figcaption" size="label" tone="muted">
          {caption}
        </Text>
        {error ? <Badge variant="bad">error</Badge> : null}
      </Inline>

      <div
        className={cn(
          surfaceBase({ level: "well" }),
          "relative p-3",
          // The left edge changes hue with the word, never instead of it (§4.2).
          error ? "border-l-critical" : "",
        )}
      >
        {copyable ? (
          <div
            className={cn(
              "absolute right-1 top-1",
              // Present to a screen reader at all times; drawn when the reader is near it.
              "opacity-0 focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
              "transition-opacity [transition-duration:var(--dur-press)] [transition-timing-function:var(--ease)]",
            )}
          >
            <CopyButton text={pretty} label={`Copy ${caption.toLowerCase()}`} />
          </div>
        ) : null}

        {/*
          Bounded only once it is expanded. Collapsed, the well is `fold` lines tall by
          construction and a scroll region there would be a scrollbar over nothing; expanded, it
          may be 300 lines and the page must not grow by all of them.
        */}
        {expanded && overflows ? <ScrollArea maxHeight="60vh">{body}</ScrollArea> : body}
      </div>

      {overflows ? (
        // The control names the size of what it is hiding, because "Show more" tells a reader
        // nothing about whether the rest is two lines or two hundred. The label itself carries
        // the state in both directions — "Show all 312 lines" / "Show fewer lines" — which is
        // what reaches a screen reader, since `Link` takes no ARIA props of its own.
        <Link
          size="meta"
          tone="quiet"
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          {expanded ? "Show fewer lines" : `Show all ${lines.length} lines`}
        </Link>
      ) : null}
    </figure>
  );
});
