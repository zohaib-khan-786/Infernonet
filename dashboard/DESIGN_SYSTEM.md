# FreshGuard Design System

A specification for the dashboard at `dashboard/`. Every value here is implemented in
`src/styles/tokens.css` and every contrast ratio quoted was computed against that file's
hex values, not estimated.

- **Token file:** `src/styles/tokens.css`
- **Target:** WCAG 2.1 AA minimum
- **Hard constraint:** works at 360 px, excellent on a wide desktop
- **No new dependencies.** System font stacks only. No Tailwind, no CSS-in-JS, no UI kit.

---

## 1. Visual thesis

FreshGuard is a measuring instrument, so it is built like one.

A cool, light instrument face with a single dark bezel at the top. Elevation is a
four-step ladder of surface lightness separated by 1px seams, never shadow. Readouts are
dense, hairline-ruled and stamped in tabular mono so a column of digits stays comparable
and nothing reflows as values update. Saturation is treated as a budget: the only
chromatic pixels in the entire interface are four status inks, one data blue, and the
focus ring, and each is doing a job a shape or a word could not do alone.

**Why this fits a food-safety instrument.** A volunteer is making a decision about whether
someone eats something, standing up, in a basement, possibly on a phone with a low
brightness setting. That context argues for maximum luminance contrast, minimum
decoration, and a page where the single most important thing — the verdict — is the
loudest element and everything else is quiet. It also argues against a dark "mission
control" theme, which is the reflexive choice for telemetry and is genuinely worse on a
cheap phone screen in an unlit room. So: a light instrument face, a dark bezel for
identity and link state only, and colour that is spent exclusively on meaning.

**The deliberate omission: there is no accent colour.** Interactive affordances are
ink-on-paper — a dark filled button or a hairline outlined one. This is the only way the
rule "colour is reserved for meaning" is actually true in practice. A brand accent would
sit one click away from every status colour and the volunteer would learn to ignore hue
entirely, which is exactly the failure mode the four-status colour language depends on
preventing.

**Where the "modern and futuristic" actually comes from**, since it is not coming from
glow: precision. Fluid display sizes that stay readable at 360 px and do not become a
billboard at 1400 px. Real tabular figures everywhere. A density that treats whitespace as
wasted instrument face. Tight negative tracking on display sizes. Mono micro-labels where
a label is really an identifier. Structure that reads as engineered rather than decorated.

### Banned, deliberately

Near-black grounds with a single acid accent; frosted glass and `backdrop-filter`;
purple/indigo gradients; ALL-CAPS tracked-out eyebrow labels; `·`-joined meta strings;
`→` on button labels; glowing text shadows; animated gradient orbs; a soft grey
`rgba(0,0,0,.1)` shadow under every card. If a change reintroduces one of these it is
wrong, not a matter of taste.

---

## 2. Palette

All ratios are WCAG 2.1 relative-luminance contrast, computed. "void" is
`--surface-void`, "field" is `--surface-field`, "plate" is `--surface-plate`,
"sunken" is `--surface-sunken`.

### 2.1 Surfaces — the elevation ladder

| Token | Hex | Role |
|---|---|---|
| `--surface-void` | `#E2E6E6` | The page. Also panel head strips and the table head. |
| `--surface-sunken` | `#D3DADA` | Wells and tracks: meter tracks, hatched fills. Carved, not raised. |
| `--surface-field` | `#EFF3F3` | Panel heads and feet, table head, acknowledged rows, retired rows. |
| `--surface-plate` | `#FFFFFF` | The readout plate. Where a number is stamped. The lightest surface. |

Adjacent-step contrast: void↔sunken 1.13, void↔field 1.13, field↔plate 1.12,
plate↔sunken 1.42. These are below 3:1 **on purpose** — this ladder *is* the depth
model, and it is backed up by hairline seams so structure survives in greyscale. Do not
"fix" these by darkening; darken `--rule-hairline` instead.

### 2.2 Ink

| Token | Hex | L | void | field | plate | sunken |
|---|---|---|---|---|---|---|
| `--ink-primary` | `#0F1618` | 0.0074 | 14.54 | 16.36 | 18.29 | 12.90 |
| `--ink-secondary` | `#394648` | 0.0572 | 7.79 | 8.76 | 9.80 | 6.91 |
| `--ink-tertiary` | `#53605E` | 0.1101 | 5.21 | 5.87 | 6.56 | 4.62 |
| `--ink-disabled` | `#7E8A88` | 0.2439 | 2.84 | 3.20 | 3.57 | 2.52 |

Every ink clears 4.5:1 on all four surfaces. `--ink-disabled` is below 4.5:1 and is
permitted only on genuinely disabled controls, which WCAG 1.4.3 exempts.

`--ink-primary` is **1.06:1 on the bezel and must never be used there.** The bezel has its
own ink ladder.

### 2.3 Rules

| Token | Hex | plate | field | void | sunken |
|---|---|---|---|---|---|
| `--rule-strong` | `#6C7A7B` | 4.46 | 3.99 | 3.55 | 3.15 |
| `--rule-hairline` | `#A6B0B0` | 2.22 | 1.99 | 1.77 | 1.57 |

`--rule-strong` clears 3:1 on all four surfaces and is the **only** border permitted on a
control — buttons, inputs, selects, the segmented control, the chart axis, the meter
track. `--rule-hairline` is decorative structure: 2.22:1 on the plate is below 3:1, and
that is correct, because WCAG 1.4.11 applies to visual information *required to identify a
control* and no control in this system is identified by a seam. Seams are backed up by the
surface lightness step so they remain visible in greyscale.

### 2.4 Status — reserved, never decorative

Four device verdicts, then two tones that are explicitly **not** verdicts.

| Status | Code | `--status-…-ink` | tint | `-edge` | ink on tint | ink on plate |
|---|---|---|---|---|---|---|
| `fresh` | 0 | `#1C7251` | `#D8EADB` | `#1C7251` | 4.67 | 5.87 |
| `use_soon` | 1 | `#7E4A0B` | `#F1E2C4` | `#7E4A0B` | 5.72 | 7.31 |
| `check_food` | 2 | `#841C13` | `#F5D9D3` | `#841C13` | 7.30 | 9.74 |
| `sensor_fault` | 3 | `#222E34` | `#D6DCDD` | `#222E34` | 10.04 | 13.92 |
| administrative | — | `#245470` | `#DFE8EE` | `#245470` | 6.56 | 8.15 |
| informational | — | `#394648` | `#EFF3F3` | `#6C7A7B` | 8.76 | 9.80 |

All six inks also clear 4.5:1 on `--surface-void` and `--surface-field`. The lowest
figure anywhere in that set is 4.67:1.

**One boundary to know:** `--status-fresh-ink` on `--surface-sunken` is 4.14:1, below
4.5:1. Never place a status ink on `--surface-sunken`. Sunken is for wells and tracks,
which carry `--tone-edge` as a graphic (3:1 gate, all tones pass) and not text.

Design intent per tone:

- **`fresh` is the lowest-contrast status ink in the system.** A good cabinet should look
  quiet. It takes real oxide red to make this page loud.
- **`use_soon` is a burnt amber, never yellow.** Yellow cannot reach 4.5:1 on white.
- **`check_food` is the only red in the system.** One red, used once, means something.
- **`sensor_fault` is a cold near-neutral slate, never red.** The device could not
  evaluate the food. Painting it like `check_food` would tell a volunteer their food is
  unsafe when the device said it could not tell.
- **`administrative`** is a desaturated blue-slate: storage, config and optional-hardware
  problems, which the service reports as leaving freshness unaffected.
- **`informational`** borrows `--surface-field` as its tint on purpose. "No verdict here"
  should not look like a sixth opinion.

### 2.5 Accent and data — one blue, three weights

| Token | Hex | Role | plate |
|---|---|---|---|
| `--accent-link` | `#0B4C7F` | Link text | 8.92 |
| `--accent-series` | `#14567F` | The measured trace | 7.87 |
| `--accent-focus` | `#1A5FD0` | Keyboard focus ring, and nothing else | 5.85 |
| `--accent-on-dark` | `#8FC7F2` | Focus ring on the bezel | 9.56 on bezel |
| `--focus-halo` | `#FFFFFF` | Keeps one ring colour legible on any surface | — |
| `--tap-highlight` | `rgb(11 76 127 / .14)` | iOS tap flash | — |

The focus ring is the only vivid thing in the system, and it only exists when the keyboard
is in use. That is the correct place to spend the system's one bright colour.

### 2.6 Bezel — the one dark region

| Token | Hex | Role | on `#151C1D` |
|---|---|---|---|
| `--surface-bezel` | `#151C1D` | The masthead | — |
| `--surface-bezel-well` | `#1F292A` | Select and input wells inside the bezel | — |
| `--surface-bezel-raised` | `#1D2728` | Reserved | — |
| `--rule-bezel` | `#333E3F` | Hairline inside the bezel | 1.56 |
| `--rule-bezel-strong` | `#4A5657` | Hover inside the bezel | 2.27 |
| `--ink-on-dark` | `#EDF2F1` | Wordmark, bezel headings | 15.28 |
| `--ink-on-dark-2` | `#A6B2B1` | Device id, bezel metadata | 7.92 |
| `--ink-on-dark-3` | `#7D8A89` | "no device has reported" | 4.83 |

**Transport lamps — deliberately not green.**

| Token | Hex | Meaning | on bezel |
|---|---|---|---|
| `--transport-live` | `#7FB6E2` | Data is arriving | 7.97 |
| `--transport-waiting` | `#C99A4A` | Quiet, not alarming | 6.75 |
| `--transport-down` | `#8A9695` | No information | 5.66 |
| `--caution-on-dark` | `#D8B36B` | Device-level caution text in the bezel | 8.70 |

Green in this system means `fresh` and nothing else. A live network is not a food verdict,
and a volunteer who has learned to read green must never see it for something that is not
about the food. `--transport-live` is the data blue, lifted for a dark ground;
`--transport-down` is deliberately the same value as `--ink-on-dark-3`, because a dead
link is not information, it is absence.

### 2.7 Chart series

| Slot | Hex | L | plate | field | dash |
|---|---|---|---|---|---|
| `--chart-series-1` | `#0F1618` | 0.0074 | 18.29 | 16.36 | `none` |
| `--chart-series-2` | `#14567F` | 0.0834 | 7.87 | 7.04 | `7 3` |
| `--chart-series-3` | `#2F7396` | 0.1507 | 5.23 | 4.68 | `2 3` |
| `--chart-series-4` | `#4A87A8` | 0.2161 | 3.95 | 3.53 | `9 3 2 3` |

Each plot in this product carries **exactly one series** and is separated from its
neighbours by a panel seam, so series colour is never load-bearing today. The ramp exists
for a future overlay and is built to survive having no hue at all:

- **Lightness is the primary channel, not hue.** Luminance steps 0.0074 → 0.0834 → 0.1507
  → 0.2161. Smallest gap 0.067, roughly five times the ~0.013 a reader can just resolve.
- **Dash pattern is the third channel**, and the right one for a line chart.
- **Hue is almost entirely a single blue family plus the ink black**, so a chart line can
  never be mistaken for a status colour. The nearest collision is `--chart-series-1` (ink
  black, 0.0074) against `--status-sensor-fault-ink` (0.0254) — 0.018 apart, and they
  never co-occur: the sensor-fault slate appears only as a chip tint, a tone bar or a
  hatched mark, and a trace always appears inside its own bordered plot.

Chart ink: `--chart-axis` `#6C7A7B` (4.46 on plate, 3.81 on the band — this is the line
that must read), `--chart-grid` `#A6B0B0` (2.22, decorative), `--chart-band` `#E9EEEF`
(1.17, bounded by a dashed `--chart-band-edge` at 4.46), `--chart-label` `#394648` (9.80),
`--chart-label-quiet` `#53605E` (6.56).

---

## 3. Typography

### 3.1 The two voices

| Role | Token | Stack |
|---|---|---|
| Measurement, timestamps, codes, tabular data | `--font-mono` | `ui-monospace`, `Cascadia Mono`, `Cascadia Code`, `SFMono-Regular`, `Segoe UI Mono`, `Liberation Mono`, `Consolas`, `Courier New`, `monospace` |
| Prose, labels, headings | `--font-sans` | `Segoe UI Variable Text`, `Segoe UI`, `system-ui`, `-apple-system`, `Helvetica Neue`, `Arial`, `sans-serif` |

**Why system stacks and no webfont.** The dashboard has to work in a basement with no
signal. A Google Fonts `<link>` is render-blocking and fails closed exactly when the
product is most needed, and self-hosting means adding binary assets and an `@font-face` to
a project that deliberately has three runtime dependencies. The thing that makes this read
as an instrument is the *split by job* — mono for measurement, humanist sans for language —
and that split is carried by the role assignments below, not by a particular grotesque. A
system stack loses nothing here. If a brand face is ever added it replaces `--font-sans`
only, and it must keep a humanist skeleton at 11.5–15.5 px.

**Why tabular figures are non-negotiable.** A reading updates every few seconds. In
proportional figures `3.4` becoming `11.2` makes the whole cell twitch, and a column of
readings stops being comparable at a glance. Every measured value, timestamp, sequence
number, count and duration gets `--font-mono` **and** `font-variant-numeric: tabular-nums`
**and** `letter-spacing: var(--tracking-data)`. The `.num` utility in `base.css` already
does this; every new numeric element must use it.

### 3.2 Size scale

| Token | Size | Weight / leading / tracking | Used for |
|---|---|---|---|
| `--type-micro` | 11.5px | 600 / 1.4 / `--tracking-label` | units, axis micro-labels, mobile cell labels, footnotes |
| `--type-meta` | 12.5px | 600 / 1.4 / `--tracking-label` | table headers, button labels, panel sub, log stamps |
| `--type-small` | 14px | 400–600 / 1.5 / normal | secondary body, table cells, condition detail |
| `--type-body` | 15.5px | 400–700 / 1.5 / `--tracking-heading` | body copy, panel titles, notice and banner titles |
| `--type-readout` | `clamp(1.125rem, 3.2vw, 1.375rem)` → **18→22px** | 600 / `--leading-data` 1.1 / `--tracking-data` | one measurement, one chart readout |
| `--type-verdict` | `clamp(1.5rem, 5.2vw, 2.125rem)` → **24→34px** | 700 / `--leading-tight` 1.05 / `--tracking-display` | the verdict word |

The two largest steps are fluid. The scale is otherwise fixed and deliberately compressed:
an instrument is dense, and density is the aesthetic, not an accident.

**The 18px floor on `--type-readout` is load-bearing.** At 20px the word
`not reported` wraps to two lines inside a 360px reading cell, which reads as a layout
fault rather than as an absence. Verified by rendering.

The 24px floor on `--type-verdict` means `Check food` sits on one line at 360px. Verified
by rendering.

### 3.3 Weights, leading, tracking

- `--weight-regular` 400 · `--weight-medium` 500 · `--weight-semibold` 600 · `--weight-bold` 700.
  Nothing heavier. An instrument is not a poster.
- `--leading-tight` 1.05 · `--leading-snug` 1.2 · `--leading-body` 1.5 ·
  `--leading-prose` 1.62 · `--leading-data` 1.1
- `--tracking-display` -0.025em · `--tracking-heading` -0.015em · `--tracking-normal` 0 ·
  `--tracking-label` 0.005em · `--tracking-data` -0.01em

**Uppercase and tracked-out labels are banned.** The tracking values above are optical
corrections at display sizes and nothing more. A label is sentence case.

### 3.4 Measure

`--measure-prose: 68ch` for notice and banner paragraphs. Longest implemented
`max-inline-size` is 76ch, which is at the top of the comfortable range for this sans;
prefer `--measure-prose` for anything new.

---

## 4. Space, radius, elevation, motion

### 4.1 Space — 4px base

| Token | Value | Role |
|---|---|---|
| `--space-1` | 4px | hairline gaps, icon to label |
| `--space-2` | 8px | inline gaps, chip padding |
| `--space-3` | 12px | default cell padding, panel head and foot |
| `--space-4` | 16px | page gutters on mobile, control padding |
| `--space-5` | 24px | between panels on mobile |
| `--space-6` | 32px | reserved: desktop column rhythm (**currently unreferenced**) |
| `--space-7` | 48px | page bottom rhythm |

### 4.2 Radius — nothing above 3px, anywhere, ever

`--radius-none` 0 (structural panels, rules, the bezel) · `--radius-hairline` 1px (wells,
meter tracks) · `--radius-control` 2px (buttons, inputs, chips, selects) ·
`--radius-plate` 3px (panels, banners, notices). A moulded instrument face has a 1–2px
break. A 16px pill belongs to a different product.

### 4.3 Elevation — a budget of two

| Token | Value | Use |
|---|---|---|
| `--elevation-none` | `none` | everything, by default |
| `--elevation-raised` | `0 1px 2px rgb(15 22 24 / .07)` | only what genuinely floats over content: the sticky masthead, the skip link |
| `--elevation-overlay` | `0 8px 24px -10px rgb(15 22 24 / .22), 0 2px 6px -2px rgb(15 22 24 / .1)` | reserved for true overlays. Nothing uses it today. |

**If you need a third shadow level, you have misunderstood the layout.** Depth here is
lightness plus a seam. 1px, not 8px.

### 4.4 Motion

| Token | Value |
|---|---|
| `--motion-instant` | 80ms — colour and border on hover |
| `--motion-fast` | 120ms — chips, focus ring, segmented options |
| `--motion-base` | 180ms — expanding a section, a chart redraw |
| `--motion-slow` | 320ms — reserved; a real layout change only |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--ease-entrance` | `cubic-bezier(0, 0, 0, 1)` |
| `--ease-exit` | `cubic-bezier(0.3, 0, 1, 1)` |
| `--motion-pulse-loop` | 2400ms — the live-feed lamp |
| `--motion-sweep` | 1400ms — the loading bar |

Motion answers an action or a state change. It is never ambient. There are exactly two
loops in the system and both carry information: the live lamp says data is arriving, the
loading sweep says a request is in flight. No entrance animations on scroll, no hover
lifts on cards, no animated backgrounds.

### 4.5 Layout and hit targets

`--shell-max` 1560px · `--rail-width` 27rem · `--measure-prose` 68ch ·
`--control-min` 2.25rem (36px, pointer) · `--tap-min` 44px (coarse pointers, the
accessibility floor) · `--hairline` 1px · `--z-sticky` 20 · `--z-skip` 100.

Breakpoints are documented in `tokens.css §14` as documentation-only custom properties,
because CSS variables cannot be read inside `@media` without a preprocessor and this file
is plain CSS on purpose. The numbers are 26rem, 44rem, 46rem, 46.0625rem, 60rem, 68rem.
The 44rem / 46rem pair is genuinely redundant and is a consolidation candidate.

---

## 5. The status language

### 5.1 Status is never colour alone

Every status treatment is **colour + word + shape**, and all three are always present.
The word is the device's own label, humanised only by removing underscores and fixing
case; the raw token is printed alongside it, so a volunteer can see the exact word the
service used and nothing has been re-derived on the way to the screen.

| Status | Token | Shape | Word | Tint | Edge |
|---|---|---|---|---|---|
| `fresh` | `fresh` | ring / circle outline | Fresh | `#D8EADB` | `#1C7251` |
| `use_soon` | `use_soon` | filled triangle | Use soon | `#F1E2C4` | `#7E4A0B` |
| `check_food` | `check_food` | filled square | Check food | `#F5D9D3` | `#841C13` |
| `sensor_fault` | `sensor_fault` | **hatched** diamond | Sensor fault | `#D6DCDD` | `#222E34` |
| code outside 0–3 | as sent | slashed circle | Unrecognised status | `--surface-field` | `#6C7A7B` |

The shapes are drawn as SVG in `Mark.tsx` and mapped in `lib/status.ts`. Those two files
are the contract; the table above documents it and `tokens.css` must not duplicate it.

### 5.2 Greyscale strategy

**Primary strategy: shape and word.** The four shapes are unambiguous in greyscale at
13px and at 2x, and the word is always present. This is why the palette is free to be
calm — the shapes do the load-bearing work and colour is reinforcement.

**Secondary, independent strategy: ink luminance.** The four status inks are spaced in
relative luminance so a greyscale rendering still separates them:

| Status | Hex | L |
|---|---|---|
| `sensor_fault` | `#222E34` | 0.0254 |
| `check_food` | `#841C13` | 0.0578 |
| `use_soon` | `#7E4A0B` | 0.0936 |
| `fresh` | `#1C7251` | 0.1288 |

Smallest pairwise gap **0.0324** (sensor_fault / check_food), roughly 2.5× the ~0.013
difference a reader can just resolve on a panel. The ordering is also semantically
pleasing: the calm state is the lightest, so `fresh` reads as quiet in greyscale too.

**Tints mirror the ink ordering** — sensor-fault 0.707 < check-food 0.737 < use-soon
0.771 < fresh 0.786 — so if hue is removed the two channels reinforce rather than
contradict.

**Be honest about the limit.** Four pale washes inside 0.71–0.79 cannot be separated by
lightness alone. The tints are hue-led and are reinforcement, not the greyscale channel.
The ink, the shape and the word are what carry it.

**One texture, on purpose.** Exactly one pattern exists: the 45° hatch on `sensor_fault`,
which is what a laboratory instrument prints when it has no data. It is not repeated
across the other three statuses. Giving every status a texture would turn a signal into a
pattern library.

### 5.3 The greyscale fallback treatment

If a user cannot perceive hue at all, or the page is printed in black and white:

1. The **shape** carries the status, at every size the shape is rendered.
2. The **word** carries it, always.
3. The **ink luminance ordering** above separates the four where they appear as text or a
   tone bar.
4. The **hatch** on `sensor_fault` is the only texture and survives monochrome completely.
5. Nothing else needs to change. No alternate stylesheet, no `forced-colors` variant is
   required for status to remain correct.

### 5.4 Device-level banners are not verdicts — the load-bearing distinction

The "device clock is not trusted" banner and the "transport stale" notice describe the
**monitor and the network**. They are not judgements about the food, and they must not
look like judgements about the food. The mechanism is a different **edge treatment**,
which is greyscale-distinct and not a hue:

| Token | Value | Meaning |
|---|---|---|
| `--edge-verdict` | `5px solid` | the device is telling you a verdict about food |
| `--edge-caution` | `6px double` | something about the device is wrong; not a verdict |
| `--edge-neutral` | `1px solid` | information, no judgement |

A solid thick bar says *decision*. A double rule says *instrument caution* — the way a
panel meter marks a caution lamp differently from an alarm lamp. A hairline says
*information*.

**Today both banners still use `--edge-verdict`,** because both set `data-tone` in a
`.tsx` file that must not change and there is no token-only way to separate them. See
Deferred items — this is the single most important thing in that list.

---

## 6. Component treatments

### 6.1 Status band (`.status-band`, `.annunciator`)

The one loud element on the page, and the only thing allowed to be loud.

- Full-bleed. `background: var(--surface-plate)`, `border: var(--seam)`,
  `border-radius: var(--radius-plate)`. No shadow.
- Head strip: `background: var(--surface-void)`, `border-block-end: var(--seam)`. One
  step darker than the plate, so the band reads as a recessed instrument face.
- **≥ 44rem:** two annunciator plates side by side, split by a 1px inline seam.
- **< 44rem:** stacked, one per row. Add a `border-block-start: var(--seam)` between
  stacked plates so the two 5px tone bars do not read as one 10px bar that changes
  colour halfway (deferred — `layout.css`).
- Each annunciator: `border-inline-start: var(--edge-verdict)` where the edge is
  `var(--tone-edge)`, `padding: var(--space-4) var(--space-3)`.
- Lamp column 2.75rem, holding a `--type-verdict`-scale shape mark coloured
  `var(--tone-ink)`.
- Scope label ("Overall", "Cabinet zone") at `--type-meta` / 600 / `--ink-secondary`. Not
  an eyebrow; it sits inside the plate as a field label.
- Verdict word at `--type-verdict` / 700 / `--tracking-display`, coloured
  `var(--tone-ink)`.
- The raw token in a chip beside it: `--status-…-tint` background, 1px
  `--status-…-edge` border, `--radius-control`, `--type-micro`, `var(--tone-ink)`.
  The chip is what makes "nothing has been re-derived" visible.
- Meaning sentence at `--type-small` / `--ink-secondary`, `max-inline-size: 46ch`.
- Foot strip: `background: var(--surface-field)`, `border-block-start: var(--seam)`,
  `--type-meta` / `--ink-secondary`, counts in `.num` / 600 / `--ink-primary`.
- **Hover:** none. It is not interactive.
- **Focus:** none. It is not interactive.
- **Acknowledged / stale:** not applicable — this element is always current state.
- **Empty:** the band is not rendered at all until a snapshot exists. `App.tsx` shows a
  `LoadingLine` instead.

### 6.2 Status chip (`.chip`)

The compact form, used in the food table and anywhere a full annunciator will not fit.

- `display: inline-flex`, `padding: .15rem .4rem .15rem .3rem`,
  `background: var(--tone-tint)`, `border: 1px solid var(--tone-edge)`,
  `border-radius: var(--radius-control)`, `color: var(--tone-ink)`,
  `--type-meta` / 600, `white-space: nowrap`.
- Contains a `.mark--sm` shape and the word. **Never one without the other.**
- `title` carries the raw backend token, and the word is the humanised form of that exact
  token.
- **`.chip--plain`** (kind, severity, "Retired", "Expected"):
  `background: transparent`, `border-color: var(--rule)`, `color: var(--ink-2)`,
  weight 500. Neutral by construction — a metadata chip is never a status.
- **Hover / focus / active:** none. It is not a control. If one ever needs to be, it
  becomes a button and takes the button treatment below.
- **Stale:** the chip reflects the snapshot it came from. The staleness is stated once, in
  the transport notice, not repeated on forty chips.

### 6.3 Environment readings (`.readings`, `.reading`)

A data logger's front panel: cells divided by seams, one measurement each.

- `grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr))` — 2-up at 360px, 4–5-up
  on desktop.
- Each cell: `padding: var(--space-3)`, `border-block-end: var(--seam)`,
  `border-inline-end: var(--seam)`, `background: var(--surface-plate)`.
- Label: `--type-meta` / 600 / `--ink-secondary`, flex row with an optional 13px mark.
- Value row: `min-height: 1.9rem` **reserved** so a value arriving does not shift the row.
  Number in `.num` at `--type-readout` / 600 / `--leading-data` / `--tracking-data`,
  `--ink-primary`. Unit in the sans at `--type-meta` / `--ink-tertiary`, baseline-aligned.
- Foot line: `min-height: 1.05rem` reserved, `--type-micro` / `--ink-tertiary` / 1.4.
  Carries the device-configured band, or the reason the value is absent.
- **Absent value** (`.reading__number--absent`): the words `not reported` in
  `--ink-tertiary` at `--type-readout`. Never `0`, never `—`, never blank. The reason
  goes in the foot line using the device's own availability-mask name, and a
  `visually-hidden` span carries it for screen readers.
- **Flagged** (gas path warming): a 13px triangle beside the label and the number in
  `var(--tone-ink)`. Colour *and* shape.
- **Hover / focus / active:** none. A reading is not a control.
- **Stale:** not shown per cell. Stated once in the panel head and the transport notice.
- **Empty:** when the service has the device but no stored reading, the whole grid is
  replaced by a `.note` paragraph explaining that the panel fills in on the next
  snapshot. An absent reading and an absent panel are different states with different
  words.
- **Device facts** (`.facts`) sit in the panel foot: a 1px-gap grid on
  `--surface-void` with `--surface-field` cells, label at `--type-micro` /
  `--ink-tertiary`, value in `.num` at `--type-small` / `--ink-primary`,
  `overflow-wrap: anywhere`.

### 6.4 Conditions panel (`.lane`, `.condition`)

- Grouped by **what a condition is about** before it is grouped by how loud it is. Three
  lanes: Food status, Device health, Administration. This is the most important
  information architecture decision in the product — the backend files a LittleFS fault at
  the same `severity` as an item at its limit, and sorting purely by severity would put a
  filing problem next to "throw this food out".
- Lane head: `background: var(--surface-field)`, `border-block-end: var(--seam)`,
  `padding: var(--space-3) var(--space-3) var(--space-2)`. Title `--type-small` / 700.
  Count in `.num` at `--type-meta` / `--ink-tertiary`. Blurb `--type-micro` /
  `--ink-secondary`, `flex: 1 1 18rem` so it drops below the title on narrow screens.
- Condition row: `grid-template-columns: auto 1fr`, `padding: var(--space-3)`,
  `border-block-start: var(--seam)`. No tone bar — the mark, the kind chip, the severity
  chip and the word carry it. A tone bar on every row would be forty coloured stripes.
- Title `--type-small` / 600 / `--ink-primary`. Meta row: plain chips + the item UID in
  mono at `--type-micro`. Detail: the backend's prose, **verbatim**, at `--type-small` /
  `--ink-secondary`, `max-inline-size: 76ch` — it encodes the safety rules and rewriting
  it would be paraphrasing a safety rule.
- **Hover:** none on the row.
- **Focus-visible:** the `Acknowledge` / `Un-acknowledge` button takes the standard ring.
- **Active / pending:** button label becomes `Saving…`, `disabled`, and a
  `role="status"` hint appears beside it. The row dims to `opacity: .72`
  (`.condition--pending`) so it is visibly in flight without hiding the text.
- **Acknowledged:** `background: var(--surface-field)`, title drops to `--ink-secondary`
  / 500, and an `.condition__ack` line records who and when in `.num`. The action becomes
  `Un-acknowledge` in a quiet button. Acknowledging never changes a verdict, and the
  panel foot says so in words.
- **Error:** `.condition__error` at `--type-micro` / 600 / `--status-check-food-ink`,
  directly above the action row, in the row it belongs to.
- **Stale:** n/a — conditions come from the current snapshot.
- **Empty:** when there are no conditions at all, the lane machinery is replaced by a
  `.note` that says nothing the device has reported is wrong **and that this is not a
  statement about the food's quality**. Absence of conditions is not a verdict.

### 6.5 Stored-food table (`.data-table.food-table`)

- Real `<table>` in the DOM at every width, so column relationships survive for screen
  readers. `border-collapse: collapse`, `--type-small`.
- Head: `position: sticky`, `background: var(--surface-void)`,
  `border-block-end: 1px solid var(--rule-strong)`, `--type-meta` / 600 /
  `--ink-secondary`, `white-space: nowrap`. Numeric heads are right-aligned.
- Row cells: `padding: var(--space-2) var(--space-3)`,
  `border-block-end: var(--seam)`. The item cell is a `<th scope="row">` at weight 600
  with the name, the UID in mono, and category/location beneath.
- **Numeric columns:** `.cell-num { text-align: end; white-space: nowrap }` with tabular
  figures, so magnitudes compare down a column.
- **Hover:** `tbody tr:hover { background: var(--surface-field) }`. One step, no shadow,
  no lift. This is a data table, not a card grid.
- **Focus-visible:** rows are not focusable. The row's controls are.
- **< 46rem:** the head is visually hidden with `clip-path: inset(50%)` and each cell
  becomes `grid-template-columns: 6.5rem minmax(0, 1fr)` with a visible
  `.cell-label` at `--type-micro` / 600 / `--ink-tertiary`. A 360px phone reads the table
  as a list of items while the semantics stay a table. Empty cells are `display: none` so
  a row never has a label with nothing beside it.
- **Retired row** (`.row-retired`): `background: var(--surface-field)`, name at
  `--ink-secondary` / 500, plus a plain `Retired` chip. Retired items sort after active
  ones.
- **Withheld:** `remaining_seconds === null` renders the word **withheld** in
  `--status-sensor-fault-ink` at `--type-small` / 600, with the service's own reason
  beneath in `--type-small` / `--ink-secondary`, `max-inline-size: 34ch`. Never `0 s`,
  never a dash, never a guess. Same treatment for a missing deadline, which reads
  **none** and then says what the device does and does not hold.
- **Meter:** a flat bar, not a pill. Track `--surface-sunken` with a 1px
  `--rule-strong` border and `--radius-hairline`. Fill is `var(--tone-edge)` with the
  width set from the value the backend sent. A 2px `--ink-secondary` notch sits at 75%
  because 75% is the use-soon threshold the device applies and it should be visible *as a
  place on the scale*. Scale labels at `--type-micro` / `--ink-tertiary`, percentage in
  `.num` / 600. A withheld meter is a 135° hatch of `--status-sensor-fault-tint` and
  `--surface-plate`, never an empty track — an empty bar reads as 0% used.
- **Stale:** the whole panel gets a `.panel__note-strip` above the table —
  `--status-sensor-fault-tint` background, 1px `--status-sensor-fault-edge`, 1px
  `--ink-secondary` text at `--type-meta` — explaining that every duration and progress
  figure is withheld and that deadlines are still shown because they come from dates the
  device holds rather than from a clock comparison.
- **Empty:** a `.note` paragraph that says no food is registered, that items are
  registered by scanning an RFID tag, that the list updates on the next snapshot, and
  that an empty list is not a fault. An empty screen is an invitation to act, not an
  apology.

### 6.6 Charts (`.chart`, `LineChart`)

Small multiples: three rows, one column of shared time, the way a data logger prints them.
Each plot is its own bordered plate with its own value axis and a shared real time axis.

- Frame: `background: var(--surface-plate)`, `border: var(--seam)`,
  `border-radius: var(--radius-control)`, `padding: var(--space-3)`. No shadow.
- Head: title `--type-small` / 700; readout right-aligned in `.num` at `--type-readout` /
  600 / `--leading-data` / `--tracking-data`, with the unit in the sans at `--type-meta`.
- Gridlines: `--chart-grid`, 1px, `shape-rendering: crispEdges`. Decorative.
- Axis line: `--chart-axis`, 1px. **This is the line that has to read** — 4.46:1.
- Axis text: `--chart-label` at `--chart-axis-text-size`, in `--font-mono` with tabular
  figures so ticks align. Raise the hardcoded `9.5px` to the token and to 10–11px; at
  9.5px on a 360px screen the time axis is not comfortably readable (deferred).
- Series: `fill: none`, `stroke: var(--chart-series-2)`, `stroke-width:
  var(--chart-line-weight)`, round joins and caps, `vector-effect: non-scaling-stroke` so
  the line weight is identical at every plot width. Last-value marker: a filled circle of
  `var(--chart-line-weight)` colour at `r: var(--chart-point-radius)`.
- The device's configured band: `--chart-band` fill, bounded top and bottom by a 4px/3px
  dashed `--chart-band-edge`. Never the series colour — a band is not a measurement.
- **Hover:** none on the plot. A crosshair is out of scope for this pass; the visible
  range control and the hidden data table are the affordances.
- **Focus-visible:** the range selector and the Refresh button only.
- **Active range:** the pressed `.segmented__option` is `--ink-primary` fill with
  `--surface-field` text — ink-on-paper, no accent hue.
- **Downgraded / stale:** when the service could not honour the requested bucket it picks
  a coarser one and says so, in a `.panel__note-strip` in words, because a chart that
  silently changes its resolution is a chart that lies about detail.
- **Empty:** no values in range renders a `.chart__empty-text-block` at `--type-small` /
  `--ink-secondary`, `min-height: 7rem`, `max-inline-size: 48ch` — a sentence saying
  what is missing and why, not an empty rectangle.
- **Non-visual equivalent:** every plot is `role="img"` with a summary label covering
  point count, runs, lowest, highest, latest and the axis definition, **and** a visually
  hidden table repeats the same numbers. An `aria-label` long enough to be useful is not
  pleasant to read aloud.
- **Honest gaps:** the line breaks on a null value *and* where the gap between points
  exceeds about 2.5 buckets. A straight line drawn through an hour of power-off is a lie.

### 6.7 Event log (`.log-item`)

- Flush list inside the panel, rows `grid-template-columns: auto 1fr`,
  `padding: var(--space-2) var(--space-3)`, `border-block-end: var(--seam)`.
- Stamp column `min-inline-size: 8.5rem`: the time in `.num` at `--type-micro` /
  `--ink-primary`, then the provenance line, then the full date at `--type-micro` /
  `--ink-secondary`.
- Type in `--font-mono` at `--type-micro` / `--ink-tertiary`, `translate="no"`,
  `overflow-wrap: anywhere`.
- Message at `--type-small` / `--ink-primary`, `text-wrap: pretty`.
- **Untrusted device time:** when `time_valid` is false there is no device timestamp at
  all, so the row shows the **service receipt time**, says `received · device time not
  trusted` beneath it, and marks the stamp
  `--status-sensor-fault-ink` with a dotted underline. It never quietly substitutes one
  for the other. This is the log's version of the same distinction the banners make.
- **Hover:** none. It is a log, not a list of links.
- **Focus-visible:** the `Load older events` button in the panel foot.
- **Active:** the button reads `Loading…` and is disabled while paging.
- **Stale:** not applicable — events are read on demand, not streamed.
- **Empty:** an `EmptyState` notice explaining what raises an event (threshold latch,
  door open too long, an input that stopped producing data) and that an empty log means
  none of those has happened since the device started reporting.

### 6.8 Masthead (`.masthead`)

The dark bezel. Identity, the device switch, and the link indicator, always in the same
place so the link state is one glance away.

- `background: var(--surface-bezel)`, `color: var(--ink-on-dark)`,
  `border-block-end: 1px solid var(--ink-primary)`, `position: sticky`,
  `z-index: var(--z-sticky)`, `padding-block-start: env(safe-area-inset-top)`.
- Wordmark `--type-readout` / 700 / `--tracking-heading` / `--leading-data` /
  `--ink-on-dark`. Device id beside it in `--font-mono` at `--type-meta` /
  `--ink-on-dark-2`, `overflow-wrap: anywhere`, `translate="no"`. "no device has reported"
  in `--ink-on-dark-3`, italic, in the sans.
- **Link indicator** (`.link-state`): `--surface-bezel-well` background, 1px
  `--rule-bezel` border, `--radius-control`, `--type-meta`. An 8px dot in
  `var(--transport-live)` / `--transport-waiting)` / `--transport-down` per state, then
  `Live feed: <text>` with the age in `--font-mono` at `--type-micro` /
  `--ink-on-dark-2`. The service's own `transport.note` is in the `title` attribute and
  repeated in the banner below.
  - **Never red, never green.** A dropped connection is a statement about the network and
    can never be read as a food-safety warning.
  - **The one ambient motion in the product:** the live dot pulses
    `var(--motion-pulse-loop)` opacity 1 → 0.35 → 1, and *only* while data is arriving.
    It carries information — it stops when data stops. Fully disabled under
    `prefers-reduced-motion`.
- **Device select:** `.input` on `--surface-bezel-well` with a `--rule-bezel` border and
  `--ink-on-dark` text. Hover border `--rule-bezel-strong`.
- **Buttons inside the bezel:** `--ink-on-dark-2` text, `--rule-bezel-strong` border,
  transparent background. **This is a live bug** — `.btn--quiet` currently inherits
  `--ink-2` on the bezel at **1.76:1**. See Deferred items.
- **Warning line** (device id in the URL is unknown): `--type-micro` /
  `--caution-on-dark` (8.70:1 on the bezel), on its own row,
  `flex: 1 0 100%`. Not `--status-use-soon-ink`, which is 2.36:1 on the bezel.
- **Responsive:** wraps to two rows below ~60rem — identity on row one, link indicator
  and controls on row two. Nothing is hidden.
- **Focus-visible:** `--focus-ring-width` of `--accent-on-dark` with a
  `--surface-bezel` halo, so one ring spec works on both grounds.
- **Stale / down:** dot colour and the word change; nothing else. No banner inside the
  bezel — the banner belongs on the page where it cannot be missed while scrolling.

### 6.9 Banners (`.banner`)

Two exist. Both persist, neither is dismissible, neither is urgent enough for a toast, and
both must be on screen every time.

- `grid-template-columns: auto 1fr`,
  `padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4)`,
  `background: var(--tone-tint)`, `border: 1px solid var(--tone-edge)`,
  `border-inline-start-width: 5px`, `border-radius: var(--radius-plate)`.
- **Change `border-inline-start` to `var(--edge-caution)` for both of these** — the
  double rule is what separates a device problem from a food verdict. See Deferred.
- Mark column holds a 2rem shape in `var(--tone-ink)`.
- Title `--type-body` / 700 / `--tracking-heading` / `var(--tone-ink)`.
- Body `--type-small` / `--ink-primary`, `max-inline-size: 76ch`, `text-wrap: pretty`.
  Each paragraph does one job; no apologies, no filler.
- **Clock banner** (`data-tone="warn"`, triangle): states that storage times cannot be
  judged, that the service withholds duration, time remaining and window progress, that
  those appear as *withheld* rather than as zero and why, that this is a fault in the
  monitor and not a verdict about the food, and how to fix it (RTC backup battery, time
  source). It says in words that the device is reporting `Sensor Fault / Data Unavailable`
  for this reason.
- **Transport banner** (`data-tone="informational"`, circle): states that no new data is
  arriving, how old the last accepted snapshot is, and — in bold — that this says nothing
  about the food and never changes the verdict. The service's own `transport.note` is
  shown verbatim.
- **Hover / focus / active:** none. A banner is not a control.
- **Acknowledged:** not applicable.
- **Stale:** this *is* the stale state.
- **Empty:** a banner disappears when its condition clears. It never leaves a gap.

### 6.10 Notices (`.notice`), loading and empty states

- Same shape as a banner, at `--type-body` for the title and `--type-small` for the body.
  `role="group"` with an `aria-label` naming what failed.
- **Error:** title says what the service reported, body says what was being attempted,
  what the service said and what a person can do next, in that order. `code` and
  `request_id` are printed in `--font-mono` at `--type-micro` — when someone reports
  "the dashboard is broken", those two lines are the whole diagnosis. A `Try again` button
  where a retry is meaningful.
- **Empty** (`EmptyState`): `data-tone="informational"`, circle mark. A title, a sentence
  or two on what would put something here, and an action where one exists. An empty screen
  is an invitation to act.
- **Loading** (`LoadingLine`): `role="status"`, `aria-live="polite"`, `min-height: 3rem`
  so the layout does not jump, a 40px × 2px sweep bar in `--rule-hairline` with a
  `--ink-secondary` head running `var(--motion-sweep)`. Under reduced motion the sweep
  stops and the bar is simply full.

### 6.11 Buttons, inputs, segmented control

- `.btn`: `--surface-plate` background, 1px `--rule-strong` border,
  `--radius-control`, `--type-meta` / 600, `min-height: var(--control-min)`, and
  `min-height: var(--tap-min)` with `--space-4` inline padding under
  `@media (pointer: coarse)`.
  - **hover:** `--surface-field`, border `--ink-secondary`
  - **active:** `--surface-sunken`, no transform
  - **focus-visible:** the standard ring (§7.1)
  - **disabled:** `--ink-disabled` text, `--rule-hairline` border, `--surface-void`
    background, `cursor: not-allowed`
- `.btn--primary`: `--ink-primary` fill with `--surface-field` text. Hover
  `#262F33`-equivalent, i.e. a lighter step of the ink. **Never a status colour, never
  the accent.**
- `.btn--quiet`: transparent, `--rule-hairline` border, `--ink-secondary` text, weight
  500. Hover `--surface-plate` with a `--rule-strong` border.
- `.segmented`: `--surface-plate` on a 1px `--rule-strong` frame,
  `--radius-control`, `overflow: hidden`, so options butt against each other with no gap.
  Option: transparent, `--rule-hairline` inline divider, `--ink-secondary`,
  `min-width: 3rem`. Pressed: `--ink-primary` fill, `--surface-field` text. Under coarse
  pointers `min-height: var(--tap-min)`, `min-width: 3.5rem`.
- `.input`: `--surface-plate`, 1px `--rule-strong`, `--radius-control`, `--type-small`,
  `min-height: var(--control-min)`, and `var(--tap-min)` under coarse pointers. Hover
  border `--ink-secondary`. Placeholder `--ink-tertiary`.

### 6.12 Focus ring spec

One ring, everywhere, on `:focus-visible` only, so a mouse click leaves no halo.

```
outline: var(--focus-ring-width) solid var(--focus);   /* 2px #1A5FD0 */
outline-offset: var(--focus-ring-offset);              /* 2px */
box-shadow: 0 0 0 var(--focus-ring-halo) var(--focus-halo);  /* 5px #FFFFFF */
border-radius: var(--radius-control);
```

On the bezel: `outline-color: var(--accent-on-dark)` with a `--surface-bezel` halo. The
white halo is what lets a single ring colour survive on both the plate and the bezel,
which a single-colour ring cannot do. Contrast: 5.85:1 on the plate, 4.65:1 on the void,
9.56:1 on the bezel.

---

## 7. Accessibility notes

### 7.1 Focus

- One ring spec, `:focus-visible` only, defined in §6.12. Never remove it.
- Tab order follows the DOM, which follows the reading order in `App.tsx`: verdict →
  banners → conditions → environment → stored food → trends → event log. On mobile the
  columns collapse in that same order with nothing hidden behind a tab, so tab order and
  reading order never disagree.
- Every interactive element is reachable: buttons, inputs, selects, `summary`, links,
  and the chart range control. The skip link is the first tab stop and moves focus to
  `#main-content`.
- Focus ring is 2px with a 2px offset and a 5px halo, so it is never clipped by an
  `overflow: hidden` ancestor and never overlaps the label it surrounds.

### 7.2 Motion

- `prefers-reduced-motion: reduce` sets every duration to **1ms, not 0ms** — a zero
  duration can suppress `transitionend` / `animationend` that other code may be listening
  for, and 1ms is indistinguishable from 0ms to a person.
- `components.css` already sets `animation: none` on both loops under that query, so
  nothing is left moving: the live lamp stops pulsing and the loading bar becomes a plain
  full bar.
- There is no motion that is not answering an action or a state change. No entrance
  animations, no scroll reveals, no hover lifts, no animated backgrounds.

### 7.3 What a screen reader user gets

- **The verdict is announced on change, not on every snapshot.** A polite
  `role="status"` live region in the status band is fed by a comparison of the previous
  and current status pair, so a device reporting every five seconds does not make a screen
  reader talk over itself. It announces the first reading once, then only real changes:
  "Verdict changed: overall status is now check food".
- **Each annunciator mark carries an `aria-label`** of the form
  `Check food (check_food)` when it is the primary mark, so the shape is not the only
  thing a non-visual user has.
- **Scope notes are visually hidden**, not absent: "Overall. The most severe verdict
  across the cabinet and every stored item."
- **The food table is a real `<table>` at every width**, with `<caption>`, `<th scope="col">`
  headers and `<th scope="row">` item cells. The mobile list layout is CSS only.
- **Every meter is `role="progressbar"`** with `aria-valuemin`, `aria-valuemax`,
  `aria-valuenow` and, crucially, an `aria-valuetext` that says what the number means
  and where the 75% threshold sits. A withheld meter has no `aria-valuenow` and a
  `aria-valuetext` of "withheld", so the absence is announced rather than implied.
- **Every chart is `role="img"`** with a full prose summary, and repeats the same numbers
  in a visually hidden table so nothing depends on reading an `aria-label` aloud.
- **Absence is a sentence, never a blank cell.** `not reported`, `withheld`, `none`,
  `no reading yet`, `no device has reported` — each with the device's own reason where
  one exists, and each with a `visually-hidden` companion where the visible text is
  abbreviated.
- **The tone attribute never carries meaning alone.** Every `data-tone` element also
  contains a word and, where a mark is present, a distinct shape.
- `translate="no"` on every identifier, token, UID and error code, so a screen reader
  does not read `E2C4-0198` as a phrase.

### 7.4 Other

- Touch targets are `var(--tap-min)` = 44px minimum under `@media (pointer: coarse)` on
  `.btn`, `.input` and `.segmented__option`. The mark glyphs are 13–18px but are never
  the sole target for an action.
- The layout survives 200% browser text zoom: the two largest type steps are
  `clamp()`-based and the reading grid reflows via `auto-fit`.
- `color-scheme: light` is declared, so form controls and scrollbars match the face.
- Nothing depends on hover. Every hover treatment has a non-hover equivalent or is
  decoration on a non-interactive element.
- Line lengths stay under 80 characters. `--measure-prose` is 68ch.

---

## 8. Wireframes

### 8.1 Desktop, ≥ 68rem (1088px)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ▓▓ FRESHGUARD  cabinet-01-fridge        [ ● Live feed: Live · 3s ago ]  [Reload] │ ← bezel #151C1D
└──────────────────────────────────────────────────────────────────────────────────┘   sticky, 1px
  ╭─ shell, max 1560px, padding 24px, gap 24px ─────────────────────────────────────╮
  │ ┌── status band ─────────────────────────────────────────────────────────────┐ │
  │ │ Device verdict                              Reported by the device · 14:22  │ │ ← void
  │ ├───────────────────────────────┬────────────────────────────────────────────┤ │
  │ │▌■ Overall                      │▌▲ Cabinet zone                             │ │ ← plate
  │ │▌  Check food  [check_food]     │▌  Use soon  [use_soon]                     │ │   5px bar
  │ │▌  A confirmed threshold breach │▌  A stored item has passed 75% of its      │ │
  │ │▌  or an item at its limit.     │▌  storage window. Not unsafe; plan for it. │ │
  │ ├───────────────────────────────┴────────────────────────────────────────────┤ │ ← seam
  │ │  47 items stored   3 needing attention   2 conditions unacknowledged        │ │ ← field
  │ └────────────────────────────────────────────────────────────────────────────┘ │
  │ ┌── DeviceClockBanner ────────────────────┐ ┌── Conditions (right rail) ───────┐ │
  │ │▌▲ The device clock is not trusted, so   │ │ Food status              2        │ │
  │ │▌  storage times cannot be judged        │ │  ■ Frozen peas, 1kg has reached   │ │
  │ │▌  <three short paragraphs, 76ch>        │ │    [Item][Needs action] E2C4-0198 │ │
  │ └─────────────────────────────────────────┘ │    <detail>  [ Acknowledge ]      │ │
  │ ┌── LinkNotice ────────────────────────────┐ │  ▲ Cabinet temp above 3 °C (acked) │ │
  │ │▌○ No new data is arriving from the device│ │ Device health            1        │ │
  │ │▌  Everything below is the last data …    │ │  ◈ Device clock is not trusted     │ │
  │ └─────────────────────────────────────────┘ │ Administration          1        │ │
  │ ╭─ columns: minmax(0,1fr) 27rem ──────────╮ │  ○ LittleFS filesystem fault      │ │
  │ │ ┌── Environment ─────────────────────┐   │ ├─────────────────────────────────┤ │
  │ │ │ Environment     Last reading 3s ago│   │ │ Event log       24 shown         │ │
  │ │ ├─────────┬─────────┬─────────┬─────┤   │ │ 14:19:44  threshold_latch        │ │
  │ │ │ Temp    │ Humid   │ Press   │Gas  │   │ │ reported by the device            │ │
  │ │ │ 3.4 °C  │ 71.2 %  │ 1013.2  │not  │   │ │ Temperature crossed the warning  │ │
  │ │ │ band 0-5│ band 30+│ atmo    │rept.│   │ ├─────────────────────────────────┤ │
  │ │ ├─────────┼─────────┼─────────┼─────┤   │ │ 13:52:07  rtc_untrusted          │ │
  │ │ │ Door    │ Gas path│ …       │     │   │ │ received · device time not trusted│ │
  │ │ ├─────────┴─────────┴─────────┴─────┤   │ │              [ Load older events ] │ │
  │ │ └─ facts grid on void, 1px gaps ─────┘   │ └─────────────────────────────────┘ │
  │ │ ┌── Stored food ─────────────────────┐   │ ╰───────────────────────────────────╯ │
  │ │ │ Stored food  47 active · urgency   │   │                                        │
  │ │ │ ⓘ clock-not-trusted note strip      │   │                                        │
  │ │ │ Item      Qty  Status  Deadline  …  │   │                                        │
  │ │ │ ▪ peas  12  [■Check] 12 Mar  …      │   │                                        │
  │ │ │ ▓▓▓▓▓▓░░░░ ← meter, 75% notch       │   │                                        │
  │ │ └────────────────────────────────────┘   │                                        │
  │ │ ┌── Trends ──────────────────────────┐   │                                        │
  │ │ │ Trends  180 pts    [1h|6h|24h|7d] │   │                                        │
  │ │ │ ┌ Temperature ──────────── 3.4 °C┐ │   │                                        │
  │ │ │ │ ░░░░░░░░░  (band 0–5)        │ │   │                                        │
  │ │ │ │   ╱╲__╱‾‾╲___╱‾‾‾‾  (trace)     │ │   │                                        │
  │ │ │ │ 13:00   16:00   19:00         │ │   │                                        │
  │ │ │ └ 3 rows, one shared time column ┘ │   │                                        │
  │ │ └────────────────────────────────────┘   │                                        │
  │ ╰───────────────────────────────────────────╯                                        │
  ╰──────────────────────────────────────────────────────────────────────────────────╯
```

### 8.2 Mobile, 360px

```
┌────────────────────────────────────┐
│ FRESHGUARD  cabinet-01-fridge      │ ← bezel, wraps to 2 rows
│ [● Live feed: Live·3s] [ Reload ]  │   --ink-on-dark / --ink-on-dark-2
├────────────────────────────────────┤   1px --ink-primary underline
│ Device verdict          14:22:07  │ ← void, --type-body/700 + --type-meta
├────────────────────────────────────┤
│▌■ Overall                           │ ← plate
│▌  Check food  [check_food]         │   24px  (--type-verdict floor)
│▌  A confirmed threshold breach or  │   18px
│▌  an item at its limit.            │
│▌  Needs a human look at the food.  │
├────────────────────────────────────┤ ← seam (deferred, see §10)
│▌▲ Cabinet zone                      │
│▌  Use soon  [use_soon]             │
│▌  A stored item has passed 75% of  │
│▌  its storage window.              │
├────────────────────────────────────┤
│ 47 items stored   3 needing attn.  │ ← field, --type-meta
│ 2 conditions unacknowledged        │
├────────────────────────────────────┤
│▌▚ Device clock not trusted ·      │ ← --edge-caution (6px DOUBLE)
│▌▚ storage times cannot be judged  │   --status-use-soon-tint
│▌▚ <paragraphs, 76ch>               │   triangle mark + word
├────────────────────────────────────┤
│▌  No new data is arriving …        │ ← --edge-neutral (1px hairline)
│▌  Everything below is the last …   │   --surface-field, circle mark
├────────────────────────────────────┤
│ Environment      Last reading 3s   │ ← field head
│┌────────────┬─────────────────────┐│
││ Temperature│ Humidity            ││ 2-up, minmax(8.5rem,1fr)
││ 3.4 °C     │ 71.2 % RH           ││ --type-readout, tabular mono
││ band 0 to 5│ band 30 to 85%      ││ --type-micro foot, reserved height
│├────────────┼─────────────────────┤│
││ Pressure   │ Gas input      ▲    ││
││ 1013.2 hPa │ not reported        ││ one line — the 18px floor
││ atmospheric│ gas path warming up ││
│├────────────┴─────────────────────┤│
││ Door                             ││ trailing empty cell: known
││ Closed                           ││ cosmetic gap, see §10
│└──────────────────────────────────┘│
├────────────────────────────────────┤
│ Stored food   47 active · urgency  │
│ ⓘ all times withheld               │
│┌──────────────────────────────────┐│
││ Frozen peas, 1kg                 ││ real <table>, reflowed:
││ E2C4-0198                        ││   label 6.5rem | value 1fr
││ Frozen  Shelf 2                  ││
││ Quantity            12           ││
││ Status      [■ Check food]       ││ shape + word + tint + edge
││ Deadline    12 Mar 2026, 09:00   ││ .num, right-aligned, nowrap
││ Time rem.   withheld             ││ sensor-fault ink, italic-free
││             the clock is not …   ││
││ Storage     ▓▓▓▓▓▓▓░░░ ← 78.4%  ││ notch at 75%
│└──────────────────────────────────┘│
│  (each item repeats; 44px rows)    │
├────────────────────────────────────┤
│ Trends    [1h|6h|24h|7d]  ≥44px   │
│ Temperature              3.4 °C   │
│ ░░░░░░░░ (band)  ╱╲__╱‾╲_        │
└────────────────────────────────────┘
```

---

## 9. Token inventory

### 9.1 Preserved legacy names

All 37 of these are already referenced by the shipped components and resolve through the
compatibility block at the foot of `tokens.css`. **Delete that block in the implementation
pass** once every selector has been updated.

Surfaces `--panel` `--field` `--plate` · Rules `--rule` · Ink `--ink` `--ink-2`
`--ink-3` · Status `--ok-ink/tint/edge` `--warn-ink/tint/edge` `--crit-ink/tint/edge`
`--unknown-ink/tint/edge` `--admin-ink/tint/edge` `--neutral-ink/tint/edge` · Chart
`--series` `--threshold` `--threshold-edge` · Accent `--link` `--ease` · Type
`--text-micro` `--text-meta` `--text-small` `--text-body` `--text-readout`
`--text-annunciator` `--text-hero`

Retained under their existing names because they are already canonical in intent:
`--font-sans` `--font-mono` `--space-1`…`--space-7` `--radius-control` `--radius-plate`
`--seam` `--tap-min` `--shell-max` `--rail-width` `--motion-fast` `--motion-base`
`--focus` `--focus-halo` `--rule-strong` `--series-soft`

### 9.2 New canonical names

**Surfaces** `--surface-void` `--surface-sunken` `--surface-field` `--surface-plate`
**Ink** `--ink-primary` `--ink-secondary` `--ink-tertiary` `--ink-disabled`
`--ink-on-dark` `--ink-on-dark-2` `--ink-on-dark-3`
**Rules and edges** `--hairline` `--rule-hairline` `--rule-strong` `--seam-strong`
`--edge-verdict` `--edge-caution` `--edge-neutral`
**Status** `--status-fresh-ink/-tint/-edge` `--status-use-soon-ink/-tint/-edge`
`--status-check-food-ink/-tint/-edge` `--status-sensor-fault-ink/-tint/-edge`
`--status-administrative-ink/-tint/-edge` `--status-informational-ink/-tint/-edge`
**Accent** `--accent-link` `--accent-series` `--accent-focus` `--accent-on-dark`
`--tap-highlight`
**Chart** `--chart-series-1`…`-4` `--chart-series-soft` `--chart-dash-1`…`-4`
`--chart-line-weight` `--chart-point-radius` `--chart-plot-height` `--chart-grid`
`--chart-axis` `--chart-band` `--chart-band-edge` `--chart-label`
`--chart-label-quiet` `--chart-axis-text-size`
**Bezel** `--surface-bezel` `--surface-bezel-well` `--surface-bezel-raised`
`--rule-bezel` `--rule-bezel-strong` `--transport-live` `--transport-waiting`
`--transport-down` `--caution-on-dark`
**Type** `--type-micro` `--type-meta` `--type-small` `--type-body` `--type-readout`
`--type-verdict` `--weight-regular` `--weight-medium` `--weight-semibold`
`--weight-bold` `--leading-tight` `--leading-snug` `--leading-body` `--leading-prose`
`--leading-data` `--tracking-display` `--tracking-heading` `--tracking-normal`
`--tracking-label` `--tracking-data`
**Space** unchanged names, roles now documented
**Radius** `--radius-none` `--radius-hairline` (with `--radius-control`,
`--radius-plate` retained)
**Elevation** `--elevation-none` `--elevation-raised` `--elevation-overlay`
**Motion** `--motion-instant` `--motion-slow` `--motion-pulse-loop` `--motion-sweep`
`--ease-standard` `--ease-entrance` `--ease-exit`
**Layout** `--measure-prose` `--control-min` `--z-sticky` `--z-skip`
**Focus** `--focus-ring-width` `--focus-ring-offset` `--focus-ring-halo`
**Breakpoints** `--bp-verdict-step` `--bp-annunciator` `--bp-table-collapse`
`--bp-table-collapse-edge` `--bp-shell` `--bp-rail` *(documentation only)*

132 canonical names, 37 legacy aliases. Three further names, `--tone-ink`, `--tone-tint`
and `--tone-edge`, are plumbing rather than palette and stay in the `[data-tone]`
selector blocks in `components.css`; they are unchanged.

---

## 10. Deferred to the implementation pass

Nothing below could be done in `tokens.css` alone without touching a `.tsx` file.

**Priority 1 — accessibility failures that exist today**

1. **`.btn--quiet` on the bezel is 1.76:1.** `.masthead .btn` does not override the
   light-surface ink, so the `Reload` label is effectively invisible on the dark masthead.
   Add `.masthead .btn--quiet { color: var(--ink-on-dark-2); border-color: var(--rule-bezel); }`
   and `.masthead .btn--quiet:hover { color: var(--ink-on-dark); border-color: var(--rule-bezel-strong); }`
   in `base.css`. Confirmed by rendering at 2×.
2. **`.masthead` should use `--surface-bezel`, not `var(--ink)`.** `layout.css` currently
   paints the bezel with the primary ink, which is 1.06:1 against `--ink-on-dark` and
   makes `--ink` mean two things. Swap `background: var(--ink)` → `var(--surface-bezel)`
   and `border-block-end: 1px solid #000` → `var(--ink-primary)`.
3. **The transport lamps are hardcoded green.** `components.css` sets
   `[data-link='live'] .link-state__dot { background: #6fd39b }`. Replace `#6fd39b`,
   `#e5b567` and `#9aa6ab` with `var(--transport-live)`, `var(--transport-waiting)` and
   `var(--transport-down)`, and `#1c2427`/`#3b454a`/`#6d7a80`/`#e3e8ea`/`#a9b6bb`/`#8b9599`
   with the bezel tokens. Until this is done the only green in the product is not
   `fresh`, which breaks the status colour language. **This is the highest-value single
   change in the list.**

**Priority 2 — the load-bearing banner distinction**

4. **Both banners use `--edge-verdict`.** `DeviceClockBanner` sets `data-tone="warn"` and
   `LinkNotice` sets `data-tone="neutral"` in `Banners.tsx`, and `use_soon` also maps to
   `data-tone="warn"`, so the clock banner and a `use_soon` verdict currently share a tone
   *and* a shape (triangle) *and* an edge. The clock banner is a device fault, not a
   verdict, and the brief calls that distinction load-bearing. It cannot be solved in
   tokens because the tone attribute is set in a `.tsx`. The fix: add a
   `data-kind="device"` attribute to both banner elements and one rule —
   `.banner[data-kind='device'] { border-inline-start: var(--edge-caution); }` — or add
   two device-level tone attributes (`data-tone="device-caution"`,
   `data-tone="transport"`) with their own three tokens each. The tokens
   (`--edge-caution`, `--edge-neutral`) already exist and are ready.

**Priority 3 — hardcoded values to tokenise**

5. `base.css`: `#8fc7f2` → `--accent-on-dark`; `#0b1418` → `--surface-bezel`;
   `#eef0f1` (button hover) → `--surface-field`; `#e2e6e7` (button active) →
   `--surface-sunken`; `rgba(20, 73, 110, 0.16)` → `--tap-highlight`; `2.25rem` →
   `--control-min`; the 2px/2px/5px focus ring → `--focus-ring-*`.
6. `layout.css`: `#a9b6bb`, `#8b9599`, `#c9a86a`, `#1c2427`, `#3b454a` → bezel tokens;
   `border-block-end: 1px solid #000` → `var(--ink-primary)`.
7. `components.css`: the focus ring dims, `2.5rem`/`2px` loading bar, `9.5px` axis text →
   `--chart-axis-text-size` (and raise it to 10–11px), `1.75px`/`3px` chart stroke and
   point radius → `--chart-line-weight` / `--chart-point-radius`, `8.5rem` plot height →
   `--chart-plot-height`, `4 3` band dash → a token, `#79858a` link dot default →
   `--transport-down`.
8. **`.masthead__notice` uses `#c9a86a`** — an amber that is in no token. That literal is
   currently fine at 7.64:1, but `--status-use-soon-ink` is **not** the right replacement:
   it is only 2.36:1 on the bezel, because it is built for text on a light surface. Map
   it to `--caution-on-dark` (`#D8B36B`, 8.70:1), the bezel-legal step of the same hue.

**Priority 4 — token-file mechanics**

9. **Delete the inverted media query at `layout.css:233`.** It applies `--text-hero`
   inside `@media (max-width: 26rem)`, which makes the verdict *larger* on the narrowest
   screens. Both `--text-hero` and `--text-annunciator` now resolve to the same fluid
   `--type-verdict`, which neutralises it and removes the 416px size jump, so it is
   currently dead code — but it should be deleted rather than left to confuse the next
   reader. Also give `.status-band__readout + .status-band__readout` a
   `border-block-start: var(--seam)` below 44rem so the two stacked 5px tone bars do not
   read as one 10px bar.
10. **Adopt the new names** by replacing each legacy reference with its canonical name and
    then deleting the compatibility block at the foot of `tokens.css`. A mechanical
    find-and-replace per selector; the block lists every mapping.
11. `--space-6` is defined but unreferenced. Either use it for the desktop column rhythm
    or delete it.
12. `.reading` has 7 cells and `auto-fit` leaves a visible empty cell at 360px. Consider
    giving the last cell `:nth-last-child(odd) { grid-column: 1 / -1 }` or painting the
    remainder `--surface-field`.
13. `.reading__number--absent` could be italicised to match the `.withheld__value`
    treatment, so an absence reads as an absence at a glance and not only by wording.

---

## 11. What was verified, and what was not

**Verified by computation.** Every contrast ratio in this document and in the header
comment of `tokens.css` was calculated with the WCAG 2.1 relative-luminance formula
against the hex values actually in the file — 55 hex literals, all well-formed, no
dangling `var()` references, braces balanced, and all 95 custom properties referenced
anywhere in `src/` resolve (55 directly on canonical names, 37 through the compatibility
block, 3 in the `[data-tone]` plumbing).

**Verified by rendering.** `tokens.css` was loaded by the real `base.css`, `layout.css`
and `components.css` in headless Chrome against representative markup, and inspected at
1400px and at a true 360px viewport at 1× and 2×. The 360px render is what caught the
`not reported` wrap (fixed by the 18px readout floor) and the invisible `Reload` label
(deferred item 1).

**Not verified — do not assume these.**

- **No automated WCAG audit was run.** No axe, no Lighthouse, no NVDA, no JAWS, no
  VoiceOver, no actual colour-blindness simulation. The greyscale claim rests on
  computed relative luminance, which is a proxy for perceived lightness and not a
  substitute for testing with a real user. The shape-and-word channel is what actually
  guarantees the status language survives monochrome, and that is a structural argument,
  not a measured one.
- **Dark mode is not specified and not provided.** `color-scheme: light` is declared and
  the palette is a single light theme. A `prefers-color-scheme: dark` block is out of
  scope for this pass; the bezel tokens are the only dark surfaces and they are not a
  dark theme.
- **Forced-colors / Windows High Contrast was not tested.** The system relies on
  `currentColor` for marks and on borders rather than fills, which is the right
  foundation, but `forced-colors` behaviour is unverified.
- **The charts were rendered from hand-written SVG, not from `LineChart.tsx`.** The real
  component computes its own padding, tick ladder and path; the axis-text size issue in
  §10.7 was observed in the CSS, not measured in a live chart at 360px.
- **Print styles were not considered.** The greyscale section is written to be
  print-friendly in principle, but no print stylesheet exists and none was tested.
- **Rendering used headless Chrome only.** The system font stacks resolve to Segoe UI
  Variable Text and Cascadia Mono on this machine. On macOS and Android the sans becomes
  SF Pro / Roboto and the metrics will differ; the fluid clamps should absorb it, but
  that was not confirmed on those platforms.
- **No touch device was available**, so the 44px targets were verified by reading
  `@media (pointer: coarse)` rules, not by measuring hit areas on hardware.
- **Contrast was computed in the sRGB colour space.** No display was calibrated and no
  ICC profile was applied, so the figures describe the CSS values, not what a specific
  uncalibrated monitor emits.
