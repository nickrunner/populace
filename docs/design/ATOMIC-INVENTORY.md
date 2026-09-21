# The Populace atomic inventory

Companion to `DESIGN-SYSTEM.md`. That document is the law; this one is the parts list and the
order to build them in.

**Counts:** 33 atoms · 34 molecules · 33 organisms · 8 templates · 26 pages.

---

## 0. CONVENTIONS

### 0.1 Where things live

```
packages/web/src/design/
  tokens.ts          # typed mirrors of the token names (Tone, SeverityLevel, …). No values.
  cn.ts              # the one class-merging helper
  variants.ts        # shared CVA fragments: focusRing, control, rowBase, surfaceBase
  atoms/             # 33 files + index.ts
  molecules/         # 35 files + index.ts
  organisms/         # 35 files + index.ts
  templates/         # 8 files + index.ts
  brand/             # the mark-grammar SVG primitives: Dot, Ring, Capsule, Lattice, Fan
  index.ts           # one barrel. Screens import from "../design/index.js" and nowhere else.
```

`packages/web/src/components/ui.tsx` is deleted at the end of the port. Nothing new imports from
it. Screens import from the single barrel so a later move of a component between layers is not a
346-site edit.

### 0.2 House rules for every component

- **No `any`, no `unknown`** (ADR-0001). Props are exact unions and `React.ReactNode`. Where a
  component accepts a record view it imports the type from `@populace/contract` rather than
  restating it.
- **`@populace/contract` is the ONLY place a component imports a record shape from.** Nothing
  under `design/` imports from `@populace/core/isomorphic`, even for a type the contract merely
  re-exports. That is what makes the boundary real: ADR-0032's rule is that translation happens
  in one package, and a component that reaches past it into the core domain has moved the seam
  into the component. **AMENDED:** this document previously named six view types that do not
  exist — `ToolCallView`, `ReproductionStepView`, `VerificationView`, `ExecutionSummaryView`,
  `ExecutionCompareSideView` and `TargetStatusView`. Five of the six were invented names for
  records that already cross the wire under their own: `ToolCallRecord`, `Verification`,
  `TraceEvent`, `JsonValue` and `ExecutionHistoryEntry`. They have **no second vocabulary** — a
  tool call is a tool call on both sides, and `ToolCallRecord.ref` is the `[c3]` a person typed
  into `evidence_calls` and the `[c3]` a reader clicks — so `@populace/contract` re-exports them
  (`views.ts`, "the records the browser reads verbatim") rather than restating eight fields under
  a second name. The sixth, `TargetStatusView`, is not a wire shape at all and is declared by
  `TargetStatus.tsx`. The signatures below have been corrected to the types that exist.
- **CVA for variants, `cn()` for merging.** No hand-written `Record<variant, string>` lookups —
  the app has 29 of them today.
- **Every variant is written against a token.** No hex, no `text-white`, no `/30` alpha over a
  hard-coded ground. `primary` and `accent` swap identities between themes.
- **Every focusable atom applies `focusRing`** from `variants.ts`. No component rolls its own.
- **`asChild` via `@radix-ui/react-slot`** on every atom a `<Link>` may stand in for — `Button`,
  `IconButton`, `Chip`, `ListRow`, `Card`. This is what stops `SimulationActions` copying
  `Button`'s class string verbatim, as it does today.
- **No component branches on theme in TypeScript.** Elevation, shadow and the lime treatment are
  composite tokens that flip in CSS.
- **No component prints `event.type`, a raw id, `agentId`, `runId` or a persona slug** where a
  person has a name. Kind → human noun is a lookup in `format.ts`.
- **Ref forwarding** on every atom that wraps a DOM node, because Radix needs it.

### 0.3 Shared types (`design/tokens.ts`)

```ts
export type Tone = "neutral" | "good" | "bad" | "warn" | "live" | "selected";
export type SeverityLevel = "critical" | "high" | "medium" | "low";
export type VerdictValue = "confirmed" | "not-reproduced" | "inconclusive" | "unchecked";
export type ControlSize = "sm" | "md" | "lg";
export type Density = "default" | "tight";
export type PersonDotState = "present" | "absent" | "left" | "theOne" | "provisional" | "selected";
export type StateKind = "loading" | "empty" | "failed" | "gone";
export type ScreenClass = "document" | "instrument";
```

---

## 1. ATOMS — `packages/web/src/design/atoms/`

The irreducible ones. Nothing here knows about a finding, a cohort or an execution.

| # | Atom | File | Radix | Replaces | Sites |
|---|---|---|---|---|---|
| 1 | `Text` | `Text.tsx` | — | ~250 inline `t-* text-*` strings | ~250 |
| 2 | `Heading` | `Heading.tsx` | — | hand-rolled `<h1>`/`<h2>`/`<h3>` | 40 |
| 3 | `Mono` | `Mono.tsx` | — | `Mono` | 23 |
| 4 | `Code` | `Code.tsx` | — | `<code className="font-mono text-[12.5px]">` | 12 |
| 5 | `Kbd` | `Kbd.tsx` | — | — (new) | 6 |
| 6 | `Button` | `Button.tsx` | `Slot` | `Button` | 45 |
| 7 | `IconButton` | `IconButton.tsx` | `Slot` + `Tooltip` | `Stepper`'s −/+, copy affordances | 18 |
| 8 | `Link` | `Link.tsx` | `Slot` | `text-accent hover:underline` ×4 spellings | 34 |
| 9 | `Input` | `Input.tsx` | — | `Input` | 31 |
| 10 | `NumberInput` | `NumberInput.tsx` | — | `NumberInput` | 11 |
| 11 | `TextArea` | `TextArea.tsx` | — | `TextArea` | 4 |
| 12 | `Select` | `Select.tsx` | `react-select` | `Select` + `Executions.Pick` | 12 |
| 13 | `Checkbox` | `Checkbox.tsx` | `react-checkbox` | raw `<input type=checkbox>` | 3 |
| 14 | `Radio` / `RadioGroup` | `Radio.tsx` | `react-radio-group` | raw `<input type=radio>` ×2, 4 button-cards | 6 |
| 15 | `Switch` | `Switch.tsx` | `react-switch` | — (new; the kill switch) | 2 |
| 16 | `Slider` | `Slider.tsx` | `react-slider` | `<input type=range accent-[var(…)]>` | 2 |
| 17 | `Label` | `Label.tsx` | `react-label` | `"t-label text-ink-muted block mb-1.5"` ×8 | 47 |
| 18 | `Badge` | `Badge.tsx` | — | part of `Chip` | 40 |
| 19 | `Chip` | `Chip.tsx` | `Slot` | `Chip` | 22 |
| 20 | `Avatar` | `Avatar.tsx` | `react-avatar` | `Avatar` | 9 |
| 21 | `Icon` | `Icon.tsx` | — | — (new; 8 utility glyphs) | 60 |
| 22 | `Separator` | `Separator.tsx` | `react-separator` | `border-t/b border-rule` | 32 |
| 23 | `Spacer` | `Spacer.tsx` | — | `<span className="flex-1" />` | 19 |
| 24 | `Stack` | `Stack.tsx` | — | `flex flex-col gap-*` | ~35 |
| 25 | `Inline` | `Inline.tsx` | — | `flex items-baseline gap-*` | ~40 |
| 26 | `Measure` | `Measure.tsx` | — | `max-w-[68ch]` ×12 + 4 other ch values | 19 |
| 27 | `Meter` | `Meter.tsx` | — | `Bar` | 7 |
| 28 | `Spinner` | `Spinner.tsx` | — | — (new; three lattice dots, no arc) | 10 |
| 29 | `Skeleton` | `Skeleton.tsx` | — | — (new; the app has none) | ~40 |
| 30 | `Tooltip` | `Tooltip.tsx` | `react-tooltip` | `title=` attributes | 14 |
| 31 | `VisuallyHidden` | `VisuallyHidden.tsx` | `react-visually-hidden` | — (new) | 25 |
| 32 | `SkipLink` | `SkipLink.tsx` | — | — (new) | 1 |
| 33 | `ScrollArea` | `ScrollArea.tsx` | `react-scroll-area` | `overflow-y-auto` ×4 | 6 |

### Signatures

```ts
// 1 — Text. The single largest collapse available: t-meta text-ink-muted alone is 140 sites.
export type TextSize =
  | "statement" | "lede" | "finding" | "read" | "read-sm" | "voice"   // serif
  | "figure" | "figure-sm" | "name" | "ui" | "eyebrow" | "meta" | "label"; // sans
export type TextTone = "ink" | "soft" | "muted" | "primary" | "evidence"
  | "critical" | "high" | "medium" | "low" | "confirmed" | "on-primary" | "on-accent";
export interface TextProps {
  size?: TextSize;                    // default "ui"
  tone?: TextTone;                    // default "ink"
  as?: "span" | "p" | "div" | "dd" | "dt" | "li" | "figcaption";
  marked?: boolean;                   // the lime marker band. ONE per screen — §5.4.
  truncate?: boolean;
  className?: string;
  id?: string;
  children: React.ReactNode;
}
// The family follows from `size`; a caller cannot put a sans size in a serif family.
// `marked` renders the band in light and the 2px underrule in dark, from one prop.

// 2 — Heading. Owns heading order so screens stop hand-rolling <h1>.
export interface HeadingProps {
  level: 1 | 2 | 3;
  size?: TextSize;                    // defaults: 1→"title" (sans), 2→"eyebrow", 3→"name"
  tone?: TextTone;
  id?: string;
  className?: string;
  children: React.ReactNode;
}

// 3 — Mono
export interface MonoProps {
  size?: "code" | "code-inline" | "code-sm" | "ref";   // default "code"
  tone?: TextTone;                                     // default "evidence"
  className?: string;
  children: React.ReactNode;
}

// 4 — Code: inline machine speech inside prose. Square, no border, evidence wash.
export interface CodeProps { inProse?: boolean; children: React.ReactNode; className?: string }

// 5 — Kbd: sans (a key is a named control, not machine output), 2px bottom border.
export interface KbdProps { children: React.ReactNode }

// 6 — Button
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "link";
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;            // default "secondary"
  size?: ControlSize;                 // sm 24px / md 32px / lg 40px. default "md"
  asChild?: boolean;
  pending?: boolean;                  // renders Spinner in place of the label, keeps width
  atBound?: boolean;                  // AMENDED: aria-disabled, keeps the tab stop and the
                                      // tooltip, swallows the press. NEVER the disabled attribute
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
}
// primary: bg-primary/text-on-primary — forest+paper in light, lime+ink in dark. Never text-white.
// danger replaces tone="stop" and is never a filled red button; destructive actions go via Dialog.
// `disabled` on a button that needs explaining uses aria-disabled + a Tooltip instead.
// AMENDED (port review, S5.32). That last line was a convention and not a prop, so the two
// screens that gate SPENDING REAL MONEY behind a list of blockers used the `disabled` attribute
// and lost both halves of what §6 asks: the tooltip could not open and the control left the tab
// order, with the blockers far up the page and associated with nothing. `atBound` is that state
// as a prop: it wears `aria-disabled`, restates the inert ink against the `aria-disabled:`
// variant for all five shells (the `disabled:` classes never match an aria-disabled button), and
// swallows the press in the handler so the target keeps its pointer events. Pair it with a
// `Tooltip` and an `aria-describedby` naming the reason. `IconButton` keeps its own local
// spelling of the same behaviour for now; the two agree and neither is a hand-rolled class string.

// 7 — IconButton. aria-label and tooltip are REQUIRED, not optional.
export interface IconButtonProps extends Omit<ButtonProps, "children" | "variant"> {
  icon: IconName;
  label: string;                      // both the aria-label and the tooltip text
  variant?: "quiet" | "secondary" | "danger";
  disabled?: boolean;                 // drawn as aria-disabled, NEVER as the disabled attribute
}
// At a bound the button keeps its tab stop, its aria-label and its Tooltip, and swallows the
// press. A natively disabled button takes no pointer events and leaves the tab order, so it has
// neither of the two things §6 requires of an icon button — a glyph with no name is what is left.

// 8 — Link. Inherits the family of whatever it sits in: serif inside prose, sans inside chrome.
export interface LinkProps {
  to?: string;                        // react-router
  href?: string;                      // external; renders Icon "external" + VisuallyHidden note
  size?: Extract<TextSize, "read" | "read-sm" | "ui" | "meta">;
  tone?: "primary" | "quiet";
  asChild?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  children: React.ReactNode;
}
// Dark deviation (§7.3 of the design system): glyphs stay `ink`, the underline alone is lime,
// so a paragraph of dark serif is not threaded with full-strength lime.

// 9/10/11 — Input, NumberInput, TextArea
export interface InputProps {
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "password" | "url" | "email";
  placeholder?: string;
  mono?: boolean;                     // t-code, for URLs, endpoints, ids, globs
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
  autoComplete?: string;
  className?: string;
}
export interface NumberInputProps {
  value: number; onChange: (n: number) => void;
  min?: number; max?: number; step?: number;
  disabled?: boolean; id?: string; describedBy?: string; invalid?: boolean;
}
export interface TextAreaProps extends Omit<InputProps, "type" | "mono"> { rows?: number }

// 12 — Select (Radix). Keeps the {value,label}[] shape so the 11 call sites do not move.
export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  size?: "sm" | "md";
  disabled?: boolean; id?: string; describedBy?: string; invalid?: boolean;
  "aria-label"?: string;
}

// 13 — Checkbox (Radix). Indicator is a check glyph, NOT a capsule: a mis-read checkbox here
// gates actions that spend money, and controls are the one place familiarity beats grammar.
export interface CheckboxProps {
  checked: boolean | "indeterminate";
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean; id?: string;
}

// 14 — Radio / RadioGroup (Radix). The dot IS the mark's dot at UI scale.
export interface RadioGroupProps {
  value: string;
  onChange: (v: string) => void;
  name: string;
  legend: string;                     // the group's name; always present, always announced
  legendHidden?: boolean;             // draws it for the screen reader alone — set it EXACTLY
                                      // when a visible caption immediately above the group
                                      // already carries the same words (a Field's label, a
                                      // Section's eyebrow), and never otherwise. AMENDED (port
                                      // review, S6.42): this reads as two conventions across two
                                      // screens and is one rule — `Get started` draws its legend
                                      // because nothing above the group names the choice, `New
                                      // simulation` hides it because its Section does. The two
                                      // screens now also use the SAME WORDS for the same
                                      // decision — "How they visit" — because one decision has
                                      // one name (DESIGN-SYSTEM §7.1)
  orientation?: "vertical" | "horizontal";
  children: React.ReactNode;
}
export interface RadioProps { value: string; label: React.ReactNode; hint?: React.ReactNode; disabled?: boolean }

// 15 — Switch (Radix). Used for exactly one thing: the kill switch. Always paired with the word.
export interface SwitchProps {
  checked: boolean; onChange: (c: boolean) => void;
  label: string; onLabel: string; offLabel: string;
  tone?: "primary" | "danger"; disabled?: boolean; id?: string;
}

// 16 — Slider (Radix). Replaces the app's only arbitrary colour value.
export interface SliderProps {
  value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number;
  valueLabel: string;                 // the prose reading, e.g. "waits about a minute"
  id?: string; describedBy?: string;
  ariaLabel?: string;                 // the control's name, when the caller holds the string
  ariaLabelledBy?: string;            // the id of the element that names it
}
// Radix draws the thumb as <span role="slider">, and <label for> binds only labelable elements —
// so a Field wrapping a bare Slider captions NOTHING. The name arrives as ARIA, on the thumb
// (the element carrying role="slider"), never on the root. ScaleField passes ariaLabel={label}.

// 17 — Label (Radix)
export interface LabelProps { htmlFor: string; size?: "label" | "eyebrow"; children: React.ReactNode }

// 18 — Badge: a FACT about the row. Rectangular, square corners, t-label, no fill,
//      a 1px left border in the semantic colour. Reads as a tab on a file.
export type BadgeVariant = "severity" | "verdict" | "mode" | "kind" | "status" | "neutral" | "bad";
export interface BadgeProps {
  variant?: BadgeVariant;
  tone?: Tone | SeverityLevel | "confirmed" | "evidence";
  children: React.ReactNode;          // always a word. Never empty.
}

// 19 — Chip: a STATE you can sometimes act on. Stadium, full radius, t-meta, 1px border.
export interface ChipProps {
  tone?: Tone;                        // neutral | good | bad | warn | live | selected
  count?: number;                     // tabular, muted, after an 8px gap
  asChild?: boolean;
  onClick?: () => void;
  pressed?: boolean;                  // renders aria-pressed when interactive
  children: React.ReactNode;
}
// `live` is a FOREST pill with paper text and a 6px lime dot in BOTH themes (lime on forest
// 7.97:1) plus aria-live="polite". The badge/chip split is the geometry rule doing semantic
// work: square = data, stadium = state.

// 20 — Avatar (Radix). Initials only; nobody in a population has a photograph.
export interface AvatarProps { name: string; size?: "sm" | "md" | "lg"; active?: boolean }
// `active` (mid-visit) adds a 2px accent ring at outline-offset 2 — deliberately the same
// geometry as focusRing, so "someone is here" and "you are here" rhyme.

// 21 — Icon: eight utility glyphs, affordance only, never meaning.
export type IconName = "chevron-right" | "chevron-down" | "check" | "x"
  | "plus" | "minus" | "copy" | "external";
export interface IconProps { name: IconName; size?: 12 | 16 | 20; className?: string; title?: string }

// 22 — Separator (Radix). The vertical 12px variant IS the meta-line separator and
//      replaces the " · " middle dot on every screen.
export interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  weight?: "hair" | "provisional";    // provisional = dashed at the mark's own 2/7 rhythm
  decorative?: boolean;               // default true
  className?: string;
}

// 23/24/25 — layout atoms
export interface SpacerProps { axis?: "x" | "y" }
export interface StackProps { gap?: 1|2|3|4|6|8|12; align?: "start"|"center"|"stretch"; as?: "div"|"ul"|"ol"|"section"; className?: string; children: React.ReactNode }
export interface InlineProps { gap?: 1|2|3|4|6|8; align?: "baseline"|"center"|"start"|"end"; wrap?: boolean; className?: string; children: React.ReactNode }

// 26 — Measure
export interface MeasureProps { width?: "read" | "statement" | "lede" | "wide"; as?: "div"|"p"|"section"; children: React.ReactNode }

// 27 — Meter. role=progressbar with a real aria-valuetext. Width NEVER transitions.
export interface MeterProps {
  value: number; of: number;
  tone?: "measure" | "attention" | "spent" | "over";  // default "measure" (graph, not a highlight)
  label: string;                      // becomes aria-valuetext as a sentence
  size?: "sm" | "md";
}

// 28 — Spinner: three dots on the lattice pitch. No arc, no rotation, no lime.
export interface SpinnerProps { label: string; size?: "sm" | "md" }

// 29 — Skeleton: ruled, not shimmering. Built to the exact height of what it replaces.
export interface SkeletonProps {
  variant: "line" | "block" | "row" | "lattice";
  width?: "full" | "wide" | "half" | "short";
  height?: number;
  count?: number;
  label: string;                      // the role=status sentence: "Reading the transcript"
}

// 30 — Tooltip (Radix). Explains; never carries information available nowhere else.
export interface TooltipProps { content: React.ReactNode; side?: "top"|"right"|"bottom"|"left"; children: React.ReactElement }
export interface TooltipProviderProps { children: React.ReactNode }
// ONE provider per root, mounted by AppShell — skipDelayDuration is a property of a GROUP of
// triggers, so a provider per tooltip can never apply it and a toolbar of IconButtons re-serves
// the full 300ms delay on every hover. Tooltip wraps itself in one only as a crash guard when it
// finds no provider above it; a root that draws tooltips mounts its own.

// 31/32/33
export interface VisuallyHiddenProps { children: React.ReactNode }
export interface SkipLinkProps { targetId: string }   // renders first, z-index --z-skip
export interface ScrollAreaProps { maxHeight: string; focusable?: boolean; className?: string; children: React.ReactNode }
// focusable defaults to TRUE: a scroll container is focusable in Firefox and nowhere else, so
// without a tab stop a keyboard reader cannot scroll a 300-line payload at all. A roving-tabindex
// composite passes focusable={false} — it already IS the region's one tab stop (§6), and a
// focusable viewport around it would make two. TranscriptList does exactly that.
```

---

## 2. MOLECULES — `packages/web/src/design/molecules/`

Two or three atoms with one job. Still product-agnostic except where a name is a product noun.

| # | Molecule | File | Radix | Replaces | Sites |
|---|---|---|---|---|---|
| 1 | `Field` | `Field.tsx` | `Label` | `Field` (+ its hint-inside-label bug) | 47 |
| 2 | `FieldGrid` | `FieldGrid.tsx` | — | `grid grid-cols-2\|3 gap-4` | ~25 |
| 3 | `FieldError` | `FieldError.tsx` | — | `Problem` used inline | 12 |
| 4 | `FieldWarning` | `FieldWarning.tsx` | — | `"t-meta text-medium mt-1"` | 5 |
| 5 | `SecretField` | `SecretField.tsx` | — | the hand-rolled password + "stored" hint | 3 |
| 6 | `DurationField` | `DurationField.tsx` | — | seconds↔ms arithmetic, duplicated | 4 |
| 7 | `TagListField` | `TagListField.tsx` | — | `asList()`, duplicated verbatim ×2 | 6 |
| 8 | `ScaleField` | `ScaleField.tsx` | `Slider` | the range input + `PATIENCE` prose map | 2 |
| 9 | `Stepper` | `Stepper.tsx` | — | `Stepper` (fixes the sub-24px targets) | 3 |
| 10 | `SearchInput` | `SearchInput.tsx` | — | — (new) | 3 |
| 11 | `FilterChip` | `FilterChip.tsx` | `ToggleGroup` | part of `FilterChips` | 8 |
| 12 | `FilterChips` | `FilterChips.tsx` | `ToggleGroup` | `FilterChips` | 3 |
| 13 | `Stat` | `Stat.tsx` | — | `Stat` | 13 |
| 14 | `StatGroup` | `StatGroup.tsx` | — | 5 hand-rolled stat strips | 5 |
| 15 | `Breadcrumb` | `Breadcrumb.tsx` | — | `Breadcrumb` | 13 |
| 16 | `NavItem` | `NavItem.tsx` | — | `Sidebar.Item` | 18 |
| 17 | `NavGroup` | `NavGroup.tsx` | — | `Sidebar` group markup | 4 |
| 18 | `PersonLink` | `PersonLink.tsx` | — | `Avatar + name + link` ×3 | 9 |
| 19 | `NameWithRole` | `NameWithRole.tsx` | — | `name · role` ×3 | 6 |
| 20 | `SeverityStack` | `SeverityStack.tsx` | — | the colour-only severity word | 14 |
| 21 | `SeverityTag` | `SeverityTag.tsx` | — | `Severity` | 5 |
| 22 | `VerdictTag` | `VerdictTag.tsx` | — | `Verdict` | 3 |
| 23 | `CallRef` | `CallRef.tsx` | — | `CallRef` | 3 |
| 24 | `ToolName` | `ToolName.tsx` | — | `ToolName` | 12 |
| 25 | `MetaLine` | `MetaLine.tsx` | `Separator` | two divergent ` · ` implementations | ~30 |
| 26 | `MetaSentence` | `MetaSentence.tsx` | — | — (new; detail panes and ledes only) | 14 |
| 27 | `RelativeTime` | `RelativeTime.tsx` | — | `ago` / `when` / `elapsed` / `countdown` / `Saved` — four implementations | 22 |
| 28 | `Money` / `Duration` | `Numeric.tsx` | — | `usd` / `usd4` / `ms` / `lasted` call sites | 30 |
| 29 | `CopyButton` | `CopyButton.tsx` | `Tooltip` | — (new) | 7 |
| 30 | `ThemeToggle` | `ThemeToggle.tsx` | `ToggleGroup` | — (new) | 2 |
| 31 | `ConfirmButton` | `ConfirmButton.tsx` | `AlertDialog` | — (new; 4 destructive actions) | 4 |
| 32 | `StateBlock` | `StateBlock.tsx` | — | `Loading` 31 + `Failed` 34 + `Empty` 19 + `Gone` 5 | ~100 |
| 33 | `Disclosure` | `Disclosure.tsx` | `Collapsible` | 2 bare toggles with no aria | 5 |
| 34 | `Pagination` | `Pagination.tsx` | — | — (new; Visits, Executions) | 3 |
| 35 | `FactList` / `Fact` | `FactList.tsx` | — | **ADDED (port review, S5.37):** the hand-written `grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)]` on `Person` | 1 |

### Signatures

```ts
// 1 — Field. The hint moves OUT of the <label> and onto aria-describedby.
export interface FieldProps {
  label: string;
  hint?: React.ReactNode;
  error?: string;                      // role="alert", sets aria-invalid on the control
  warning?: React.ReactNode;           // non-fatal, `medium` tone, no aria-invalid
  optional?: boolean;
  htmlFor?: string;                    // generated with useId when absent
  children: (ids: { id: string; describedBy: string | undefined }) => React.ReactNode;
}

export interface FieldGridProps { cols: 2 | 3; align?: "start" | "end"; children: React.ReactNode }
export interface FieldErrorProps { id?: string; children: React.ReactNode }
// AMENDED (port review, S5.35). `id` is optional, and only for the case where no single control
// owns the failure — a row action any of twelve rows could have fired. An id exists to be pointed
// at; minting one and wiring it to no `aria-describedby` is wiring in the source and wiring
// nowhere. Where a control DOES own the failure it names the id, and `Field` still wires both ends.
export interface FieldWarningProps { children: React.ReactNode }

// 5 — SecretField. Blank means keep; the placeholder says so.
export interface SecretFieldProps {
  stored: boolean; value: string; onChange: (v: string) => void; label: string; hint?: string;
}

// 6 — DurationField. The unit is a suffix inside the control, not a parenthesis in the label.
export interface DurationFieldProps {
  valueMs: number; onChange: (ms: number) => void;
  unit: "s" | "ms" | "min"; label: string; hint?: string; min?: number; max?: number;
}

// 7 — TagListField. One implementation of asList(); Target and PersonaEditor share it.
export interface TagListFieldProps {
  value: readonly string[]; onChange: (v: string[]) => void;
  label: string; hint?: string; separator?: "comma" | "newline"; placeholder?: string;
}

// 8 — ScaleField
export interface ScaleFieldProps {
  value: number; onChange: (v: number) => void;
  min: number; max: number; label: string; describe: (v: number) => string;
}

// 9 — Stepper. 32px targets, not 20×24.
export interface StepperProps {
  value: number; onChange: (n: number) => void;
  min?: number; max?: number; label: string;
  id?: string; describedBy?: string;
}
// AMENDED (port review, S5.30). The root is a `role="group"` div, and HTML's `for` binds a label
// only to a LABELABLE element — so a `Field` wrapping a bare `Stepper` captioned nothing: its
// `htmlFor` pointed at an id that existed nowhere and its hint reached nothing at all, while the
// group's own `aria-label` repeated the caption a reader had already been given. `id` and
// `describedBy` are real props for exactly the reason `Slider` has them, and a caller inside a
// `Field` passes both plus the same string to `label` (see `ScaleField`, molecule 8).

// 11/12 — FilterChips (Radix ToggleGroup: roving tabindex + aria-pressed, which it lacks today)
export interface FilterOption<T extends string> { value: T; label: string; count?: number }
export interface FilterChipsProps<T extends string> {
  options: readonly FilterOption<T>[];
  value: T | "all";
  onChange: (v: T | "all") => void;
  allLabel: string; allCount?: number;
  legend: string;                      // VisuallyHidden group label
  trailing?: React.ReactNode;
}

// 13/14 — Stat and StatGroup
export interface StatProps { label: string; value: React.ReactNode; sub?: React.ReactNode; marked?: boolean }
export interface StatGroupProps { cols: 2 | 3 | 4 | 5; ruled?: boolean; children: React.ReactNode }
// cols is the DESKTOP count; the molecule owns the 5→3→2 wrap at lg and md.

// 15 — Breadcrumb. aria-label on the nav, aria-current="page" on the last crumb — both missing today.
export interface Crumb { label: string; to?: string }
export interface BreadcrumbProps { items: readonly Crumb[] }

// 16/17 — nav
export interface NavItemProps { to: string; label: string; count?: number; tone?: "default" | "live"; end?: boolean }
export interface NavGroupProps { label?: string; children: React.ReactNode }

// 18/19 — people
export interface PersonLinkProps { name: string; to: string; cohort?: string; size?: "sm" | "md"; active?: boolean }
export interface NameWithRoleProps { name: string; role: string; to?: string; level?: 2 | 3 }
// AMENDED (port review, S5.38). `level` draws the name as a real heading, which is what a ledger
// row's name IS — every other ledger in the product gives its row an <h3>, and the personas
// ledger gave its rows a <span>, leaving a page of records with no outline to move through (§6,
// "Heading order"). The step does not change with the level: `t-name` either way, because the
// level is the semantics and the type step is fixed. A linked name puts the <a> inside the
// heading, where `Link` inherits the step rather than restating it. Omitted where the pairing is
// not a record's own name — a starter in a picker, a name beside the page it already titles.

// 20/21/22 — state carriers. Every one prints its word.
export interface SeverityStackProps { level: SeverityLevel; size?: "sm" | "md" }
export interface SeverityTagProps { level: SeverityLevel; kind?: string; withStack?: boolean }
export interface VerdictTagProps { value: VerdictValue }

// 23/24 — the evidence seam
export interface CallRefProps { callRef: string; onSelect?: () => void; current?: boolean }
// AMENDED. The prop was `ref`, which is React's one reserved prop name: it works under React 19,
// and it made CallRef the only component in the system that could not be a forwardRef — its own
// prop occupied the name the DOM handle needs, so the day anything wrapped it the ref would have
// gone nowhere. `callRef` frees the name; CallRef is a forwardRef like everything else.
export interface ToolNameProps { name: string; missing?: boolean }
// missing renders the name plus " — not exposed" in ink-muted. Never strikethrough alone.

// 25/26 — facts
export interface MetaFact { key: string; node: React.ReactNode }
export interface MetaLineProps { facts: readonly MetaFact[]; size?: "meta" | "ui" }
// Hairline Separator between facts, never " · ". Used in rows and header bands.
export interface MetaSentenceProps { children: React.ReactNode }
// A real sentence with real pluralisation, built from format.ts's people/plural/ago/lasted.
// BANNED from table rows and list rows: prose cannot be compared down a column.

// 27/28 — time and number
export interface RelativeTimeProps { at: string | null; mode?: "ago" | "absolute" | "countdown" | "elapsed"; tick?: boolean }
// `tick` self-updates on a 1s interval. Today only LiveRun ticks and every other time freezes.
export interface MoneyProps { usd: number; precision?: 2 | 4 }
export interface DurationProps { ms: number }

// 29/30/31
export interface CopyButtonProps { text: string; label?: string }
export interface ThemeToggleProps { compact?: boolean }   // light | system | dark, words not glyphs
export interface ConfirmButtonProps {
  title: string; body: React.ReactNode; confirmLabel: string;
  onConfirm: () => void; variant?: "danger" | "primary";
  pending?: boolean; children: React.ReactNode;   // the trigger
}

// 32 — StateBlock. One component for every query state, so a screen stops collapsing and jumping.
export interface StateBlockProps {
  kind: StateKind;
  what: string;                        // "the transcript", "this project"
  error?: Error | null;                // `failed` renders the message in serif + the raw text in a mono well
  children?: React.ReactNode;          // `empty` and `gone`: a serif sentence and a way back
  skeleton?: React.ReactNode;          // `loading`: the screen's own skeleton, so layout holds
}
// empty and gone are serif sentences, upright, ink-soft — never italic, because the PRODUCT
// is speaking, not a person.
// AMENDED (port review, S6.40). A StateBlock RENDERS BARE, in a template's state slot, and is
// never boxed in a Card. Two screens wrapped theirs in `Card tone="sunk" pad="roomy"` while
// sixteen did not, and `sunk` is reserved for the quiet aside (organism 1): an empty state is the
// page's own subject at that moment, not an aside beside something else. The block owns its own
// rhythm; a card around it is a second frame inside the one the template already drew.

// 33/34
export interface DisclosureProps { label: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }
export interface PaginationProps { page: number; pages: number; onChange: (p: number) => void; label: string }

// 35 — FactList / Fact. ADDED by the port review (S5.37).
export interface FactListProps { children: React.ReactNode }   // Fact elements
export interface FactProps { label: string; children: React.ReactNode }
// The label/value track a record's steady column is made of: a real <dl> whose two columns are a
// grid, so every value starts at one left edge instead of eleven copies of
// `flex items-baseline gap-3 w-24` agreeing by eye. It exists because the measurement was written
// by hand on a screen — `Person` carried a live `grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)]`
// while its own docstring said the screen's hand-rolled grids were gone — and §0.2 puts a layout
// with a measurement in it in `design/`. `Fact` is a fragment, not a wrapper, so its <dt> and
// <dd> land in the list's own tracks; it travels in this file because it IS the list's item.
```

---

## 3. ORGANISMS — `packages/web/src/design/organisms/`

Product-shaped. These know what a finding, a cohort and an execution are, and several take a
contract view type directly.

| # | Organism | File | Radix | Replaces | Sites |
|---|---|---|---|---|---|
| 1 | `Card` | `Card.tsx` | `Slot` | `Card` + `className="p-4"` ×50 | 85 → ~25 |
| 2 | `Section` | `Section.tsx` | — | `Section` + 5 hand-rolled headers | 39 |
| 3 | `PageHeader` | `PageHeader.tsx` | — | `PageHeader` + the 5 that bypass it | 21 |
| 4 | `Ledger` / `LedgerRow` | `Ledger.tsx` | — | `divide-y divide-rule` ×20, `block p-3.5` ×6 | ~27 |
| 5 | `DataTable` | `DataTable.tsx` | — | `DataTable` + `RunCohorts`' own `<table>` | 4 |
| 6 | `Dialog` | `Dialog.tsx` | `react-dialog` | — (**zero dialogs exist today**) | 6 |
| 7 | `AlertDialog` | `AlertDialog.tsx` | `react-alert-dialog` | — (4 destructive actions) | 4 |
| 8 | `DropdownMenu` | `DropdownMenu.tsx` | `react-dropdown-menu` | the hand-rolled switcher popup | 4 |
| 9 | `Popover` | `Popover.tsx` | `react-popover` | — (new) | 3 |
| 10 | `Tabs` | `Tabs.tsx` | `react-tabs` | — (new; Target's sections) | 2 |
| 11 | `Toast` | `Toast.tsx` | `react-toast` | 4 stacked non-clearing error strips | 6 |
| 12 | `RosterLattice` | `RosterLattice.tsx` | — | `Bar` wherever it counts people | 16 |
| 13 | `CohortCapsule` | `CohortCapsule.tsx` | — | cohort `Bar` rows | 9 |
| 14 | `AvatarGroup` | `AvatarGroup.tsx` | — | hand-stacked avatars | 5 |
| 15 | `PayloadBlock` | `PayloadBlock.tsx` | `ScrollArea` | `Payload` (+ the 600-char cut) | 7 |
| 16 | `ToolCallBlock` | `ToolCallBlock.tsx` | — | WatchAVisit's tool-call detail layout | 3 |
| 17 | `EvidenceSteps` | `EvidenceSteps.tsx` | — | the `<ol>` of reproduction steps | 3 |
| 18 | `CitedAsEvidence` | `CitedAsEvidence.tsx` | — | the reverse-link block | 2 |
| 19 | `ReplayVerdict` | `ReplayVerdict.tsx` | — | the verdict line — **now renders `replay[]`** | 2 |
| 20 | `TriageForm` | `TriageForm.tsx` | `Collapsible` | the hand-rolled triage panel | 1 |
| 21 | `ClusterRow` | `ClusterRow.tsx` | — | `ClusterRow` + Compare's thinner copy | 12 |
| 22 | `IncidenceBars` | `IncidenceBars.tsx` | — | two divergent proportion markups | 6 |
| 23 | `FindingCard` | `FindingCard.tsx` | — | — (landing + proof; the app's own markup) | 6 |
| 24 | `PersonQuoteCard` | `PersonQuoteCard.tsx` | — | quotes at two sizes in two files | 7 |
| 25 | `TranscriptList` | `TranscriptList.tsx` | `ScrollArea` | WatchAVisit's 200-button list | 1 |
| 26 | `TranscriptRow` | `TranscriptRow.tsx` | — | 10 hand-written step variants | 1 |
| 27 | `TranscriptDetail` | `TranscriptDetail.tsx` | — | 3 hand-written detail layouts | 1 |
| 28 | `LiveActivityFeed` | `LiveActivityFeed.tsx` | `ScrollArea` | LiveRun's 11 event renderings | 1 |
| 29 | `PersonLiveCard` | `PersonLiveCard.tsx` | — | the live person grid cell | 1 |
| 30 | `ExecutionRow` | `ExecutionRow.tsx` | — | Executions' rows (the dot strip is `FindingInFull`'s own — §6.3 row 20) | 2 |
| 31 | `ExecutionCompare` | `ExecutionCompare.tsx` | — | — (**new: Compare has no instrument today**) | 1 |
| 32 | `Sidebar` / `ProjectSwitcher` / `SpendMeter` / `TargetStatus` | `Sidebar.tsx` | `DropdownMenu` | `Sidebar` | 1 |
| 33 | `ExplorationFan` | `ExplorationFan.tsx` | — | — (new; landing hero, empty states) | 4 |
| 34 | `ExecutionPicker` | `ExecutionPicker.tsx` | — | **AMENDED:** the picker §5 page 20 already named and this table left out — hand-rolled inside `Executions`, and about to be written a second time by `Compare` | 2 |
| 35 | `WhatWentWrong` | `WhatWentWrong.tsx` | — | **ADDED (port review, S4.26):** a local helper on one screen, and a raw `error.message` in a `FieldError` on four others | 9 |

### Signatures

```ts
// 1 — Card. Owns its padding. Three slots. `interactive` adds the hover language and focusRing.
export interface CardProps {
  pad?: "none" | "tight" | "default" | "roomy";   // 0 / 14 / 16 / 24
  tone?: "surface" | "sunk";
  interactive?: boolean;
  asChild?: boolean;                               // so a <Link> can be the card
  className?: string;
  children: React.ReactNode;
}
export interface CardHeaderProps { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; level?: 2 | 3 }
// level 3 by default (a card inside a Section). level 2 when the card sits DIRECTLY under a
// PageHeader, so the outline does not read h1 then h3. Appearance does not change with depth.
export interface CardFooterProps { children: React.ReactNode }

// 2 — Section. THE SECTION RULE: a 12px sentence-case eyebrow, a hairline running to the
// content width, an optional trailing fact at the far right. Replaces 39 <Section>s AND the
// five hand-rolled `mb-7 flex items-start justify-between` headers.
export interface SectionProps {
  title: string;
  id?: string;                         // gives scroll-mt anchoring; copied verbatim twice today
  trailing?: React.ReactNode;          // the fact on the far right of the rule — A FACT, a
                                       // figure read alongside the eyebrow as one line. NEVER an
                                       // instruction: "click one to meet the people in it" is an
                                       // affordance the rows carry, and prose sitting where every
                                       // other section shows a number is read as a number first
                                       // (port review, S4.27; DESIGN-SYSTEM §7.4)
  actions?: React.ReactNode;
  level?: 2 | 3;
  children: React.ReactNode;
}

// 3 — PageHeader. Owns the single <h1>. The `actions` slot is why five screens bypass it today.
export interface PageHeaderProps {
  title: string;
  crumbs?: readonly Crumb[];
  lede?: React.ReactNode;              // serif t-lede at --measure-lede
  eyebrow?: string;                    // sentence case, above the title
  meta?: readonly MetaFact[];          // the hairline-separated fact line
  actions?: React.ReactNode;
  status?: React.ReactNode;            // the live Chip, aria-live
}

// 4 — Ledger. THE SIGNATURE MOVE. A 72px right-aligned stub, one continuous spine, square rows.
//
// AMENDED — M2's spine has ONE spelling, and `Ledger.tsx` holds it:
//   LEDGER_GRID          the two columns, the 3px selection gutter, the collapse below md
//   LEDGER_STUB          the stub cell inside that grid
//   LEDGER_STUB_COLUMN   the same 72px column where it is a real table column (DataTable's <th>)
//   <LedgerSpine />      the hairline at calc(var(--w-stub) + 3px), drawn by the Separator atom
// `Ledger`, `LedgerRow` and `DataTable` take the geometry from here (AMENDED again:
// `MarketingShell` no longer does — DESIGN-SYSTEM §9.2 withdrew the page-long spine, because a
// marketing page has no stub column for it to align and the line crossed every heading): the four
// spellings agreed only by coincidence, and a change to the 3px gutter had to be made in every one
// of them or the spine stepped out of the column on one screen in five. TranscriptList,
// TranscriptRow, LiveActivityFeed and ExecutionCompare still write the track inline because theirs
// sits inside a variant (`md:grid-cols-[…]`, `md:before:left-[…]`) and a variant prefix cannot be
// applied to a class string from elsewhere — converting their `before:` hairline to <LedgerSpine />
// is the remaining move.
export interface LedgerProps {
  stubLabel?: string;                  // t-label above the stub column
  spine?: boolean;                     // default true
  as?: "ul" | "ol" | "div";
  children: React.ReactNode;
}
export interface LedgerRowProps {
  stub: React.ReactNode;               // ONLY a locator: sequence, severity stack, call ref,
                                       // execution number, or a mark-grammar glyph. Nothing else.
  to?: string;
  onClick?: () => void;
  selected?: boolean;
  suspect?: boolean;                   // 2px critical left edge on the CONTENT column + a word
  density?: Density;
  children: React.ReactNode;
}
// Below --breakpoint-md the stub collapses and its contents render as a leading line.

// 5 — DataTable. Square cells inside a radius-md container. No zebra. One serif sentence column.
export interface Column<T> {
  key: string;
  header: string;                       // t-label, sentence-case-free (it is caps), hairline under
  align?: "start" | "end";
  width?: string;
  sentence?: boolean;                   // THE one serif column. At most one per table.
  numeric?: boolean;                    // tabular, right aligned, sized to the widest value + 16
  priority?: 1 | 2 | 3;                 // 3 is cut first at lg, then 2 at md
  cell: (row: T) => React.ReactNode;
}
export interface SortableColumn<T> extends Column<T> {
  sortable?: boolean;                    // adds the header control AND aria-sort on the <th>
}
export type SortDirection = "ascending" | "descending";   // aria-sort's own values
export interface SortState { key: string; direction: SortDirection }

interface DataTableBaseProps<T> {
  rows: readonly T[];
  keyOf: (row: T) => string;
  stub?: (row: T) => React.ReactNode;    // the ledger stub, tabulated
  rowHref?: (row: T) => string;
  empty: React.ReactNode;
  caption: string;                       // VisuallyHidden <caption>
  stickyHeader?: boolean;
  pagination?: PaginationProps;
}
// A SORTABLE TABLE REPORTS ITS SORT, BY CONSTRUCTION. Every sortable head owes aria-sort,
// including the unsorted ones — "none" is what says a column can be sorted at all — so the two
// halves arrive together or not at all. Pass a SortableColumn and the type DEMANDS sort and
// onSortChange; pass plain Columns and it forbids both. `sortable?: never` on the second branch
// is load-bearing: a branch that merely omits the property would still swallow a SortableColumn
// handed in through a variable.
export type DataTableProps<T> = DataTableBaseProps<T> & (
  | { columns: readonly SortableColumn<T>[]; sort: SortState | null; onSortChange: (next: SortState) => void }
  | { columns: readonly (Column<T> & { sortable?: never })[]; sort?: never; onSortChange?: never }
);
// AMENDED. Below md the table is replaced by a card list — a second rendering of the same rows,
// because a column head cannot become a label beside its value in CSS alone. Both renderings read
// ONE prepared array, so `column.cell(row)` runs once per row per render and not twice: Visits
// polls at 2s with seven columns and a stub, which was 16 formatter calls per row per poll with
// half of them for a rendering the reader cannot see. `cell` is still a pure formatter; it is just
// no longer billed twice for being one. The stub column is `LEDGER_STUB_COLUMN`, from Ledger.

// 6/7/8/9/10/11 — Radix shells, thin
export interface DialogProps { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }
export interface AlertDialogProps { title: string; body: React.ReactNode; confirmLabel: string; cancelLabel?: string; tone?: "danger" | "primary"; onConfirm: () => void; trigger: React.ReactElement }

// 35 — WhatWentWrong. ADDED by the port review (S4.26).
export interface WhatWentWrongProps { says: string; error: Error; id?: string }
// A mutation that did not land: OUR sentence — what failed, in the reader's terms, and what is
// still true — in a `role="alert"` `FieldError`, and THEIR words verbatim in the one
// `PayloadBlock` beneath it. DESIGN-SYSTEM §7.4 asks for exactly this pair, and it was spelled
// two ways: five screens composed it through a local helper of this name, four dumped a raw
// `error.message` into a `FieldError`, which puts an HTTP status inside the product's own voice
// and loses the evidence seam (§4.3). It is an organism because the well is one — there is one
// well in the product, not three. `id` is optional for the reason `FieldError`'s is (molecule 3).
export interface DropdownMenuItem { label: string; to?: string; onSelect?: () => void; tone?: "default" | "danger"; disabled?: boolean }
export interface DropdownMenuProps { trigger: React.ReactElement; items: readonly DropdownMenuItem[]; label: string }
export interface PopoverProps { trigger: React.ReactElement; children: React.ReactNode; label: string }
export interface TabsProps { value: string; onChange: (v: string) => void; tabs: readonly { value: string; label: string; count?: number }[]; children: React.ReactNode }
export interface ToastProps { tone: "neutral" | "bad"; title: string; body?: React.ReactNode; onDismiss: () => void }
// Toast replaces the four stacked non-clearing mutation error strips on LiveRun; one
// role="alert" region, dismissible, cleared on the next successful mutation.

// 12 — RosterLattice. One dot is one person, at the mark's 26:31 ratio, four rows always.
export interface LatticeDot { id: string; state: PersonDotState; label: string; tone?: BrandTone }
// DECLARED BY brand/Lattice.tsx and re-exported by RosterLattice under this name. The primitive
// owns the geometry, so it owns the record the geometry is drawn from; the organism layer briefly
// restated the same three fields as a second interface (`LatticeItem`), which was two names for
// one shape. `tone` is the primitive's optional recolour, for a column that is a reading rather
// than a roster.
export interface RosterLatticeProps {
  dots: readonly LatticeDot[];
  size?: "sm" | "md" | "lg";
  sentence: string;                      // role="img" aria-label; the n-of-N text sits adjacent
  onSelect?: (id: string) => void;
}
// Degradation: 1:1 to 40 dots; block mode (1 dot = 5, caption "48 people · 1 dot = 5") to 200;
// a Meter plus the count above that. Never scrolls, never wraps past 4 rows.
// FORBIDDEN inside a table cell.
// With onSelect each dot is a button and takes §6's target floor through a centred ::after box —
// 24px for a mouse, 44px on a coarse pointer — because a dot is 6/10/15px across. Neighbouring
// targets overlap at these pitches; the later sibling wins the seam. Without onSelect the dots
// are aria-hidden and the container's sentence is the whole announcement.

// 13/14
export interface CohortCapsuleProps { name: string; dots: readonly LatticeDot[]; hit?: number; total?: number; to?: string }
export interface AvatarGroupProps { names: readonly string[]; max?: number; size?: "sm" | "md" }
// CohortCapsule draws `brand/Capsule` — the mark's own stadium, n fused cells long, laid under a
// row of the cohort's people so its ends land on the outer dot centres. Its LENGTH is the
// headcount (DESIGN-SYSTEM §1.2 M4, §8.6 amendment); the outer pill is the record you can open,
// the capsule inside it is the measurement. Folding is RosterLattice's ladder, so a capsule and
// a lattice never put two scales on one screen; past the ladder's last rung the capsule gives
// way to a Meter. AvatarGroup keeps its overlapped circles — three faces are not a headcount.

// 15/16/17/18/19 — evidence
export interface PayloadBlockProps {
  caption: string;                       // "What they sent" / "What came back"
  value: string;                         // pretty-printed at 2-space by the organism, not the caller
  error?: boolean;                       // 2px critical left edge + the word `error` in a Badge
  maxLines?: number;                     // default 24, then "Show all N lines"
  copyable?: boolean;                    // default true
}
export interface ToolCallBlockProps { call: ToolCallRecord; cited?: readonly ClusterCardView[]; onSelectRef?: (ref: string) => void }
export interface EvidenceStepsProps { steps: readonly ToolCallRecord[]; title?: string; onSelectRef?: (ref: string) => void }
export interface CitedAsEvidenceProps { findings: readonly { signature: string; title: string; severity: SeverityLevel; refs: readonly string[]; index: number }[]; currentRef: string; onSelectRef: (ref: string) => void }
export interface ReplayVerdictProps { verification: Verification }
// ReplayVerdict now renders `verification.replay[]` under a second heading — "What happened when
// we tried it again" — in the same register as the original steps, so the two can be read
// against each other. No screen draws this data today.

// 20/21/22/23/24 — findings
export interface TriageFormProps { signature: string; current: TriageView | null; onSave: (t: TriageInput) => void; drifted: boolean }
export interface ClusterRowProps { cluster: ClusterCardView; to: string; density?: Density; currentSeq?: number; theOne?: boolean }
export interface IncidenceBarsProps { cohorts: readonly { slug: string; name: string; hit: number; total: number }[]; theOne?: string }
export interface FindingCardProps { cluster: ClusterCardView; evidence?: readonly ToolCallRecord[]; quote?: { name: string; words: string; visit: number }; scale?: 1 | 0.8 }
export interface PersonQuoteCardProps { name: string; words: string; cohort: string; visit: number; size?: "sm" | "md"; to?: string }
// `name`, `cohort` and `visit` stay REQUIRED: a quote in this product is somebody's, and an
// optional attribution is an invitation to render one without it. The one case where there is
// no person to attribute to — a finding whose participant is not on the execution's roster —
// is drawn by `WhoLeft` itself, which says so in words rather than filling these three in
// (§6.3 row 7).

// 25/26/27 — the transcript
export type TranscriptKind = "visit.start" | "memory" | "model.turn" | "tool.call"
  | "reporter.call" | "guardrail" | "identity" | "finding" | "note" | "visit.end";
export interface TranscriptStep {
  id: string; seq: number; kind: TranscriptKind;
  title: string; sub?: string; meta?: string;
  callRef?: string; suspect?: boolean; severity?: SeverityLevel;
}
export interface TranscriptListProps {
  steps: readonly TranscriptStep[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  live: boolean;
}
// A roving-tabindex composite: role="listbox", one tab stop, arrows, Home/End,
// aria-activedescendant. 200 tab stops today. Rows keyed by step id and memoised so the 2s
// poll cannot re-render the list under the reader, and new rows never steal selection.
export interface TranscriptRowProps extends TranscriptStep { selected: boolean; onSelect: () => void }
export interface TranscriptDetailProps { step: TranscriptStep; detail: TraceEvent }
// Three layouts: tool call, model turn, generic. The generic one renders a HUMAN NOUN for the
// step kind — never `event.type`, which leaks `wake.start` onto the screen today.

// 28/29 — live
export type FeedEventKind = "run.started" | "run.ended" | "run.status" | "run.config"
  | "visit.started" | "visit.ended" | "finding.filed" | "guardrail.tripped"
  | "identity.created" | "job.updated";
export interface FeedEvent { id: string; kind: FeedEventKind; at: string; sentence: React.ReactNode; fresh: boolean }
export interface LiveActivityFeedProps { events: readonly FeedEvent[]; cap?: number; label: string }
// Rows are SANS. A streaming list is scanned as it arrives, and there family-as-channel beats
// sentence-ness; the person's name carries weight 500 within the row.
export interface PersonLiveCardProps { name: string; cohort: string; state: "away" | "here" | "thinking" | "calling"; tool?: string; nextAt?: string; theOne?: boolean }

// 30/31 — executions
export interface ExecutionRowProps { execution: ExecutionHistoryEntry; current: boolean; to?: string }
// `to` is OPTIONAL, and the omission is the meaning. AMENDED: the port made every row a link and
// gave the OLDEST row a comparison with the NEWER one, and a lone execution a link to the results
// page. An execution's only destination is itself beside another one, and the comparison worth
// offering is with the execution BEFORE it — so the oldest row is a row, not a link. The rule is
// `Executions`' own, restored: `compareTo = previous?.runId ?? null`.
export interface ExecutionCompareProps { a: ExecutionHistoryEntry; b: ExecutionHistoryEntry; clusters: readonly ClusterCardView[] }

// 34 — ExecutionPicker. AMENDED into §3: named on §5 page 20 and §6.3 row 9 as a principal
// organism, missing from the table above, hand-rolled inside `Executions` by the port — and
// `Compare` (§6.3 row 21) needs the same control, which would have made two spellings of one
// guard. One copy, here.
export interface ExecutionPickerProps {
  executions: readonly ExecutionHistoryEntry[];  // newest first, as the screen reads them
  a: string; b: string;                          // run ids: the earlier one and the later one
  onA: (runId: string) => void;
  onB: (runId: string) => void;
  to: string;                                    // where the act goes; the app owns its routes
}
// THE GUARD IS THE POINT: while a === b the act is disabled and a `FieldWarning` says which two
// are wanted, rather than the compare screen explaining it after the click. It takes `to` already
// composed because an organism that built the path would have to know which simulation it is in.
// NEW. Per cluster, a PAIRED LATTICE: execution A's dots above execution B's, so "not reported
// in the newer one" renders as a row of rings under a row of filled dots — ADR-0028's claim
// drawn rather than described. Compare renders no comparison instrument at all today.

// 32 — the shell
export interface SidebarProps {
  collapsed?: boolean;
  onNavigate?: () => void;
  project: ProjectOverviewView;            // counts, simulations, spend, kill switch
  projects: readonly ProjectSummaryView[]; // what the switcher offers
  href: (path?: string) => string;         // a path inside this project
  target: RailTarget | null;               // { id, name, endpoint } — never a token
  populationCount: number;
}
export interface RailTarget { id: string; name: string; endpoint: string | null }
// AMENDED. The original signature gave the rail nowhere to receive anything, so it fetched its
// own: `useQuery` × 3 and `useProject`, making it the only component under design/ that knew the
// app had a data layer. The fetching is now `packages/web/src/ProjectRail.tsx` on the app side and
// `AppShell` takes the composed rail as its `rail` prop. `useMatch` stays — which URL you are on
// is routing, not data, and the NavItems underneath already read it.
export interface ProjectSwitcherProps { current: ProjectSummaryView; projects: readonly ProjectSummaryView[] }
export interface SpendMeterProps { spent: number; ceiling: number | null }
export interface TargetStatusProps { target: TargetStatusView }
// `TargetStatusView` is DECLARED BY TargetStatus.tsx and exported from it. It is not a wire shape
// and must not become one: it is the rail's own composition of a target's name and endpoint with
// the project's kill switch and whether anything is running, none of which arrive together in any
// one response. A view type is a translation of a record; this is a reading of four.

// 33 — the mark's own artwork, drawn live so it can theme and animate
export interface ExplorationFanProps {
  ends: readonly { outcome: "filed" | "done" | "gaveUp"; label?: string }[];
  animate?: boolean;
  size?: "hero" | "panel" | "inline";
}
// `gaveUp` is the ONLY component in the product allowed to reference --pop-clay, at >=14px,
// always beside a word, and only on the landing route. AMENDED: the component has no route to
// test and ships on NotFound and in empty states too, so the WORD is the licence. `brand/Fan`
// draws its ends' words at size="hero" only; `fanNamesItsEnds(ends, size)` is that condition,
// exported, and both the terminal dot and the legend swatch ask it. Everywhere else — every use
// inside /app — "gave up" is ink-muted, the grammar's `left`. Key and keyed are never painted by
// different rules. `filed` is the mark's `theOne` at every size: a lime fill carrying the
// mandatory 1.5px ink ring in light, a 2px lime ring on transparent in dark (§1.2 M5, §5.4).
```

---

## 4. TEMPLATES — `packages/web/src/design/templates/`

A template owns layout, max-width, heading placement and the loading/error/empty slot. **Nothing
else.** No data fetching, no product nouns, no business logic.

| # | Template | File | Owns | Used by |
|---|---|---|---|---|
| 1 | `AppShell` | `AppShell.tsx` | `SkipLink` + `Sidebar` + scrolling `<main id="main" tabindex="-1">` + `RouteAnnouncer` + the `Toast` region + the one `TooltipProvider`; the rail→drawer switch below 900px | every `/app` screen |
| 2 | `DocumentPage` | `DocumentPage.tsx` | `--w-page`, the 72px stub grid, `--measure-read`, an optional 264px sticky instrument rail at ≥1240px, `PageHeader` slot, state slot | 12 screens |
| 3 | `InstrumentPage` | `InstrumentPage.tsx` | `--w-page` full bleed, no reading measure, 32px rows, the stub as a leading column, a toolbar slot | 8 screens |
| 4 | `SplitPage` | `SplitPage.tsx` | `grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`, sticky right rail, stacking at 1000px with the **detail above the list** | 5 screens |
| 5 | `FormPage` | `FormPage.tsx` | `DocumentPage` + a sticky `SaveBar`, an unsaved-changes guard, field error focus management | 4 screens |
| 6 | `CenteredPage` | `CenteredPage.tsx` | `--w-page-narrow`, railless, vertically generous | 1 screen (Projects) + the shells' own error states |
| 7 | `WizardPanel` | `WizardPanel.tsx` | the numbered/ticked step spine, collapse-to-a-line, the done summary, nothing spends until the last step | 1 screen (GetStarted) |
| 8 | `MarketingShell` | `MarketingShell.tsx` | `--w-landing`; `radius-lg`, exported as `LANDING_PANEL` — the one spelling of the 20px corner, composed by the hero panel, the diagram plates and the final CTA; the transparent nav; `RouteAnnouncer` and the focus move, as `AppShell` does them; the footer; `ThemeToggle`. **AMENDED: no `<LedgerSpine />`** — see DESIGN-SYSTEM §9.2 | 5 screens (the public route) |

```ts
export interface AppShellProps { rail?: React.ReactNode; children: React.ReactNode }
// AMENDED. The shell used to mount `Sidebar` itself, which is how the rail came to fetch its own
// data (see organism 32). It now RECEIVES the rail — the app's `ProjectRail` — and renders it in
// both the fixed column and the drawer, so the template still fetches nothing and the rail is
// still one component. The drawer closes on a click that lands on an anchor inside it, which is
// the delegated listener the rail used to own.
export interface PageStateSlots { loading?: React.ReactNode; error?: React.ReactNode; empty?: React.ReactNode; gone?: React.ReactNode }
export interface DocumentPageProps extends PageStateSlots {
  header: React.ReactNode;              // a PageHeader
  rail?: React.ReactNode;               // the instrument rail; hidden below xl and moved beneath
  state?: StateKind;                    // when set, the matching slot renders INSTEAD of children
  children: React.ReactNode;
}
export interface InstrumentPageProps extends PageStateSlots {
  header: React.ReactNode; toolbar?: React.ReactNode; state?: StateKind; children: React.ReactNode;
}
export interface SplitPageProps extends PageStateSlots {
  header: React.ReactNode; left: React.ReactNode; right: React.ReactNode;
  ratio?: "even" | "narrow-right"; state?: StateKind;
}
export interface FormPageProps extends DocumentPageProps { dirty: boolean; saving: boolean; onSave: () => void; savedAt: string | null }
export interface CenteredPageProps extends PageStateSlots { header?: React.ReactNode; state?: StateKind; children: React.ReactNode }
export interface WizardPanelProps { title: string; steps: readonly { id: string; label: string; done: boolean; summary?: React.ReactNode; body: React.ReactNode }[]; openId: string; onOpen: (id: string) => void }
// `title` is the explicit <h2> §6 gives GetStarted, which has no <h1> and whose step labels are
// <h3>s. It is required and it always renders, so the level cannot be skipped by accident — and
// it is why the panel is NOT wrapped in a Section, which would put two <h2>s on one thing.
export interface MarketingShellProps { children: React.ReactNode }
```

---

## 5. PAGES — the 26 screens

| # | Page | Route | Template | Principal organisms |
|---|---|---|---|---|
| 1 | `Landing` **(new)** | `/` | `MarketingShell` | `ExplorationFan`, `FindingCard`, `PayloadBlock`, `Ledger`, `Section` |
| 2 | `Projects` | `/projects` | `CenteredPage` | `Ledger`, `Card`, `PageHeader`, `Dialog` |
| 3 | `ProjectHome` | `/p/:proj` | `DocumentPage` | `StatGroup`, `Section`, `Ledger`, `GetStarted` panel |
| 4 | `GetStarted` | *(embedded in 3)* | `WizardPanel` | `ChoiceCard` group, `CostEstimate`, `Stepper`, `Checkbox` |
| 5 | `NewSimulation` | `/p/:proj/s/new` | `DocumentPage` + `ActionBar` **(amended)** | `RadioGroup` choice cards, `CohortCapsule`, `CostEstimate`, `ActionBar` |
| 6 | `Preflight` | `/p/:proj/s/:sim/preflight` | `DocumentPage` | `CostEstimate`, `PayloadBlock` (prompt preview), `Ledger` (blockers), `ConfirmButton` |
| 7 | `Settings` | `/p/:proj/settings` | `FormPage` | `Field`, `FieldGrid`, `Switch` (kill), `DangerZone`, `AlertDialog` |
| 8 | `Targets` | `/p/:proj/library/target` | `DocumentPage` | `Ledger`, `Section` (`TargetStatus` is the RAIL's block, organism 32 — §6.3 row 2) |
| 9 | `Target` | `/p/:proj/library/target/:t` | `FormPage` + `Tabs` | `ToolPolicyEditor`, `ConnectionStatusBar`, `Repeater`, `SecretField`, `FirstContactPanel` |
| 10 | `Personas` | `/p/:proj/library/personas` | `DocumentPage` | `Ledger`, `AlertDialog` (removing a persona takes its cohorts) |
| 11 | `PersonaEditor` | `/p/:proj/library/personas/:x` | `SplitPage` + `FormPage` | `ToolPolicyEditor`, `ScaleField`, `TagListField`, `KeyValueEditor`, `SamplePreview` |
| 12 | `People` | `/p/:proj/library/people` | `SplitPage` | `CohortCapsule`, `RosterLattice`, `JobProgress`, `CostEstimate`, `AlertDialog` (removing a cohort takes its people out of the population) |
| 13 | `Cohort` | `/p/:proj/library/people/:cohortSlug` | `DocumentPage` | `RosterGrid`, `InlineEdit`, `JobProgress`, `AlertDialog` ("Re-cast all of them") |
| 14 | `SimulationResults` | `/p/:proj/s/:sim` | `DocumentPage` + rail | `ClusterRow` ledger, `StatGroup`, `IncidenceBars`, `RosterLattice`, `Disclosure`, `SimulationActions` |
| 15 | `FindingInFull` | `/p/:proj/s/:sim/f/:signature` | `SplitPage` | `EvidenceSteps`, `ReplayVerdict`, `TriageForm`, `PersonQuoteCard`, `IncidenceBars` |
| 16 | `PeopleWhoHit` | `…/f/:signature/people` | `InstrumentPage` | `DataTable`, `PersonLink`, `RosterLattice` |
| 17 | `Gaps` | `/p/:proj/s/:sim/coverage` | `InstrumentPage` | `DataTable` (tool usage), `ClusterRow` (coverage-gap), `ToolName` |
| 18 | `WhoLeft` | `/p/:proj/s/:sim/left` | `DocumentPage` | `PersonQuoteCard`, `Ledger`, `StateBlock` |
| 19 | `Compare` | `…/executions/compare?a=&b=` | `InstrumentPage` | **`ExecutionCompare`**, `ClusterRow density="tight"`, `ExecutionPicker`, `Card tone="sunk"` (the caveat) |
| 20 | `Executions` | `/p/:proj/s/:sim/executions` | `InstrumentPage` | `ExecutionRow` ledger, `LiveActivityFeed` (a longitudinal execution's life), `ExecutionPicker` |
| 21 | `RunCohorts` | `/p/:proj/s/:sim/population` | `InstrumentPage` | `CohortCapsule`, `RosterLattice`, `DataTable`, `Disclosure` |
| 22 | `Visits` | `/p/:proj/s/:sim/visits` | `InstrumentPage` | `DataTable` (7 cols + stub, expandable detail row), `FilterChips`, `PersonLink`, `Pagination` |
| 23 | `WatchAVisit` | `…/visits/:wakeId` | `SplitPage` | `TranscriptList`, `TranscriptDetail`, `ToolCallBlock`, `CitedAsEvidence`, `MemoryPanel` |
| 24 | `LiveRun` | `/p/:proj/s/:sim/live` | `InstrumentPage` | `LiveActivityFeed`, `PersonLiveCard` grid, `RunControlBar`, `Meter`, `Toast` |
| 25 | `Person` | `…/people/:pid` and `/p/:proj/people/:personId` | `SplitPage ratio="narrow-right"` | `PersonIdentityLine`, `MemoryPanel`, `DataTable` (visits), `RosterLattice` |
| 26 | `NotFound` **(new)** | `*` | `CenteredPage` | `StateBlock kind="gone"`, `ExplorationFan size="inline"` |

Shared non-route components that move with the pages: `SimulationActions` (organism, 2 sites),
`NeedsExecution` (a `StateBlock` preset that keeps the screen's own title and the pre-flight
link), `RunRedirect` (unchanged behaviour, new copy for the "Back to where you were" link now
that `/` is public), `ProjectShell` / `SimulationShell` (their loading, 404 and error states move
**inside** `AppShell` — today they render without the sidebar).

**AMENDED — `SimulationActions` is `design/organisms/SimulationActions.tsx`, published from the
barrel.** "Moves with the pages" put it in `components/`, and from there it kept drawing its
primary button with `ui.tsx`'s `tone="go"` — `bg-accent text-white border-accent`. A ported
screen switches the `theme.css` shim off for its own subtree, so on `ProjectHome` that resolved
to **white on lime, 1.22:1**: "Send them in", "Run it again" and "Pause" were illegible on the
screen the product opens on. Anything a ported screen renders has to be *of* the system. Two
consequences are deliberate and both are exceptions worth naming:

- It is **the one component under `design/` that owns its own mutations** (`api`, the project
  context, `useMutation`). Both call sites want one line, and a presentational version would push
  four mutations, a navigate and an invalidation into every screen that shows a simulation —
  which is how the two call sites drifted apart before.
- Starting spends real money, so every act that sends people in goes through `ConfirmButton`,
  with the headcount and the target in the question and no promise about what comes back (§7.3).
  Pausing is `secondary`; the act that *ends* an execution is `danger`, the stop tone, never a
  filled red button. `components/SimulationActions.tsx` survives, deprecated, only for the
  unported `SimulationResults` (§6.3 row 19), and goes with the shim.

---

## 6. THE PORT PLAN

### 6.1 How to read it

Ordered so that independent screens can be taken by separate engineers who share only the design
system. **Wave 0 is a hard gate**; nothing else starts until it lands. Within a wave, no two rows
touch the same file, so they can be done in parallel and merged in any order.

**Risk** is the chance the port takes materially longer than a straight substitution:
**L** = mechanical; **M** = one new organism or a real layout change; **H** = a new organism plus a
behaviour change plus a state machine.

### 6.2 Wave 0 — the foundation (one engineer, nothing in parallel)

| # | Deliverable | Risk | Note |
|---|---|---|---|
| 0.1 | `theme.css`: fonts, tokens, `@theme inline`, `focus-ring`, the type utilities, the base layer, reduced motion | M | The `@theme inline` mechanic is the thing to get right; a plain `@theme` makes dark mode a silent no-op |
| 0.2 | Brand assets copied, WOFF2 built, metrics verified, `index.html` head, `site.webmanifest`, `VITE_FONT_SOURCE` | L | Run the verification script in §8.2 of the design system; if the numbers differ, `size-adjust` is wrong |
| 0.3 | `design/cn.ts`, `variants.ts`, `tokens.ts`, the barrel; add `class-variance-authority`, `clsx`, `tailwind-merge`, the Radix packages | L | 13 Radix packages: slot, label, select, checkbox, radio-group, switch, slider, avatar, separator, tooltip, dialog, alert-dialog, dropdown-menu, popover, tabs, toast, toggle-group, collapsible, scroll-area, visually-hidden |
| 0.4 | All 33 atoms | M | `Text`, `Button`, `Link`, `Input` and `Skeleton` first — everything else depends on them |
| 0.5 | All 34 molecules | M | `StateBlock` and `Field` are the two that unblock the most screens |
| 0.6 | `Card`, `Section`, `PageHeader`, `Ledger`, `DataTable`, `Dialog`, `AlertDialog`, `DropdownMenu`, `Toast` | M | The nine organisms every screen needs |
| 0.7 | `AppShell` + `Sidebar` + `ProjectSwitcher` + `SpendMeter` + `TargetStatus` + `ThemeToggle` + `SkipLink` + `RouteAnnouncer` | H | Everything renders inside this, and the shells' error states move inside it |
| 0.8 | `RosterLattice`, `CohortCapsule`, `SeverityStack`, `PayloadBlock`, `CallRef`, `ToolName`, `ExplorationFan` | M | The mark-grammar and evidence-seam components; six later screens are blocked on them |
| 0.9 | A visual-regression harness: every atom, molecule and organism rendered in both themes at 3 widths | M | Without it, "does dark mode still work" is 26 manual passes |

### 6.3 Waves 1–5 — the screens

| Order | Screen | Wave | Template | Principal organisms | Hand-rolled patterns it loses | Risk | Note |
|---|---|---|---|---|---|---|---|
| 1 | `Projects` | 1 | `CenteredPage` | `Ledger`, `Card`, `Dialog` | `max-w-[860px]`, `divide-y divide-rule`, `Card p-4` | **L** | Railless and dependency-free; the smoke test for the whole system |
| 2 | `Targets` | 1 | `DocumentPage` | `Ledger`, `Section` | `divide-y`, `block p-3.5 hover:bg-well`, `max-w-[68ch]` | **L** | Three rows and a lede; use it to settle `LedgerRow` before anyone else builds on it. **AMENDED:** `TargetStatus` was listed here and does not belong — organism 32 is the block at the foot of the RAIL, and its props are the rail's own reading of four sources (a target's name and endpoint, the kill switch, whether anything is running). This screen lists every target a project has; it reads none of them. The rail already carries the status on this screen as on every other |
| 3 | `Personas` | 1 | `DocumentPage` | `Ledger`, `AlertDialog` | `divide-y` ×2, `text-[11px]` slug line | **L** | First destructive confirm in the product — removing a persona takes its cohorts with it, and the dialog must say so |
| 4 | `Settings` | 1 | `FormPage` | `Field`, `FieldGrid`, `Switch`, `AlertDialog` | the hand-rolled `<h1>` header, `grid-cols-3 gap-4` ×3, the raw kill-switch checkbox | **M** | The kill switch is the product's only `Switch`; turning it **on** goes through an `AlertDialog` <br> **AMENDED:** it went in as a `Dialog`, because `AlertDialog` had no controlled `open` and a `Switch` is not a slotted trigger — so the product's most destructive control was announced as `dialog` and closed on a click on the scrim. `AlertDialog` takes `open`/`onOpenChange`/`confirmPending` now and this screen uses them. The two mutations also stop calling `invalidateQueries()` with no key: a save refetches `settings`, `populations` and `project`, and the switch refetches `setup` and `project`, rather than every live query in the app |
| 5 | `NotFound` | 1 | `CenteredPage` | `StateBlock`, `ExplorationFan` | the bare `Navigate` | **L** | New screen; also proves `ExplorationFan` outside the landing |
| 6 | `PeopleWhoHit` | 1 | `InstrumentPage` | `DataTable`, `PersonLink`, `RosterLattice` | `text-[11px]`, the ad-hoc table | **L** | The smallest `DataTable`; settle `Column<T>` here. **AMENDED — a displayed figure changes:** the headline's denominator is `peopleHit.length + Σ peopleMissed[].count`, not `card.peopleTotal`. Every row here is a person as they were in the execution that REPORTED the problem; `peopleTotal` is the newest execution's whole population, and for a problem that has gone quiet those are two different casts. The lattice beside the sentence is drawn from the same two lists, so the picture and the words agree. It remains an absence, never a repair |
| 7 | `WhoLeft` | 1 | `DocumentPage` | `PersonQuoteCard`, `Ledger` | quote markup duplicated from `FindingInFull` | **L** | Wrapped in `NeedsExecution`; the zero state keeps the screen's title <br> **AMENDED — the quote is unconditional, and the persona slug is never the byline.** Findings and the roster are two requests about one execution and they can disagree; the port rendered the quote only when the lookup succeeded, so such a row collapsed to a title and one sentence. It always renders: with a name, a cohort and a visit through `PersonQuoteCard`, and without them through the screen's own `Unattributed` — the same frame and the same `t-voice`, saying that this execution's roster no longer lists whoever said it, because a name, a cohort or a visit number invented to satisfy the card's props would be a fact the reader could read off the page and believe. The sentence beneath it says "They" rather than `personaId`: §7.4 forbids naming a persona where a person is meant |
| 8 | `Gaps` | 2 | `InstrumentPage` | `DataTable`, `ClusterRow`, `ToolName` | `line-through opacity-50` for a missing tool | **M** | `coverage.items[].calls` is a usage distribution the screen currently reduces to a column of literal `0`s — draw it. Error-vs-empty for `toolsError` must be visually distinct. **No marker band on this screen**: §5.4 appearance 4 names it — "Visits / Compare / Gaps → nothing, those screens have no single answer and get none". The port marked the gap the most people wanted, which answers a question this screen has no standing to answer; it is removed |
| 9 | `Executions` | 2 | `InstrumentPage` | `ExecutionRow`, `ExecutionPicker` (organism 34) | the copy-pasted `INPUT` class string, `STATUS_INK`, `max-w-[78ch]` | **M** | Add the a≠b guard on the picker — in `design/organisms/ExecutionPicker.tsx`, because row 21 needs the same control and a second copy is a second guard. **AMENDED, twice:** the dot-strip note was filed here and this screen has no dot strip — it is `FindingInFull`'s `AcrossExecutions`, and it now sits on row 20. And a row is a link ONLY when there is an older execution beneath it, to that comparison: the oldest row offers nothing and a lone execution is not clickable, which is the rule this screen has always had |
| 10 | `RunCohorts` | 2 | `InstrumentPage` | `CohortCapsule`, `RosterLattice`, `DataTable`, `Disclosure` | its own hand-rolled `<table>`, `max-w-[18rem]` | **M** | First real `RosterLattice`. `worstSignature` is fetched and never rendered — render it. Member links must carry `?execution=` <br> **AMENDED:** "render it" was read as rendering the signature, and the screen printed the hash as the link's own text. A signature is an id and §4.3 keeps ids out of the place a sentence belongs: render the **problem's title** and keep the signature as the link's target. The title is looked up from this execution's findings — a third request, and the only one on the page that is not per head — and where no title has been read back the link says "the worst thing they ran into" rather than a hash |
| 11 | `Visits` | 2 | `InstrumentPage` | `DataTable`, `FilterChips`, `PersonLink`, `Pagination` | 9 literal columns, the only `FilterChips` site | **M** | **Two columns move into an expandable detail row** (turns, tokens); seven remain, one of them the serif outcome column. Never label a row by persona <br> **AMENDED:** `DataTable` had no expandable row when this screen was ported, so the detail was a `Popover` hung off a `Button` **in the ledger stub** — a control where §1.2 M2 allows a locator and nothing else. `DataTable` has the disclosure now and the screen uses it: the **visit's number is the stub**, the **start time is the column the number vacated** and is the link into the transcript, and turns, tokens and the coming-back sentence fold out under the row at the table's full width <br> **AMENDED:** `?participant=` is the filter; the person's name only labels it. The two are not the same question — somebody who is not on this execution's roster still filters the log — and collapsing them printed the unfiltered lede *"Every visit anyone made in this execution"* and the caption *"Every visit in this execution"* over a list of one person's visits. Lede, caption and breadcrumb all branch on the filter and fall back to "one person". The id is printed beneath the table **only** in that case, where it is the one handle the reader has |
| 12 | `Cohort` | 2 | `DocumentPage` | `RosterGrid`, `InlineEdit`, `JobProgress`, `AlertDialog` | the hand-rolled `<h1>` header, `grid-cols-2 gap-x-6` with misaligned per-cell rules | **M** | The product's only inline editor; "Re-cast all of them" is destructive and needs the dialog |
| 13 | `Preflight` | 2 | `DocumentPage` | `CostEstimate`, `PayloadBlock`, `Ledger`, `ConfirmButton` | `grid-cols-4`, `max-w-[420px]`, the third `CostEstimate` | **M** | This is the screen that saves the user money and it is a footnote link today — promote it. "Send them in" spends real money and gets a confirm <br> **AMENDED:** "promote it" means an entry point of its own, and every link added to it in the port was still a footnote inside somebody else's empty state. It is a row in the **simulation's own navigation group**, directly under "Results" — unconditional, because what an execution would cost is a fair question of a simulation that has run ten times as much as of one that has never run, and the page spends nothing to answer it. The links from `GetStarted` and from `NeedsExecution` stay; they are shortcuts now rather than the only way in |
| 14 | `ProjectHome` | 3 | `DocumentPage` | `StatGroup`, `Section`, `Ledger`, `SimulationActions` | `grid-cols-3`, `max-w-[34ch] leading-[1.25]` | **M** | Embeds `GetStarted`. Copy must be **trimmed**, not shrunk, now that `t-read` is 15px <br> **AMENDED:** it rendered the legacy `components/SimulationActions` inside its own `data-design-system` subtree, where the shim is off, so `tone="go"` — `bg-accent text-white border-accent` — drew "Send them in" **white on lime at 1.22:1**. The organism is the fix (see §5's shared-components note); the marker stays where it is, since lifting it would un-port the rest of the screen |
| 15 | `GetStarted` | 3 | `WizardPanel` | `RadioGroup` choice cards, `CostEstimate`, `Stepper` | two `ChoiceCard` sizes, the raw checkbox, `max-w-[560px]`/`[320px]` | **M** | Same wave as 14; same file tree. What it gets right and must survive: it is a card not a wizard, steps collapse to lines, it never says persona/cohort/population, nothing spends until the last step, the cost estimate names its own basis, and **the two mode cards are the best copy in the repo — keep them verbatim**. It has no `<h1>`; the template gives it an explicit `<h2>` |
| 16 | `NewSimulation` | 3 | `DocumentPage` + `ActionBar` | `RadioGroup`, `CohortCapsule`, `CostEstimate`, `ActionBar` | two button-cards + two bare radios for the same concept in one file, `p-4 rounded-lg` vs `p-3.5 rounded-md` | **M** | One `ChoiceCard` at one size replaces four implementations. The `ActionBar` becomes sticky. **AMENDED — the template is `DocumentPage`, not `FormPage`.** `FormPage` mounts a `SaveBar` unconditionally, and given one this page said "Nothing changed yet" → "Unsaved changes" → "Save changes" about a simulation that does not exist yet. It composes `DocumentPage` + its own `<form>` (Enter still commits) + `ActionBar` instead. The verb is **Make it**, the one this screen has always used, and a held bar states its reason — no name, no population, no target — rather than going dead in silence |
| 17 | `Person` | 3 | `SplitPage` | `MemoryPanel`, `DataTable`, `RosterLattice` | `grid-cols-[minmax(0,22rem)]`, `text-[11px]`, `text-[12px]` | **M** | Two entry routes. `PersonInSimulation` throws a `Failed` card for a normal zero state (dead code) — make it a `StateBlock kind="empty"`. `PersonAcrossProject` does a serial N-run walk behind one loading line: give it a skeleton and a progressive list. `visits` is an **array** here and a count on the summary |
| 18 | `People` | 3 | `SplitPage` | `CohortCapsule`, `RosterLattice`, `JobProgress`, `CostEstimate` | `grid-cols-[1fr_1fr] gap-6`, `sticky top-9`, `max-w-[320px]`, the fourth `CostEstimate` | **M** | Two `JobProgress` implementations (`string[]` here, `string \| null` in `Cohort`) unify <br> **AMENDED:** they did not — both screens kept a local `WritingProgress` and the two had already drifted on the meter's hide rule and on which job's label is spoken. The organism takes both shapes and both screens call it. **Also:** removing a cohort is destructive and went through a `Tooltip` and a quiet button, while the same act reached from `Personas` went through an `AlertDialog` naming the consequence. Destructiveness belongs to the act, not to the screen it is pressed on: both ends use the dialog, and this one says how many people leave the population and that executions already run keep naming them |
| 19 | `SimulationResults` | 4 | `DocumentPage` + rail | `ClusterRow`, `StatGroup`, `IncidenceBars`, `Disclosure`, `SimulationActions` | `grid-cols-5 gap-6 mb-9 pb-8`, `max-w-[34ch]`, the client-side `headline()` | **H** | The direction's showcase. **Use `SimulationResultsView.headline` from the wire** — the screen recomputes it today while the field sits unused. A zero-findings execution gets the same 30px serif statement, not an empty state. Carries the screen's one marker band |
| 20 | `FindingInFull` | 4 | `SplitPage` | `EvidenceSteps`, `ReplayVerdict`, `TriageForm`, `PersonQuoteCard` | four sibling `<h2>`s, `max-w-[46ch]`/`[38ch]`/`[34ch]`/`[34rem]`, `min-w-[16rem]` | **H** | **Renders `Verification.replay[]` for the first time** — the strongest evidence the product holds. Needs the missing `Gone` state. Preserve `INDEPENDENT`, `CAVEAT`, `stateOfCluster` verbatim; "fixed" only inside `TRIAGE_WORDS`. **AMENDED — the dot strip is this screen's**, not `Executions`': `AcrossExecutions` writes one `●`/`○` span per execution and hides the report count in a `title=` attribute (`FindingInFull.tsx:171`), which is a tooltip on a hover-only surface and invisible to a keyboard. The count moves into the DOM. Each cell stays a seq, a mark and a number — an execution that did not report it is an absence, not a repair |
| 21 | `Compare` | 4 | `InstrumentPage` | **`ExecutionCompare`**, `ClusterRow density="tight"`, `ExecutionPicker` (organism 34 — **do not write a second one**) | `Row` — a second thinner `ClusterRow` that drops `Verdict` | **H** | Gains a comparison instrument it has never had: the **paired lattice**, A above B, so an absence reads as rings under filled dots. The caveat copy — "an absence, not a repair" — is verbatim and non-negotiable |
| 22 | `Target` | 4 | `FormPage` + `Tabs` | `ToolPolicyEditor`, `ConnectionStatusBar`, `Repeater`, `SecretField`, `FirstContactPanel` | 599 lines: `max-w-[68ch]` ×4, `divide-y` ×3, four renderings of connection state, an MCP-endpoint repeater **with no remove button** | **H** | Where organism extraction pays most. The `ToolPolicyEditor` here and in `PersonaEditor` are two divergent implementations of one merge rule — build it once, in wave 0.8 if it slips |
| 23 | `PersonaEditor` | 4 | `SplitPage` + `FormPage` | `ToolPolicyEditor`, `ScaleField`, `TagListField`, `KeyValueEditor`, `SamplePreview` | 476 lines: the range input's `accent-[var(--color-accent)]`, a nested ternary returning three JSX trees for the identity strategy, the only `dirty` tracking in the app | **H** | Pair with 22; they share `ToolPolicyEditor` and `TagListField`. `ConditionalFieldset` replaces the nested ternary. Its `dirty` flag becomes the unsaved-changes guard for every `FormPage` |
| 24 | `WatchAVisit` | 5 | `SplitPage` | `TranscriptList`, `TranscriptDetail`, `ToolCallBlock`, `CitedAsEvidence`, `MemoryPanel` | 10 step variants, 3 detail layouts, 200 tab stops, `grid-cols-[1fr_1fr]`, `sticky top-9`, the 600-char payload cut, `event.type` printed raw, `agentId · runId` in a sub-line | **H** | The most component-hungry surface and the hardest density test. Roving tabindex, memoised rows so the 2s poll cannot reflow under the reader, pretty-printed payloads, the `error`/`suspect` words, a real `Gone` state. Do it after 19–21 so `ClusterRow` and `PayloadBlock` are settled |
| 25 | `LiveRun` | 5 | `InstrumentPage` | `LiveActivityFeed`, `PersonLiveCard`, `RunControlBar`, `Meter`, `Toast` | 11 event renderings, `max-h-[26rem]`, four stacked non-clearing error strips, the only ticking clock in the app | **H** | Mode-aware controls (ephemeral = Stop / one more round; longitudinal = Pause). `paused/process-ended` is **not** a failure. The SSE cursor seed is a `useRef` that must never re-open the stream — do not touch it. Feed rows are sans. The run-progress meter is suppressed for longitudinal |
| 26 | `Landing` | 5 | `MarketingShell` | `ExplorationFan`, `FindingCard`, `PayloadBlock`, `Ledger`, `Section` | — (new route; today's `Landing` redirect moves to `/app`) | **H** | Also changes the `*` catch-all, `RunRedirect`'s "Back to where you were" link and the wordmark link. Do it last so `FindingCard` can render the app's real markup rather than a mock-up. The headline is restated; the descriptor is verbatim; the honesty clause is a section |

### 6.4 Parallelism

- **Wave 1** (rows 1–7): seven independent screens, no shared files. Up to four engineers.
- **Wave 2** (rows 8–13): six screens; 10/11 share `RosterLattice` semantics and 12/13 share
  `JobProgress`, so pair those. Up to three engineers.
- **Wave 3** (rows 14–18): 14/15 share a file tree and must be one engineer; 17/18 share
  `MemoryPanel`. Up to three engineers.
- **Wave 4** (rows 19–23): 19/20/21 share `ClusterRow` and should be one engineer in that order;
  22/23 share `ToolPolicyEditor` and should be another. Two engineers.
- **Wave 5** (rows 24–26): three engineers, fully independent, but all three depend on everything
  before them.

### 6.5 Definition of done, per screen

1. Zero imports from `components/ui.tsx`.
2. Zero `text-[`, zero `max-w-[`, zero `grid-cols-[` outside `design/`.
3. Renders correctly in `light`, `dark` and `system`, at 1400 / 1100 / 900 / 640px.
4. Every interactive element has a visible focus ring and a ≥24px target.
5. Heading order is 1→2→3 with no skips; there is exactly one `<h1>`.
6. Loading renders a skeleton at the content's height — the layout does not jump.
7. `empty`, `failed` and `gone` are all reachable and all render a sentence, and **`failed`
   offers the read again** — a `Button variant="secondary"` reading *Try again* in `StateBlock`'s
   children, refetching every query the state was composed from. AMENDED after the port of 1–18
   shipped a retry on three screens and not on the other fifteen: a read that failed is the one
   state a reader can act on, and the act is the same everywhere or it is not learnable. It
   retries a read and promises nothing about the answer — executions are independent (§7.3).
8. `grep -riE "\bagent|\bwake" src/screens/<Screen>.tsx` returns nothing outside an import path.
9. No copy promises a repeatable outcome; no absence is described as a fix.
10. `pnpm check` passes.
11. **The screen's root element carries `data-design-system`.** That attribute is what confines
    the deprecated compatibility shim in `theme.css`, which redirects nine old class names —
    `text-accent`, `bg-accent`, `border-accent` and the rest — to their pre-port meanings. The
    shim is ON by default, because every element in the product is an unported one until it is
    ported, and the attribute switches it OFF for a subtree so `accent` inside a ported screen
    means the lime the token layer says it means. Without it, a `Chip`'s live dot is repainted
    forest on a forest pill and disappears. It is **not** put on `AppShell`: while the port runs
    the shell wraps unported screens too, and a marker there would strip 18 files of links back
    to lime on paper at 1.08:1. A design component rendered outside any ported screen — the
    rail, a toast, a dialog portalled to `<body>` — marks its own root instead. The attribute
    and the shim are deleted together in the final wave.

### 6.6 The three biggest risks in the port

1. **Wave 0 is a two-week gate with nothing shippable in it.** 33 atoms, 34 molecules, 9
   organisms and the shell must all land before screen 1 can start, and the temptation will be to
   start screens early against half-built atoms — which is how a second, divergent primitive set
   gets created inside `screens/`. Mitigation: ship wave 0 behind the visual-regression harness
   (0.9) and treat the harness as the gate, not a code review.
2. **`t-read` at 15px where the current body is 13.5px makes every prose block taller, and the
   72px stub makes every list narrower.** ProjectHome, Preflight, GetStarted and the Visits table
   will not fit as they are. The rule is **trim the copy and cut a column**, never shrink the
   type or the stub — but that is a product-copy decision landing inside a front-end port, and it
   needs someone who can approve copy available during waves 2 and 3.
3. **The four highest-risk screens are also the four the product is judged on** —
   `SimulationResults`, `FindingInFull`, `WatchAVisit` and `Compare` — and three of them gain
   genuinely new behaviour (`replay[]` rendered, the paired lattice, roving tabindex with
   memoised rows under a 2s poll). A regression in `WatchAVisit`'s polling or `LiveRun`'s SSE
   cursor is a functional bug introduced by a front-end-only rebuild, which is exactly what this
   port promised not to do. Mitigation: those five screens keep their existing data hooks
   untouched, line for line, and the port is a render-layer change only; any diff inside a
   `useEffect`, a `useRef` or a query key in waves 4–5 is a review stop.
