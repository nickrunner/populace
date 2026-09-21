/**
 * The Populace design system — one barrel (ATOMIC-INVENTORY §0.1).
 *
 * Screens import from `../design/index.js` and nowhere else. That is the whole point of this
 * file: a component that later moves between layers — an organism that turns out to be a
 * molecule, a molecule promoted to an atom — costs one line here rather than an edit at every
 * call site. It also means a screen never reaches past the system into a component's module and
 * helps itself to a class string, which is how a design system quietly stops being one.
 *
 * What a screen gets, in the order the inventory lists it:
 *
 *   cn                 the one class-merging helper
 *   variants           the four shared CVA fragments, for a screen-local composition
 *   tokens             the typed unions — Tone, SeverityLevel, VerdictValue, StateKind, …
 *   brand              the mark grammar: Dot, Ring, Capsule, Lattice, Fan
 *   atoms              33
 *   molecules          34
 *   organisms          33, the shell four included
 *   templates          8
 *
 * **What is deliberately absent.** The CVA factories behind the components — `textStyles`,
 * `button`, `navItem` and the rest — are not re-exported, exactly as the layer barrels do not
 * export them. A component's class string is not a public interface; `asChild` is the sanctioned
 * way for a `<Link>` to stand in for a button, a chip, a row or a card (§0.2), and an exported
 * class string is the thing that stops that from being true. The `VariantProps` *types* are
 * published, because a type describes the API rather than offering a second way to spell it.
 */

// The one class-merging helper.
export { cn } from "./cn.js";

// The shared CVA fragments. `focusRing` is the single focus treatment in the system: every
// focusable component applies it and nothing rolls its own.
export { focusRing, pressTransition, stateTransition, control, rowBase, surfaceBase } from "./variants.js";
export type { ControlVariants, RowVariants, SurfaceVariants } from "./variants.js";

// The typed token mirrors. Values-free: every value lives in theme.css, where the cascade can
// flip it between themes.
export type {
  Tone,
  SeverityLevel,
  VerdictValue,
  ControlSize,
  Density,
  PersonDotState,
  StateKind,
  ScreenClass,
} from "./tokens.js";

// The mark grammar — Dot, Ring, Capsule, Lattice, Fan, and the drawing protocol they share.
export * from "./brand/index.js";

// The four layers.
export * from "./atoms/index.js";
export * from "./molecules/index.js";
export * from "./organisms/index.js";
export * from "./templates/index.js";

/**
 * Organism 32 — the shell. `Sidebar`, `ProjectSwitcher`, `SpendMeter` and `TargetStatus` are the
 * one part of the organism layer that `organisms/index.js` leaves out, because they land with
 * `AppShell` rather than with the rest of §3. They are published here for the same reason
 * `SaveBar` and `RouteAnnouncer` are: a screen composing its own frame needs them, and an
 * unexported rail would be re-rolled the first time that happened.
 */
export { Sidebar } from "./organisms/Sidebar.js";
// `RailTarget` travels with `SidebarProps`: it IS the type of `target`, so a screen that builds
// the rail's target from its own query — which is the whole point of the rail taking props
// rather than fetching — cannot name what it is building without it.
export type { SidebarProps, RailTarget } from "./organisms/Sidebar.js";
export { ProjectSwitcher } from "./organisms/ProjectSwitcher.js";
export type { ProjectSwitcherProps } from "./organisms/ProjectSwitcher.js";
export { SpendMeter } from "./organisms/SpendMeter.js";
export type { SpendMeterProps } from "./organisms/SpendMeter.js";
export { TargetStatus } from "./organisms/TargetStatus.js";
export type { TargetStatusProps, TargetStatusView } from "./organisms/TargetStatus.js";
