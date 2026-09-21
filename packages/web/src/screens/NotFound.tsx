import { Link as RouterLink, useLocation } from "react-router-dom";

import {
  AppShell,
  Button,
  CenteredPage,
  Code,
  ExplorationFan,
  PageHeader,
  Stack,
  StateBlock,
} from "../design/index.js";
import type { FanEnd } from "../design/index.js";

/**
 * NotFound — ATOMIC-INVENTORY §5 page 26, port plan row 5. The `*` catch-all.
 *
 * What it replaces is a bare `<Navigate to="/" replace />`: a mistyped address, a link to a
 * project somebody deleted, or a bookmark to a route that was renamed all silently became the
 * home page, which tells the reader nothing and quietly loses the address they came in on. This
 * screen says what happened, quotes the address the machine was handed, and offers one way back.
 *
 * **The whole page is the `gone` state**, so it goes through `CenteredPage`'s slot rather than
 * being a layout of its own: the template keeps the frame, the `<h1>` and the vertical rhythm
 * every other screen gets, and `StateBlock` writes the sentence in the one voice §4.7 gives the
 * product — serif, upright, `ink-soft`. There is no `children` branch to fall back to, which is
 * why the slot is handed the content and the body is `null`.
 *
 * **Railless `AppShell`.** There is no project here to build a rail from — `*` is reached from
 * outside one as often as inside — and the shell's own note says a frame with no navigation is
 * what a route outside a project wants. It is still the shell, so the skip link, the `<main>`
 * landmark, the route announcer and the theme toggle are all where they are on every other
 * screen; a 404 that loses the chrome is a second app.
 *
 * **The fan is the artwork, not a readout** (DESIGN-SYSTEM §5.4 appearance 5, amendment): the
 * mark's own nine endings, at `inline`, unanimated — §5.1 spends the one orchestrated motion on
 * the landing hero and nowhere else. At this size the fan names no ends, so `gaveUp` is
 * `ink-muted` and §4.1's "clay may never be anything at all inside `/app`" holds by construction.
 */

/**
 * The mark's nine: four filed, three finished their errand, two gave up — §9.3's hero split,
 * interleaved so the three outcomes do not read as three stacked blocks. This is the drawing the
 * brand ships, not a count of anything that happened; nobody has visited anything on this page.
 */
const ENDS: readonly FanEnd[] = [
  { outcome: "filed" },
  { outcome: "done" },
  { outcome: "filed" },
  { outcome: "gaveUp" },
  { outcome: "done" },
  { outcome: "filed" },
  { outcome: "done" },
  { outcome: "gaveUp" },
  { outcome: "filed" },
];

export function NotFound() {
  // Which address was asked for is routing, not data. Reading it changes no route.
  const { pathname } = useLocation();

  return (
    <AppShell>
      <CenteredPage
        header={<PageHeader title="Not found" />}
        state="gone"
        gone={
          <Stack gap={12} align="start">
            <StateBlock kind="gone" what="this address">
              <Stack gap={6} align="start">
                {/*
                  The machine's own words, quoted rather than paraphrased (§7.4): the address it
                  was handed, in mono on the evidence wash, inside the serif sentence.
                */}
                <div>
                  There is no page at <Code inProse>{pathname}</Code>. The address may have been
                  renamed, or the record it named has been deleted.
                </div>

                {/* The way back. One act, named in the product's own words. */}
                <Button asChild variant="primary">
                  <RouterLink to="/projects">Go to your projects</RouterLink>
                </Button>
              </Stack>
            </StateBlock>

            <ExplorationFan ends={ENDS} size="inline" />
          </Stack>
        }
      >
        {null}
      </CenteredPage>
    </AppShell>
  );
}
