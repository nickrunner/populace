# Populace — asset pack v1

Clean vector reconstruction of the approved forest/lime concept. The mark follows the original modular P; spacing and geometry are standardized. The wordmark uses outlined Space Grotesk Bold, so it is a close typographic reconstruction rather than a pixel-perfect trace of generated lettering.

## Files

- `logos/svg/`: horizontal logos, standalone marks, and wordmarks in primary, ink, forest, inverse, and white; plus logos with paper/forest backgrounds. All logo lettering is paths, with no font or external dependencies.
- `logos/png/`: matching PNG exports. Horizontal logos and wordmarks are 2048 px wide; standalone marks are 512 px wide. Transparent unless filename includes `on-paper` or `on-forest`.
- `icons/`: scalable app icon, favicon SVG and ICO, small favicon PNGs, and 32/48/180/192/512 px app icons. The square app assets intentionally omit rounded corners so the platform can apply its own mask.
- `theme/`: exact palette JSON, light/dark tokens JSON, CSS variables, importable GIMP palette, and calculated text contrast checks.
- `fonts/`: original variable Space Grotesk font and its SIL Open Font License. Wordmark uses weight 700. Inter and IBM Plex Mono are recommended for body/logs but are not bundled; CSS includes system fallbacks.
- `patterns/`: vector exploration pattern.
- `preview/`: contact sheet in SVG and PNG. Preview uses system type for explanatory labels; logo artwork remains outlined.

## Palette

| Ink | Paper | Forest | Signal | Clay |
|---|---|---|---|---|
| #202823 | #F4F1E9 | #254B3E | #D7F56B | #C46D51 |

Use Ink on Paper, Paper on Forest, or Ink on Signal. Clay is decorative; the theme defines separate semantic colors for error/warning/success/info. Never rely on color alone to communicate state. Supplied text/background pairs have calculated contrast of at least 4.5:1; see `theme/contrast-checks.md`.

## Logo rules

Keep at least one circle diameter of clear space around visible artwork. Built-in canvas padding is smaller than the recommended layout clear space. Minimum recommended horizontal logo width: 160 px. Below that, use the standalone mark. Favicons include additional sizing/padding for 16–48 px display. Use inverse/white artwork only on dark backgrounds. Do not stretch, add effects, or recolor individual modules arbitrarily.

## CSS

Import `theme/populace.css` and preserve the relative `fonts/` directory, or adjust the font URL after bundling.

```css
body { background: var(--color-background); color: var(--color-text); font-family: var(--font-body); }
h1, h2 { font-family: var(--font-display); }
.primary { background: var(--color-primary); color: var(--color-on-primary); }
```

Set `data-theme="dark"` on the root element for dark mode; `data-theme="light"` or the default root styles select light mode. These tokens do not automatically apply a system theme or style app components.

## Messaging

Headline: See your app through agents’ eyes.

Descriptor: Autonomous testing for MCP apps.

Description: Populace deploys a swarm of AI agents to use your app through its MCP server, uncover bugs, and reveal usability and discoverability problems.

The preview’s finding is illustrative. No repository files or application implementation were changed.
