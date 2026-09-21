import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * RouteAnnouncer — the half of a route change a screen reader can hear.
 *
 * A single-page app moves the reader without reloading the document, so nothing is announced and
 * nothing is said about where they now are: React Router moves neither focus nor the reading
 * position (DESIGN-SYSTEM §6, "Keyboard operation"). `AppShell` moves focus to `<main>`; this
 * names the screen that focus landed in.
 *
 * **What it announces is the screen's own `<h1>`**, because `PageHeader` owns exactly one of them
 * per screen and it is the sentence the product itself chose for that page. `document.title` is
 * the fallback, for the moment between a navigation and the header mounting — a screen still
 * fetching has no heading yet, and "Populace" is a truer answer there than silence.
 *
 * **It is polite, never assertive.** An arriving page is not an interruption; it is the thing
 * that was asked for. `aria-live="polite"` waits for the reader to finish whatever they were
 * hearing, which is the behaviour a navigation should have.
 *
 * **It does not announce the first paint.** The browser already reads a document it has just
 * loaded, and announcing over that is a stutter, not a courtesy.
 *
 * Nothing here is drawn. The region carries no visual weight at all, and it must stay in the DOM
 * from the first render — a live region added at the same moment as its text is not announced by
 * most screen readers, which is why this is one node whose *content* changes rather than a node
 * that appears.
 */

export interface RouteAnnouncerProps {
  /** The id of the landmark whose `<h1>` names the screen. The shell's `<main>`. */
  mainId?: string;
}

export function RouteAnnouncer({ mainId = "main" }: RouteAnnouncerProps) {
  const { pathname } = useLocation();
  const [message, setMessage] = useState("");
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }

    // One frame after the navigation, so the screen that replaced the old one has mounted and
    // its heading exists to be read. A `setState` in a rAF is also what keeps the live region's
    // content changing *after* it is already in the DOM, which is the condition for it to be
    // announced at all.
    const frame = window.requestAnimationFrame(() => {
      const heading = document.getElementById(mainId)?.querySelector("h1");
      const named = heading?.textContent?.trim();
      setMessage(named !== undefined && named !== "" ? named : document.title);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [pathname, mainId]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
