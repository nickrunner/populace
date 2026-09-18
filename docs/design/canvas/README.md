# The dashboard design canvas

The artboards behind the published canvas at
<https://claude.ai/artifact/UDwjUzi4tsyK4W9iFXZ4kP>. Thirteen screens on two pages: M1, the
read-only local dashboard, and M2, setting populace up and driving it from the browser.

## The rule the screens encode

The roadmap asks for two surfaces — evidence for the product owner, instrument for the
developer — that still read as one product. These screens separate them by **typeface, not by
mode**. There is no role switch and no expert view:

- Prose (Instrument Sans) carries what we found: the errand, the person, what it cost them.
- Monospace (IBM Plex Mono), marked in ochre, carries how we know: tool names, call refs,
  arguments, results, timings, money.

Every finding shows the calls that produced it on the same page, and every call says which
finding cited it. That pair of links is the only seam either audience has to cross.

## Files

Each `.dc.html` is one artboard; `canvas.json` is the layout, the pages and the sticky notes.

| Hand-authored | Generated |
| --- | --- |
| `Main.dc.html`, `Foundations.dc.html` | everything else |

`Trace.dc.html` is the only interactive artboard: clicking a step in the timeline moves the
detail pane. Its `<script data-dc-script>` block is plain JS — HTML entities are **not** decoded
inside it, so write literal UTF-8 characters there.

Generators, each writing the files named at the bottom of it:

```bash
python3 screens.py    # Evidence, Cluster, Gaps, Population, Wakes
python3 flowgen.py    # Flow
python3 m2.py         # Connect, Personas, NewRun, LiveRun
python3 tracegen.py   # Trace
```

`build.py` holds the shared M1 app shell (228px sidebar, 56px top bar) and the token values;
`m2.py` holds the M2 shell, which adds a "Start a run" button and a "Set up" nav group.

## Tokens

Literal values, used inline so the canvas editor can edit them by hand.

```
ink #1a1510   soft #57514c   muted #857f79
paper #f9f6f2   card #fefdfb   well #f3f0ea
rule #e1ded7   rule strong #cecac2
accent #236292   accent wash #dbeefe
evidence #864e18   evidence wash #fde9d4
critical #d03b3b   high #ec835a   medium #fab219   low #857f79   good #0ca30c
```

Severity and verdict always carry their word; colour never carries meaning alone.

## Changing a screen

Edit the working file (or its generator and re-run it), then re-seed a fresh copy of the canvas
payload with the `design` skill's `seed-canvas.mjs`, passing every artboard and `canvas.json`,
and republish it to the same artifact URL. Editing the seeded output file directly does not work.

## Content

The mockups use the repository's own material — Tasklet, the three example personas in
`examples/tasklet-population.yaml`, and the four planted defects in `packages/mock-target` — so a
screen can be checked against rows the store actually holds.
