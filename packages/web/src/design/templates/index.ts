/**
 * The template layer — ATOMIC-INVENTORY §4. All 8, in the inventory's own order.
 *
 * A template owns layout, max-width, heading placement and the loading/error/empty slot, and
 * nothing else: no data fetching, no product nouns, no business logic. That is why the state
 * slots are `ReactNode` props rather than anything a template could fill for itself — the
 * screen knows what "nothing here yet" means on its own page, and the template only knows
 * where that sentence goes.
 *
 * **Two exports below are not numbered templates.** `SaveBar` is the sticky bar `FormPage`
 * mounts and `RouteAnnouncer` is the live region `AppShell` and `MarketingShell` mount; both are
 * published because
 * a screen that composes its own frame out of `DocumentPage` still needs them, and an
 * unexported one would be re-rolled the first time that happened.
 *
 * `PageStateSlots` and `pageStateSlot` are the shared state-slot protocol every page template
 * implements, so a screen writes `state="loading"` once and gets the same behaviour in all six.
 * `PAGE_FRAME` is the one spelling of the page gutter, which `AppShell` also uses so the rail's
 * own bars line up with the content beneath them. `LANDING_PANEL` is the same move for the
 * landing's 20px corner: `MarketingShell` owns `radius-lg` (§5.2, §1.3 rule 8) and the hero
 * panel, the diagram plates and the final CTA compose it, so `rounded-lg` is written once and
 * a 20px corner inside `/app` has nowhere to have been copied from. Both are exported for the
 * same reason and neither is a licence to write a fifth one.
 */

// 1 — AppShell
export { AppShell } from "./AppShell.js";
export type { AppShellProps } from "./AppShell.js";

// 2 — DocumentPage, and the state-slot protocol every page template shares.
export { DocumentPage, pageStateSlot, PAGE_FRAME } from "./DocumentPage.js";
export type { DocumentPageProps, PageStateSlots } from "./DocumentPage.js";

// 3 — InstrumentPage
export { InstrumentPage } from "./InstrumentPage.js";
export type { InstrumentPageProps } from "./InstrumentPage.js";

// 4 — SplitPage
export { SplitPage } from "./SplitPage.js";
export type { SplitPageProps } from "./SplitPage.js";

// 5 — FormPage, the pane it is made of, and the sticky bar that pane mounts.
export { FormPage } from "./FormPage.js";
export type { FormPageProps } from "./FormPage.js";
/**
 * `FormPane` is the form, the bar and the unsaved-changes guard without the page frame, so
 * `PersonaEditor` — `SplitPage` + `FormPage` in §5 — composes the same implementation the other
 * three editors get rather than re-rolling the guard inside a screen (§6.3 row 23).
 */
export { FormPane } from "./FormPane.js";
export type { FormPaneProps } from "./FormPane.js";
export { SaveBar } from "./SaveBar.js";
export type { SaveBarProps } from "./SaveBar.js";

/**
 * `ActionBar` is the other sticky foot, and the distinction is the point: `SaveBar` reports
 * whether an existing record has unsaved changes, `ActionBar` commits a thing that does not
 * exist yet and names that act in the product's own words. §5 row 5 and §6.3 row 16 both asked
 * for it; without it, `NewSimulation` was given the save bar and now says "Nothing changed yet"
 * and "Save changes" about creating a simulation.
 */
export { ActionBar } from "./ActionBar.js";
export type { ActionBarProps } from "./ActionBar.js";

// 6 — CenteredPage
export { CenteredPage } from "./CenteredPage.js";
export type { CenteredPageProps } from "./CenteredPage.js";

// 7 — WizardPanel
export { WizardPanel } from "./WizardPanel.js";
export type { WizardPanelProps, WizardStep } from "./WizardPanel.js";

// 8 — MarketingShell, and the one spelling of the 20px corner it owns.
export { MarketingShell, LANDING_PANEL } from "./MarketingShell.js";
export type { MarketingShellProps } from "./MarketingShell.js";

// The live region `AppShell` and `MarketingShell` mount, published for anything composing its
// own frame.
export { RouteAnnouncer } from "./RouteAnnouncer.js";
export type { RouteAnnouncerProps } from "./RouteAnnouncer.js";
