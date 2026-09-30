---
name: health-card-charts
description: The card and chart design system for the Dispatch Pro dashboard redesign, derived from the Digcy "Healthcare Cards" UI kit — rounded-cap bars, metric triplets, radial gauges, threshold meters, hex heatmaps, and a light/dark token set. Use this whenever redesigning, restyling, or building dashboard cards, stat tiles, KPI panels, metric widgets, or any chart in this project, including when the user pastes existing dashboard HTML and asks to "make it look like the cards library", "redesign the dashboard", "restyle these widgets", or "apply the card system" — and also when they hand over dashboard markup without saying exactly what to do with it.
---

# Health Card Charts — dashboard card & chart system

This is the target visual system for the Dispatch Pro dashboard redesign. It comes from a close read of the Digcy Healthcare Cards UI kit (50 cards × light/dark). The kit's real value is not the specific health metrics — it is that **50 different visualizations all read as one system**, because every card is assembled from the same small set of primitives.

When you redesign a component, you are not inventing a look. You are picking the right archetype from this catalog and filling it with the component's real data.

## Why this system holds together

Three things do all the work. Understand them and the rest follows:

1. **One card skeleton, always.** Header → metric row → visualization → optional footer stats. Nothing deviates. A card with a hex heatmap and a card with a progress bar have identical headers, identical padding, identical corner radius. The *chart* varies; the *frame* never does.
2. **Size contrast carries hierarchy, not weight.** The hero number is ~3× its unit and ~3.5× its caption. Almost everything is medium weight. If you find yourself reaching for bold to make something stand out, the sizes are wrong.
3. **Color is semantic, never decorative.** Blue = neutral / volume / the default. Red-orange = load, heat, alarm. Green = in range. Purple = depth, rest, idle. Amber = caution. A card carrying four unrelated hues is a bug.

The signature detail: **every bar is a pill.** Fully rounded caps, both ends, no exceptions — `border-radius: 999px`. This single choice is what makes the kit recognizable at a glance, and dropping it is the fastest way to lose the look.

## Redesign workflow

When HTML arrives, work in this order. Don't start restyling the first widget you see — the mapping pass is what keeps 30 components looking like one system instead of 30 separate redesigns.

**1. Inventory.** Read the HTML and list every component: what it's called, what metric it carries, and what shape the data is (single value / series over time / parts of a whole / position on a scale / 2D matrix).

**2. Map.** For each component pick an archetype from the catalog below and an accent that matches its *meaning*. Write this out as a table and show it to the user before touching code — mapping errors are cheap to fix here and expensive later. Two components with the same data shape get the same archetype; resist varying them for interest.

**3. Install tokens once.** Copy `references/tokens.css` into the file and drive everything from the custom properties. Hardcoded hex inside a component is what makes the second half of a dashboard drift from the first.

**4. Rebuild card by card.** Use the shell from `references/chart-recipes.md`, then the recipe for that archetype. Keep the original component's real data and labels — the redesign is visual, so don't silently invent or drop metrics.

**5. Verify.** Run the checklist at the bottom of this file, in light *and* dark.

## Card anatomy

```
┌─────────────────────────────────────┐
│ ⟐ Card Title                  ···   │  header: 16px icon + 13px title, ··· chip right
│                                     │
│ 104 mg/dL        90-112 mg/dL       │  metric row: 1–3 triplets
│ Average Today    Variability        │  (number · small unit · muted caption)
│                                     │
│  ╭──────────────────────────────╮   │  visualization
│  │         the chart            │   │
│  ╰──────────────────────────────╯   │
│  6AM   9AM   12PM   3PM   6PM       │  axis ticks, 10px muted
│                                     │
│ 127 bpm    80 bpm    80 bpm         │  optional footer stat strip
│ Now        Min       Max            │  (same triplet pattern)
└─────────────────────────────────────┘
```

**Header** — a 16px monoline outline icon (1.5px stroke, never filled, thematically literal: a truck for fleet, a droplet for fuel, a clock for dwell time), the title at 13px/500, and a `···` overflow button in a 28px circular grey chip pinned right. The chip appears on essentially every card; it's part of the look even when it does nothing yet.

**Metric triplet** — the core repeating unit, used in both the metric row and the footer strip:

```html
<div class="mtr">
  <span class="mtr-v">104</span><span class="mtr-u">mg/dL</span>
  <div class="mtr-c">Average Today</div>
</div>
```

The unit sits on the same baseline as the number at ~40% its size, in muted grey. The caption goes underneath. Deltas ride as coloured micro-text near the number (`+27% Than Yesterday` in green, `−8% vs Target` in red).

**Density** — cards are generously padded (20–24px) and equal-width, built to drop into a bento or masonry grid. Don't compress padding to fit more in; add a column instead.

## Chart catalog

Pick by data shape. Full implementations live in `references/chart-recipes.md` — read that file before writing chart markup.

| Data shape | Archetype | Use when |
|---|---|---|
| Series over time, discrete buckets | **Rounded-cap bar chart** | daily/hourly counts, volume, loads per day. The default. |
| Series with sub-parts | **Stacked segment bars** | one bar split into 2–3 *tonal steps of one hue* — not different hues |
| Series with min/max spans | **Floating range bars** | ranges and spreads; bars detached from the axis. Dot endcaps mark outliers |
| Continuous trend | **Sparkline area/line** | 2px smooth line, dotted horizontal gridlines only, no axis lines |
| Trend with few points | **Line + node markers** | ≤10 points; a circular dot on each |
| Single value against a max | **Radial gauge** | scores, indices, % of goal. ~240° open arc, value centred |
| Value on a banded scale | **Segmented threshold meter** | 6 pill segments green→amber→orange→red with a triangular pointer. For anything with normal / warning / critical bands |
| Several values 0–100% | **Labelled progress rows** | `label … value%` rows with a full-width track under each, one hue per row |
| Parts of a whole, 2–4 parts | **Multi-segment proportion bar** | one track split into tonal blocks, dot legend below |
| Dense 2D intensity | **Hex heatmap** | honeycomb tessellation, single-hue intensity ramp, % legend |
| Sparse 2D intensity | **Dot matrix** | circles varying in *size and tone* per column |
| Duration bands over a timeline | **Hypnogram** | floating rounded rects at different vertical bands (states over time) |
| Discrete day / step selection | **Pill selector** | circular day chips, check mark on the active one |

Two treatments layer on top of any of these: an **annotated peak marker** (a dark tooltip chip pinned to the max value) and a **footer stat strip** repeating 2–3 secondary numbers.

**Chart chrome is minimal by design.** Dotted horizontal gridlines, 10px uppercase muted tick labels, and nothing else. No axis lines, no border around the plot, no legend unless the chart has segments that genuinely need naming — and then it's a dot legend, not a box.

## Tokens

Full file at `references/tokens.css`. Its shape:

- **Surfaces** — `--canvas` (near-white `#F4F5F7`), `--card` (white), `--border` (hairline, ~6% black), `--track` (chart rails, `#EFF1F4`), plus a soft shadow.
- **Text** — `--fg` near-black, `--fg-muted` grey for units and captions, `--fg-faint` for axis ticks.
- **Accents** — each accent carries 5 tonal steps (`-600` … `-100`) so stacked bars, heatmaps and dot matrices can ramp *within* one hue. Blue is the workhorse; red, orange, green, amber, purple and pink are semantic.
- **Geometry** — `--r-card: 20px`, `--r-pill: 999px`, `--pad-card: 22px`.

**Dark mode is a re-theme, not an inversion.** Cards go near-black on black, accents get *more* saturated so they still pop, tracks darken to `#2A2A2C`, text steps white → grey. Radius, padding and chart geometry are identical between modes — only colour changes. Implement it as a `[data-theme="dark"]` block plus a `prefers-color-scheme` fallback, so a toggle can override the OS.

One subtlety worth knowing before you theme anything: **the tonal ramps flip.** In light, `-600` is the darkest step and therefore the strongest; on a black card the strongest step is the *brightest*. So the dark ramps run dim at `-100` up to bright at `-600`, which keeps a low→high stacked bar or heatmap reading in the same direction in both themes. The pale steps also have to stay legible mid-tones rather than sliding toward black — in a ramp they carry data, they aren't background tints. `tokens.css` already handles this; the trap is only if you extend the palette by hand.

## Typography

One geometric grotesque throughout (Inter is a good stand-in). Four roles, and that's it:

| Role | Size | Weight | Colour |
|---|---|---|---|
| Hero numeral | 34px, `letter-spacing: -0.02em` | 500–600 | `--fg` |
| Unit suffix | 14px (≈40% of the numeral) | 400 | `--fg-muted` |
| Card title | 13px | 500 | `--fg` |
| Caption / axis tick | 11px / 10px uppercase | 400–500 | `--fg-muted` / `--fg-faint` |

Use `font-variant-numeric: tabular-nums` on everything numeric, so values don't jitter as they update.

## Verification checklist

Before calling a redesign done, check in both themes:

- Every bar has fully rounded caps. Square-ended bars are the most common regression.
- Every card shares the same radius, padding, border and shadow — flipping between two cards should shift nothing.
- Hero numerals are the same size across cards; units are ~40% of them everywhere.
- No hardcoded colours outside `tokens.css`, and no card carrying more than two accent hues.
- Each accent still means what the semantic table says it means.
- Chart chrome is dotted gridlines plus tick labels only.
- Dark mode was re-themed, not filtered or inverted; accents read *brighter* there, not dimmer.
- Every number, label and unit from the source HTML survived the redesign.

## Reference files

- `references/tokens.css` — the full token set, light and dark. Copy in verbatim.
- `references/chart-recipes.md` — the card shell plus a working implementation for each archetype in the catalog. Read before writing any chart markup.
