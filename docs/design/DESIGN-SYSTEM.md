# The Populace design system

**Status:** authoritative. This document and `ATOMIC-INVENTORY.md` are the only two things an
engineer needs to read before building a screen. Where they disagree with a screen that exists
today, they win.

**Scope:** front-end only. No API shape, no server code, no runner code, no product behaviour
changes. Everything here lives under `packages/web/`.

---

## 1. THE DIRECTION

### 1.1 The thesis, in one page

Populace is a measuring device pointed at someone else's software. It is not a dashboard that
reports on itself — it reports on a product that nobody has used yet, using evidence it collected
by sending people in. So the interface is built like a **ruled instrument with a reading column**:

- **Space Grotesk names things. Source Serif 4 says things. IBM Plex Mono is what the machine
  emitted.** That is the whole typographic system, and it is semantic rather than size-based. A
  simulation's name is sans because it is a name. "47 visits turned up 4 problems" is serif
  because it is a sentence. `search_tasks` is mono because the target app is speaking.
- **Structure is carried by rules and alignment, not by boxes.** The app today has 85 `<Card>`s
  and `className="p-4"` fifty times; a finding, a form, an error and a stat strip all arrive as
  the same rounded rectangle. Here a card means one thing — *a discrete record you can open* —
  and almost everything else is a list on a hairline with a fixed measurement column down its
  left edge.
- **The mark is the data model, so the mark draws the data.** The Populace P is a 4×4 lattice of
  circles with one lime circle in the counter, plus two stadium capsules. Dot = a person. Ring =
  a person who was not there. Capsule = a cohort. Lattice = a population. Lime dot = the one that
  matters. Every count of *people* in this product is drawn in that grammar, not as a bar.
- **Density is a virtue.** 13px sans chrome, an 18px chrome line box, a 4px spacing base, square
  data rows, hairline separation and a continuous spine instead of per-row borders. No screen gets
  more generous just because it has room.
- **Colour is held in reserve.** The working palette is ink, paper, two greys and one hairline.
  Forest carries links and primary fills. Lime appears at most once per viewport and is always
  either a ground under ink or ringed in ink. Severity colours appear only inside the severity
  stack and the word beside it.

### 1.2 The six signature moves

A reviewer should be able to point at any one of these and say "this is missing."

**M1 — Three voices, one grammar.** The page tells you what *kind* of thing each string is by
which typeface sets it. Peaks on the Results screen: a sans `<h1>` naming the simulation, a 30px
serif sentence saying what happened, a row of sans figures measuring it, then serif
finding-sentences each carrying a sans severity word and a mono tool name. Four registers in
400px of vertical space and not one box drawn. It survives total webfont failure, because the law
is built on family *class* (grotesque / serif / monospace), not on a specific face.

**M2 — The ledger stub.** Every list that carries evidence — the transcript, the findings list,
the executions history, the visits table, the landing page — is a two-column ledger with a
**72px right-aligned stub** (`--w-stub`) and a **continuous 1px vertical rule** at its right edge
running the full height of the list. Not per-row borders: one spine. The stub carries only
locators: the 4-digit mono sequence, the severity stack, the `[c3]` call-ref, the execution
number, the mark-grammar glyph. Nothing else ever goes in it. Rows are square, `py-2`, separated
by nothing — the spine carries the alignment. This is the direction's face and it fixes the
ergonomic bug the survey found: 200 trace rows whose sequence numbers and call refs are inline
and therefore unscannable. Below 900px the stub collapses and its contents become a leading line
above each row.

**M3 — The severity stack.** Severity is a **vertical column of four 4px dots at the mark's own
pitch**, lit from the bottom up: critical 4, high 3, medium 2, low 1. Lit dots are filled in the
severity colour; unlit dots are 1px rings in `rule-strong` (3.2:1 — visible, unlike a hairline
segment). This is not an invented glyph: the mark's own stem *is* four circles in a vertical
column at (13,13) (13,44) (13,75) (13,106). It carries magnitude, survives greyscale and colour
blindness, costs 5px of row width, and the unlit state is the same "ring = absent" grammar the
lattice uses. **The word always accompanies it.**

**M4 — The roster lattice.** Any count of people is drawn. A CSS grid of circles at the mark's
exact proportions (dot ÷ pitch = 26 ÷ 31 = 0.839), always four rows, because the mark is four
high. Dot states: **present** = filled `primary`; **absent** = 1px `rule-strong` ring on
transparent; **left** = filled `sunk` with a `rule-strong` ring; **the one** = lime with a
mandatory 1.5px ink ring in light / a 2px lime ring on transparent in dark; **provisional** = the
dashed 2/7 stroke. Cohorts are drawn as **capsules** that hug their contents, so a population
reads as a column of bars of different lengths made of visible individuals. Degradation ladder:
one-dot-one-person to 40; **block mode** (1 dot = 5, caption changes to "48 people · 1 dot = 5")
to 200; a `Meter` plus the count above that. The lattice is **forbidden inside a table cell**.

**M5 — Lime is lit, never flat.** `#D7F56B` on `#F4F1E9` is **1.08:1** — below even the 3:1 floor
for non-text graphics. A lime tick, dot, underline, bar or border is *literally invisible* in
light mode. The law: **lime is either a ground under ink, or an ink on forest or on the dark
background, or a fill carrying a mandatory 1.5px ink ring.** Five sanctioned appearances and no
sixth (§5.4). Budget: all lime on any dashboard viewport must fit inside a 24×24px square.

**M6 — Square data, stadium people.** Radius by *kind*, not by size, derived from the fact that
every shape in the mark is a full circle or a stadium — there is not one slightly-rounded corner
in it. 0 for data (cells, wells, transcript rows, the stub, call refs, code), 6 for controls, 12
for containers, 20 for the landing only, full for people and states (avatars, person dots, cohort
capsules, live pills, the radio dot). A row of stadium avatars above a table of square cells
reads instantly as *these are people, that is the measurement*.

### 1.3 The rules a reviewer holds a PR against

Twelve. Each is a yes/no question.

1. **No hex anywhere in a component.** Every colour is a token. `primary` and `accent` swap
   identities between themes; a literal hex breaks dark mode silently.
2. **No paper or white text on lime.** 1.08:1 and 1.22:1. Lint the pair.
3. **No clay in the interface.** `--pop-clay` lives outside the Tailwind colour namespace so
   `bg-clay` and `text-clay` cannot be generated. Exactly two components may reference it, both
   on the landing (§9.1, §9.4). If you are reaching for clay, the answer is `--color-high` or
   nothing.
4. **No colour-alone state.** Every severity, verdict, run status, error payload and suspect step
   carries a word or a glyph as well as a hue. Specifically: an error payload gets the word
   `error` in a badge; a suspect transcript step gets the word `suspect`.
5. **No `:focus-visible`-less interactive element.** Every focusable atom applies the shared
   `focus-ring` utility. Today the app has zero focus styles across 45 buttons, 34 links and a
   200-button transcript list.
6. **No serif below 13px, no sans below 11px, no mono below 11px.** If a container cannot afford
   13px for a sentence, the container is wrong — truncate it, move it to a detail pane, or widen
   the row. Never shrink a sentence into sans.
7. **No zebra striping, and no fill without a reason.** A tinted ground means one of exactly
   three things: machine output (`sunk`), selection (`primary-wash` / `accent-wash`), or hover.
   Zebra would destroy the first meaning, which the whole evidence seam depends on.
8. **No `20px` radius inside `/app`.** It is a marketing radius. Zero uses in the dashboard.
9. **No animated widths, numbers, list re-entries or route transitions.** See §6.
10. **No ornament inside a table cell.** No lattice, no capsule, no bar. Cells hold values.
11. **No "agent", no "wake", anywhere a human can read it** — copy, `aria-label`, `title`,
    tooltip, placeholder, empty state, route, query param, test id. And nothing promises a
    repeatable outcome.
12. **No new hue.** The system has exactly the kit's colours plus three derived neutrals and two
    derived severity steps, every one with a measured ratio recorded in §2.

### 1.4 What this direction is not

It is not the warm-cream-plus-serif house style that machine-generated design currently defaults
to. Paper is `#F4F1E9` and clay is `#C46D51`, which puts us one accent away from that cliché. The
three defences are load-bearing and each is a review rule, not a hope:

- **Clay is gone from the interface** (rule 3). The terracotta tell is gone because the
  terracotta is gone.
- **The serif is a text face doing text work.** Source Serif 4 sets a 62-character reading measure
  and a finding's one sentence. It is never a 72px display face over an empty cream field. The
  display face — the one that sets page titles, the landing masthead and the wordmark — is the
  geometric sans, which is the *inverse* of the cliché.
- **The ground is ruled, not empty.** Hairlines and a fixed 72px measurement column divide the
  paper into a ledger. It reads as a page with structure printed on it, not as a floating card
  kit.

---

## 2. THE TOKEN LAYER

### 2.1 How it is wired — Tailwind v4 mechanics, exactly

This is the part people get wrong, so state it precisely.

`@theme { --color-x: #abc }` registers a *design token* at build time. Tailwind reads the value,
generates `bg-x` / `text-x` / `border-x`, **and inlines the literal value into each utility**. It
also emits the variable on `:root`. Because the value is inlined, redefining `--color-x` under
`[data-theme="dark"]` changes nothing — the utilities still carry the hex. **A plain `@theme`
block makes a runtime theme switch a silent no-op.**

`@theme inline { --color-x: var(--c-x) }` registers the same token but tells Tailwind the value is
already a reference: the generated utilities emit `background-color: var(--c-x)` rather than a
hex, and Tailwind does **not** re-declare `--c-x`. So the cascade decides. That is the structure
we need, and it is the only one that survives a `data-theme` flip.

Four layers, in this order, in `packages/web/src/theme.css`:

```css
@import "tailwindcss";

/* 0. the dark variant, so `dark:` utilities follow data-theme rather than the media query */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* 1. brand constants — identical in both themes, never used directly by a component */
:root {
  --pop-ink:    #202823;
  --pop-paper:  #F4F1E9;
  --pop-forest: #254B3E;
  --pop-signal: #D7F56B;
  --pop-clay:   #C46D51;   /* decorative only — deliberately NOT in the colour namespace */
}

/* 2. semantic values, light (the default) */
:root, [data-theme="light"] { /* §2.2 */ }

/* 3. semantic values, dark */
[data-theme="dark"] { /* §2.3 */ }

/* 3b. system preference, only when the user has not chosen */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]) { /* the same dark block */ }
}

/* 4. republish into Tailwind's namespace by reference */
@theme inline { /* §2.4 */ }
```

The dark block is written once and `@apply`-free; to avoid duplicating it for the media query,
author it as a single CSS custom-property set in a `@layer base` rule list and reference it from
both selectors, or simply repeat it — it is 30 lines and duplication here is cheaper than
indirection. **Do not** use `light-dark()`: it cannot express the `primary`/`accent` swap, and it
ignores an explicit user choice.

`<html>` carries `data-theme` as `"light"`, `"dark"`, or the attribute is absent for "system".
An inline script in `index.html` sets it before first paint (§2.9). `<meta name="color-scheme"
content="light dark">` makes native form controls and scrollbars follow.

### 2.2 Light theme — every value with its measured ratio

Grounds: `bg #F4F1E9`, `surf #FFFFFF`, `sunk #E9E7DF`, `hover #EEEBE3`. Ratios are WCAG relative
luminance, computed against the shipped hexes. **[kit]** = the brand kit ships it. **[der]** =
ours, derived here.

| Token | Hex | Src | bg | surf | sunk | hover | Job |
|---|---|---|---|---|---|---|---|
| `--c-bg` | `#F4F1E9` | kit | — | — | — | — | the page |
| `--c-surface` | `#FFFFFF` | kit | 1.13 | — | — | — | cards, dialogs, popovers, table bodies, inputs |
| `--c-sunk` | `#E9E7DF` | der | 1.10 | 1.19 | — | — | payload wells, code, the stub's fill, avatar fill |
| `--c-hover` | `#EEEBE3` | der | 1.06 | — | — | — | row and control hover, and nothing else |
| `--c-text` | `#202823` | kit | **13.39** | **15.12** | **12.21** | **12.69** | all primary text |
| `--c-text-soft` | `#39453D` | der | **8.89** | **10.04** | **8.11** | **8.42** | serif reading prose, quiet button labels |
| `--c-text-muted` | `#566259` | kit | **5.66** | **6.39** | **5.16** | **5.36** | labels, counts, metadata, placeholders |
| `--c-rule` | `#CBD2C7` | kit | 1.37 | 1.55 | 1.25 | 1.30 | **decorative hairlines only** |
| `--c-rule-strong` | `#6E8579` | der | **3.51** | **3.97** | **3.20** | **3.33** | every interactive boundary; clears WCAG 1.4.11's 3:1 on *all three* grounds |
| `--c-primary` | `#254B3E` | kit | **8.63** | **9.75** | **7.87** | **8.18** | links, primary fill, active nav, present lattice dot |
| `--c-on-primary` | `#F4F1E9` | kit | — | — | — | — | 8.63 on primary |
| `--c-accent` | `#D7F56B` | kit | 1.08 | 1.22 | — | — | **ground only**; ink on it is 12.35 |
| `--c-on-accent` | `#202823` | kit | — | — | — | — | 12.35 on accent |
| `--c-accent-wash` | `#ECF2C6` | der | 1.03 | 1.16 | — | — | selection; ink 13.02 / primary 8.39 / muted 5.50 on it |
| `--c-primary-wash` | `#E1E2DA` | der | 1.16 | 1.30 | — | — | selected row; ink 11.58 / primary 7.47 on it |
| `--c-mark-ring` | `#202823` | der | — | — | — | — | the mandatory 1.5px ink ring round any lime fill |
| `--c-focus` | `#254B3E` | kit | — | — | — | — | = primary; hence the two-part ring, §5.5 |
| `--c-link` | `#254B3E` | der | **8.63** | **9.75** | **7.87** | — | = primary in light; deviates in dark (§7.3) |
| `--c-evidence` | `#285C88` | kit `info` | **6.25** | **7.06** | **5.70** | **5.92** | call refs, tool names, machine speech |
| `--c-evidence-wash` | `#E3EAF0` | der | 1.08 | 1.21 | — | — | evidence 5.81 / ink 12.45 on it |
| `--c-critical` | `#A33132` | kit `error` | **6.11** | **6.90** | **5.57** | **5.79** | severity 4, errors, destructive. hue 359° |
| `--c-high` | `#8C4527` | der (clay darkened) | **6.21** | **7.01** | **5.66** | **5.88** | severity 3. hue 18° |
| `--c-medium` | `#785600` | kit `warning` | **5.94** | **6.71** | **5.42** | **5.63** | severity 2. hue 43° |
| `--c-low` | `#566259` | = text-muted | **5.66** | **6.39** | **5.16** | **5.36** | severity 1. hue 135°, deliberately achromatic |
| `--c-confirmed` | `#2D6345` | kit `success` | **6.24** | **7.04** | **5.69** | **5.91** | verdict = confirmed |
| `--c-on-critical` | `#FFFFFF` | kit | — | — | — | — | 6.90 on the critical fill |
| `--c-graph` | `#6E8579` | = rule-strong | **3.51** | **3.97** | **3.20** | — | bar fills and other non-text marks (≥3:1) |

Every token that carries text is ≥4.5:1 on every ground it is legal on. `rule`, `accent`, the
three washes, `mark-ring` and `graph` carry no text **by rule**, not by oversight.

### 2.3 Dark theme — every value with its measured ratio

Grounds: `bg #202823`, `surf #2C3730`, `sunk #191F1B`, `hover #2A342D`.

| Token | Hex | Src | bg | surf | sunk | hover | Notes |
|---|---|---|---|---|---|---|---|
| `--c-bg` | `#202823` | kit | — | — | — | — | the page (Ink) |
| `--c-surface` | `#2C3730` | kit | 1.22 | — | — | — | **border-led elevation** — §6.2 |
| `--c-sunk` | `#191F1B` | der | 1.11 | 1.36 | — | — | a well is *darker* than its ground in both themes |
| `--c-hover` | `#2A342D` | der | 1.17 | — | — | — | |
| `--c-text` | `#F4F1E9` | kit | **13.39** | **10.97** | **14.85** | **11.43** | paper, never `#FFFFFF` |
| `--c-text-soft` | `#D8E0D6` | der | **11.20** | **9.17** | **12.41** | **9.56** | |
| `--c-text-muted` | `#BCC9BC` | kit | **8.80** | **7.20** | **9.75** | **7.51** | |
| `--c-rule` | `#526357` | kit | 2.36 | 1.93 | 2.62 | 2.02 | decorative only |
| `--c-rule-strong` | `#8B968B` | der | **4.92** | **4.03** | **5.45** | **4.20** | ≥3:1 everywhere |
| `--c-primary` | `#D7F56B` | kit | **12.35** | **10.12** | **13.70** | **10.55** | lime is an *ink* in dark |
| `--c-on-primary` | `#202823` | kit | — | — | — | — | 12.35 on the lime fill |
| `--c-accent` | `#254B3E` | kit | 1.55 | 1.27 | — | — | **a large ground only**: paper on it 8.63, lime on it 7.97. Never text, never a small fill |
| `--c-on-accent` | `#F4F1E9` | kit | — | — | — | — | 8.63 on accent |
| `--c-accent-wash` | `#3D492F` | der | 1.58 | 1.29 | — | — | paper 8.49 / lime 7.83 / muted 5.57 on it |
| `--c-primary-wash` | `#233B32` | der | 1.25 | 1.03 | — | — | selected row; paper 10.67 / lime 9.85 on it |
| `--c-mark-ring` | `transparent` | der | — | — | — | — | lime needs no ring on ink |
| `--c-focus` | `#D7F56B` | kit | — | — | — | — | = primary |
| `--c-link` | `#D7F56B` | der | **12.35** | **10.12** | — | — | the *underline*, not the glyph — §7.3 |
| `--c-evidence` | `#A5CFFF` | kit `info` | **9.34** | **7.65** | **10.35** | **7.97** | |
| `--c-evidence-wash` | `#333F42` | der | 1.39 | 1.14 | — | — | evidence 6.72 / paper 9.64 on it |
| `--c-critical` | `#FF9A93` | kit `error` | **7.41** | **6.07** | **8.22** | **6.33** | hue 4° |
| `--c-high` | `#F2B180` | der | **8.19** | **6.71** | **9.08** | **6.99** | hue 26° — 22° clear of critical |
| `--c-medium` | `#E8CE7A` | kit `warning` | **9.75** | **7.98** | **10.81** | **8.32** | hue 46° |
| `--c-low` | `#BCC9BC` | = text-muted | **8.80** | **7.20** | **9.75** | **7.51** | hue 120° |
| `--c-confirmed` | `#A6D9A9` | kit `success` | **9.44** | **7.73** | **10.47** | **8.06** | |
| `--c-on-critical` | `#202823` | kit | — | — | — | — | 7.41 on the critical fill |
| `--c-graph` | `#8B968B` | = rule-strong | **4.92** | **4.03** | **5.45** | — | |

Severity is a four-hue ladder in both themes (359/18/43/135 light, 4/26/46/120 dark) and evidence
is blue at 208°/218°, roughly 190° from `high`. That kills, by construction, the live bug where
`--color-high #b4551b` and `--color-evidence #864e18` read as one ink at 11px.

### 2.4 The `@theme inline` block, ready to paste

```css
@theme inline {
  /* ---- colour ---- */
  --color-bg:            var(--c-bg);
  --color-surface:       var(--c-surface);
  --color-sunk:          var(--c-sunk);
  --color-hover:         var(--c-hover);
  --color-ink:           var(--c-text);
  --color-ink-soft:      var(--c-text-soft);
  --color-ink-muted:     var(--c-text-muted);
  --color-rule:          var(--c-rule);
  --color-rule-strong:   var(--c-rule-strong);
  --color-primary:       var(--c-primary);
  --color-on-primary:    var(--c-on-primary);
  --color-accent:        var(--c-accent);
  --color-on-accent:     var(--c-on-accent);
  --color-accent-wash:   var(--c-accent-wash);
  --color-primary-wash:  var(--c-primary-wash);
  --color-mark-ring:     var(--c-mark-ring);
  --color-focus:         var(--c-focus);
  --color-link:          var(--c-link);
  --color-evidence:      var(--c-evidence);
  --color-evidence-wash: var(--c-evidence-wash);
  --color-critical:      var(--c-critical);
  --color-high:          var(--c-high);
  --color-medium:        var(--c-medium);
  --color-low:           var(--c-low);
  --color-confirmed:     var(--c-confirmed);
  --color-on-critical:   var(--c-on-critical);
  --color-graph:         var(--c-graph);
  /* NOTE: --pop-clay is deliberately absent. bg-clay must not be generatable. */
  /* NOTE: --color-info is deliberately absent. The system has one blue and it means
     "the machine is speaking". info-as-a-status is retired; use `medium` for a notice. */

  /* ---- type families ---- */
  --font-display: "Space Grotesk", "Space Grotesk Fallback", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-text:    "Source Serif 4", "Source Serif 4 Fallback", "Iowan Old Style", Charter, Georgia, "Times New Roman", serif;
  --font-mono:    "IBM Plex Mono", "IBM Plex Mono Fallback", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  /* ---- spacing: 4px base. Tailwind's numeric utilities derive from this. ---- */
  --spacing: 4px;

  /* ---- radius: by KIND, not by size (§5.2) ---- */
  --radius-none: 0px;      /* data */
  --radius-sm:   6px;      /* controls */
  --radius-md:   12px;     /* containers */
  --radius-lg:   20px;     /* the landing route only */
  --radius-full: 9999px;   /* people and states */

  /* ---- layout constants (replace the 9 one-off pixel widths the survey found) ---- */
  --w-stub:            72px;    /* the ledger stub — 18 spacing units */
  --w-rail:            236px;   /* the sidebar */
  --w-inspector:       264px;   /* the sticky instrument rail on document-class screens */
  --w-page:            1100px;  /* the app content measure */
  --w-page-narrow:     860px;   /* railless screens: Projects */
  --w-landing:         1080px;  /* the marketing route */
  --measure-read:      62ch;    /* serif prose */
  --measure-statement: 34ch;    /* t-statement */
  --measure-lede:      52ch;    /* t-lede */
  --measure-wide:      78ch;    /* payload wells and transcripts */

  /* ---- the lattice module: the mark's own geometry, dot/pitch = 26/31 = 0.839 ---- */
  --lat-dot-sm:   6px;   --lat-pitch-sm:  7px;    /* inline, in a row */
  --lat-dot:      10px;  --lat-pitch:     12px;   /* the default, in panels */
  --lat-dot-lg:   15px;  --lat-pitch-lg:  18px;   /* the landing hero, the live field */
  --lat-rows:     4;                              /* the mark is four high; so is every lattice */

  /* ---- elevation: composite, redefined per theme in §2.5 ---- */
  --shadow-card: var(--c-shadow-card);
  --shadow-over: var(--c-shadow-over);

  /* ---- motion ---- */
  --ease:       cubic-bezier(.2, 0, 0, 1);
  --ease-exit:  cubic-bezier(.4, 0, 1, 1);
  --dur-press:     90ms;
  --dur-state:    140ms;
  --dur-disclose: 160ms;
  --dur-enter:    240ms;
  --dur-hero:     900ms;

  /* ---- z-index. Seven steps, and nothing may invent an eighth. ---- */
  --z-base:     0;
  --z-raised:  10;   /* sticky rails, sticky detail panes, sticky table headers */
  --z-rail:    20;   /* the sidebar */
  --z-overlay: 40;   /* dropdown, select, popover, tooltip */
  --z-dialog:  50;   /* dialog + its backdrop */
  --z-toast:   60;
  --z-skip:    70;   /* the skip link, which must outrank everything */

  /* ---- breakpoints. The app has zero today; these are the only four. ---- */
  --breakpoint-sm: 40rem;    /* 640  — phone / stacked */
  --breakpoint-md: 53.75rem; /* 860  — the stub collapses below this */
  --breakpoint-lg: 62.5rem;  /* 1000 — two-column splits stack below this */
  --breakpoint-xl: 77.5rem;  /* 1240 — the instrument rail appears at or above this */
}
```

### 2.5 Elevation and shadow, as composite tokens

Declared in the theme blocks (layers 2 and 3), *not* in `@theme`, because their value flips:

```css
:root, [data-theme="light"] {
  --c-shadow-card: 0 1px 2px rgb(32 40 35 / .055);
  --c-shadow-over: 0 10px 28px -6px rgb(32 40 35 / .18), 0 2px 6px rgb(32 40 35 / .07);
}
[data-theme="dark"] {
  --c-shadow-card: none;                             /* dark elevation is border-led */
  --c-shadow-over: 0 12px 32px -8px rgb(0 0 0 / .55);
}
```

| Level | Light | Dark |
|---|---|---|
| **flat** — sections, lists, rows. *The default; most of the app.* | no fill, no border; separated by `1px solid var(--color-rule)` | same |
| **card** — a discrete record you can open | `bg-surface` + `1px rule` + `--shadow-card` | `bg-surface` + `1px rule`, **no shadow** |
| **card, interactive** | + `hover:border-rule-strong` + `hover:bg-hover` | same |
| **well** — machine output | `bg-sunk` + `1px rule` + a 2px `evidence` left edge | same |
| **control** | `bg-surface` + `1px rule-strong` | `bg-sunk` + `1px rule-strong` |
| **overlay** — dialog, popover, menu, tooltip | `bg-surface` + `1px rule` + `--shadow-over` | `bg-surface` + `1px rule-strong` + `--shadow-over` |

Light shadows are deliberately near-invisible. The brand is flat, matte and geometric; a card
casting a soft grey drop shadow is the SaaS-kit tell. In dark `--shadow-card` is literally `none`,
because `#2C3730` on `#202823` is 1.22:1 and no fill difference will read — the hairline does all
of it. **A component never branches on theme in TypeScript.**

### 2.6 Borders — two tokens, used by rule and never by taste

- `--color-rule` (the kit's `border`, 1.37–2.62:1) → **decorative separation only**: dividers,
  card edges, table rules, the spine.
- `--color-rule-strong` (derived, ≥3:1 on every ground in both themes) → **the boundary of
  anything interactive**: inputs, selects, textareas, checkbox and radio edges, switch tracks,
  segmented controls, any clickable card, and the lattice's *absent* ring (an un-hit person is a
  ring, and if the ring is under 3:1 the incidence reading fails).

Hairlines are `1px` at every zoom. Never `0.5px`, never a transform to fake a thinner rule. There
is no 2px border in the system except the focus ring, the payload well's evidence edge, and the
3px selected-row edge.

### 2.7 The one-file skeleton of `theme.css`

```
@import "tailwindcss";
@custom-variant dark (…);
@font-face × 6            /* 3 real + 3 metric-matched fallbacks, §4.6 */
:root                     /* brand constants */
:root, [data-theme=light] /* §2.2 + shadows */
[data-theme=dark]         /* §2.3 + shadows */
@media (prefers-color-scheme: dark) :root:not([data-theme]) { … }
@theme inline             /* §2.4 */
@utility focus-ring       /* §5.5 */
@utility t-*              /* §3 */
@utility eyebrow-*        /* §3.5 */
@utility skeleton-line
@layer base               /* html/body/reset, the button cursor, reduced motion, dark font-smoothing */
```

### 2.8 Base layer

```css
@layer base {
  html, body, #root { height: 100%; }
  html { color-scheme: light dark; }
  body {
    margin: 0;
    background: var(--color-bg);
    color: var(--color-ink);
    font-family: var(--font-display);   /* chrome is the default; prose opts in */
    font-size: 13px;
    line-height: 18px;
    font-synthesis: none;               /* Space Grotesk has no italic; never oblique it */
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  /* Grayscale AA thins glyphs — the exact wrong move light-on-dark. Turn it off in dark
     BEFORE any weight or optical-size compensation; on macOS this alone recovers most of
     the apparent stroke weight a serif loses on an ink ground. */
  [data-theme="dark"] body {
    -webkit-font-smoothing: auto;
    -moz-osx-font-smoothing: auto;
  }
  :focus-visible { outline: none; }     /* every atom supplies focus-ring instead */

  /* AMENDED. Tailwind v3's Preflight carried `button { cursor: pointer }` and v4 dropped it, so
     the product shipped with every button — `Button`, every Radix trigger, every hand-rolled
     one — wearing the arrow beside `<a>`s wearing the hand. It is restored here rather than in
     `Button`'s CVA: a cursor is a platform default, not a design decision, and most of what a
     reader presses is a Radix `<button>` no CVA in this system reaches. The three disabled
     spellings are excluded because not every control spells one — `disabled` natively,
     `aria-disabled` for §6's control-at-a-bound, `data-disabled` for a Radix item. */
  button:not(:disabled, [aria-disabled="true"], [data-disabled]),
  [role="button"]:not([aria-disabled="true"], [data-disabled]),
  input:where([type="button"], [type="reset"], [type="submit"]):not(:disabled),
  summary:not([aria-disabled="true"]) { cursor: pointer; }
}
```

### 2.9 The pre-paint theme script

In `index.html`, inline, before the stylesheet link, so there is no flash:

```html
<script>
  (function () {
    try {
      var t = localStorage.getItem("populace:theme");
      if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    } catch (e) { /* storage off: system preference applies, which is the default anyway */ }
  })();
</script>
```

The toggle writes `"light"`, `"dark"`, or removes the key for `"system"`. `system` is the default.

---

## 3. THE TYPE SCALE

### 3.1 The law

> **If the text is a name, a number, a label or a control → Space Grotesk.
> If the text is a sentence the product or a person is saying → Source Serif 4.
> If the text is something the machine emitted or is named by → IBM Plex Mono.**

Worked from the real screens, with the app under test written as a generic exemplar —
**Acme Tasks** — rather than as this repo's development fixture. The fixture is a test target
used to build the harness, not a product feature; §9.4 bars it from the public pages, and the
same exemplar is used here so that a row copied out of this table into a screen, a placeholder
or a caption cannot carry it into shipped copy. Machine speech below stays concrete
(`search_tasks`, `[c3]`) because a tool name is the app's, not the fixture's.

| Text | Family | Why |
|---|---|---|
| `Acme Tasks smoke test` (the `<h1>`) | sans | a name |
| `47 visits to Acme Tasks turned up 4 problems` | serif | a sentence the product says |
| `search_tasks says it is case-insensitive and is not` | serif | a sentence a person wrote |
| `People sent` / `24` | sans | a label and a figure |
| `critical`, `confirmed`, `ephemeral` | sans | names of categories |
| `They tried the search twice, then gave up on it` | serif | a sentence |
| `search_tasks`, `[c3]`, `POST /mcp`, `{"q":"Report"}` | mono | machine speech |
| `Show the other 6` | sans | a control |
| `Nobody filed anything in this execution.` | serif | a sentence |

**Two named exceptions, and there are no others.**

1. **The landing masthead is sans.** "See your app through your users' eyes." is a sentence, but
   it is the product naming itself — a wordmark-adjacent utterance — and it is set in the
   wordmark's family at weight 300 so the 700 wordmark above it stays the boldest thing on the
   page. This also keeps the serif out of the one position (72px display over cream) where it
   would read as the generated-design cliché.
2. **The container overrides the string inside a dense row.** Inside a table cell, a list row
   under 44px, a form control, a chip, a badge, a button, the sidebar or a tooltip, text is
   Space Grotesk at any size, even when it is a full sentence — *with one carve-out*: **a table
   may have exactly one sentence column, and that column is serif at 13px.** A table column is
   scanned vertically and compared row to row, which is what the serif's sentence-ness buys; a
   streaming list (the live feed, the 200-row transcript) is scanned as it arrives, and there
   family-as-channel is worth more, so those rows are all sans.

   **Amendment (conformance review): a control's own messages belong to the control.** A hint, an
   error and a warning attached to a form control are inside that control's container for the
   purpose of this exception, and they are therefore **sans `t-meta`** — in `Field`, in
   `Checkbox`, in `Radio` and in every control built on them. The system had this both ways: a
   `Field` hint was sans `t-meta` and a `Checkbox` hint was serif `t-read-sm`, so a single form
   showed one role in two faces. Sans wins for three reasons. The hint, the error and the warning
   are one stack under one control and must match, and an error is unarguably chrome. A form is
   the densest container the product has, which is the condition this exception exists for. And
   the serif means *the product narrating a screen* — a statement, a lede, an empty state, a
   finding — whereas micro-copy under an input is not narration; it is part of the control. The
   serif floor `t-read-sm` keeps its job: a sentence inside a dense **row, cell or table column**.

### 3.2 The serif steps — "saying"

All Source Serif 4. `opsz` is set explicitly on every step; that is the optical correction, and it
is what stops a 30px statement looking like a scaled-up 15px paragraph.

| Utility | Size / line | wght | opsz | tracking | For |
|---|---|---|---|---|---|
| `t-statement` | 30 / 38 | 400 | 24 | −0.008em | the one-sentence headline of a screen; landing section statements |
| `t-lede` | 18 / 28 | 400 | 16 | 0 | page ledes, section intros, landing body copy |
| `t-finding` | 17 / 24 | 500 | 14 | −0.003em | a finding's title — the one sentence that is the product |
| `t-read` | 15 / 24 | 400 | 12 | 0 | **default reading text**: prose, descriptions, empty states, help, detail-pane narration |
| `t-read-sm` | 13 / 20 | 400 | 10 | +0.002em | **the serif floor**: a sentence inside a dense row, cell or table column |
| `t-voice` | 16 / 26 | 400 *italic* | 14 | 0 | a person's verbatim words. The only italic in the system |

> **Amendment (port review, S4.25). `t-finding` is the finding's title everywhere, and it is not
> negotiable per screen.** The three screens that print a finding's or a problem's title printed
> it at three steps — `Heading size="finding"` on *Who walked away*, `Text size="finding"` on
> project home, and `Text size="read"` on a person's own page, one step smaller than the other
> two. One object has one step. The step is fixed by the object, not by the container it is in
> and not by the element carrying it: a title may be an `<h2>`, an `<h3>` or a `<p>` depending on
> what the outline needs (§6), and it is `t-finding` in all three cases, because "the one sentence
> that is the product" does not get quieter on the page belonging to the person who filed it.

```css
@utility t-read {
  font-family: var(--font-text);
  font-size: 15px; line-height: 24px; font-weight: 400; letter-spacing: 0;
  font-optical-sizing: none;                 /* we drive opsz ourselves */
  font-variation-settings: "opsz" 12;
}
```

### 3.3 The sans steps — "naming"

All Space Grotesk. Weight ceiling **700** (verified: the shipped variable TTF has one `wght` axis,
300–700, and no italic file).

| Utility | Size / line | wght | tracking | Case | For |
|---|---|---|---|---|---|
| `t-masthead` | `clamp(2.75rem, 6.4vw, 4.25rem)` 44→68 | **300** | −0.03em | sentence | the landing hero headline, once per site |
| `t-title` | 24 / 30 | 500 | −0.015em | sentence | `<h1>`: the name of a project, simulation, person, target, persona |
| `t-figure` | 32 / 36 | 500 | −0.02em | — | a `Stat` value |
| `t-figure-sm` | 18 / 24 | 500 | −0.01em | — | inline counts, ledger fractions, the rail's numbers |
| `t-name` | 15 / 20 | 500 | −0.005em | sentence | a record's name inside a row, cell or card |
| `t-ui` | 13 / 18 | 450 | 0 | sentence | **the chrome default**: buttons, nav, breadcrumbs, cells, chips, control text |
| `t-eyebrow` | 12 / 16 | 500 | +0.02em | **sentence** | the label set into a section rule (`h2`/`h3`), and the label above a serif statement |
| `t-meta` | 12 / 16 | 400 | +0.005em | sentence | counts, timestamps, secondary chrome facts |
| `t-label` | 11 / 16 | 500 | +0.08em | **UPPERCASE** | field labels, stat labels, table column heads, stub unit labels — **these four roles only** |

**Uppercase discipline.** Tracked-out caps are the commonest decorative tic in generated
interfaces, and at 12px in a face with a 0.700 cap height they render as a grey stripe. So caps
are confined to the four roles above, all of which are *data labels on an instrument*. The label
above a heading — the commonest placement and the one in the user's reference — is
**`t-eyebrow`, sentence case**, because Space Grotesk's personality lives in its lowercase (the
flat-topped `a`, the single-storey `g`, the angled `k`) and all-caps discards every one of them.

All sans steps carry:
```css
font-feature-settings: "tnum" 1, "lnum" 1, "zero" 1, "case" 1;
```
`zero` is the slashed zero, verified present in the shipped TTF's GSUB. Slashed zeros throughout
are a signature: the mark is made entirely of circles, and the slashed zero is the one place a
circle gets cut. They also do real work beside a capital O in a tool name.

### 3.4 The mono steps — "the machine"

| Utility | Size / line | wght | tracking | For |
|---|---|---|---|---|
| `t-code` | 13 / 20 | 400 | 0 | tool names, endpoints, URLs, inline code in chrome |
| `t-code-inline` | 13.5 / **24** | 400 | 0 | mono **inside `t-read`** — leading pinned to the serif's so a tool name never disturbs the paragraph's line box. Inside `t-read-sm` it is 12 / **20** |
| `t-code-sm` | 11.5 / 18 | 400 | +0.01em | payload wells, transcript sub-lines, ids, slugs |
| `t-ref` | 11 / 14 | 500 | +0.02em | the `[c3]` pill and the stub's 4-digit sequence |

IBM Plex Mono's x-height is 0.516 against the serif's 0.475 — 8.6% larger — so uncorrected mono
bulges inside a paragraph. Parity at 15px serif would be 13.8px mono; `t-code-inline` ships 13.5,
which lands a shade under and reads as a quieter register rather than a mistake. Mono is the one
family allowed below the 12px sans floor, because its x-height exceeds the sans's (0.516 vs
0.486): Space Grotesk at 11px is a 5.35px lowercase, Plex Mono at 11px is 5.68px.

These four steps absorb all 28 arbitrary `text-[11px]` / `text-[11.5px]` / `text-[12.5px]` sites
the survey found.

### 3.5 Migration table from the old scale

| Old | New | Note |
|---|---|---|
| `t-display` 27/600 | **`t-statement`** (serif) *or* **`t-figure`** (sans) | split by job — the old token set both a headline sentence and a `Stat` value |
| `t-title` 22/600 | **`t-title`** 24/500 sans | same role |
| `t-section` 16/600 | **`t-eyebrow`** (the label in a section rule) *or* **`t-name`** (a record's name) | 16px did double duty |
| `t-finding` 15/600 sans | **`t-finding`** 17/500 **serif** | the biggest visible change in the product |
| `t-body` 13.5/400 | **`t-read`** 15 serif *or* **`t-ui`** 13 sans | decide with §3.1. ~60/40 in favour of `t-ui` by raw call sites; `t-read` wins on every screen that matters |
| `t-meta` 12/400 | **`t-meta`** 12 sans *or* **`t-read-sm`** 13 serif | serif only when the string is a sentence, and then it goes to 13px |
| `t-label` 11/600 caps | **`t-label`** (form unchanged, scope narrowed to four roles) *or* **`t-eyebrow`** (sentence case, everywhere it was an eyebrow over a heading) | |
| `font-mono text-[11px]` ×18 | **`t-code-sm`** or **`t-ref`** | |
| `font-mono text-[12.5px]` ×5 | **`t-code`** | |
| `font-mono text-[11.5px]` ×6 | **`t-code-sm`** | |

### 3.6 Optical correction between the two families

Measured, not guessed. Space Grotesk parsed from the shipped TTF; Source Serif 4 from its
published `OS/2` (re-verify against the downloaded WOFF2 before shipping — the one-line script is
in §4.6).

| | Space Grotesk | Source Serif 4 | IBM Plex Mono |
|---|---|---|---|
| unitsPerEm | 1000 | 1000 | 1000 |
| x-height | **486** (0.486) | **475** (0.475) | **516** (0.516) |
| cap-height | 700 | 670 | 698 |
| hhea asc / desc | 984 / −292 | 1024 / −400 | 1025 / −275 |

The x-heights of the sans and the serif differ by **2.3%** — below the perceptual threshold — so
*size* is not the problem. Two other things are:

1. **Presence.** Source Serif 4 at `wght 400, opsz 12` has visibly thinner stems than Space
   Grotesk at `wght 450`. At the same px the serif recedes.
2. **Set width.** The serif sets ~11% more characters per line, so an equal-px serif looks smaller
   and denser in a column.

> **The correction: where a serif and a sans sit on the same line or in adjacent columns, the
> serif is set 2px larger than the sans.**
>
> - 15px `t-read` ↔ 13px `t-ui` — the house pairing
> - 17px `t-finding` ↔ 15px `t-name`
> - 13px `t-read-sm` ↔ 12px `t-meta` — **+1, not +2**, because 11px sans falls below the label
>   floor. Where a +2 pairing is unavailable the serif wins and the sans stays at 12.

The 2px is not x-height compensation (that would ask for +0.35px at 15px). It is presence
compensation, and it is why `t-read` is 15 while the chrome default is 13.

The serif also needs a **colour** correction: its thin strokes make a paragraph read lighter, so
body prose takes `--color-ink-soft` `#39453D` (8.89:1) rather than the muted tier a sans body
would take. That is the only place in the system where a family changes a colour choice.

### 3.7 Baselines: the eyebrow-above-a-serif-headline case

This is the commonest adjacency in the direction and the one in the user's reference screenshot.
Solve it with `text-box`, which trims a heading's box to cap-top → baseline so the gap becomes a
literal, predictable margin instead of the sum of two faces' different half-leadings.

```css
.t-masthead, .t-title, .t-statement, .t-lede, .t-finding, .t-figure, .t-eyebrow {
  text-box: trim-both cap alphabetic;
}
.t-eyebrow + .t-statement { margin-top: 20px; }
.t-eyebrow + .t-masthead  { margin-top: 24px; }
.t-eyebrow + .t-lede      { margin-top: 14px; }
.t-eyebrow + .t-finding   { margin-top: 13px; }
.t-eyebrow + .t-title     { margin-top: 12px; }  /* sans over sans */
.t-label   + .t-figure    { margin-top: 6px;  }
```

**Fallback, written out — nothing is computed at runtime.** Guard with
`@supports not (text-box: trim-both cap alphabetic)`. Derived from the metrics in §3.6 using

```
sans space below baseline inside the line box = L − [ (L − 1.276·S)/2 + 0.984·S ]
serif cap-top offset from the line box top    =     (L − 1.424·S)/2 + 0.354·S
```

| Pairing | eyebrow below-baseline | heading cap-top | inherent gap | fallback margin | resulting optical gap |
|---|---|---|---|---|---|
| `t-eyebrow` 12/16 → `t-statement` 30/38 | 4.85 | 8.26 | 13.11 | **7px** | 20.1 |
| `t-eyebrow` 12/16 → `t-masthead` 68/69 | 4.85 | 9.95 | 14.80 | **9px** | 23.8 |
| `t-eyebrow` 12/16 → `t-lede` 18/28 | 4.85 | 7.55 | 12.40 | **2px** | 14.4 |
| `t-eyebrow` 12/16 → `t-finding` 17/24 | 4.85 | 6.72 | 11.57 | **1px** | 12.6 |
| `t-label` 11/16 → `t-figure` 32/36 (both sans) | 4.20 | 3.08 | 7.28 | **0px** | 7.3 |

Ship these as four utilities — `.eyebrow-statement`, `.eyebrow-masthead`, `.eyebrow-lede`,
`.eyebrow-finding` — so no screen guesses a margin.

**Amendment (conformance pass).** Two things about those four utilities were implicit and are now
written down, because a review read the absence as a defect.

1. **They are for the four SERIF pairings, and for callers whose eyebrow and heading are not DOM
   siblings.** Where the two elements *are* adjacent the CSS above already applies and the utility
   is redundant; the utility exists for the case a wrapper sits between them — a flex row that
   puts a status chip on the heading's line, a `Measure` around the headline, a section whose
   eyebrow is rendered by one component and whose heading is rendered by another. That is a screen
   shape far more than a component shape, which is why the four are shipped as utilities a screen
   can reach for rather than baked into a component.
2. **`t-eyebrow` → `t-title` is a fifth pairing and ships as an adjacency rule only.** It is sans
   over sans, so it is not in the fallback table above — the `@supports` fallback resolves to the
   same 12px either way — and it has no named utility. `PageHeader` is the one component that
   draws it, and its `status` slot puts a flex row between the eyebrow and the `<h1>`, so the
   adjacency selector cannot reach. It therefore writes the 12px itself, once, in a named constant
   that cites this section (`EYEBROW_TITLE_GAP`). One component writing one documented number is
   not a screen guessing a margin; it is the fifth row of this table, kept in the one place that
   needs it. If a second component ever needs the same pairing, that constant becomes the sixth
   utility rather than a second guess.

**Left edge.** Source Serif 4's capitals carry a slightly larger left side-bearing than Space
Grotesk's. At or above 24px, display elements take `margin-inline-start: -0.012em` so the optical
left edges line up. Below 24px the correction is sub-pixel and the rounding does more harm than
the misalignment — do nothing.

**Rhythm.** A true CSS baseline grid is not achievable without line-box hacks, so this is a
rhythm and it is committed to honestly: **every line-height in the scale is an even number of
pixels. Every vertical gap between blocks is a multiple of 4px. Every gap between sections is a
multiple of 8px. The reading line box is 24px, the chrome line box is 18px, the meta line box is
16px.** Three reading lines (72px) equals four chrome lines, so the two columns of a split screen
re-align every three reading lines — which is the alignment a reader actually notices.

### 3.8 Dark-mode compensation for the serif

Three things, **in this order**, because the first is free and recovers the most:

1. **Turn grayscale antialiasing off in dark** (§2.8). Already in the base layer.
2. **Lower `opsz`; do not raise `wght`.** A lower optical-size cut has thicker stems, shorter
   ascenders and larger, blunter serifs — which is the actual design response to hairline erosion
   on an ink ground, and it is what the axis exists for. Raising weight would thicken the stems
   and leave the serifs and bracket joins as thin as before, changing the *colour* of the page
   rather than its cut.

```css
[data-theme="dark"] .t-read      { font-variation-settings: "opsz"  9; letter-spacing: 0.004em; }
[data-theme="dark"] .t-read-sm   { font-variation-settings: "opsz"  8; letter-spacing: 0.006em; }
[data-theme="dark"] .t-voice     { font-variation-settings: "opsz" 11; letter-spacing: 0.004em; }
[data-theme="dark"] .t-finding   { font-variation-settings: "opsz" 11; letter-spacing: 0.001em; }
[data-theme="dark"] .t-lede      { font-variation-settings: "opsz" 13; }
[data-theme="dark"] .t-statement { font-variation-settings: "opsz" 18; letter-spacing: -0.004em; }
```
   Tracking opens 0.004–0.006em at reading sizes to counter blooming closing the counters, and
   *tightens* at display sizes where blooming makes large text look loose.
3. **Static-fallback degradation.** With Georgia there is no `opsz`. Guarded by
   `@supports not (font-variation-settings: normal)`, dark reading text takes
   `letter-spacing: 0.006em` and nothing else — opening the counters is the only lever a static
   face offers.

Space Grotesk and IBM Plex Mono need no compensation. Space Grotesk is a low-contrast grotesque
with no hairlines; bumping it in dark would make the chrome shout beside the serif. Plex Mono is
drawn for terminals.

---

## 4. SEMANTIC RULES

### 4.1 What each colour is allowed to mean

| Token | Means | May never be |
|---|---|---|
| `primary` | *the thing you act on, and the present person* — links, primary fill, active nav, a filled lattice dot, a selected radio's dot | a status, a severity, a chart series |
| `accent` (lime) | *this one, right here* — the marker band, the live dot, the one lime dot, the landing CTA | text, a border, a bar fill, a small unringed fill in light, a chart series |
| `evidence` (blue) | *the machine is speaking* — call refs, tool names, endpoints, ids, the payload well's edge | a status, a link, a severity, a notice. There is no `info` status; the blue has one job |
| `confirmed` | *a judge replayed it and it reproduced* | a generic "good", a success toast, a done tick. Distinguished from `primary` by **shape and word**, never by hue: a verdict is always a square `Badge` carrying the word |
| `critical / high / medium / low` | severity, and only severity. `critical` doubles as the error/destructive ink | a highlight, a hover, a chart series |
| `ink-muted` | *a person who walked away* — the departure ink, which is `Dot`'s own `left` state (§8.6) | — (it is also the quiet text ink; the pairing is deliberate, see the amendment below) |
| `rule` | decorative separation | the visible boundary of a control |
| `rule-strong` | an interactive boundary, and the *absent* lattice ring | text |
| `graph` | a non-text mark: a bar fill, a stub glyph | text, or any mark whose meaning is not also written |
| `--pop-clay` | one decorative terminal dot on the landing, ≥14px, always beside a word | anything at all inside `/app` |

> **Amendment (port review, S4.22–S4.24). Three inks were carrying meanings this table forbids,
> and the table wins in all three cases.**
>
> - **A severity ink for something that has no severity.** A target's warnings (*Before you send
>   them*) and a simulation's pre-flight blockers (*Get started*) were drawn `medium`. Neither is
>   a finding and neither has a level: one is a fact about what this run will not be able to do,
>   the other a precondition that has not been met. They take the reading ink, and the state
>   arrives as a **word in a `Badge`** — *heads up*, *blocker* — which is what §4.2 asks of any
>   state anywhere. A severity hue on a thing with no severity is worse than a neutral one,
>   because it spends the scale's alarm on something the scale does not measure.
> - **`confirmed` as a done tick.** A visit that ran to the end was inked `confirmed`, which is
>   the one thing this table says that token may never be. A verdict is a judge's replay; an
>   ordinary ending is the unremarkable case and takes `ink-soft`. The same applies to *"said a
>   fix would bring them back"* on *Who walked away*: it is the notable half of a sentence, so it
>   takes full `ink` against the `muted` of the other two readings — emphasis by ink against
>   ink-soft, which is what §4.7 gives prose, and never by a borrowed semantic hue.
> - **`critical` for a person who left**, at four sites across three screens. `critical` is
>   severity 4, an error and a destructive act. **A person walking away is a signal, not an
>   error** — it is the product's single most valuable observation, and drawing it as a failure of
>   the *system* misreads it as one. The ink for it already existed and was already drawn on the
>   screen the finding is named after: `Dot`'s `left` state is a **filled `ink-muted` circle**,
>   *a person who walked away* (§8.6). So `ink-muted` is the departure ink, in a row's words
>   exactly as in the mark, and the row's word — *"left at visit 4"*, *"3 walked away"* — is what
>   distinguishes it from the other quiet things `ink-muted` draws (§4.2).

### 4.2 Severity always carries its word

The kit's own binding rule is *"never rely on colour alone to communicate state."* So severity is
carried by **three redundant channels at once**: the **count** (the severity stack's lit dots),
the **word** (`t-label` in the severity colour), and the **hue**. Remove any one and it still
reads. The same discipline applies everywhere state exists:

- A verdict is a square `Badge` with the word — `confirmed` / `not reproduced` / `inconclusive` /
  `not checked yet`.
- An error payload gets the word `error` in a `Badge` above the well **and** a 2px `critical` left
  edge, never a colour change alone. (Today `WatchAVisit` colours a suspect step `text-critical`
  with no word at all.)
- A suspect transcript step gets the word `suspect` in a `Badge`.
- A missing tool renders its name in `t-code` with `— not exposed` appended in `ink-muted`,
  never strikethrough-plus-opacity alone.
- A run status is a word in a `Chip`, never a coloured dot alone. `killed`/`failed` and
  `paused`/`pending` currently share a hue in `STATUS_INK`; the word disambiguates them and the
  hue no longer has to.

### 4.3 The evidence seam

Anything the target app said or is named by is recognised by **three things simultaneously — its
face, its position and its ink** — so the seam survives colour blindness, the dark flip, an 11px
render and a total webfont failure:

- **Face:** IBM Plex Mono. Always.
- **Position:** in the ledger stub if it is a locator; in a recessed `sunk` well with a **2px
  `evidence` left edge** if it is a payload. The 2px left rule is the only 2px border in the
  system besides focus.
- **Ink:** `--color-evidence`, the kit's `info` value. Blue is the only non-brand hue in the
  system, so it reads as *not us* — which is exactly what a quoted machine utterance is. Zero
  invented hues, and it puts severity (red → sienna → olive → grey) on a completely separate arc
  of the wheel from evidence (blue).

Specifics:

- **`CallRef`** — `t-ref` in `evidence` on `evidence-wash`, `px-1 py-[1px]`, **square**, 1px
  `rule-strong` border. Square because it *names a record*; and it may not be a stadium, because a
  stadium means cohort.

  > **Amendment (conformance review).** This bullet specified a 1px `evidence/30` border, which
  > ATOMIC-INVENTORY §0.2 forbids outright — *"no `/30` alpha"*. The ban wins and the alpha is
  > retired. An alpha border is a fourth, invented value of a hue that already has exactly two
  > tokens; it composites differently over `evidence-wash` than over the `sunk` well a ref sits in
  > inside a ledger stub; and it is the first thing to vanish at 11px on a low-contrast display.
  > `rule-strong` is the token for *an interactive boundary* (§4.1), which is what this is, and
  > nothing is lost by the swap: the ink and the face carry the whole meaning of the seam, and the
  > border is the faintest thing on the row by design. **The `current` ref still takes the opaque
  > `evidence` border**, so the selected locator is still drawn in the seam's own hue — and, per
  > §4.2, announced with `aria-pressed` rather than left to colour.
- **`ToolName`** — `t-code` in `evidence`. In a transcript row, a `tool.call` step's *title* is
  mono/evidence while every other kind's title is sans — the family alone tells you which steps
  touched the target, with no colour read at all.
- **`Payload`** — `bg-sunk`, 1px `rule`, 2px `evidence` left edge, **square**, `p-3`, `t-code-sm`
  **inked `evidence`** — it is machine output, and §4.7's table gives machine output the evidence
  ink; a payload in `ink-soft` would be the one well in the system not wearing the seam's colour —,
  `whitespace-pre-wrap`, `tab-size: 2`, JSON pretty-printed at 2-space indent (today it is a raw
  single-line `JSON.stringify`). A `t-label` caption above it — `WHAT THEY SENT` / `WHAT CAME
  BACK`. Over 24 lines it collapses with a `Show all 312 lines` link; **the current hard cut at
  600 characters silently loses evidence and does not get rebuilt.** A `Copy` `IconButton` sits
  top-right, visible on hover and `focus-within`, always present to a screen reader.
- **Inline `Code` in prose** — `t-code-inline`, `evidence`, `evidence-wash`, `px-1`, square, no
  border. So `c1, c2, c3` inside a landing sentence shows the seam doing its job mid-sentence.

**There is one well, not three.** Every quoted machine utterance in the product — a tool call's
arguments and result, a target's error, the message behind a failed read — is drawn by the single
`PayloadBlock` component. `ToolCallBlock` and `StateBlock` render theirs through it rather than
spelling the rule a second and third time; a hand-rolled well is how a system ends up with three
nearly-identical seams that drift apart one commit at a time.

### 4.4 Numerals are always tabular

Every figure in the product — statistics, counts, durations, money, fractions, sequence numbers,
run ids — carries `font-variant-numeric: tabular-nums slashed-zero`. It is baked into every sans
step and every mono step, so a component never applies it by hand. The survey found
`tabular-nums` written out 60 times and missing where it mattered; after the port it should
appear zero times outside the type utilities.

### 4.5 Facts are separated by a hairline, not a middle dot

`A · B · C` appears on every screen today in two incompatible implementations. It is replaced by
a **12px vertical hairline `Separator`** between facts:

```
ephemeral │ Early adopters (12 people, 2 cohorts) → Acme Tasks │ execution 3 │ 14 Mar 09:41
```

A dot-joined meta string is the generic default; a hairline tick between facts is what a scale
looks like, and it costs the same markup. The only surviving `·` in the product is inside a
`t-code-sm` machine string where the target app produced it.

**Where a fact line is read once rather than compared across rows** — a detail pane, a lede, an
empty state, an `aria-label` — it is written as a **sentence** instead
(`MetaSentence`): *"Nine of twelve people hit this, first in execution 2 and last four minutes
ago."* `format.ts` already has `people()`, `plural()`, `ago()` and `lasted()`. **MetaSentence is
banned from table rows and list rows**, because prose cannot be compared down a column and the
reader is scanning.

### 4.6 The focus-ring rule

`--color-focus` equals `--color-primary` in both themes, so a plain ring on a primary button is
invisible. One two-part ring, built once, applied by every focusable atom, never re-rolled:

```css
@utility focus-ring {
  &:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px var(--focus-sep, var(--color-bg)),
      0 0 0 4px var(--color-focus);
  }
}
```

`box-shadow` inherits `border-radius`, so the ring is correct on square rows, 6px controls, 12px
cards and full-round avatars with no per-shape work. A component sitting on a non-page ground
sets `--focus-sep` on its container (`var(--color-surface)` inside a card, `var(--color-sunk)`
inside a well) so the separator band is always the colour immediately behind the control.

This is the single largest accessibility gain in the rebuild: the survey found **zero**
`:focus-visible` styles in the entire app.

### 4.7 Prose versus machine output

| | Prose | Machine output |
|---|---|---|
| Family | Source Serif 4 (or Space Grotesk in a dense container) | IBM Plex Mono, always |
| Colour | `ink` / `ink-soft` | `evidence` |
| Ground | the page, or a card | `sunk`, with a 2px `evidence` left edge |
| Radius | n/a | **square** |
| Emphasis | `ink` against `ink-soft`. **Not bold, not italic, not colour** | none; it is a quotation |
| Italic | only `t-voice`, only a person's verbatim words | never |

**Italic belongs to people.** Space Grotesk has no italic axis and `font-synthesis: none` forbids
obliquing it, so italic exists only in Source Serif 4 and is reserved for `inTheirWords` and the
walked-away quote. Consequence: the existing `Empty` atom (19 sites, currently italic) becomes
**upright** `t-read` in `ink-soft`, because there the *product* is speaking, not a person.

---

## 5. MOTION, ELEVATION, DENSITY

### 5.1 Motion

Durations and easing are tokens (§2.4). `--ease: cubic-bezier(.2,0,0,1)` for entries and states;
`--ease-exit: cubic-bezier(.4,0,1,1)` at 0.75× the entry duration for exits.

| Thing | Property | Duration |
|---|---|---|
| button / row / nav hover, active, selected | `background-color`, `border-color`, `color` | 90ms |
| focus ring appearing | `box-shadow` | 90ms |
| checkbox, radio, switch thumb | `transform: translateX` (switch only), `background-color` | 140ms |
| disclosure (Known, Triage, cohort cards, GetStarted steps) | `height`, `opacity` | 160ms |
| dialog, popover, dropdown, select, tooltip | `opacity` 0→1, `translateY` 4px→0 | 240ms in / 180ms out |
| live-feed row arriving | a 3px `primary` left edge painted instantly, then `opacity` 1→0 | 900ms, `linear` |
| the live dot | `opacity` 1 → 0.35 → 1 | 2000ms, infinite |
| the landing hero fan | `stroke-dashoffset`, then each terminal dot's `r` 0→7 | 900ms total, 70ms stagger |
| the landing hero lattice | `opacity` + `scale(.6)→1`, 28ms stagger capped at 24 dots | 1200ms |

**AMENDMENT — the live-feed freshness edge is `primary`, not `accent`.** This table said `accent`
until `LiveActivityFeed` was built against it and the token was measured. `accent` is lime on
paper at **1.08:1** in light and forest on ink at **1.55:1** in dark, so a 3px edge in it is
invisible in *both* themes; §4.1 already forbids lime as a border or a bar fill, and §5.4's five
sanctioned appearances contain no rule. `primary` is an ink in both themes (8.63:1 light, 12.35:1
dark) and in dark it is the very lime this row asked for, so the mark reads and no hue was added
to make it read. The row above now says `primary` and `organisms/LiveActivityFeed` implements it;
the two agree, and neither is the place to reopen it.

**AMENDMENT — a centred overlay animates `transform`; it never animates the centring.**
`Dialog`, `AlertDialog` and `ConfirmButton` centre themselves with `left-1/2 top-1/2
-translate-x-1/2 -translate-y-1/2`, and their keyframes used to restate it —
`translate(-50%, calc(-50% + 4px))` → `translate(-50%, -50%)`. Under Tailwind v3 that was
correct: the utility compiled into `transform`, so the keyframe replaced it. **v4 compiles it
into the independent `translate` property**, which COMPOSES with `transform` rather than being
overridden by it, so each panel was displaced -50% twice and opened one panel-width left and one
panel-height above the middle of the window. The centring lives in the utilities, in one place;
the keyframes carry the 4px of travel and the fade and nothing else:

```css
@keyframes populace-dialog-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

A keyframe that spells `-50%` anywhere is a review stop. The overlays that are positioned by
Radix rather than by a utility — popover, dropdown, select, tooltip, toast — were never affected
and are unchanged.

**What must never animate.** This list is a review rule.

- **`Bar` / `Meter` widths.** Live screens poll every 2s; an animated width means every bar on
  the screen twitches twice a second forever. Widths change instantly.
- **Numbers.** No count-up, anywhere. A figure that animates from 0 to 47 is lying about a
  measurement for half a second, and in a product whose honesty clause is "outcomes vary" a
  spinning number is a lie about precision.
- **The transcript list and the Visits table.** 200 rows refetched every 2s. Rows are keyed by
  step id and memoised; any enter animation turns a re-render into a strobe, and selection is
  never stolen.
- **The lattice on a re-poll.** It animates on first paint only.
- **Route transitions.** None. The page is there or it is not.
- **Skeleton → content.** Swap, do not cross-fade. Skeletons are built to the exact height of
  what they replace, so there is no reflow to hide.
- **The theme switch.** Instant. A 200ms transition over every colour on a dense screen is
  nauseating and advertises any unthemed spot as a flicker.
- **Section entrances on scroll.** Zero, including on the landing. The page has exactly one
  orchestrated moment and it is the hero.

**Reduced motion.**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
Plus three deliberate substitutions, because a blanket override loses meaning: the live dot stops
pulsing and gains a 1px lime ring (still visibly different from a static dot); the hero fan and
lattice render their final state immediately; the live-feed freshness edge is painted and left in
place, removed on the next state change rather than decayed.

### 5.2 Radius, by kind

| Radius | Kind | Applies to |
|---|---|---|
| **0** `none` | **data** | table cells, payload wells, transcript rows, the ledger stub, call-ref pills, code, the severity stack, section rules, feed rows |
| **6** `sm` | **controls** | buttons, inputs, selects, textareas, menu items, tabs, kbd, checkboxes, the theme toggle |
| **12** `md` | **containers** | cards, dialogs, popovers, tooltips, toasts, the sticky detail pane |
| **20** `lg` | **landing only** | the hero panel, case-study blocks, the final CTA. **Zero uses inside `/app`** |
| **full** | **people and states** | avatars, person dots, cohort capsules, live pills, count badges, the radio dot, the meter track |

The consequence worth stating: **a data table has a 12px radius on its outer container and square
cells inside it**, and the transcript's 200 rows are square. A 6px radius on a 22px row is 27% of
its height — it becomes a lozenge and the list dissolves. Square rows on a hairline grid is what
a recorder trace looks like.

### 5.3 Density

Density is the thesis, so this direction gets **denser** than the app is today, not looser. The
serif does not endanger that, because the serif is never used for chrome: the threshold rule
(§3.1, rule 6) means it simply is not present in the densest places.

**Two screen classes**, and every screen declares which it is (the port plan in
`ATOMIC-INVENTORY.md` assigns them):

- **Document-class** — SimulationResults, FindingInFull, Person, Gaps, WhoLeft, Cohort, Preflight,
  GetStarted, ProjectHome, Settings, Projects, the landing. Ledger stub on, serif reading column
  at `--measure-read`, an optional 264px sticky instrument rail at ≥1240px carrying the numbers.
  The full direction applies.
- **Instrument-class** — Visits, WatchAVisit, LiveRun, Compare, Executions, RunCohorts, People,
  PeopleWhoHit. Full `--w-page`, 32px rows, `t-ui` 13px chrome, square cells, hairline
  separation, the stub tabulated as the leading column. The direction survives in four ways and
  is not applied literally: (1) the stub returns as the 72px leading column; (2) exactly one
  column carries a sentence and that column is `t-read-sm` serif; (3) column heads are `t-label`
  with a hairline beneath and **no fill and no zebra**; (4) numbers are `t-ui` tabular, right
  aligned, columns sized to the widest value plus 16px.

**Row heights.** Table row 32px (40px with a sub-line). Transcript row 32px (44px with a
sub-line) — this beats the 34/48 that an all-sans transcript would cost, and it is the number the
stub has to earn. List row `py-3.5`. Feed row 28px.

**The Visits table, specifically.** Nine columns plus a 72px stub does not fit 1100px. Two columns
move: the **turn count** and the **token count** move into the row's expandable detail (they are
diagnostic, not scanning, data), and so does the one thing no column measured — whether they said
they would come back. Seven columns remain: person, cohort, start time, outcome (the one serif
column — `wakeOutcome()`'s phrases are sentences), tool calls, findings, cost.
Below 1000px, **cut a column, do not shrink the type**; the stub is not negotiable. Under 860px
the stub collapses to a leading line and the table becomes a card list.

**AMENDED — what the Visits stub holds.** This paragraph named seven columns including "visit
number" and left the stub unnamed, and the only thing displaced from the nine was the start time,
so the port put the time in the stub, behind a `Button` that opened a `Popover`. Both halves were
wrong by M2 above: a stub carries **locators only**, and a time is not one — nor is a control.
**The visit's own number is the stub** (the same locator the `Person` screen already puts in the
same column on the same rows), and the start time takes the column the number vacated, where it
is also the link into the transcript. Seven columns, one stub, and no control in it.

**Responsiveness, which does not exist today.** Every literal `grid-cols-N` and `w-[Npx]` becomes
a token with breakpoints. Stat strips go 5 → 3 (lg) → 2 (md). Two-column splits stack at 1000px,
with the **detail pane above the list** (a narrow reader wants the current step, not the index).
The sidebar becomes a Radix `Dialog` drawer below 900px. The instrument rail appears only at
≥1240px and otherwise sits beneath the content as a 2-column grid of the same blocks.

### 5.4 The lime law, stated as five sanctioned appearances

There is no sixth. Total lime area on any dashboard viewport must fit inside a 24×24px square.

1. **The marker.** Exactly one number or phrase per screen may be marked. In light, a `#D7F56B`
   band sits behind the ink at the x-height:
   `background: linear-gradient(var(--color-accent), var(--color-accent)) 0 0.72em / 100% 0.5em no-repeat; box-decoration-break: clone;`
   Ink on lime is 12.35:1. In dark it inverts to a **2px lime rule under the text**, because a
   lime fill large enough to sit behind text is a flashlight in a dark room.
2. **The live dot.** A 6px lime dot on a **forest** pill with paper text. Lime on forest is
   7.97:1 and legal in both themes, which is why the live `Chip` is forest-grounded in light *and*
   dark (`primary` in light, `accent` in dark — the same colour, a different token name).
3. **The primary button, in dark only.** The kit's swap makes lime `primary` in dark; lime with
   ink text is 12.35:1. In light the primary button is forest.
4. **"The one" lattice dot.** In light: a lime fill carrying a **mandatory 1.5px
   `--color-mark-ring` (ink) ring**, which is the only structural answer to 1.22:1 on white. In
   dark, where lime is already everywhere, "the one" becomes a **2px lime ring on transparent**
   instead of a second lime language. Which element earns it, per screen, is fixed: Results → the
   incidence peak of the worst cluster; LiveRun → the person who most recently filed; FindingInFull
   → the confirmed verdict's glyph; Preflight → the "Send them in" button; Visits / Compare / Gaps
   → **nothing**, those screens have no single answer and get none.
5. **The mark's own dot, the landing hero CTA (ink on lime, 12.35:1) and the fan's "filed"
   terminal dots.**

   **Amendment (mark-grammar conformance).** As written, this appearance licensed the fan's lime
   only "on the landing's forest band", which is where §5.4 assumed the fan lived. It does not:
   §9.3 puts the hero fan on **paper**, and `ExplorationFan` is also the empty-state and
   `NotFound` artwork, where lime is 1.08:1 and a flat lime terminal dot is invisible — the
   picture's primary information, gone, in the light theme, everywhere except one band. The rule
   is therefore the one M5 already states with no exception: **a lime fill in light carries the
   mandatory 1.5px `--color-mark-ring` ring, and the fan's "filed" terminal is no exception.** It
   is drawn with the mark's own `theOne` classes — lime fill + 1.5px ink ring in light, a 2px
   lime ring on transparent in dark — so the terminal and the legend swatch that keys it cannot
   drift apart. On the forest band the ring costs nothing: `mark-ring` is ink, and lime on forest
   is 7.97:1 with or without it.

---

## 6. ACCESSIBILITY CONTRACT

Every line here is testable, and every one is a regression from the current app if it is missed.

**Contrast floors.**
- Text: **4.5:1** against every ground it is legal on. Every token in §2.2 and §2.3 that carries
  text meets this — including `ink-muted`, which is the app's most-used text colour and is
  **≈3.6:1 today** across 140+ sites at 11–12px. The new value is 5.16–6.39:1.
- Large text (≥24px, or ≥19px at 500+): 3:1. We ship nothing that relies on this relaxation.
- Interactive boundaries and meaningful non-text marks: **3:1** — `rule-strong` (3.20–5.45),
  `graph` (3.51–4.92). The kit's `border` at 1.37–2.62 may **never** bound a control.
- Focus indicator: the outer 2px ring is `focus` against a 2px band of the ground colour, so it is
  ≥3:1 against everything it can sit on by construction.
- Decorative only, exempt by rule: `rule`, the three washes, `accent` as a ground, `--pop-clay`.

**Focus visibility.** Every focusable element applies `focus-ring` (§4.6). No `outline: none`
without a replacement. The transcript list, the live feed and the project switcher are **roving
tabindex composites** — one tab stop each, arrows to move, Enter to select,
`aria-activedescendant` — rather than 200 tab stops, 200 tab stops and an unclosable menu.

*One tab stop means one.* A `ScrollArea`'s viewport is focusable by default, because a scroll
container is focusable in Firefox and nowhere else and a keyboard reader must be able to scroll a
300-line payload well. Around a composite that already owns its keys that would be a **second**
stop, so such a composite passes `focusable={false}` and keeps the one stop this paragraph gives
it.

**Keyboard operation.** *(Amended by the port review, S5.36: an editor drawn **in place** owes the
same focus contract a dialog gets free from Radix. Opening it moves focus to the first control
there is to type in; closing it — saved or cancelled — returns focus to the control that opened
it. A row whose Edit button unmounts under the caret drops focus to the top of the document, and
a keyboard reader who cancels is returned to nothing.)* A `SkipLink` as the first focusable element on the page (`--z-skip`).
`<main>` gets `tabindex="-1"` and focus moves to it on route change, with a `RouteAnnouncer`
(`aria-live="polite"`) naming the new screen — React Router moves neither today. Every dialog,
popover, menu and select is Radix, so Escape, focus trap and focus return come free. The project
switcher — today a `<button aria-expanded>` plus an absolutely positioned div with no Escape
handler, so a keyboard user can open it and never close it — becomes a Radix `DropdownMenu`.

**Reduced motion.** §5.1, including the three substitutions that keep meaning when motion is off.

**Heading order.** `PageHeader` owns the single `<h1>`; `Section` owns `<h2>`; a card title inside
a section is `<h3>` — and a card sitting **directly** under a `PageHeader`, with no section
between them, takes `<h2>` through `CardHeader`'s `level`, because h1 then h3 is a skipped level.
Appearance never changes with depth: the level is the semantics and the type step is fixed. The five screens that currently hand-roll an `<h1>` to get an actions slot
stop doing so, because `PageHeader` now has one. `GetStarted` has no `h1` today and starts at
`h2`; as an embedded panel it takes `<h2>` explicitly from its template rather than by accident.
`FindingInFull`'s four sibling `<h2>`s become one `<h2>` per `Section` with `<h3>` beneath.

**Form labelling.** *(Amended by the port review, S5.30, S5.31, S5.35. Three rules follow from
this paragraph and were being broken.* **One:** a `Field` wrapping a control that is not a
*labelable* element — a `Stepper`'s `role="group"`, a `Slider`'s `role="slider"` — must hand that
control the render prop's `id` and `describedBy`, or the caption's `htmlFor` points at an id that
exists nowhere and the hint reaches nothing; `Stepper` takes both props for exactly this, as
`Slider` already did. **Two:** a control with a visible `<Label>` takes no `aria-label`, because
the ARIA name overrides the words a speech-input user can see and say — WCAG 2.5.3, label in
name. **Three:** an error id exists to be pointed at. Minting one with `useId` and wiring it to no
`aria-describedby` is wiring in the source and wiring nowhere; either the control whose press
failed names it, or — where no single control owns the failure, such as a row action any of twelve
rows could have fired — the message carries no id at all and its `role="alert"` is the whole
announcement.)* `Field` uses Radix `Label` with an explicit `htmlFor`, and the **hint moves
out of the `<label>` onto `aria-describedby`** — today it sits inside the label and is read as
part of it. An error message is `role="alert"`, wired by `aria-describedby`, with `aria-invalid`
on the control. Every radio and checkbox group is a Radix `RadioGroup` / fieldset with a legend;
`NewSimulation`'s two bare radios have no group semantics today.

**Never colour alone.** §4.2. Enforced additionally on: `Bar`/`Meter` (`role="progressbar"` with
`aria-valuenow/min/max` and an `aria-valuetext` that is a sentence — the spend meter's number
reaches nobody today); the lattice (`role="img"` with the sentence as its label, dots
`aria-hidden`, and the `n of N` text always adjacent); the execution dot strip (its count lives in
`title=` today and moves into the DOM).

**Live regions.** `Loading` is `role="status"` with `aria-busy`; `Failed` and `Problem` are
`role="alert"`; the live `Chip` and the run-status line are `aria-live="polite"`; the live feed
announces a count ("34 events") rather than reading every arriving row; the transcript announces
"step 34" rather than the row's contents.

**Tap targets.** 24×24px minimum for every control, 44px on coarse pointers via a `::after` hit
area. `Stepper`'s − and + are ~20×24 today and fail this. The rule binds every control without
exception, including a **selectable lattice dot**, which is 6–15px of drawn mark and therefore
carries the box rather than the target: neighbouring targets overlap at the mark's pitch, and the
later dot wins the seam. The one exemption is a link inside prose, where a 44px box would swallow
the words either side of it.

**A control at a bound is inert, not gone.** *(Amended by the port review, S5.32: this binds a
text `Button` as much as an `IconButton`, and `Button` therefore carries `atBound` — the two
places in the product that gate spending real money behind a list of blockers gate a text button,
and both were natively `disabled` with the blockers far up the page and associated with nothing.
The control names the list in `aria-describedby` and carries a `Tooltip`, so the reason is
reachable from the control rather than only findable by scrolling.)* A natively `disabled` button takes no pointer events
— so its tooltip can never open — and leaves the tab order, so a keyboard reader never meets it
either. Where the control is an `IconButton`, that loses both of the two things the next
paragraph requires of one and leaves an unnamed glyph on screen. Such a control therefore carries
`aria-disabled` and keeps its focus, its name and its tooltip, and swallows the press.

**Icons.** An affordance glyph never appears without a text label, except inside an `IconButton`,
which requires both an `aria-label` and a `Tooltip`. This is not a platitude — it is the
direction: an instrument is labelled.

---

## 7. COPY RULES

### 7.1 The vocabulary the wire and the UI speak

A user sets up a **project**, composes **people** into **cohorts** and a **population**, and runs
a **simulation** whose **executions** send those people on **visits**, which produce **findings**
that cluster into **problems**. Use exactly these words, in this shape:

| Word | Means | Never say instead |
|---|---|---|
| **project** | one product under test; scopes targets, personas, cohorts, populations, simulations, settings, triage | workspace, org |
| **target** | the app's MCP endpoint and its policy | server, system under test |
| **persona** | a kind of person | archetype, profile |
| **person** | a durable named individual, `cohortSlug#ordinal` | agent, user ID, instance |
| **cohort** | N people of one persona; the **only** place a headcount lives (`size`) | group, batch, scale |
| **population** | the ordered set of cohorts; composition and nothing else | fleet, swarm, squad |
| **simulation** | a population + a target + a mode; the thing you press go on | job, campaign, test |
| **execution** | one time you pressed go | run (in copy — "run" survives only in `runId` and the CLI) |
| **visit** | one session one person had | wake, session, episode |
| **finding** | one problem with receipts | issue, bug report, log entry |
| **mode** | *a few visits each, then stop* / *keep coming back until I stop it* | ephemeral/longitudinal as a bare word without its gloss on first use |

### 7.2 Forbidden words

**"agent" and "wake" appear nowhere a human can read** — copy, headings, labels, placeholders,
empty states, tooltips, `aria-label`, `title`, route paths, query parameters, test ids, or error
messages. Internally the rows are still `Agent` and `Wake` and every store method keeps its name;
that stays under `packages/contract`, which is the translation layer.

Two live leaks this rebuild inherits and must not widen:
- The route `visits/:wakeId` and every link built from it. **Out of scope for this rebuild** (it
  is routing, not design), but it should be renamed `:visitId` the next time someone touches
  routing, and the design system will not print the param anywhere. Where the id must be shown, it
  is labelled *"this visit's id"* in a `t-code-sm` line.
- `WatchAVisit`'s generic detail pane prints `event.type` raw, which puts `wake.start` on screen,
  and the `wake.start` sub-line prints `agentId · runId`. Both are replaced by a lookup of human
  nouns and by a `MetaSentence`.

The brand kit's approved headline — *"See your app through agents' eyes."* — uses a banned word,
and the landing page is a route in this SPA and therefore UI copy. It is restated as
**"See your app through your users' eyes."** The descriptor is safe verbatim and is used
verbatim everywhere: **"Autonomous testing for MCP apps."** The kit's description becomes
*"Populace deploys a population of AI people who use your app through its MCP server, uncover
bugs, and reveal usability and discoverability problems."*

### 7.3 The non-determinism rule

Outcomes vary between executions **by design**. There is no determinism subsystem.

- No copy — in the app, in the landing, in a tooltip, in a test name — may promise identical,
  repeatable or reproducible results. "Catch the same bug every time", "verified fixed",
  "consistent results" are all forbidden.
- **A problem absent from the newest execution is reported as an absence, never as a fix.**
  `stateOfCluster`'s vocabulary is preserved verbatim: *"gone quiet"*, *"not reported"*. The word
  **"fixed" appears only inside `TRIAGE_WORDS`**, where a human asserts it about their own
  product.
- `INDEPENDENT` and `CAVEAT` and the line *"an absence, not a repair"* are preserved verbatim.
- The landing's honesty clause is a **section**, not a footnote, and it is the page's second most
  emphatic block after the masthead.

### 7.4 Voice

Plain, specific, and in the reader's own terms. The product reports; it does not congratulate.

- **Say what happened, with a number.** "Nine of twelve people hit this, first in execution 2."
  Not "Multiple users affected."
- **Empty states are sentences that invite, not labels that apologise.** *"Twelve people made 36
  visits and none of them hit a problem worth filing. That is a result, not a gap — the coverage
  table says which of your tools they actually reached."* Serif, upright, `ink-soft`, never
  italic.
- **A zero-findings execution is a result, not an empty state.** It gets the same 30px serif
  statement any other execution gets.
- **Labels are sentence case.** The only uppercase in the product is `t-label`'s four data-label
  roles.
- **Buttons name the act, in the product's own words**: "Send them in", "Stop", "Pause",
  "One more round", "Re-cast all of them". Not "Submit", "Execute", "Run job".
- **No exclamation marks, no emoji, no arrows appended to link text.** An arrow is drawn only
  where something literally moves.
- **Errors say what failed and what to do**, with the machine's own words quoted in a mono well
  beneath, never paraphrased into prose. **There is one component for this**, `WhatWentWrong`
  (§3): the product's sentence in a `role="alert"` line, the machine's verbatim words in the one
  well beneath it. A raw `error.message` dropped into a `FieldError` is both halves collapsed
  into one — an HTTP status and a server's punctuation inside the product's own voice, with the
  evidence seam (§4.3) lost — and it was the spelling on four screens while five used the pair.
- **Never promise a consequence the server will refuse.** *(Port review, S4.28.)* Removing a
  persona said *"The cohort drawn from X goes too, and N people leave the population"* in every
  case, computed from a count that is one cohort's size. The server refuses outright when more
  than one cohort draws from the persona, so for exactly the reader who most needed telling, the
  dialog promised a cascade and a headcount and the press then failed. **Copy that states an
  outcome states the outcome the server will actually produce, including the refusal**, and it
  reads the fact it needs from the record that holds it rather than from the nearest number that
  looks like it. Where an act is refused by rule, the control is at a bound and not gone (§6) and
  the reason names what to do first.
- **A section's `trailing` is a FACT, never an instruction.** *(Port review, S4.27.)* It is the
  figure on the far right of the section rule — *"12 people"*, *"3 populations"* — and it is read
  alongside the eyebrow as one line. *"click one to meet the people in it"* is an affordance the
  rows carry themselves, and an instruction sitting where every other section shows a number is
  read as a number and found to be prose.
- **Never name a persona where a person has a name.** Rows are labelled by person and cohort.

---

## 8. THE BRAND ASSET PLAN

### 8.1 What moves, where, and under what name

Source: `Populace-Brand-Assets-v1/` at the repo root (currently untracked). It stays in the repo
as the licensed source of truth; the web package gets a curated copy.

| From | To | Why this one |
|---|---|---|
| `logos/svg/populace-logo-primary.svg` | `packages/web/public/brand/logo.svg` | the horizontal lockup, ink lettering with the lime dot in the P's counter — the spark survives on paper. Light theme, sidebar and landing nav |
| `logos/svg/populace-logo-inverse.svg` | `packages/web/public/brand/logo-inverse.svg` | all-paper. **Dark theme and forest grounds only** |
| `logos/svg/populace-mark-primary.svg` | `packages/web/public/brand/mark.svg` | the standalone mark, for anything under 160px wide |
| `logos/svg/populace-mark-inverse.svg` | `packages/web/public/brand/mark-inverse.svg` | the same, on dark |
| `patterns/populace-exploration.svg` | `packages/web/public/brand/exploration.svg` | the nine dashed béziers. Kept as a file for the OG card; the landing hero **redraws its geometry inline** so it can animate and theme |
| `icons/favicon.svg` | `packages/web/public/favicon.svg` | carries its own tighter padding and lime tile for 16–48px. Do **not** substitute the mark |
| `icons/favicon.ico` | `packages/web/public/favicon.ico` | legacy |
| `icons/favicon-16.png` `-32.png` `-48.png` | `packages/web/public/` (same names) | legacy |
| `icons/populace-icon-180.png` | `packages/web/public/apple-touch-icon.png` | `<link rel="apple-touch-icon">` |
| `icons/populace-icon-192.png` `-512.png` | `packages/web/public/icon-192.png`, `icon-512.png` | the web manifest |
| `icons/populace-app-icon.svg` | `packages/web/public/icon.svg` | 512, square, deliberately un-rounded so the platform applies its own mask |
| `fonts/SpaceGrotesk-Variable.ttf` | `packages/web/public/fonts/SpaceGrotesk-Variable.woff2` (converted) | §8.4 |
| `fonts/SpaceGrotesk-OFL.txt` | `packages/web/public/fonts/SpaceGrotesk-OFL.txt` | the licence must ship beside the font |

**Not copied:** the `-on-paper` / `-on-forest` lockups (they bake a background rect and are for
contexts where we do not control the surface — OG images, email, PDFs, slides; never inside the
app, where the surface is a token), the `-white` variants (white is colder than the brand's
light; on our ink background `-inverse` is correct), the wordmark-only files (we always have room
for the full lockup or the mark), the `png/` exports (SVG everywhere; PNG only for the icon set),
and `preview/`.

### 8.2 The exact copy commands

```bash
cd /Users/nickschrock/git/populace
SRC=Populace-Brand-Assets-v1
DST=packages/web/public

mkdir -p "$DST/brand" "$DST/fonts"

# logos and the pattern
cp "$SRC/logos/svg/populace-logo-primary.svg"  "$DST/brand/logo.svg"
cp "$SRC/logos/svg/populace-logo-inverse.svg"  "$DST/brand/logo-inverse.svg"
cp "$SRC/logos/svg/populace-mark-primary.svg"  "$DST/brand/mark.svg"
cp "$SRC/logos/svg/populace-mark-inverse.svg"  "$DST/brand/mark-inverse.svg"
cp "$SRC/patterns/populace-exploration.svg"    "$DST/brand/exploration.svg"

# favicons and app icons
cp "$SRC/icons/favicon.svg"              "$DST/favicon.svg"
cp "$SRC/icons/favicon.ico"              "$DST/favicon.ico"
cp "$SRC/icons/favicon-16.png"           "$DST/favicon-16.png"
cp "$SRC/icons/favicon-32.png"           "$DST/favicon-32.png"
cp "$SRC/icons/favicon-48.png"           "$DST/favicon-48.png"
cp "$SRC/icons/populace-icon-180.png"    "$DST/apple-touch-icon.png"
cp "$SRC/icons/populace-icon-192.png"    "$DST/icon-192.png"
cp "$SRC/icons/populace-icon-512.png"    "$DST/icon-512.png"
cp "$SRC/icons/populace-app-icon.svg"    "$DST/icon.svg"

# the font, and its licence, which must travel with it
cp "$SRC/fonts/SpaceGrotesk-OFL.txt"     "$DST/fonts/SpaceGrotesk-OFL.txt"
python3 -m pip install --quiet 'fonttools[woff]' brotli
python3 -c "
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options
f = TTFont('$SRC/fonts/SpaceGrotesk-Variable.ttf')
o = Options(); o.layout_features = ['*']; o.name_IDs = ['*']; o.drop_tables = ['DSIG']
s = Subsetter(options=o)
s.populate(unicodes=list(range(0x00, 0x100)) + [0x0131, 0x0152, 0x0153, 0x2212]
                   + list(range(0x2000, 0x2070)) + list(range(0x2190, 0x2194))
                   + [0x2022, 0x25CF, 0x25CB, 0x20AC, 0x2713])
s.subset(f)
f.flavor = 'woff2'
f.save('$DST/fonts/SpaceGrotesk-Variable.woff2')
print('wrote', '$DST/fonts/SpaceGrotesk-Variable.woff2')
"

# verify the metrics the size-adjust overrides depend on
python3 -c "
from fontTools.ttLib import TTFont as T
f = T('$DST/fonts/SpaceGrotesk-Variable.woff2')
o, h = f['OS/2'], f['hhea']
print('upm', f['head'].unitsPerEm, 'asc', h.ascent, 'desc', h.descent,
      'xh', o.sxHeight, 'cap', o.sCapHeight)
print('axes', [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in f['fvar'].axes])
"
```

Expected from the last command: `upm 1000 asc 984 desc -292 xh 486 cap 700` and
`axes [('wght', 300.0, 300.0, 700.0)]`. If they differ, the `size-adjust` numbers in §8.4 are
wrong and must be recomputed before shipping.

`packages/web/public/` is gitignored today only because it does not exist; add the directory and
commit it. `Populace-Brand-Assets-v1.zip` at the repo root should be deleted after the extraction
is committed.

### 8.3 Which lockup, where

The kit's rules, applied: *"Keep at least one circle diameter of clear space around visible
artwork… Minimum recommended horizontal logo width: 160 px. Below that, use the standalone mark…
Use inverse/white artwork only on dark backgrounds. Do not stretch, add effects, or recolor
individual modules arbitrarily."*

Clear space in numbers: one circle diameter = **26 viewBox units**; the file's own padding is 16
units on every side, so we owe a further 10 units ≈ **6.6% of the logo's rendered height** as
empty space on all four sides, and nothing may sit inside it. Aspect ratios: horizontal logo
**685:152** (4.507:1), mark **146:152** (0.96:1 — slightly taller than wide, so do not box it in
a perfect square and expect optical centring), wordmark 535:136. Always set both dimensions or
use `aspect-ratio`; never let flexbox squash it.

| Context | File | Size |
|---|---|---|
| Sidebar header, light | `brand/logo.svg` | 168px wide (rail is 236px, minus 2×32px padding = 172px) |
| Sidebar header, dark | `brand/logo-inverse.svg` | 168px |
| Collapsed rail / mobile header / loading | `brand/mark.svg` / `mark-inverse.svg` | 24–32px |
| Landing nav | `brand/logo.svg` (light) / `logo-inverse.svg` (dark) | 160px — the kit's minimum |
| Landing forest band | `brand/logo-inverse.svg` | 180px |
| Landing footer | `brand/mark.svg` | 24px |
| Browser tab | `favicon.svg` + `.ico` + the three PNGs | — |
| OG / social card | `brand/exploration.svg` (1200×630, forest ground, baked) | — |

**The dark header's missing spark, honestly.** `populace-logo-inverse.svg` sets *every* module to
`#F4F1E9`, including the dot at (44,44) that is lime in the primary artwork. The lime spark is
therefore absent from the dark-mode header as shipped, and restoring it would mean recolouring an
individual module, which the kit forbids. **Ship `-inverse` as-is.** Dark mode is not
lime-starved — the primary button, the focus ring and the marker rule are all lime there. Raise
a request for `populace-logo-inverse-signal.svg` as a v1.1 brand item. **Do not hand-edit the
SVG.**

### 8.4 Fonts: self-hosting and loading

`index.html`, in the head, in this order — the inline theme script (§2.9), then:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="preload" href="/fonts/SpaceGrotesk-Variable.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,300..600;1,8..60,300..600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/favicon.ico" sizes="48x48" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="color-scheme" content="light dark" />
<meta name="description" content="Autonomous testing for MCP apps." />
```

The stylesheet `<link>` is behind a build flag: **`VITE_FONT_SOURCE=cdn|local`**, default `cdn`.
With `local`, Vite injects nothing and `theme.css` loads self-hosted WOFF2s from `/fonts/`
instead. This flag must actually be built, not merely specified — the dashboard is local-first and
routinely runs against `localhost` with no network, and without the flag the first air-gapped
install silently ships Georgia and nobody will have decided that.

In `theme.css`, before the `@theme` block:

```css
@font-face {
  font-family: "Space Grotesk";
  src: url("/fonts/SpaceGrotesk-Variable.woff2") format("woff2-variations");
  font-weight: 300 700;         /* the fvar wght axis. There is no italic axis. */
  font-style: normal;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+2190-2193, U+2212, U+2022, U+25CF;
}

/* Metric-matched fallbacks, so `swap` causes no layout shift. */
@font-face {
  font-family: "Space Grotesk Fallback";
  src: local("Helvetica Neue"), local("Arial"), local("Segoe UI"), local("Liberation Sans");
  size-adjust: 94%;          /* 0.486 / 0.517 */
  ascent-override: 104.7%;   /* 98.4 / 0.94 */
  descent-override: 31.1%;   /* 29.2 / 0.94 */
  line-gap-override: 0%;
}
@font-face {
  font-family: "Source Serif 4 Fallback";
  src: local("Iowan Old Style"), local("Charter"), local("Georgia"), local("Times New Roman");
  size-adjust: 98%;          /* 0.475 / 0.4841 (Georgia) */
  ascent-override: 104.5%;   /* 102.4 / 0.98 */
  descent-override: 40.8%;   /* 40.0 / 0.98 */
  line-gap-override: 0%;
}
@font-face {
  font-family: "IBM Plex Mono Fallback";
  src: local("SFMono-Regular"), local("Menlo"), local("Consolas"), local("DejaVu Sans Mono");
  size-adjust: 95%;          /* 0.516 / 0.5405 */
  ascent-override: 82.1%;
  descent-override: 23.2%;
  line-gap-override: 0%;
}
```

**What the app looks like if the webfonts never load.** Space Grotesk is same-origin, so on a
local-first dashboard it is always there: every name, number, label, button and nav item is
exactly right. The serif falls back to Iowan Old Style / Charter / Georgia at metric parity —
identical measure, leading and line breaks — and the mono to the platform's. **The
naming/saying/machine law survives completely**, because it is built on family *class*, not on a
specific face. The page is quieter, not broken. The wordmark and the mark are SVG paths with no
font dependency, so the brand's identity is unaffected by total font failure.

Inter is **dropped**. Nothing in this system asks a neutral sans to set a paragraph — the serif
owns every multi-line run of prose — and Space Grotesk's weaknesses (wide set, a single-storey
`a`/`g`, loose colour over long runs at small size) bite only in multi-line prose. Its strengths
are exactly what the chrome needs: tabular lining figures with a slashed zero, a geometric
skeleton that holds shape at 11px caps, and a 700 weight that matches the wordmark. Keeping Inter
would add a whole webfont family to a local-first dashboard to do a job the display face already
does better here. The honest cost: Space Grotesk is worse than Inter at 11px, so the sans floor is
11px for `t-label` only and the chrome default is 13px rather than 12px, costing roughly one row
per eight table rows. If a screen cannot afford it, the answer is **mono** (legal at 11px, and
usually what such content already is), never re-adding Inter.

### 8.5 `site.webmanifest`

```json
{
  "name": "Populace",
  "short_name": "Populace",
  "description": "Autonomous testing for MCP apps.",
  "start_url": "/app",
  "display": "standalone",
  "background_color": "#F4F1E9",
  "theme_color": "#254B3E",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
```

### 8.6 The mark's grammar, as a component vocabulary

The mark, in viewBox units: a lattice at pitch **31** with dot diameter **26** (r=13) and gap
**5**; seven ink circles at (13,13) (44,13) (75,13) (13,44) (13,75) (75,75) (13,106); **one lime
circle at (44,44)**; a horizontal capsule `x=62 y=31 w=52 h=26 rx=13` (two cells fused); a
vertical capsule `x=31 y=62 w=26 h=40 rx=13`. Read as a P, the lime dot sits inside the counter —
the highlighted individual is literally enclosed by the letterform.

| Form | Reads as | Product meaning | Where it is used |
|---|---|---|---|
| circle, filled | an individual | a **person** who was there | lattice `present`, avatar, radio dot |
| circle, ring | an individual who was not | a person **absent** | lattice `absent`, empty roster slot |
| capsule | individuals merged into one body | a **cohort** | `CohortCapsule` (see the amendment below) |
| lattice | an ordered set | a **population** | `RosterLattice`, the landing hero |
| lime circle | the one that matters | a **finding**, a selection | "the one" dot, the live dot |
| a column of four circles | a graduated reading | **severity** | `SeverityStack` |
| nine dashed béziers | a population exploring | a **run** | the landing hero, empty states, trace art |
| dashed 2/7 stroke | this has not happened yet | **provisional** | a cohort that has not run, a pending verdict, an execution in progress, the `Skeleton` |

**Amendment (mark-grammar conformance) — who draws the capsule.** The row above originally
assigned the glyph to three components, and all three declined it: `CohortCapsule` drew a CSS
`rounded-full` border, `AvatarGroup` overlaps circles, `Disclosure` rotates a chevron. The mark's
own word for *a cohort* was therefore written nowhere, which was the largest single gap between
this document and the built system. It is resolved in favour of the direction rather than of the
code: **`CohortCapsule` draws `brand/Capsule`** — a stadium of *n* fused cells, `26 + (n-1) × 31`
units long, laid under a row of the cohort's own people so the stadium's ends land on the first
and last dot centres. Its **length is the headcount**, which is what makes M4's "a column of bars
of different lengths made of visible individuals" a thing a reader can actually see down a list.
The body is drawn as a ring, not a fill: the fill belongs to the individuals inside it.

The other two keep their drawings, and this is now the documented position rather than a drift.
`AvatarGroup`'s overlapped run of circles already reads as individuals merged into one body — it
is the capsule with its people still separable, which is the whole point of that component — and
a group of three is not a headcount, so a stadium would add a magnitude it does not have. The
disclosure affordance is a **tier-2 utility glyph** (the chevron below): it carries affordance,
never meaning, and a brand shape there would say "cohort" about a section that is not one.

Geometric discipline the mark implies, and which every glyph we invent obeys: everything is a
circle or a stadium; there is not one diagonal, arc-of-varying-radius, gradient or sharp inside
corner in the entire brand.

**The icon policy.** There is no icon library. Two tiers:

1. **Brand shapes carry meaning** — the eight in the table above. They are drawn from circles,
   stadiums and axis-aligned lines only, and they are the only glyphs allowed to *be* the
   information.
2. **Eight utility glyphs carry affordance and never meaning** — `chevron-right`, `chevron-down`,
   `check`, `x`, `plus`, `minus`, `copy`, `external`. 16px on a 16px grid, 1.5px stroke, round
   caps and joins, `currentColor`, no diagonals except where the meaning requires one. Anything
   the sixteen cannot say, a **word** says. And an affordance glyph never appears without a
   label, except inside an `IconButton` with a `Tooltip` and an `aria-label`.

There is **no spinner**: the brand has no arcs and no rotation, so the busy indicator is three
dots on the lattice pitch, the active one `primary` (never lime — a lime dot on paper cannot be
seen), advancing every 400ms. `role="status"` with a visually hidden label naming what is loading.

---

## 9. THE PUBLIC PAGES, IN BRIEF

`/` is the public marketing route and today's `Landing` redirect moves to `/app`. That also
changes the `*` catch-all, `RunRedirect`'s "Back to where you were" link, and the wordmark link.
Five screens sit in `MarketingShell`: `/`, `/how-it-works`, `/concepts`, `/use-cases`,
`/why-agents`.

**This section was rewritten.** It used to specify a page-long ledger spine, a stack of
narrative case studies built on this repo's development fixture, and "artefact before
explanation" as the page's organising principle. In practice that produced five pages of dense
technical documentation — thousands of lines of prose — which is not what a marketing page is.
The rules below replace it. Where an older note elsewhere still argues for the retired version,
this section wins.

1. **Same atoms, same tokens.** The two concessions are `radius-lg` (20px) and `t-masthead`.
2. **No spine, and no stub column.** The earlier rule — "the ledger stub runs the whole page, so
   the landing and the product are visibly the same instrument" — is **withdrawn**. A spine is
   the right edge of a column of locators; these pages have none, so the line aligned nothing and
   crossed every section heading at a fixed offset, reading as a stray rule rather than as
   structure. `MarketingShell` draws no spine and the page's own prose never indents to
   `--w-stub`. Left-aligned throughout: a centred page is a brochure and this product is a
   readout. Prose measure 62ch.

   **A `<figure>` is not an exemption, and this is the second half of the same fix.** When the
   shell's hairline came off, `DiagramStage` still drew one inside the figures — a `STAGE / 01`
   stub column beside five in-figure headings, **1,673px** down `/how-it-works` and **1,183px**
   down `/use-cases`. It cleared each heading by an 11px gutter, so it intersected nothing and
   read on screen as exactly the rule this clause withdrew. Moving a page rule inside a `<figure>`
   makes it shorter, not different. So: **a stage is never a ledger row.** Stages are a
   `Stack as="ol"` and each prints its ordinal as a `t-ref` eyebrow above its name, which is how
   `StepStrip` already sequences the landing page (§1.2 M2) and what §3.4 names `t-ref` for. No
   glyph joins the number — §8.6's grammar has a word for a person, a cohort, a population, a
   finding and a severity, and none for a step, and §1.3 rule 4 forbids a glyph carrying meaning
   alone.

   **Where a figure embeds a real `Ledger`, the stub stays and the spine is a function of row
   height.** These pages show the product's own components rather than drawings of them (§9.3),
   and a ledger without its stub is a falsified one. But the spine is the right edge of a column
   a reader *scans*, and a reader scans lines, not blocks. Measured: `ChainDiagram`'s seven links
   are 48–65px a row and its rule is 366px; `CoverageDiagram`'s six capabilities are 46px and its
   rule is 276px — both read as one list, and both keep the spine. `VarianceDiagram`'s rows are
   **144px** — a tag, a tool, a sentence, two lattices and a `MetaLine` — so its rule measured
   **720px** with nothing to scan beside it, and it is drawn `spine={false}`. The rule of thumb
   that follows, and what a reviewer measures: **rows past ~64px lose the spine, and no vertical
   rule under a marketing page's `<main>` exceeds ~400px.** Nested ledgers lose it too — two
   hairlines 72px apart read as a mistake. `LedgerSpine` itself is untouched and keeps earning its
   keep in the dense product screens, where a stub column of locators genuinely needs an edge.
3. **A graphic first, a short caption under it, and only then any prose.** These pages explain a
   mechanism, and a mechanism is easier to see than to read. Every section opens with a diagram
   from `design/brand/diagrams/`; the caption is a line, not a paragraph; a section that needs
   more than a short blurb after its caption is a section that has not found its picture yet. If
   a sentence is not earning its place it goes.
4. **The examples are generic.** A task app, a booking tool, a CRM, "your app". **The name of
   this repo's development fixture appears on none of the five pages, nor in any component they
   render** — it is a test target used to build the harness, not a product feature, and a reader
   who has never seen this repo cannot be expected to care about it. A demo screen or the
   technical docs may name it; a marketing page may not. **This document takes the stricter line
   on itself**: §3.1 and §4.5 write their worked examples as *Acme Tasks*, because a worked
   example in a design system is copied out of it, and the shipped placeholders (§7.4) name no
   app at all.
5. **Hero: paper, not a forest cover.** The 160px logo, the descriptor in `t-eyebrow`, the
   masthead in **Space Grotesk 300** at 44→68px breaking to three lines, a `t-lede` serif deck at
   52ch, then two buttons. The ornament is the real image: the kit's exploration geometry redrawn
   as inline SVG, nine dashed béziers (`stroke-dasharray="2 7"`, 1.5px, `rule-strong`) fanning
   from one origin off the right edge to nine Ø14px terminal dots — four lime **each carrying the
   mandatory 1.5px ink ring, because this hero is paper** *(filed a finding)*, three hollow *(got
   their errand done)*, two clay *(gave up)*. Clay's only appearance in the product, decorative,
   ≥14px, carrying no text and no state, beside a word legend. The component has no route to
   test, so **the word is the licence**: the fan draws its ends' words at `hero` only, and clay is
   drawn — in the picture and in the legend alike — only where that word is beside it. At `panel`
   and `inline`, which is every use inside `/app`, "gave up" is `ink-muted` and §4.1's "never
   anything at all inside `/app`" holds by construction. **One orchestrated motion on the page:**
   the paths draw over 900ms at 70ms stagger, dots scale in as their path lands, labels last.
   Nothing else animates, on scroll or otherwise.
6. **Any figure on these pages reads as illustrative, because it is.** Nothing here is a
   measurement. A number presented as one — a count of problems found, a spend, a duration —
   must be a number this repo can actually support, or it must be visibly an example. Never
   invite a reader to verify an authored figure.
7. **The honesty clause is a section, set as the second most emphatic block on the page**: full
   measure, a rule above and below, 48px of air, `t-lede` serif, no icon and no tint. *Executions
   vary by design; a problem that stops appearing is reported as an absence, not a repair;
   whether it is fixed is your call, and there is a field to record it.* §7.3 binds these pages
   exactly as hard as it binds the product: **no copy anywhere may promise determinism.**
8. **The close:** CTAs in order of commitment, ending with the quickstart in a `Payload` well.
   **Footer:** the 24px mark, the descriptor verbatim, one row of links, the theme toggle. The row
   is the four public pages plus the one link into the product — the site, and the door. (This
   used to say "three links", which was written before there were four other pages; the set is
   what the site map needs, and for a five-page site that is five links.) No newsletter, no logo
   strip, no testimonials — the product has none and inventing them is the fastest way to look
   generated.
9. **The forest band appears once**, behind the "how it works" chain diagram: paper on forest is
   8.63:1, lime on forest 7.97:1. It is the only inverted section and the only place dark
   `accent` (forest) is used as a ground.

---

## 10. THE HONEST RISKS

1. **The palette is one bad decision from the generated-design cliché.** Paper is within one unit
   of the tell's `#F4F1EA` and clay is in the `#D97757` family. The three defences (§1.4) are not
   decoration; if any one erodes — a clay badge, a 72px serif over empty cream, floating cards
   returning — the direction collapses into the default. This is why rules 3, 7 and 8 in §1.3 are
   review rules and not guidance.
2. **Two webfont families plus two variable axes on a local-first dashboard.** Source Serif 4's
   `ital,opsz,wght` file is ~60–80KB from a font service and the dashboard often runs offline.
   The metric-matched fallback makes the offline case *correct* rather than broken, but it is a
   different reading experience. Expect to vendor the serif within a release or two;
   `VITE_FONT_SOURCE` is the escape hatch and it must actually be built.
3. **The 72px stub costs horizontal room on every list**, on a page capped at 1100px. The Visits
   table loses two columns to a detail row (§5.3). That is a real trade and somebody will push
   back on it; the answer is to cut a column, not to shrink the stub or the type.
4. **`t-read` at 15px where the current body is 13.5px means every prose block gets taller.**
   Screens that fit today will scroll. It is paid back on the two screens where reading happens
   (FindingInFull, WatchAVisit's detail pane), but ProjectHome and Preflight will need their
   **copy trimmed rather than their type shrunk.**
5. **The severity stack's unlit dots are 4px rings at 3.2:1.** Better than the 2px hairline
   segments the original gauge proposed, but test it on a non-retina LCD at 100% zoom before
   shipping. If the rings vanish, the fallback is 5px dots at `--lat-pitch-sm` and a wider stub.
6. **Dark mode's card affordance rests entirely on one hairline.** Surface over background is
   1.22:1 and shadows do nothing on ink, so the dark theme has visibly less depth than the light
   one. That is a character difference to accept, not a defect to fix with invented surfaces.
7. **Honouring the primary/accent swap means the primary button changes hue between themes.**
   Some readers will call that inconsistent. The defence is physical, not aesthetic: forest on the
   dark ground is 1.55:1 and cannot be an ink; lime on paper is 1.08:1 and cannot be either. The
   swap is the only arrangement that works. Put this answer in the atoms' README beside the
   `Button` variant table, because it will be asked repeatedly.
8. **The lattice degrades above 40 people** into block mode and above 200 into a meter. Somebody
   will run a 200-person population and the signature display will not be one-dot-one-person. The
   caption says so, which is the honest handling, but it is a real limit.
9. **Out of scope but worth flagging:** the route `visits/:wakeId` and every link built from it
   leak a forbidden word into a path. This rebuild does not touch routing; rename it `:visitId`
   the next time someone does.
