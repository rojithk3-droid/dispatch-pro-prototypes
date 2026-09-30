---
name: newdpdesignsystem
description: The Dispatch Pro shadcn/ui-at-80% design system — the 1.25px grid, the even-parity rule, the token set, and the component library established in agent-pay-profile.html. Use this whenever building, redesigning, restyling or extending any screen, card, table, form, dialog, dropdown or wizard in this project, whenever a Figma link is posted for one of these files, and whenever a size, colour, radius or spacing value has to be chosen. Read it BEFORE touching any px value — hand-picked numbers land off the pixel grid and soften every glyph on the screen.
---

# Dispatch Pro design system (shadcn/ui at 80%)

This is the house system for the Dispatch Pro prototypes. It is shadcn/ui's geometry rendered at 80% so the page matches the app's topbar and sidebar, which are **not** scaled and keep their own values.

You are not inventing a look. You are picking the right component from the catalog and filling it with real data. If you need a value that isn't here, derive it from the grid — never eyeball it.

## The three laws

### 1. Every length is a multiple of 1.25px

`body { zoom: 0.8 }`. A declared px value renders at 0.8×, so it lands on a **whole rendered pixel only when it is a multiple of 1.25px**.

```
declared 13.75px -> renders 11px    ✓
declared  6.25px -> renders  5px    ✓
declared 13.5px  -> renders 10.8px  ✗ never
```

A fractional painted size re-hints the glyphs onto half-pixels every line — this is what makes text look soft and "low quality", and it is almost always the real cause when someone says the font looks wrong.

To convert a shadcn value: `declared = round(shadcn_px × 0.8) × 1.25`.
To rescale the whole system to a different zoom: `new = round(old × 0.64) × 1.25`.

### 2. Line-heights and centring containers must render EVEN

A line box is constantly centred against something — a button, a table cell, a card footer, a flex row. **An odd-height box cannot centre an even child**: a 16px line box in a 29px trigger sits at y+6.5.

So: every `--lh-*` renders even, and `--h-9` is 30px painted, not 29. When you build a new flex row, compute its content height in painted px and make it even before you ship it. This is the single most common defect in new work.

Worked example, from the saved-profile row:

```
name 16px + margin 1px + summary 14px = 31 painted (ODD)
    -> the row's 28px icon and 18px badge both land on a half-pixel
fix: margin 1.25px -> 2.5px  =>  16 + 2 + 14 = 32 (EVEN)
```

### 3. No shadows, one hover colour

All four `--shadow-*` tokens are `none` in both themes. Every elevation surface resolves them, so elevation is carried by **hairline borders and background steps only**. Focus rings are unaffected — they are spread-only `0 0 0 Npx` box-shadows written inline, not elevation.

**Every hover in the file goes to `--blue` (#0F6FFF).** Buttons, dropdown options, segmented tabs, table rows, list rows, choice cards, warning links — all the same blue wash (`--blue-bg` fill, `--blue` text/border). A component that hovers grey is a bug. When the hovered text sits on `--blue-bg`, the text must go blue too — amber or green on blue is unreadable.

## Workflow

1. **Install the tokens first.** Copy `references/tokens.css` verbatim. A hardcoded hex inside a component is what makes the second half of a screen drift from the first.
2. **Map before you build.** List every element and name the component from `references/components.md` you'll use for each. Two things with the same job get the same component; resist varying them for interest.
3. **Build from the catalog**, not from scratch. If nothing fits, compose from existing primitives (card + data-grid + badge) before adding a new one.
4. **Compute parity** for any new flex row or centring container.
5. **Run the audit** (below) in light *and* dark before you call it done.

## Verification

Paste this in the console. It must return empty arrays.

```js
var bad = [];
document.querySelectorAll('SCOPE *').forEach(function(el){
  if(!(el instanceof HTMLElement)) return;          // SVG inner paths are always fractional; ignore them
  var r = el.getBoundingClientRect();
  if(!r.height) return;
  if(Math.abs(r.height - Math.round(r.height)) > 0.01 ||
     Math.abs(r.top    - Math.round(r.top))    > 0.01)
    bad.push((el.className || el.tagName) + ' h=' + r.height + ' top=' + r.top);
});
bad;
```

Also check: no console errors, and the same pass with `data-theme="dark"` on `<html>`.

## Traps that have actually bitten

These are all real, all cost time, and all look like something else when they happen.

- **Never put a `transform` on an ancestor of a `position:fixed` JS-positioned panel.** A transform creates a containing block and the dropdown panel gets trapped inside it. This rules out scale/slide entrance animations on `.stage`, `.dialog-panel` and anything above them — opacity-only.
- **`getBoundingClientRect()` returns PAINTED px; `getComputedStyle()` and `clientHeight`/`offsetHeight` return DECLARED/layout px.** Under `zoom:0.8` these are different units. Never compare them without dividing by the zoom. Comparing a rect against a `clientHeight` is a silent bug.
- **CSS transitions corrupt immediate measurement.** Reading `getComputedStyle` within ~300ms of a state change gives you the mid-transition value. Re-measure after ~900ms, or you will chase a bug that isn't there.
- **Lucide moves your class onto the replacement `<svg>`.** `<i data-lucide="x" class="foo">` becomes `<svg class="lucide lucide-x foo">`, so `.foo svg` never matches. Style `svg.foo`, and re-run `dpIcons()` after building markup in JS.
- **`scroll` does not bubble** — a document-level listener needs capture, and capture then hears *every* element's scroll, including the panel's own. Guard with a containment test.
- **`width:100%` defeats `max-content` measurement** (it resolves against the container). Use `min-width:100%` when you need to fill without breaking intrinsic sizing.
- **Text that can wrap also wraps during a `max-content` measurement**, so the measurement returns the already-wrapped width. Add `white-space:nowrap` before measuring.
- **`border-collapse:collapse` splits a shared border between adjacent cells**, putting rows on half-pixels. Tables use `separate` + `border-spacing:0` with horizontal borders only.
- **Specificity:** `.segmented[data-variant="x"] button` is (0,3,1) and silently outranks `.segmented button.active` at (0,2,1). Check before adding a variant.
- **A removed element's click may not reach a delegated `document` listener** — a row's remove button detaches itself mid-dispatch. Use a `MutationObserver` on the container instead.
- **A sticky box taller than the scrollport pins its top and puts its own bottom out of reach.** If a sticky panel can grow, compare its height to the scrollport and drop it to `position:static` when it doesn't fit.
- **`body.innerHTML` includes inline `<script>` text.** Never use it to check "is this string gone from the UI".

## Don't touch

In the existing prototypes these are out of scope for restyling unless asked directly: the topbar/header, the breadcrumb bar, the left sidebar rail, and `.wizard-footer`. They are shared app chrome and are not scaled by the 80% block.

## Files

- `references/tokens.css` — the complete token set, light and dark. Paste verbatim.
- `references/components.md` — the component catalog: markup shape, the rules that matter, and the parity notes for each.
