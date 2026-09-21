import { forwardRef } from "react";

import { Logo, type LogoProps } from "./Logo.js";

/**
 * Wordmark — the lettering alone, for the surface that has the product's name to say and no room
 * to say it twice.
 *
 * It is the quietest of the three lockups and the one to reach for least often: where there is
 * room for a lockup at all there is usually room for the full horizontal logo, which is the one
 * the kit builds every other rule around. The wordmark earns its place beside artwork that is
 * *already* the mark — a mark sitting in a rail's corner, an app icon on a card, the exploration
 * pattern — where a second copy of the glyph would be the same shape said twice.
 *
 * The lettering is outlined Space Grotesk Bold, so it is paths with no font dependency: it is
 * correct with the webfont, without it, and offline. Its canvas is **535:136**.
 *
 * It has no lime spark, so its light-ground cut and its lime-ground cut are the same file; only
 * dark grounds take a different one, and `on` still decides which.
 */

export type WordmarkProps = Omit<LogoProps, "variant">;

export const Wordmark = forwardRef<HTMLSpanElement, WordmarkProps>(function Wordmark(props, ref) {
  return <Logo ref={ref} variant="wordmark" {...props} />;
});
