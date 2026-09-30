# Chart recipes

Working implementations for every archetype in the catalog. All of them assume `tokens.css` is loaded and use its variables.

Two rules that apply to everything below:

- **Every bar cap is round** (`border-radius: var(--r-pill)` or `rx` on an SVG rect equal to half its width). This is the single most identifying trait of the system.
- **Gridlines are dotted and horizontal only.** No axis lines, no plot border.

Prefer plain HTML + CSS for bars, meters and progress rows — they animate smoothly, scale with the container, and need no library. Use inline SVG only where the geometry demands it: lines, gauges, hexagons.

## Contents

1. [Card shell](#1-card-shell)
2. [Rounded-cap bar chart](#2-rounded-cap-bar-chart)
3. [Stacked segment bars](#3-stacked-segment-bars)
4. [Floating range bars](#4-floating-range-bars)
5. [Sparkline area / line](#5-sparkline-area--line)
6. [Line + node markers](#6-line--node-markers)
7. [Radial gauge](#7-radial-gauge)
8. [Segmented threshold meter](#8-segmented-threshold-meter)
9. [Labelled progress rows](#9-labelled-progress-rows)
10. [Multi-segment proportion bar](#10-multi-segment-proportion-bar)
11. [Hex heatmap](#11-hex-heatmap)
12. [Dot matrix](#12-dot-matrix)
13. [Hypnogram](#13-hypnogram)
14. [Pill selector](#14-pill-selector)
15. [Annotated peak marker](#15-annotated-peak-marker)

---

## 1. Card shell

Every card is this. Fill the middle; never alter the frame.

```html
<article class="card">
  <div class="card-hd">
    <svg viewBox="0 0 24 24"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>
    <h3>Loads Delivered</h3>
    <button class="more" aria-label="More">···</button>
  </div>

  <div class="mtr-row">
    <div>
      <span class="mtr-v">780</span><span class="mtr-u">loads</span>
      <div class="mtr-c">Total this week</div>
    </div>
    <div>
      <span class="mtr-v">250</span><span class="mtr-u">avg</span>
      <div class="mtr-d up">+27% vs last week</div>
    </div>
  </div>

  <!-- chart goes here -->

  <div class="ticks"><span>Sun</span><span>Mon</span><span>Tue</span></div>
</article>
```

When three triplets share a row, drop the hero to `var(--fs-hero-sm)` so the row doesn't wrap.

---

## 2. Rounded-cap bar chart

The default for any time series with discrete buckets. Bars grow from the baseline, each a pill.

```html
<div class="bars" style="--h:120px">
  <div class="bar" style="--v:62%"></div>
  <div class="bar" style="--v:88%"></div>
  <div class="bar is-peak" style="--v:100%"></div>
  <div class="bar" style="--v:45%"></div>
</div>
```

```css
.bars { display: flex; align-items: flex-end; gap: 6px; height: var(--h, 120px); }
.bar {
  flex: 1;
  height: var(--v);
  min-height: 8px;                 /* so a pill cap is always visible */
  background: var(--blue-400);
  border-radius: var(--r-pill);
  transition: height .4s cubic-bezier(.4,0,.2,1);
}
.bar.is-peak { background: var(--blue-600); }
.bar.is-muted { background: var(--blue-200); }
```

Bar width lands around 8–14px at typical card widths; `flex: 1` with a 6px gap gets there on its own. Below ~6px wide the pill caps stop reading — drop buckets rather than thinning the bars.

**Gridlines**, when the chart needs a scale — a repeating dotted background behind the bars:

```css
.plot {
  position: relative;
  background-image: repeating-linear-gradient(
    to top, transparent 0 29px,
    var(--grid) 29px 30px);
  background-size: 100% 30px;
}
```

For dotted rather than solid rules, use `repeating-linear-gradient(to right, var(--grid) 0 2px, transparent 2px 6px)` on absolutely-positioned 1px rows.

---

## 3. Stacked segment bars

One bar split into 2–3 **tonal steps of a single hue**. Using different hues here is the most common way people break the system — the tonal ramp is what says "these are parts of the same thing".

```html
<div class="bars">
  <div class="sbar">
    <i style="--v:20%; background:var(--blue-200)"></i>
    <i style="--v:35%; background:var(--blue-400)"></i>
    <i style="--v:45%; background:var(--blue-600)"></i>
  </div>
</div>
```

```css
.sbar { flex: 1; display: flex; flex-direction: column-reverse; gap: 3px;
        height: 100%; justify-content: flex-start; }
.sbar i { display: block; height: var(--v); border-radius: var(--r-pill); }
```

The 3px gap between segments — rather than segments sharing an edge — is deliberate: it keeps every segment's caps round.

---

## 4. Floating range bars

For min/max spans. Bars detach from the baseline entirely; a pale full-height rail sits behind each one so the bar reads as a span within a range.

```html
<div class="bars">
  <div class="rbar"><i style="--top:20%; --bot:55%"></i></div>
  <div class="rbar"><i style="--top:35%; --bot:70%"><b class="cap"></b></i></div>
</div>
```

```css
.rbar { flex: 1; position: relative; height: 100%; }
.rbar::before {                                  /* pale rail */
  content: ""; position: absolute; inset: 0; margin: 0 auto; width: 10px;
  background: var(--blue-100); border-radius: var(--r-pill);
}
.rbar i {
  position: absolute; left: 0; right: 0; margin: 0 auto; width: 10px;
  top: var(--top); bottom: var(--bot);
  background: var(--blue-500); border-radius: var(--r-pill);
}
.rbar .cap {                                     /* outlier dot endcap */
  position: absolute; top: -3px; left: 50%; transform: translateX(-50%);
  width: 6px; height: 6px; border-radius: var(--r-pill); background: var(--red-500);
}
```

---

## 5. Sparkline area / line

2px smooth line, optional faint fill, dotted horizontal gridlines, no axes. Use a `viewBox` with `preserveAspectRatio="none"` so the path stretches to the card, and `vector-effect="non-scaling-stroke"` so the stroke stays 2px when it does.

```html
<svg class="spark" viewBox="0 0 300 90" preserveAspectRatio="none">
  <!-- gridlines -->
  <g stroke="var(--grid)" stroke-dasharray="2 4" stroke-width="1">
    <line x1="0" y1="22" x2="300" y2="22"/>
    <line x1="0" y1="45" x2="300" y2="45"/>
    <line x1="0" y1="68" x2="300" y2="68"/>
  </g>
  <defs>
    <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="var(--blue-500)" stop-opacity=".18"/>
      <stop offset="100%" stop-color="var(--blue-500)" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <path d="M0,70 C20,68 40,40 60,44 S110,20 140,34 S200,62 240,50 S285,26 300,30 L300,90 L0,90 Z"
        fill="url(#sparkFill)"/>
  <path d="M0,70 C20,68 40,40 60,44 S110,20 140,34 S200,62 240,50 S285,26 300,30"
        fill="none" stroke="var(--blue-500)" stroke-width="2"
        stroke-linecap="round" vector-effect="non-scaling-stroke"/>
</svg>
```

```css
.spark { width: 100%; height: 90px; display: block; }
```

Drop the fill for dense, noisy series (heart-rate style traces) — the line alone stays legible; a fill turns to mud.

---

## 6. Line + node markers

Same as the sparkline for ten points or fewer, plus a circle on each point. Keep `preserveAspectRatio` at its default here so the circles stay round.

```html
<svg viewBox="0 0 300 100" class="spark">
  <polyline points="20,78 60,74 100,50 140,42 180,52 220,62 260,28"
    fill="none" stroke="var(--blue-500)" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round"/>
  <g fill="var(--blue-500)">
    <circle cx="20" cy="78" r="4"/><circle cx="60" cy="74" r="4"/>
    <circle cx="100" cy="50" r="4"/><circle cx="140" cy="42" r="4"/>
    <circle cx="180" cy="52" r="4"/><circle cx="220" cy="62" r="4"/>
    <circle cx="260" cy="28" r="4"/>
  </g>
</svg>
```

---

## 7. Radial gauge

A ~240° open arc with the value centred. Built from two `stroke-dasharray` arcs on the same path — a grey track and a coloured fill.

```html
<div class="gauge">
  <svg viewBox="0 0 200 130">
    <path class="g-track" d="M20,120 A80,80 0 1,1 180,120"/>
    <path class="g-fill"  d="M20,120 A80,80 0 1,1 180,120" style="--pct:.72"/>
  </svg>
  <div class="g-val"><span class="mtr-v">32</span><div class="mtr-c">Years Old</div></div>
</div>
```

```css
.gauge { position: relative; }
.gauge svg { width: 100%; display: block; }
.gauge path { fill: none; stroke-width: 16; stroke-linecap: round; }
.g-track { stroke: var(--track); }
.g-fill  {
  stroke: var(--blue-500);
  stroke-dasharray: 377;                 /* arc length ≈ π·80·(240/180) */
  stroke-dashoffset: calc(377 - 377 * var(--pct));
  transition: stroke-dashoffset .6s cubic-bezier(.4,0,.2,1);
}
.g-val { position: absolute; inset: auto 0 18% 0; text-align: center; }
```

Measure the real arc length once with `path.getTotalLength()` if you change the radius or sweep — a wrong dasharray silently under- or over-fills the gauge.

Add a one-line interpretive caption under the gauge in `--fg-muted`, with the meaningful part coloured (`"6 years younger than your chronological age"`). It's the pattern the kit uses to make a bare score mean something.

---

## 8. Segmented threshold meter

Six pill segments running green → amber → orange → red with a triangular pointer marking the current value. Use this for anything with normal / warning / critical bands.

```html
<div class="meter">
  <div class="m-segs">
    <i style="background:var(--blue-500)"></i>
    <i style="background:var(--green-500)"></i>
    <i style="background:var(--amber-500)"></i>
    <i style="background:var(--orange-400)"></i>
    <i style="background:var(--orange-600)"></i>
    <i style="background:var(--red-500)"></i>
  </div>
  <b class="m-ptr" style="--pos:68%"></b>
  <div class="ticks"><span>50</span><span>140</span></div>
</div>
```

```css
.meter { position: relative; padding-bottom: 4px; }
.m-segs { display: flex; gap: 4px; }
.m-segs i { flex: 1; height: 10px; border-radius: var(--r-pill); }
.m-ptr {
  position: absolute; top: 12px; left: var(--pos); transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 5px solid transparent; border-right: 5px solid transparent;
  border-top: 6px solid var(--fg);
}
```

Pair it with the band's name as a right-aligned label beside the hero number (`120/70 mmHg` … `Stage 2`). A continuous variant swaps the six segments for one bar with a `linear-gradient` across the same stops — use that when the scale is genuinely continuous rather than banded.

---

## 9. Labelled progress rows

`label … value%` with a full-width track beneath. One hue per row, so the rows stay distinguishable while sharing a shape.

```html
<div class="prows">
  <div class="prow"><span>On-time delivery</span><b>96%</b>
    <i style="--v:96%; --c:var(--orange-500)"></i></div>
  <div class="prow"><span>Fleet utilization</span><b>76%</b>
    <i style="--v:76%; --c:var(--blue-500)"></i></div>
  <div class="prow"><span>Idle time</span><b>20%</b>
    <i style="--v:20%; --c:var(--purple-500)"></i></div>
</div>
```

```css
.prows { display: flex; flex-direction: column; gap: 14px; }
.prow { display: grid; grid-template-columns: 1fr auto; gap: 6px 8px; }
.prow span { font-size: var(--fs-caption); color: var(--fg-secondary); }
.prow b { font-size: var(--fs-caption); font-weight: 500; font-variant-numeric: tabular-nums; }
.prow i {
  grid-column: 1 / -1; height: 8px; border-radius: var(--r-pill);
  background: linear-gradient(to right, var(--c) var(--v), var(--track) var(--v));
}
```

The gradient trick keeps the whole row one element — no separate track div to keep in sync.

---

## 10. Multi-segment proportion bar

One track split into 2–4 tonal blocks with a dot legend below. For parts of a whole where a pie would be overkill (which is nearly always).

```html
<div class="pbar">
  <i style="--v:14%; background:var(--blue-600)"></i>
  <i style="--v:62%; background:var(--blue-400)"></i>
  <i style="--v:24%; background:var(--blue-200)"></i>
</div>
<div class="legend">
  <span><i style="--c:var(--blue-600)"></i>Paused</span>
  <span><i style="--c:var(--blue-400)"></i>Active</span>
  <span><i style="--c:var(--blue-200)"></i>Extra</span>
</div>
```

```css
.pbar { display: flex; gap: 3px; height: 26px; }
.pbar i { width: var(--v); border-radius: var(--r-pill); }
```

Legend text stays `--fg-muted`; only the dot carries the hue, so the legend never competes with the chart it labels. Follow it with a footer stat strip giving each segment's absolute value.

---

## 11. Hex heatmap

A honeycomb with a single-hue intensity ramp. The standout visualization in the kit and worth the effort for dense 2D data (hour × day, zone × shift).

Generate the grid rather than hand-writing it — every other row offsets by half a hex.

```js
const COLS = 14, ROWS = 9, R = 11;          // R = hex circumradius
const ramp = ['--purple-200','--purple-300','--purple-400','--pink-400','--pink-500'];
const hex = (cx, cy) => Array.from({length: 6}, (_, i) => {
  const a = Math.PI / 180 * (60 * i - 30);
  return `${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`;
}).join(' ');

const w = R * Math.sqrt(3), h = R * 1.5;
let out = '';
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const cx = c * w + (r % 2 ? w / 2 : 0) + R;
    const cy = r * h + R;
    const step = ramp[bucketFor(r, c)];       // your data → 0..4
    out += `<polygon points="${hex(cx, cy)}" fill="var(${step})"/>`;
  }
svg.innerHTML = out;
svg.setAttribute('viewBox', `0 0 ${COLS * w + w} ${ROWS * h + R * 2}`);
```

Keep the ramp inside one hue family (the kit runs purple → pink for low → high). A rainbow ramp destroys the reading, because intensity stops being ordered. Always caption it with a three-step legend giving each band's share as a percentage.

---

## 12. Dot matrix

Circles varying in **size and tone** per column — the sparse counterpart to the hex heatmap. Encoding on two channels at once is what makes it readable at a glance.

```css
.dots { display: flex; gap: 10px; align-items: center; height: 110px; }
.dcol { flex: 1; display: flex; flex-direction: column; gap: 6px; align-items: center; }
.dcol b { border-radius: var(--r-pill); width: var(--s); height: var(--s); background: var(--c); }
```

```html
<div class="dots">
  <div class="dcol">
    <b style="--s:14px; --c:var(--blue-600)"></b>
    <b style="--s:10px; --c:var(--blue-400)"></b>
    <b style="--s:8px;  --c:var(--blue-200)"></b>
  </div>
  <!-- … one .dcol per bucket … -->
</div>
```

Sizes run roughly 6–16px; below 6px a dot disappears, above ~18px the columns start to collide.

---

## 13. Hypnogram

States over time: floating rounded rects at different vertical bands. In this project that maps onto driver status over a shift, equipment state, or dock activity.

```html
<div class="hyp" style="--bands:4">
  <b style="--lane:0; --x:2%;  --w:6%;  background:var(--orange-500)"></b>
  <b style="--lane:1; --x:9%;  --w:14%; background:var(--blue-400)"></b>
  <b style="--lane:2; --x:24%; --w:22%; background:var(--blue-500)"></b>
  <b style="--lane:3; --x:47%; --w:18%; background:var(--purple-500)"></b>
</div>
<div class="ticks"><span>◑ 11:00</span><span>06:23 ◐</span></div>
```

```css
.hyp { position: relative; height: 96px; }
.hyp b {
  position: absolute; left: var(--x); width: var(--w);
  height: calc(100% / var(--bands) - 6px);
  top: calc(var(--lane) * 100% / var(--bands));
  border-radius: var(--r-sm);
}
```

Follow it with labelled progress rows totalling time per state — the timeline shows the pattern, the rows give the numbers.

---

## 14. Pill selector

Circular chips for days or steps, a check on the active one.

```css
.psel { display: flex; gap: 10px; }
.psel button {
  width: 30px; height: 30px; border-radius: var(--r-pill); cursor: pointer;
  border: 1.5px solid var(--border); background: transparent;
  color: var(--fg-muted); font-size: var(--fs-caption);
  display: grid; place-items: center;
}
.psel button[aria-pressed="true"] {
  background: var(--purple-500); border-color: var(--purple-500); color: #fff;
}
```

Put the day initials above as `.ticks` and a summary line below (`Best · 21 days`).

---

## 15. Annotated peak marker

A dark tooltip chip pinned to the maximum value. Use it on one bar per chart — two markers and it stops being an accent.

```css
.bar { position: relative; }
.bar .peak {
  position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
  margin-bottom: 8px; white-space: nowrap;
  background: var(--fg); color: var(--card);
  font-size: var(--fs-tick); font-weight: 500;
  padding: 4px 8px; border-radius: var(--r-pill);
}
.bar .peak::after {
  content: ""; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  border: 4px solid transparent; border-top-color: var(--fg);
}
```

Because it uses `--fg` / `--card`, it inverts correctly in dark mode for free.
