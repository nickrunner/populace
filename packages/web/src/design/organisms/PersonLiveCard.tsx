import { forwardRef } from "react";

import { cn } from "../cn.js";
import { Dot } from "../brand/index.js";
import { Avatar, Chip, Inline, Text } from "../atoms/index.js";
import { RelativeTime, ToolName } from "../molecules/index.js";
import { surfaceBase } from "../variants.js";

/**
 * PersonLiveCard — one person in a running execution, right now (DESIGN-SYSTEM §5.4, §6).
 *
 * The cell of the live grid. Four things can be true of somebody while an execution is running,
 * and each of them is **a word before it is anything else** (§1.3 rule 4): they are away between
 * visits, they are here, they are thinking, or they are calling one of the target's tools. The
 * forest `Chip` says which — forest ground, paper ink, in both themes — and the avatar's
 * `active` outline repeats it in a second channel for anyone scanning the grid rather than
 * reading it.
 *
 * **The tool name sits outside the pill.** §3.1's second exception makes text inside a chip sans
 * whatever it says, and a tool is machine speech that must stay mono and `evidence` (§4.3). So
 * the pill says "Calling" in the chrome's own voice and `ToolName` says `search_tasks` in the
 * target's, on the line beneath, which is the evidence seam doing its job at cell size.
 *
 * **Lime.** §5.4 fixes which element earns the one lime on each screen, and on the live screen
 * it is *the person who most recently filed* — this card's `theOne`. That is why the live pills
 * here carry no lime dot of their own: the run-status chip owns the screen's live dot, twelve
 * lime dots in a grid would blow the 24×24px lime budget (§1.2 M5), and the one dot that means
 * something would stop being the one. `theOne`'s dot is the mark's own lime circle, ink-ringed
 * in light and a lime ring in dark, and it is **accompanied by its word**, never colour alone.
 *
 * Nothing here animates and nothing here counts up (§5.1): the live grid re-polls every two
 * seconds, and a pulsing dot per person or a transitioning card would strobe the whole screen.
 * `RelativeTime` ticks, which is a re-render of a phrase, not an animation of a number.
 */

/** What somebody can be doing while an execution runs. Each is a word on the card. */
export type PersonLiveState = "away" | "here" | "thinking" | "calling";

/** The word, in the product's own vocabulary — never an internal one (§7.2). */
const LIVE_WORDS: Record<PersonLiveState, string> = {
  away: "Away",
  here: "Here",
  thinking: "Thinking",
  calling: "Calling",
};

export interface PersonLiveCardProps {
  /** Their stored name (§7.4). */
  name: string;
  cohort: string;
  state: PersonLiveState;
  /** The target tool they are calling, when they are calling one. */
  tool?: string;
  /** When they are next due back, for anybody who is away. ISO-8601. */
  nextAt?: string;
  /** The one person the screen is pointing at: the most recent to file (§5.4). */
  theOne?: boolean;
}

export const PersonLiveCard = forwardRef<HTMLDivElement, PersonLiveCardProps>(
  function PersonLiveCard({ name, cohort, state, tool, nextAt, theOne = false }, ref) {
    const here = state !== "away";

    return (
      <div
        ref={ref}
        className={cn(surfaceBase({ level: "card" }), "flex w-full min-w-0 flex-col gap-2 p-3.5")}
      >
        <Inline gap={2} align="center" className="min-w-0">
          {/* The avatar is already labelled with the name the line beside it prints; hiding it
              stops a reader hearing the same person twice. */}
          <span aria-hidden="true" className="contents">
            <Avatar name={name} size="sm" active={here} />
          </span>

          <span className="min-w-0 flex-1">
            <Text size="name" truncate>
              {name}
            </Text>
            <Text size="meta" tone="muted" truncate>
              {cohort}
            </Text>
          </span>

          {theOne ? (
            <Inline gap={1} align="center" className="shrink-0">
              <Dot state="theOne" size="sm" />
              <Text size="meta" tone="muted">
                latest finding
              </Text>
            </Inline>
          ) : null}
        </Inline>

        <Inline gap={2} align="center" wrap className="min-w-0">
          {here ? (
            <Chip tone="live">{LIVE_WORDS[state]}</Chip>
          ) : (
            <Text size="meta" tone="muted">
              {LIVE_WORDS.away}
            </Text>
          )}

          {state === "calling" && tool !== undefined ? <ToolName name={tool} /> : null}

          {!here && nextAt !== undefined ? (
            <Text size="meta" tone="muted">
              Next visit <RelativeTime at={nextAt} mode="countdown" tick />
            </Text>
          ) : null}
        </Inline>
      </div>
    );
  },
);
