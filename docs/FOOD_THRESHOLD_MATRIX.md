# FreshGuard — Food Threshold Matrix

> **SRS requirement:** §1.6-x — *"Teams should prepare and document a Food Threshold
> Matrix containing the food category, acceptable temperature range, humidity
> range, and storage-duration limit. The matrix should also include the expiry
> condition, gas-sensor baseline, configured abnormal threshold, and resulting
> freshness-condition status or alert. Threshold values should be based on cited
> food-storage guidance or manufacturer/source information where available.
> Wherever authoritative values are not available for the prototype, teams should
> clearly identify the selected values as controlled prototype/demo assumptions and
> should not present them as certified food-safety standards. Gas-sensor baseline
> and configured abnormal threshold values may be defined at the storage-zone or
> container level. Where one MQ-135 sensor monitors a shared storage zone, the gas
> reading should not be attributed to any specific food item."*
> **Deliverable:** SRS §1.9 requires a **Food Threshold Matrix**.

> ## ⚠ This matrix is a template, deliberately unfilled
>
> **No threshold in this document is a measured value, and none is a certified
> food-safety limit.** The "Measured / configured" columns are empty because
> filling them requires either a citation someone has not yet made, or a
> measurement nobody has taken.
>
> **Do not present any value here as a food-safety standard.** FreshGuard does not
> determine food safety. Users must follow applicable storage guidance, product
> labels, and normal food-safety practice regardless of what this system reports.

---

## Table of contents

1. [The four rules that govern this matrix](#1-the-four-rules-that-govern-this-matrix)
2. [The two threshold levels — and why they differ](#2-the-two-threshold-levels--and-why-they-differ)
3. [The matrix — zone-level rows](#3-the-matrix--zone-level-rows)
4. [The matrix — per-category rows](#4-the-matrix--per-category-rows)
5. [Zone gas baseline and abnormal-delta table](#5-zone-gas-baseline-and-abnormal-delta-table)
6. [Cited-source register](#6-cited-source-register)
7. [How to complete a row honestly](#7-how-to-complete-a-row-honestly)
8. [Resulting-status mapping](#8-resulting-status-mapping)
9. [What this matrix does and does not control](#9-what-this-matrix-does-and-does-not-control)
10. [Sign-off](#10-sign-off)

---

## 1. The four rules that govern this matrix

These are not style preferences. Each one is a direct requirement, and violating
any of them makes the matrix misleading.

> ### Rule 1 — Gas is a **zone-level** quantity, expressed in **millivolts** and a **delta**
>
> The gas columns in this matrix record **millivolts at ADS1115 AIN0** and a
> **delta from a stored baseline**. They are recorded at the level of the
> **storage zone**, because that is what a single shared MQ-135 measures.
>
> **There is no ppm column in this document, and there is no concentration
> column.** No traceable gas calibration has been performed. Adding a ppm column
> would misrepresent a relative reading as a measurement.

> ### Rule 2 — A shared gas reading is **never** attributed to a specific food item
>
> The matrix has a **Zone ID** column for exactly this reason. Every gas value
> belongs to a zone. When you record a per-category row, its gas columns either
> say *"shared — see zone Z1"* or they say **"not applicable, zone-level only."**
> They never carry a per-item number.

> ### Rule 3 — Every value is **cited**, or it is **flagged as a controlled prototype/demo assumption**
>
> SRS §1.6-x permits an assumption where authoritative values are unavailable, but
> it requires the assumption to be **clearly identified**. That is what the
> "Provenance" column does. A row is only complete when it is either cited or
> explicitly flagged, never neither.
>
> Do not write "standard value" in a source cell. Do not write a value with no
> source and no flag. Both are the same failure.

> ### Rule 4 — Nothing in this matrix is a **food-safety certification**
>
> The output vocabulary is **Fresh/Normal**, **Use Soon**, and **Check Food**.
> There is no "safe" and there is no "unsafe". *Check Food* means a human should
> look at it. It never means throw it away, and it never means eat it.
>
> If human inspection determines food is unsuitable, follow the appropriate
> disposal procedure — that is a human decision outside this system, exactly as
> SRS §1.6-xviii states.

---

## 2. The two threshold levels — and why they differ

| Level | What it is | Where the values live | Who enforces them |
|---|---|---|---|
| **Zone level** | The environmental band for the storage zone as a whole | The **firmware**, as compile-time constants | The firmware, identically for every item in the zone |
| **Per-category level** | The documented expected range for one food category | **This document only** | Nobody at runtime — it is a reference table |

**This distinction must stay visible in your report.** The
[`FOOD_THRESHOLD_MATRIX.md`](./FOOD_THRESHOLD_MATRIX.md) documents per-category
expectations, but the firmware applies **one uniform band to the whole zone**. A
tomato and a piece of cheese are currently judged by identical limits.

**Open decision Q-3:** whether this matrix should drive the firmware or remain
documentation. The recommended answer for the prototype is to keep it as
**clearly-labelled documentation** and to say so explicitly. A per-category table
with no code path behind it could be read as misleading — worse than having no
table at all.

---

## 3. The matrix — zone-level rows

One row per **storage zone**. The prototype has exactly one.

| Zone ID | Zone description / location | Sensor placement in this zone | Environment type | Airflow / opening frequency | Condensation risk | Photo ref |
|---|---|---|---|---|---|---|
| **Z1** | | | refrigerator / insulated box / other | | | |

**What to record in this table.** The zone description, where each sensor is
physically mounted, the storage environment actually used (open decision Q-6), how
often the zone is opened, and whether condensation is a risk. Photograph the
arrangement and reference the image.

### 3.1 Zone-level environmental thresholds as currently configured

| Parameter | Configured value | Unit | Provenance | Currently enforced by firmware? | Measured / verified |
|---|---|---|---|---|---|
| Acceptable temperature, minimum | 0 | °C | **Prototype/demo assumption** — a generic chilled-storage band, not tied to any specific food | ● Yes, uniformly for the zone | Not measured |
| Acceptable temperature, maximum | 8 | °C | **Prototype/demo assumption** — generic chilled-storage band | ● Yes, uniformly for the zone | Not measured |
| Temperature hysteresis | ±1.0 | °C | Set to at least the prototype sensor's documented uncertainty; a build that reduces it below that fails to compile | ● Yes | Not measured |
| Acceptable relative humidity, minimum | 30 | % RH | **Prototype/demo assumption** — generic chilled-storage band | ● Yes, uniformly for the zone | Not measured |
| Acceptable relative humidity, maximum | 85 | % RH | **Prototype/demo assumption** — generic chilled-storage band | ● Yes, uniformly for the zone | Not measured |
| Humidity hysteresis | ±5 | % RH | Set to at least the prototype sensor's documented uncertainty; enforced at compile time | ● Yes | Not measured |
| Consecutive-sample confirmation | 3 | samples | Reduces false alerts, per SRS §1.6-v | ● Yes | Not measured |
| Alert rearm window | 60 | s | Prevents an alert storm from a flapping condition | ● Yes | ● Design value |
| Door-open timeout | 30 | s | **Prototype/demo assumption** — long enough to tolerate a normal retrieval, short enough to matter | ● Yes | Not measured |
| Use Soon point | 75 | % of the item's window | **Prototype/demo assumption** — a common "consume soon" convention | ● Yes | Not a measurement |

> **The three values most worth replacing with evidence, in priority order:**
> the gas abnormal delta (unmeasured and easily too low or too high), the
> door-open timeout (a single unmeasured trial tells you almost nothing), and the
> zone band itself (which is generic and not tied to the food actually stored).

---

## 4. The matrix — per-category rows

One row per food category. **Every value cell is intentionally empty.** Fill a cell
only with a cited value or a clearly-flagged prototype assumption, and record which
one it is in the Provenance column.

### 4.1 Column definitions

| Column | What goes in it | Rules |
|---|---|---|
| **Category** | A food category name | Keep it broad enough to be useful and narrow enough to be honest |
| **Example items** | Typical foods in this category | Helps a reader connect the row to real food |
| **Acceptable temperature (°C)** | The expected range | Cite or flag. Note the sensor that would be *measuring* it, not just the value |
| **Acceptable humidity (% RH)** | The expected range | Cite or flag |
| **Storage-duration limit (days)** | A default limit when no expiry date exists | Cite or flag. This is the value used when the item has **no** expiry date |
| **Expiry / best-before condition** | What counts as the end of life for this category | Cite or flag. A non-zero expiry date takes precedence over the duration limit |
| **Gas baseline (AIN0 mV, ZONE LEVEL)** | The zone baseline | **Zone ID or "not applicable". Never per item.** See [§5](#5-zone-gas-baseline-and-abnormal-delta-table) |
| **Gas abnormal delta (mV, ZONE LEVEL)** | The configured zone delta | **Zone ID or "not applicable". Never per item.** Never ppm |
| **Resulting status / alert** | Which status or alert this row's conditions map to | Use only Fresh/Normal, Use Soon, Check Food, or Sensor Fault. See [§8](#8-resulting-status-mapping) |
| **Cited source** | The specific document, edition, and clause | **Must be specific.** "A website" is not a citation |
| **Provenance** | `Cited` or `Prototype assumption` | Mandatory for every row. Never leave blank |
| **Assumption flag** | A short statement of what was assumed and why | Mandatory for every `Prototype assumption` row |
| **Firmware enforces this row?** | ● / ✗ | Currently ✗ for all rows. See [§9](#9-what-this-matrix-does-and-does-not-control) |

### 4.2 The matrix

| Category | Example items | Acceptable temperature (°C) | Acceptable humidity (% RH) | Storage-duration limit (days) | Expiry / best-before condition | Gas baseline (AIN0 mV, **ZONE LEVEL**) | Gas abnormal delta (mV, **ZONE LEVEL**) | Resulting status / alert | Cited source | Provenance | Assumption flag | Firmware enforces this row? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Dairy | Milk, yoghurt, soft cheese, butter, opened hard cheese | | | | | *not applicable — zone-level, see Z1* | *not applicable — zone-level, see Z1* | | | | | | ✗ |
| Vegetables | Leafy greens, tomatoes, peppers, root vegetables | | | | | *not applicable — zone-level, see Z1* | *not applicable — zone-level, see Z1* | | | | | | ✗ |
| Fruits | Apples, berries, stone fruit, cut fruit | | | | | *not applicable — zone-level, see Z1* | *not applicable — zone-level, see Z1* | | | | | | | ✗ |
| Meat & poultry | Fresh cuts, mince, poultry | | | | | *not applicable — zone-level, see Z1* | *not applicable — zone-level, see Z1* | | | | | | ✗ |
| Cooked / leftovers | Cooked meals, opened packaged food, reheated items | | | | | *not applicable — zone-level, see Z1* | *not applicable — zone-level, see Z1* | | | | | | ✗ |
| Frozen | Frozen items, ice cream | | | | | *not applicable — zone-level, see Z1* | *not applicable — zone-level, see Z1* | | | | | | ✗ |
| Condiments | Sauces, dressings, jams, pickles | | | | | *not applicable — zone-level, see Z1* | *not applicable — zone-level, see Z1* | | | | | | ✗ |
| Bakery | Bread, pastries | | | | | *not applicable — zone-level, see Z1* | *not applicable — zone-level, see Z1* | | | | | | ✗ |
| Seafood | Fresh fish, shellfish | | | | | *not applicable — zone-level, see Z1* | *not applicable — zone-level, see Z1* | | | | | | ✗ |
| Eggs | Whole eggs, opened prepared egg products | | | | | *not applicable — zone-level, see Z1* | *not applicable — zone-level, see Z1* | | | | | | ✗ |
| Other | Anything not above | | | | | *not applicable — zone-level, see Z1* | *not applicable — zone-level, see Z1* | | | | | | ✗ |

> **Notes on the category list.** It is offered as a starting structure, not a
> prescribed taxonomy. Add, merge, or remove rows to match what is actually stored
> in the zone. If you retain a row, you must complete it or explicitly mark it as
> not assessed. **A blank row that stays blank is honest; a blank row with a
> plausible-looking value is a false claim.**

### 4.3 Worked row structure — how to fill one

Below is one row showing the *shape* of a completed row. **The values are placeholders
that illustrate format only and are not to be used as data.** Do not copy them.

| Category | Example items | Acceptable temperature (°C) | Acceptable humidity (% RH) | Storage-duration limit (days) | Expiry / best-before condition | Gas baseline (AIN0 mV, ZONE LEVEL) | Gas abnormal delta (mV, ZONE LEVEL) | Resulting status / alert | Cited source | Provenance | Assumption flag | Firmware enforces? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| *\<your category\>* | *\<examples\>* | *\<min\> – \<max\>* | *\<min\> – \<max\>* | *\<n\>* | *\<condition\>* | *not applicable — zone Z1* | *not applicable — zone Z1* | *\<status\>* | *\<document, edition, clause\>* | Cited **or** Prototype assumption | *\<what was assumed and why\>* | ✗ |

---

## 5. Zone gas baseline and abnormal-delta table

Gas values live here, at the **zone** level, and **only** here. All values are
**millivolts at ADS1115 AIN0**, or a delta from a stored baseline. **No value in
this table is a concentration.**

| Zone ID | Gas baseline at AIN0 (mV) | Baseline captured under | Gas abnormal delta, raise (mV) | Gas abnormal delta, clear (mV) | Basis for the delta choice | Alert type raised | Cited source | Provenance | Measured / verified |
|---|---|---|---|---|---|---|---|---|---|
| **Z1** | | Clean air, zone closed, after full warm-up, mean of the configured sample count at the configured interval | | | *e.g. "chosen to sit above observed steady-state noise of X mV, established by EV-8"* | `gas_relative_high` | | **Prototype assumption** — unmeasured | Not measured |

### 5.1 Mandatory constraints on every gas cell

| # | Constraint | Reason |
|---|---|---|
| 1 | The unit is **mV at AIN0**, never mV at the MQ-135 analog output and never V | The threshold is evaluated after the divider. Reporting the pre-divider voltage would be a different quantity. |
| 2 | The value is a **zone** value, tagged with a **Zone ID** | A shared sensor cannot localise an event to an item. |
| 3 | The **raise** and **clear** values are **different numbers** | Two distinct thresholds stop a signal sitting on the limit from oscillating. |
| 4 | The clear value is **below** the raise value | Enforced at compile time. A build that violates it fails to compile. |
| 5 | **No ppm. No concentration. No ppm-equivalent.** | No traceable gas calibration has been performed. |
| 6 | The delta must be justified against **observed steady-state noise** | A threshold below the noise floor flaps constantly; a threshold far above it never fires, which makes the abnormal-gas test impossible to demonstrate. |
| 7 | The baseline is **not comparable across a change of MQ-135 supply voltage, divider, gain, or sensor position** | The analog output is ratiometric to the heater supply. See [`CALIBRATION_BASELINE.md` §7](./CALIBRATION_BASELINE.md). |
| 8 | Warm-up and baseline capture are **display-only Data Unavailable** states, never a remote fault alert | A 60 s warm-up on every boot is normal. Alerting about it would be a false alarm every power-up. |

### 5.2 The honest statement to accompany the gas table

> *Gas values in this table are ADS1115 pin voltages in millivolts, or a delta
> from a baseline captured in the same zone under the stated conditions. They
> describe **relative change** in one shared storage zone. They are **not** gas
> concentrations, they are **not** calibrated, and they are **not** attributed to
> any specific food item. A gas reading alone must never be used to confirm food
> spoilage. A Check Food verdict triggered by gas means **inspect the food**.*

---

## 6. Cited-source register

Every citation used anywhere in this matrix gets a row here, so a reviewer can
check it without hunting through the tables.

| Source ID | Type | Publisher / author | Document title | Edition / version | Clause or section used | URL or reference | Date accessed | Value(s) taken from it |
|---|---|---|---|---|---|---|---|---|
| SRC-01 | | | | | | | | |
| SRC-02 | | | | | | | | |
| SRC-03 | | | | | | | | |

### 6.1 What counts as an acceptable citation

| Acceptable | Not acceptable |
|---|---|
| A national food-safety authority's published storage guidance, cited by document title, edition, and clause | "Standard food storage guidelines" |
| A food manufacturer or retailer's own storage instructions on the product, cited by product | "The packaging says so" |
| A recognised food-science textbook chapter, cited by edition and page | "Common knowledge" |
| A standards body's published document, cited by number and clause | "The internet" |
| A sensor or module manufacturer's datasheet, for sensor capability claims | A forum answer |
| An explicit statement: *"Prototype/demo assumption — no authoritative value located as of \<date\>"* | A value with no source and no assumption flag |

### 6.2 Citation discipline

| Rule | Why |
|---|---|
| Cite the **clause or section**, not just the document | A reviewer must be able to find the value without re-reading a whole document |
| Record the **date accessed** | Guidance changes; a citation without a date cannot be re-checked |
| Cite the **publisher**, not a repost | A summary of guidance is not guidance |
| If two sources disagree, **cite both and record the disagreement** | Silently picking one hides a real uncertainty |
| If no authoritative value exists, **say so and flag the assumption** | An honest gap is better than a fabricated citation |

> **Do not fabricate a citation.** A plausible-looking but unverified reference is
> worse than an empty cell, because a reviewer may trust it. If you have not
> opened the document and located the clause, the Source cell stays empty and
> Provenance reads `Prototype assumption`.

---

## 7. How to complete a row honestly

### 7.1 Decision sequence

```text
   Pick a food category
          │
          ▼
   Is authoritative, citable guidance available
   for its storage conditions?
          │
    ┌─────┴─────┐
    │ yes       │ no
    │           │
    ▼           ▼
  Enter the   Enter a value that is defensible
  cited value and clearly mark it
  in the       "Prototype assumption"
  Cited source  in Provenance
  column and   AND write what was assumed
  the clause    and why in the Assumption
  in the        flag column
  register
    │           │
    └─────┬─────┘
          │
          ▼
  Gas columns: always "not applicable —
  zone-level, see Z1". Never a per-item
  gas number.
          │
          ▼
  Resulting status: Fresh/Normal, Use Soon,
  or Check Food ONLY. Never "safe" or
  "unsafe".
```

### 7.2 A row is complete only when

| # | Condition |
|---|---|
| 1 | Every value cell is either filled with a cited value **or** filled with a flagged prototype assumption |
| 2 | Provenance reads `Cited` or `Prototype assumption` — never blank, never something else |
| 3 | If `Cited`, the citation exists in the [§6](#6-cited-source-register) register with a clause |
| 4 | If `Prototype assumption`, the assumption flag states **what** was assumed and **why** |
| 5 | Both gas columns say `not applicable — zone-level, see Z1` |
| 6 | The resulting-status column uses only the three permitted food statuses |
| 7 | "Firmware enforces this row?" is honest — currently ✗ for every row |

### 7.3 Rows you may legitimately leave incomplete

| Situation | What to do |
|---|---|
| A category not actually stored in the zone | Leave it blank and mark it *not assessed for this deployment* |
| A value where no guidance could be found at all | Leave the cell empty, set Provenance to `Prototype assumption`, and state in the flag that no authoritative value was located |
| Gas | Never fill a per-item gas cell. Ever. |
| A category the team did not have time to assess | Mark it explicitly as a known gap. An acknowledged gap is acceptable; a silent one is not |

---

## 8. Resulting-status mapping

How the conditions in a matrix row combine into a freshness status. The full
13-rule matrix, including precedence, lives in
[`FRESHNESS_DECISION_RULE_MATRIX.md`](./FRESHNESS_DECISION_RULE_MATRIX.md).

| Zone condition | Item condition | Required inputs available? | Resulting status | Indicator | Alert type |
|---|---|---|---|---|---|
| All in range | Before 75 % of window | Yes | **Fresh / Normal** | Green | — |
| All in range | 75 – 100 % of window | Yes | **Use Soon** | Yellow | `food_use_soon` |
| All in range | At or past limit | Yes | **Check Food** | Red solid | `food_check` |
| Any confirmed environmental violation | Any | Yes | **Check Food** | Red solid + buzzer | `temperature_high` / `temperature_low` / `humidity_high` / `humidity_low` / `gas_relative_high` |
| Any | Any | **No** | **Sensor Fault / Data Unavailable** | Red **blinking** | `sensor_fault` |
| Any | Any | Yes, plus a storage/admin fault | **Unchanged by the rules above** | Unchanged | `storage_fault` |
| Any | Any | Door open beyond the timeout | **Unchanged**; a separate one-shot door alert fires | Unchanged | `door_open` |

### 8.1 Vocabulary — the only permitted terms

| Use | Never use | Why |
|---|---|---|
| Fresh/Normal | Good, safe, fresh enough to eat, OK | "Safe" is a food-safety claim this system cannot make |
| Use Soon | Approaching spoilage, eat now | Predicts spoilage, which this system cannot do |
| Check Food | Spoiled, discard, dangerous, expired-and-unsafe | *Check Food* is an instruction to **a human to inspect**. Disposal is a human decision |
| Sensor Fault / Data Unavailable | Sensor failed, no data | Prefer the exact firmware wording — it distinguishes *faulted* from *not yet ready* |
| Relative gas reading in mV, or a delta from baseline | Gas level, gas concentration, ppm, VOC ppm, air quality score | A relative reading is not a concentration, and no ppm claim is permitted |

> **Gas, one more time.** The alert message for a gas excursion reports the
> **delta in millivolts** and the configured threshold in millivolts. That is
> deliberate and it should survive into every screenshot, chart axis, notification
> body, and report paragraph. If you find yourself wanting to write "gas level
> rose sharply" in a report, replace it with the actual millivolt delta.

---

## 9. What this matrix does and does not control

```text
    ┌──────────────────────────────────────────────────────────────┐
    │  This matrix (FOOD_THRESHOLD_MATRIX.md)                     │
    │  - documents expected conditions per food category          │
    │  - records cited sources and assumption flags                │
    │  - records the ZONE gas baseline and abnormal delta         │
    │  ✗  NOT read by the firmware at runtime                     │
    └───────────────────────────┬──────────────────────────────────┘
                                │  no runtime path
                                │  (open decision Q-3)
                                ▼
    ┌──────────────────────────────────────────────────────────────┐
    │  Firmware compile-time constants                             │
    │  - ONE uniform temperature band, applied to the whole zone  │
    │  - ONE uniform humidity band, applied to the whole zone     │
    │  - ONE gas abnormal delta, applied to the whole zone        │
    │  ●  These are what actually gate a Check Food verdict        │
    └──────────────────────────────────────────────────────────────┘
```

| Claim | True? |
|---|---|
| The matrix documents per-category expected storage conditions | ● Yes |
| The matrix records cited sources or flags assumptions | ● Yes |
| The matrix records the zone gas baseline and abnormal delta in millivolts | ● Yes |
| **The firmware reads this matrix at runtime** | ✗ **No** |
| **Per-category thresholds are enforced** | ✗ **No** |
| **The zone-wide band is per-food aware** | ✗ **No** |
| Per-category values could be enforced without a configuration interface | ✗ No — thresholds are compile-time only |

### 9.1 Required disclosure

Your report must contain a statement along these lines:

> *The Food Threshold Matrix documents expected storage conditions per food
> category, with cited sources where authoritative guidance was available and
> explicit prototype/demo assumptions where it was not. The deployed firmware
> enforces a single zone-wide environmental band, identical for all items, and
> does not read the matrix at runtime. Per-category enforcement would require a
> threshold-configuration interface, which is out of scope for this prototype.
> No value in this matrix is a certified food-safety standard.*

**If you change this design** — by adding a per-category lookup to the item record,
for example — update this section, update
[`FRESHNESS_DECISION_RULE_MATRIX.md`](./FRESHNESS_DECISION_RULE_MATRIX.md), and
remove this disclosure. Keeping a stale disclosure is worse than having none.

---

## 10. Sign-off

| Item | Status | Name | Date |
|---|---|---|---|
| Zone table (§3) completed and photographed | | | |
| Every per-category row is either complete or explicitly marked not assessed | | | |
| Every row's Provenance column reads `Cited` or `Prototype assumption` — none blank | | | |
| Every `Cited` value has a register entry with a specific clause | | | |
| Every `Prototype assumption` row has a written assumption flag | | | |
| No per-item gas value appears anywhere in this document | | | |
| No ppm or concentration value appears anywhere in this document | | | |
| The word "safe" or "unsafe" does not appear as a status | | | |
| Zone gas baseline captured and recorded (link to `CALIBRATION_BASELINE.md` CB-G9) | | | |
| Gas abnormal delta justified against observed noise | | | |
| The disclosure in §9.1 is included in the project report | | | |
| Gas warm-up and baseline states confirmed as display-only | | | |

---

## Cross-references

| Document | Relationship |
|---|---|
| [`../README.md`](../README.md) | Project overview, limitations, and the Option A / Option B dashboard scope |
| [`../FOOD_STORAGE_ARCHITECTURE.md`](../FOOD_STORAGE_ARCHITECTURE.md) | Design document; §15.2 is the upstream version of this matrix template |
| [`FRESHNESS_DECISION_RULE_MATRIX.md`](./FRESHNESS_DECISION_RULE_MATRIX.md) | Turns these thresholds into 13 ordered decision rules |
| [`CALIBRATION_BASELINE.md`](./CALIBRATION_BASELINE.md) | Where the zone gas baseline and delta are actually measured |
| [`IOT_TEST_MATRIX.md`](./IOT_TEST_MATRIX.md) | How each threshold's alert is demonstrated and evidenced |
| [`WIRING_AND_PIN_MAP.md`](./WIRING_AND_PIN_MAP.md) | Where the gas baseline is physically derived from |

---

*FreshGuard — Food Threshold Matrix template. ESP8266MOD prototype.*
*No value in this document is a measured result or a certified food-safety limit.
No gas concentration, ppm value, or calibration claim is made.*
