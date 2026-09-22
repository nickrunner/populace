import { forwardRef } from "react";
import { cva } from "class-variance-authority";
import { Link as RouterLink } from "react-router-dom";

import { cn } from "../cn.js";
import { focusRing, pressTransition } from "../variants.js";
import { Chip, Inline, Mono, Text } from "../atoms/index.js";

/**
 * TargetStatus — ATOMIC-INVENTORY §3, organism 32. The block at the foot of the rail.
 *
 * It answers one question — *what is this project pointed at, and is anything happening to it* —
 * and it is a link to the screen that can change the answer.
 *
 * **The state is a word, never a hue alone** (§4.2). `stopped` and `running` would be a red pill
 * and a green one to most readers and the same pill to some; the `Chip` carries the word in both
 * cases, and `live` is the product's one sanctioned lime: a forest pill with paper ink and a 6px
 * lime dot at 7.97:1 (§5.4, appearance 2).
 *
 * **Reachability is not checked here, and must never be.** Asking whether the endpoint answers
 * opens a connection to somebody else's server; that is a POST the target screen makes when a
 * reader asks for it, never a timer in the shell. This block reports what is *configured*.
 */

/**
 * The whole block is the link, so it takes the control radius and the 90ms colour-only hover
 * (§5.1, §5.2) rather than `Link`'s underline — an underlined endpoint two lines long reads as
 * ruled-out text. The negative margin lets the hover ground reach the rail's own gutter without
 * the footer having to give up its padding.
 */
const block = cva(
  [
    "-mx-2 block rounded-sm px-2 py-2",
    "hover:bg-hover",
    pressTransition,
    focusRing,
  ].join(" "),
);

/**
 * What the shell knows about the target without asking it anything.
 *
 * There is no `TargetStatusView` in `@populace/contract` to import: the rail composes this from
 * the project overview (the kill switch, whether an execution is going) and the first stored
 * target (its name and its first endpoint). This is the shape of that composition, declared
 * where it is drawn.
 */
export interface TargetStatusView {
  /** The target's name, or null when the project has none yet. Ignored when `count > 1`. */
  name: string | null;
  /** The first MCP endpoint's URL, or null when there is no target. Ignored when `count > 1`. */
  endpoint: string | null;
  /**
   * How many targets the project has.
   *
   * A project may hold several — dev and qa are two targets, not two projects — and this block
   * used to render the first of them unconditionally. `listTargets` orders `updated_at DESC`, so
   * "the first" meant "whichever you edited last": the rail named one of two and changed its mind
   * when the other was touched. Above one it reports the count and names none of them, because
   * naming one of two is worse than naming neither.
   */
  count: number;
  /** Where the block goes: the target's own screen, or the list when there is no target. */
  to: string;
  /**
   * `stopped` — the kill switch is engaged. `running` — an execution is going right now.
   * `configured` — a target is set and nothing is going. `none` — no target yet.
   */
  state: "stopped" | "running" | "configured" | "none";
}

export interface TargetStatusProps {
  target: TargetStatusView;
}

export const TargetStatus = forwardRef<HTMLAnchorElement, TargetStatusProps>(
  function TargetStatus({ target }, ref) {
    return (
      <RouterLink ref={ref} to={target.to} className={cn(block())}>
        <Inline gap={2} align="center" className="mb-1">
          <Text size="label" tone="muted" truncate className="min-w-0 flex-1">
            {target.count > 1
              ? `${target.count} targets`
              : (target.name ?? "No target yet")}
          </Text>
          {target.state === "stopped" ? (
            <Chip tone="bad">Stopped</Chip>
          ) : target.state === "running" ? (
            <Chip tone="live">Running</Chip>
          ) : target.state === "configured" ? (
            <Chip>Configured</Chip>
          ) : null}
        </Inline>
        {/*
          `code-sm` is the system's smallest mono step and the floor §1.3 rule 6 sets; the
          endpoint breaks anywhere, because a URL is one word to CSS and four lines to a reader.
        */}
        {/*
          The endpoint, which is machine output and takes the mono step. With several targets
          there is no single endpoint to print, and the count above has already said so — a
          sentence in its place would be chrome explaining chrome.
        */}
        {target.count > 1 ? null : (
          <Mono size="code-sm" tone="muted" className="block break-all">
            {target.endpoint ?? "connect one to begin"}
          </Mono>
        )}
      </RouterLink>
    );
  },
);
