# Component catalog

Every component below exists and is proven in `agent-pay-profile.html`. Copy the shape, drive the values from `tokens.css`, and don't invent a new variant when one of these fits.

Painted sizes in comments are `declared × 0.8`.

---

## Button

Three named classes plus shadcn's `data-variant` / `data-size` on `.btn`.

```html
<button class="btn" data-size="sm" type="button"><i data-lucide="plus"></i> Label</button>
<button class="btn-primary" type="button">Label</button>
<button class="btn-outline" data-size="sm" type="button">Label</button>
```

| | height | padding | fill | hover |
|---|---|---|---|---|
| `.btn` / `.btn-primary` | `--h-9` | `0 16.25px` | `--blue`, white text | `--blue-dark` |
| `.btn-outline` | `--h-9` | `0 16.25px` | `--surface`, `--input-border` | border + text → `--blue` |
| `[data-size="sm"]` | `--h-8` | `0 12.5px`, gap `6.25px` | | |

Icons inside buttons are `16.25px` (13 painted), `flex:0 0 auto`, `pointer-events:none`.

`.btn` variants: `outline`, `secondary`, `ghost`, `destructive`. `.btn[data-variant="ghost"]:hover` is the blue wash.

**Text link button** — `.add-line-btn`: blue text, `+` icon at `13.75px`, `font-size:var(--fs-sm)`, underline on hover, no background.

---

## Badge

```html
<span class="badge">3</span>
<span class="badge" data-variant="success">Ready</span>
```

`padding:2.5px 7.5px`, `--r-md`, `--fs-xs`, **`line-height:15px`** — deliberately not `--lh-xs`. 12 + 2 + 2 padding + 1 + 1 border = **18 painted, even**. At `--lh-xs` it came out 19 (odd) and sat on a half-pixel in the page header, every grid toolbar and every review section.

Variants: `info` (blue), `success` (green), `warning` (amber), `danger` (red) — each pulls its `bg` / `border` / text from the matching token family.

---

## Card

```html
<div class="card">
  <div class="card-head">
    <div class="card-head-text">
      <div class="card-title-row">
        <h2 class="card-title">Title</h2>
        <span class="badge">3</span>
      </div>
      <p class="card-desc">One line of context.</p>
    </div>
    <div class="card-head-actions"><!-- buttons, segmented --></div>
  </div>
  <div class="card-body">…</div>
  <div class="card-foot">
    <span class="card-foot-note"><i data-lucide="info"></i> Note</span>
    <div class="card-foot-actions">…</div>
  </div>
</div>
```

`--r-xl`, `1.25px` border, head `16.25px 23.75px` with a `--border-soft` bottom rule, body `20px 23.75px`. `.card + .card { margin-top:17.5px }`.

`.card-title-row` is `align-items:baseline` — the count badge sits on the title's baseline, not against its cap height.

Set `style="padding:0"` on `.card-body` when the body is a full-bleed list or grid.

---

## Field

```html
<div class="field">
  <label class="field-label" for="x">Label <span class="required">*</span></label>
  <input type="text" class="text-input" id="x" placeholder="e.g. …">
  <p class="field-hint">Optional guidance.</p>
  <p class="field-error" hidden><i data-lucide="circle-alert"></i> Message</p>
</div>
```

`.field-label` is `--fs-sm` / `line-height:1` / 500 with `margin-bottom:7.5px`. `.field` has `margin-bottom:16.25px`, zeroed on `:last-child`.

`.text-input` / `.select-input` / `.dropdown-trigger` all share: `--h-9`, `--r-md`, `1.25px solid var(--input-border)`, `padding:0 12.5px`, `--fs-sm`, hover → `border-color:var(--blue)`.

**Error plumbing** (`dpValidate`): `showError(el, msg)` finds the nearest `td`, `.field-group` or `.field`, puts a `.field-error` in it and adds `.field-invalid` to the control. If the control isn't inside one of those three wrappers, `showError` silently does nothing — that was a real bug.

**Row layout** — `.settings-field-row` is a flex row of fixed 220px `.field-group`s. An unlabelled child (a delete button) needs `margin-top:calc(var(--fs-sm) + 7.5px)` to line up with the *control*, not the top of the row. Use `margin-top`, not `align-self:flex-end`, or a validation error growing the field will drag the button with it.

**Money input** — `.rate-input-wrap` wraps a `.rate-input`; `.percent` on the wrap swaps a `$` prefix for a `%` suffix group.

---

## Select → custom dropdown

Author a plain `<select class="select-input">`; `dpEnhanceSelect` replaces it with a `.dropdown-trigger` + `position:fixed` `.dropdown-panel`. Add `data-search="Search…"` for a filterable list.

**The panel is `position:fixed` and positioned from the trigger's `getBoundingClientRect()`** so it can't be clipped by `.content-scroll`. Consequences:

- **No `transform` on any ancestor** — it creates a containing block and traps the panel. Entrance animations are opacity-only.
- `z-index:1000`, above the dialog overlay's 900, so a list opens over a modal.
- A document-level `scroll` listener must use **capture** (scroll doesn't bubble) and must skip scrolls that originate inside the open panel.

`.dropdown-item` hover is the blue wash — identical to `.segmented button:hover`, so an option list and a tab highlight the same way. `.dropdown-item.indent-1 { padding-left:27.5px }` is the child level for hierarchical lists (GL accounts: parent code, then its sub-codes indented).

---

## Segmented control

```html
<div class="segmented">
  <button type="button" class="active">Custom</button>
  <button type="button">Existing Profile</button>
</div>
```

`--h-9` track in `--segmented-track` with `2.5px` padding and `--r-lg`; buttons are `--r-md`.

- Selected = a solid `--blue` pill with white text — the same fill `.btn-primary` uses, because shadcn's white-pill-on-grey needs a shadow to read as raised and every shadow token is `none`.
- `.segmented button:not(.active):hover` — the `:not()` is load-bearing. Selection is marked *only* by the fill, so letting hover repaint it would erase the selection while the pointer sits there.
- **Never restate `color` in a `[data-variant]` block.** `.segmented[data-variant="x"] button` is (0,3,1) and outranks `.segmented button.active` at (0,2,1); a variant that repeats `color:var(--muted-fg)` keeps the active label grey. Variants carry layout only (`flex`, `padding`).

---

## Data grid

A bordered table with a toolbar, a live count and an in-grid empty state.

```html
<div class="data-grid" data-grid-for="myTable">
  <div class="data-grid-toolbar">
    <div class="data-grid-toolbar-left">
      <span class="data-grid-title">Commission lines</span>
      <span class="badge" data-grid-count>0</span>
    </div>
  </div>
  <div class="data-grid-scroll">
    <table class="pay-table" id="myTable"><thead>…</thead><tbody></tbody></table>
  </div>
  <div class="grid-empty" data-grid-empty hidden>
    <div class="grid-empty-icon"><i data-lucide="percent"></i></div>
    <p>Nothing yet. Add one to …</p>
  </div>
</div>
```

`dpInitGrids(root)` wires a `MutationObserver` on the tbody that keeps the badge and the empty state in step. Call it after building markup in JS; it's idempotent.

`.pay-table` uses **`border-collapse:separate; border-spacing:0`** with horizontal borders only. In the collapsed model a shared border is split between adjacent cells, contributing 0.5px to the row below and putting the table, the grid, the card and everything under it on a half-pixel.

**Tables start empty.** No pre-seeded blank row — a blank row reads as a line the user or a profile added, and has to be deleted by hand in the common case.

**"At least one line" rule** — put `data-requires-row="<tableId>"` on the section and a `<p class="field-error" data-requires-row-error hidden>` under the Add button. The id may be a `<table>` or a plain container of `.settings-field-row`s. The message appears only once the section has been *touched* (added to, or Continue pressed on it), so arriving on an empty step isn't greeted by an error.

---

## Alert

```html
<div class="alert" data-variant="warning">
  <span class="alert-icon"><i data-lucide="triangle-alert"></i></span>
  <div class="alert-body">
    <h4 class="alert-title">One sentence.</h4>
    <button type="button" class="alert-more" data-alert-toggle="id" aria-expanded="false" aria-controls="id">
      More <i data-lucide="chevron-down"></i>
    </button>
    <p id="id" hidden>The long version.</p>
  </div>
</div>
```

Grid `16.25px 1fr`, gap `0 12.5px`, `--r-lg`. Default is the blue/info family; `data-variant` gives `warning`, `success`. Long explainers go behind `.alert-more`, never printed twice on one screen.

---

## Dialog

```html
<div class="dialog-overlay" id="x" hidden>
  <div class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="…" aria-describedby="…">
    <div class="dialog-head">
      <h2 class="dialog-title">…</h2>
      <p class="dialog-desc">…</p>
      <button type="button" class="dialog-close" data-dialog-close aria-label="Close"><i data-lucide="x"></i></button>
    </div>
    <div class="dialog-body">…</div>
    <div class="dialog-foot has-note">
      <span class="dialog-foot-note"><i data-lucide="list-checks"></i> <span>Note</span></span>
      <div class="dialog-foot-actions">
        <button class="btn-outline" data-dialog-close>Cancel</button>
        <button class="btn-primary">Continue</button>
      </div>
    </div>
  </div>
</div>
```

- Overlay is `position:fixed; display:flex; align-items:center; justify-content:center` — **centred with flex, never `translate(-50%,-50%)`**, because a transform would trap any `position:fixed` dropdown inside.
- `z-index:900`, under the dropdown panel's 1000.
- Panel `max-width:480px` (384 painted); `.dialog-wide` is `625px` (500) when it holds side-by-side content.
- **`snap()`**: a centred panel of odd height lands on a half-pixel. Measure `panel.getBoundingClientRect().top`; if fractional, add `.snap` (one extra painted pixel of bottom padding). Re-run it on resize **and on every content change** — a multi-view dialog changes height when the view changes.
- Standard wiring: `[data-dialog-close]` buttons, overlay `mousedown`, Escape (skipped while a `.dropdown.open` is up), a Tab trap on the panel, `body.has-dialog` to lock the page scroll, and restore focus to the opener on close.

**Multi-view dialog** — one panel, several `[data-view]` bodies, one footer. Swap title, description and footer note per view so the panel reads as the thing it currently is. Back returns to the previous view rather than closing.

---

## Choice cards

Two or three ways forward, side by side, inside a dialog. Whole cards rather than radios, because each option needs a sentence and a sentence beside a radio is a label nobody can click.

```html
<div class="choice-grid">
  <button type="button" class="choice-card" data-go="a">
    <span class="choice-card-icon"><i data-lucide="folder-open"></i></span>
    <span class="choice-card-title">Title</span>
    <span class="choice-card-desc">One sentence.</span>
  </button>
</div>
```

`1fr 1fr` grid, gap `12.5px`, collapsing to one column under 520px. Hover: blue wash + blue border + blue icon + blue title.

---

## List row

A row of records where the whole row is the control.

```html
<ul class="profile-list">
  <li><button type="button" class="profile-row" data-id="…">
    <span class="profile-row-icon"><i data-lucide="file-text"></i></span>
    <span class="profile-row-text">
      <span class="profile-row-name">Name</span>
      <span class="profile-row-meta" title="…">Summary · line</span>
    </span>
    <span class="badge">Weekly</span>
    <span class="profile-row-go"><i data-lucide="chevron-right"></i></span>
  </button></li>
</ul>
```

- A `<button>`, not a link with a button on the end — a clickable name leaves most of a 44px strip inert.
- Chevron is `opacity:0` until hover/focus: three of them stacked down a card is a column of arrows pointing at nothing.
- Name and meta both ellipsise; meta hides under 640px rather than wrapping the row onto two lines.
- **Parity:** name 16 + margin 2 + meta 14 = 32 painted, even, so the 28px icon and 18px badge centre exactly. Don't let the margin be 1.25px.

---

## Empty state

```html
<div class="empty-state">
  <div class="empty-icon"><i data-lucide="file-plus-2"></i></div>
  <h3 class="empty-title">Nothing here yet</h3>
  <p>One sentence saying what to do.</p>
  <button class="btn-primary" data-size="sm">Do it</button>
</div>
```

Flex column, centred, gap `12.5px`, padding `43.75px 23.75px 40px`. The icon is a `43.75px` rounded tile with a hairline border on `--page-bg`.

Don't leave an empty state under a heading that names records you could actually list — show the records.

---

## Stepper + wizard

`.stepper .step` buttons carry `.active` / `.done` / `.is-navigable`, and `step.disabled = i > maxVisited - 1`. Hover on a navigable step is the blue wash on `.step-card`.

- Validate on Continue, per step, not all at the end.
- When a step fails, mark the fields, focus the first invalid one, and toast. If the failure is "no rows" there is no field to focus — focus the Add button.
- A review step should let the user jump to each failing step from the failure message itself, not just say "step 3".
- **A wizard is for creating.** When the same flow opens an *existing* record, unlock every step — forcing someone through seven Continues to edit one line is the wrong shape.

---

## Success stage

Seven steps of work deserve a result, not a toast that leaves in four seconds. `.created-card`: an SVG tick that draws itself (`stroke-dashoffset`), a radial `--green-bg` wash from the top, the record's name, a quotable reference, a stat grid recapping what was built (read from the live form, never re-typed), and the two actions anyone does next.

Everything on it is entrance motion, so `@media (prefers-reduced-motion: reduce)` drops all of it and leaves the finished state.

---

## Summary rail

A sticky `aside` of disclosure rows. **It grows when a section opens — no internal scroller.** Capping it and scrolling inside hides the very thing the click asked for.

Because it can grow past the scrollport, compare its height to the scroller after every open, close and resize, and drop it to `position:static` while it doesn't fit — a sticky box taller than the scrollport pins its top and puts its own bottom permanently out of reach. Measure both sides with `getBoundingClientRect()`; `clientHeight` is a different unit under zoom.

---

## Toast

`dpToast(variant, title, body)` — `success` / `error`. Use it for acknowledgements that don't need a surface of their own. If a full success screen exists for the same event, don't also toast it.
