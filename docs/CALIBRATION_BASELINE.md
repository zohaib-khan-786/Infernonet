# FreshGuard — Sensor Calibration and Baseline Table

> **SRS requirement:** §1.6-v — *"Before freshness monitoring begins, teams should
> calibrate sensors where supported or establish and document baseline readings
> under controlled conditions."* Also §1.7 Accuracy — *"Sensor baseline/calibration
> results should be documented before testing."*
> **Deliverable:** SRS §1.9 requires a **Sensor Calibration/Baseline Table**.

> ## ⚠ This table is intentionally blank
>
> **No measurement has been taken.** No physical testing has been performed on
> this project. Every "Firmware default" value below is a *compile-time controlled
> prototype assumption* that has never been validated on a bench, and every
> "Measured" cell is empty because filling it would require inventing data.
>
> **Do not fabricate a value to make a row look complete.** An empty cell with a
> source column reading "not yet measured" is a visible, honest gap. A fabricated
> number is a false claim that an evaluator can and will check.
>
> **Acceptance rule:** no row may be marked Pass without a measured value **and** a
> source.

---

## Table of contents

1. [How to use this document](#1-how-to-use-this-document)
2. [Preconditions — do these before measuring anything](#2-preconditions--do-these-before-measuring-anything)
3. [The calibration and baseline table](#3-the-calibration-and-baseline-table)
4. [Measurement procedure](#4-measurement-procedure)
5. [Fields to record for every entry](#5-fields-to-record-for-every-entry)
6. [MQ-135 baseline rules](#6-mq-135-baseline-rules)
7. [The baseline fingerprint: divider, gain, and supply](#7-the-baseline-fingerprint-divider-gain-and-supply)
8. [Evidence register](#8-evidence-register)
9. [Assumption-to-measurement traceability](#9-assumption-to-measurement-traceability)
10. [Sign-off](#10-sign-off)

---

## 1. How to use this document

| Column | What goes in it | Never goes in it |
|---|---|---|
| **Firmware default** | The value currently compiled into the firmware, quoted from the source of truth. This is a **configuration value**, not a measurement. | Any claim that it was verified. |
| **Measured** | A number you actually observed, with a unit. | An estimate, a datasheet figure, or a value copied from another row. |
| **Capture conditions** | Enough detail that someone else could repeat the capture. | "Normal" or "as expected". |
| **Method / instrument** | The instrument used and, where it matters, the instrument identifier. | A method you did not use. |
| **Source** | A datasheet, a manufacturer document, a cited food-storage guidance, an explicit "prototype assumption", or a measured observation. | A bare number with no provenance. |
| **Status** | `Measured`, `Assumption`, `Not measured`, or `Pass` (only with evidence). | `Pass` without an evidence ID. |

**Status vocabulary used in this document**

| Status | Meaning |
|---|---|
| **Not measured** | No measurement exists. The default is open. |
| **Assumption** | A controlled prototype/demo value with no measurement behind it. This is honest and permitted; it must be disclosed. |
| **Measured** | A real capture exists, with a method and conditions recorded. |
| **Pass** | The value was measured, sourced, and the associated evidence ID is filed. |

---

## 2. Preconditions — do these before measuring anything

Measuring a baseline before the electrical gates are satisfied produces a number
that will be wrong later. Complete these first.

| # | Precondition | Why it gates the measurement | Reference |
|---|---|---|---|
| 1 | **DS3231 charging path disabled and verified open** | A damaged cell invalidates the session, not just the RTC | [`WIRING_AND_PIN_MAP.md` §9](./WIRING_AND_PIN_MAP.md) |
| 2 | **Level-shifter part identified; LCD left unpowered until verified** | A wrong part puts an unknown voltage on a live bus | [`WIRING_AND_PIN_MAP.md` §7](./WIRING_AND_PIN_MAP.md) |
| 3 | **Board silkscreen confirmed against the authoritative GPIO map** | A mis-mapped I²C pair makes every bus measurement meaningless | [`WIRING_AND_PIN_MAP.md` §2](./WIRING_AND_PIN_MAP.md) |
| 4 | **DHT11 DATA pull-up fitted and idle level measured at 3.3 V** | A floating line reads as permanently unavailable, not as a humidity error | [`WIRING_AND_PIN_MAP.md` §8](./WIRING_AND_PIN_MAP.md) |
| 5 | **MQ-135 supply voltage decided and measured** | The analog output is **ratiometric to the heater supply**. A baseline captured at one supply is not comparable at another. | §7 below |
| 6 | **Fitted divider resistors measured** | The divider values are written into the baseline record and into the gain arithmetic | §7 below |
| 7 | **Storage environment decided and recorded** | A refrigerator and an insulated box produce different temperature and humidity statistics and different condensation behaviour | Open decision Q-6 |
| 8 | **Core and library versions recorded at build time** | A different core or library release can change a driver detail, including a conversion or timing path | Open decision Q-11 |

> **A calibration is only valid for the configuration that produced it.** If any of
> the eight preconditions above changes, re-measure. See
> [§7](#7-the-baseline-fingerprint-divider-gain-and-supply).

---

## 3. The calibration and baseline table

### 3.1 Temperature — BMP280 (the authoritative temperature source)

| ID | Sensor / quantity | Unit | Firmware default (assumption) | Measured value | Capture conditions | Method / instrument | Source | Status |
|---|---|---|---|---|---|---|---|---|
| CB-T1 | BMP280 temperature offset applied by firmware | °C | 0.0 — no offset is applied | | | | | Not measured |
| CB-T2 | BMP280 temperature reading, zone at steady state | °C | No fixed default; value is read live | | | | | Not measured |
| CB-T3 | BMP280 temperature spread over 10 consecutive samples | °C | Smoothed with a 0.20 weight | | | | | Not measured |
| CB-T4 | BMP280 temperature reading versus a reference instrument | °C | No offset applied | | | | | Not measured |
| CB-T5 | Pressure reading, zone at steady state | hPa | Reported for context; **no threshold applies** | | | | | Not measured |
| CB-T6 | Pressure spread over 10 consecutive samples | hPa | Smoothed with a 0.20 weight | | | | | Not measured |

**Notes to complete after measuring.**

| Field | Your entry |
|---|---|
| Reference instrument used for CB-T4 | |
| Reference instrument identifier / calibration date | |
| Where the sensor was physically mounted | |
| Time from power-on to first stable reading | |

### 3.2 Humidity — DHT11 (humidity only)

| ID | Sensor / quantity | Unit | Firmware default (assumption) | Measured value | Capture conditions | Method / instrument | Source | Status |
|---|---|---|---|---|---|---|---|---|
| CB-H1 | DHT11 humidity offset applied by firmware | % RH | 0.0 — no offset is applied | | | | | Not measured |
| CB-H2 | DHT11 humidity reading, zone at steady state | % RH | No fixed default; value is read live | | | | | Not measured |
| CB-H3 | DHT11 humidity spread over 10 consecutive samples | % RH | Smoothed with a 0.20 weight | | | | | Not measured |
| CB-H4 | DHT11 humidity reading versus a reference instrument | % RH | No offset applied | | | | | Not measured |
| CB-H5 | Idle DATA line level, ESP8266 powered, DHT11 connected | V | — | | | | | Not measured |
| CB-H6 | Does the fitted breakout already carry a DATA pull-up? | yes / no | **Unknown** — the firmware cannot supply one | | | | | Not measured |

> **CB-H6 is not a formality.** If the answer is "no" and no resistor is fitted,
> humidity is permanently unavailable. That surfaces as *Data Unavailable*, not as
> a wrong number, which is the honest behaviour — but it also means the
> humidity-excursion test can never be produced. Open decision **Q-12**.

**Notes to complete after measuring.**

| Field | Your entry |
|---|---|
| Reference instrument used for CB-H4 | |
| Did the reference agree with the sensor within the prototype hysteresis band (±5 % RH)? | |
| Pull-up resistor value actually fitted (if any) | |

### 3.3 Gas — MQ-135 relative path (millivolts at AIN0, never ppm)

| ID | Sensor / quantity | Unit | Firmware default (assumption) | Measured value | Capture conditions | Method / instrument | Source | Status |
|---|---|---|---|---|---|---|---|---|
| CB-G1 | **MQ-135 supply voltage at the module** | V | **Not a firmware constant and not a code default.** The module is deliberately not on the 3.3 V rail list. | | | | | Not measured — **BLOCKING** |
| CB-G2 | Fitted divider, top resistor | Ω | 4 700 (assumed) | | | | | Not measured |
| CB-G3 | Fitted divider, bottom resistor | Ω | 2 200 (assumed) | | | | | Not measured |
| CB-G4 | Divider scale as configured | ratio | 2 200 / (4 700 + 2 200) ≈ 0.3188 | | | | | Not measured |
| CB-G5 | AIN0 maximum during heater start-up | mV | Must stay below the 3 300 mV ceiling | | | | | Not measured |
| CB-G6 | AIN0 maximum across a full gas excursion | mV | Must stay below the 3 300 mV ceiling | | | | | Not measured |
| CB-G7 | Implied maximum permissible MQ-135 A0 at CB-G5 | mV | ≈ 10 350 mV (≈ 10.35 V) from the divider constants | | | | | Not measured |
| CB-G8 | MQ-135 warm-up time to a stable reading | s | 60 (assumption) | | | | | Not measured |
| CB-G9 | **MQ-135 baseline at AIN0** | **mV** | Captured at runtime after warm-up; **not** a fixed constant. A persisted baseline survives a reboot if the configuration fingerprint matches. | | Clean air, zone closed, after full warm-up, mean of 30 samples at 1 s intervals | | | Not measured |
| CB-G10 | Baseline spread across three consecutive captures | mV | No fixed default; smoothing weight 0.25 | | | | | Not measured |
| CB-G11 | Observed steady-state noise at AIN0, zone closed | mV | No fixed default | | | | | Not measured |
| CB-G12 | Observed delta during a deliberate excursion | **mV** | 50 mV to raise, 40 mV to clear (assumption) | | | | | Not measured |
| CB-G13 | Assessed gas abnormal delta to adopt | **mV** | 50 raise / 40 clear (assumption) | | Judged against CB-G11 observed noise | | | Not measured |
| CB-G14 | ADS1115 gain setting in use | — | GAIN_ONE, ±4.096 V full scale | | | | | ● design value, confirmed in the log |
| CB-G15 | ADS1115 data rate in use | SPS | 128 | | | | | ● design value, confirmed in the log |
| CB-G16 | Samples averaged per steady-state pass | count | 4 back-to-back conversions, then smoothing | | | | | ● design value |
| CB-G17 | Baseline samples captured, and their interval | count / ms | 30 samples at 1 000 ms intervals | | | | | ● design value |
| CB-G18 | Persisted baseline reloaded correctly after a power cycle? | yes / no | Reload is conditional on the configuration fingerprint matching | | | | | Not measured |

> ### 🚫 No ppm row exists in this table, and that is deliberate.
>
> SRS §1.6-v states: *"Teams should not report calibrated gas concentration or
> ppm values unless suitable calibration has been performed."* Suitable
> calibration for a gas concentration requires a traceable reference gas, a
> controlled atmosphere, and a documented response curve. **This prototype performs
> none of that.** The MQ-135 path reports **ADS1115 pin millivolts** and a **delta
> from a stored baseline** — nothing else. Do not add a ppm column. Do not convert
> a millivolt delta into a concentration in any report, chart label, or dashboard
> axis.

**Notes to complete after measuring.**

| Field | Your entry |
|---|---|
| Vapour source used for the excursion test (e.g. alcohol vapour, sanitiser vapour) | |
| Is the vapour source food-safe to use in a food-storage environment? | |
| Was the excursion a **controlled** step or an uncontrolled event? | |
| Roughly how long the elevated delta persisted | |
| Time for the delta to fall back below the clear threshold | |
| Would 50 mV raise / 40 mV clear have been appropriate for this module and zone? Justify with CB-G11. | |

### 3.4 Real-time clock, door input, and system timing

| ID | Sensor / quantity | Unit | Firmware default (assumption) | Measured value | Capture conditions | Method / instrument | Source | Status |
|---|---|---|---|---|---|---|---|---|
| CB-R1 | DS3231 clock error | s/day | Not compensated | | Compare against a reference over at least 24 h | | | Not measured |
| CB-R2 | Clock retained across a 60 s power removal? | yes / no | Trust flag is checked at every boot | | Set with `RTCEPOCH`, remove USB 60 s, restore power | | | Not measured |
| CB-R3 | Oscillator-stopped flag behaviour after battery removal | — | Checked and used as a deterministic fault | | | | | Not measured |
| CB-D1 | Reed debounce window | ms | 80 | | Rapid magnet operation | | | ● design value; functional test outstanding |
| CB-D2 | Door-open timeout | s | 30 (assumption) | | Timed open event | | | Not measured |
| CB-D3 | P0 idle level, contacts open | V | — | | | | | Not measured |
| CB-D4 | P0 level, contacts closed | V | Firmware asserts the closed level is LOW | | | | | Not measured |
| CB-D5 | False door transitions during rapid magnet movement | count | Debounce is designed to prevent them | | Rapid repeated operation | | | Not measured |
| CB-T3b | Threshold confirmation window, first violating sample to confirmed alert | s | 3 consecutive samples at a 5 s poll cadence | | | | | Not measured |
| CB-T4b | Local alert latency from **confirmation** to buzzer and LED | s | Raised inside the confirming evaluation pass | | | | | Not measured |
| CB-T5b | Detection latency from the **start** of a sustained excursion | s | Longer than CB-T4b by design | | | | | Not measured |

> **CB-T4b and CB-T5b are different numbers and reports routinely conflate them.**
> SRS §1.7 asks for a local alert within **2–5 seconds of a confirmed threshold
> violation**. That is CB-T4b. If you also report how long the system took to
> notice a sustained excursion at all, that is CB-T5b and it is legitimately
> longer, because a violation must survive three consecutive samples. **Label
> which one you measured.**

### 3.5 Platform and configuration fingerprint

| ID | Quantity | Unit | Value / default | Measured or recorded value | How it was obtained | Status |
|---|---|---|---|---|---|---|
| CB-F1 | ESP8266 core version compiled against | version string | This build was **checked against 3.1.2** — that is not a claim about your installation | | `arduino-cli core list`, or Boards Manager | Not recorded |
| CB-F2 | DHT library version resolved | version string | Not pinned | | `arduino-cli lib list` | Not recorded |
| CB-F3 | BMP280 library version resolved | version string | Not pinned | | `arduino-cli lib list` | Not recorded |
| CB-F4 | ADS1X15 library version resolved | version string | Not pinned | | `arduino-cli lib list` | Not recorded |
| CB-F5 | RTClib version resolved | version string | Not pinned | | `arduino-cli lib list` | Not recorded |
| CB-F6 | LiquidCrystal I2C fork and version | fork name + version | Not pinned; the fork is significant | | `arduino-cli lib list` | Not recorded |
| CB-F7 | MFRC522 library version resolved | version string | Not pinned | | `arduino-cli lib list` | Not recorded |
| CB-F8 | Board FQBN used | FQBN string | `esp8266:esp8266:nodemcu` | | Build configuration | ● recorded |
| CB-F9 | Board silkscreen confirmed against the GPIO map? | yes / no | **Unknown** | | Photograph of the physical board | Not recorded — open decision **Q-9** |
| CB-F10 | Storage environment used | refrigerator / insulated box / other | **Undecided** | | Photograph of the setup | Not recorded — open decision **Q-6** |
| CB-F11 | 3.3 V rail, idle | V | — | | | Not measured |
| CB-F12 | 3.3 V rail, minimum during a Wi-Fi transmit burst | V | — | | Scope during association and upload | Not measured |
| CB-F13 | USB supply and cable type | V / A / data-capable | Laptop USB | | | Not recorded |
| CB-F14 | Total peripheral current draw, measured | mA | — | | Insert an ammeter in the 3.3 V branch | Not measured |

---

## 4. Measurement procedure

Perform these in order. Do not skip forward — a later capture is only comparable
if every earlier precondition held.

### Step 0 — Establish and record the fingerprint first

Before any number, fill in **§3.5**. Without the core version, the library
versions, the fitted divider values, the gain setting, and the MQ-135 supply
voltage, a baseline is a number with no meaning.

### Step 1 — Safety gates (unpowered)

| # | Action | Pass criterion |
|---|---|---|
| 1.1 | Confirm the DS3231 charging path is open | No continuity from the charging circuit to the cell |
| 1.2 | Confirm the level-shifter part marking | Bidirectional BSS138-type, not a unidirectional MOSFET shifter |
| 1.3 | Confirm the board silkscreen against the GPIO map | Every connected net matches the authoritative GPIO number |
| 1.4 | Continuity-check every signal net back to its source rail | No 5 V reaches any GPIO |
| 1.5 | Measure GPIO15 with the RC522 attached, board unpowered | Reads LOW |

### Step 2 — Power-up with no peripherals

| # | Action | Pass criterion |
|---|---|---|
| 2.1 | Open the serial console at 115200 baud | Boot banner, configuration self-check, and the I²C bus scan appear |
| 2.2 | Read the bus scan | **No devices responding** |

### Step 3 — Power and rail characterisation

| # | Action | Pass criterion | Record as |
|---|---|---|---|
| 3.1 | Measure the 3.3 V rail idle | Recorded, with the instrument identified | CB-F11 |
| 3.2 | Measure the 3.3 V rail during Wi-Fi association | No collapse; note the minimum | CB-F12 |
| 3.3 | Measure total peripheral current | Within the regulator's budget with margin | CB-F14 |

### Step 4 — Fit and measure the divider

| # | Action | Pass criterion | Record as |
|---|---|---|---|
| 4.1 | Remove or lift one end of each divider resistor and measure in Ω | Both values recorded | CB-G2, CB-G3 |
| 4.2 | If the measured values differ from the compiled constants, update the constants **and** discard any stored baseline | Constants updated; baseline invalidated | §7 |
| 4.3 | Record the resulting scale | Matches the configured scale | CB-G4 |

### Step 5 — Temperature and pressure

| # | Action | Pass criterion | Record as |
|---|---|---|---|
| 5.1 | Let the zone reach steady state | — | — |
| 5.2 | Capture 10 consecutive BMP280 temperature readings | Spread recorded; the readings are stable | CB-T2, CB-T3 |
| 5.3 | Capture 10 consecutive pressure readings | Recorded | CB-T5, CB-T6 |
| 5.4 | Compare against a reference instrument at the same location | Difference recorded; do not silently apply a correction | CB-T4 |

> **The firmware applies no temperature or humidity offset.** If you measure one
> and decide to correct for it, that is a code change, not a table entry. Record
> the offset in the table either way, so a reviewer can see it was considered.

### Step 6 — Humidity

| # | Action | Pass criterion | Record as |
|---|---|---|---|
| 6.1 | With the ESP8266 powered and the DHT11 connected and **nothing else on the bus**, measure the DATA idle level | Reads 3.3 V, not floating | CB-H5 |
| 6.2 | Capture 10 consecutive humidity readings | Spread recorded | CB-H2, CB-H3 |
| 6.3 | Compare against a reference instrument | Difference recorded | CB-H4 |
| 6.4 | Record whether the breakout already carried a pull-up | Explicit yes / no | CB-H6 |

### Step 7 — Gas warm-up and baseline capture

| # | Action | Pass criterion | Record as |
|---|---|---|---|
| 7.1 | Measure and record the MQ-135 supply voltage at the module | Recorded **before** warm-up completes | **CB-G1** |
| 7.2 | Power-cycle and time the sensor from power-on to a stable reading | Warm-up duration recorded | CB-G8 |
| 7.3 | With the zone closed and in clean air, let warm-up complete | State reaches `ready` | — |
| 7.4 | Let the 30-sample baseline capture complete | `BASELINE` reports `state=ready` with a millivolt value | CB-G9 |
| 7.5 | Repeat the capture three times | Spread across captures recorded | CB-G10 |
| 7.6 | Record the observed steady-state noise | Recorded | CB-G11 |
| 7.7 | Power-cycle and confirm the persisted baseline reloads | Reload reported and matching | CB-G18 |
| 7.8 | Confirm the boot log reports the divider constants and the implied maximum A0 | Present and consistent | — |

### Step 8 — Gas excursion

| # | Action | Pass criterion | Record as |
|---|---|---|---|
| 8.1 | Introduce a recorded, food-safe vapour source into the zone | — | — |
| 8.2 | Record the **peak** AIN0 value | **Below the 3 300 mV ceiling** | CB-G6 |
| 8.3 | Record the peak **delta** from baseline | Recorded | CB-G12 |
| 8.4 | Time how long the delta stays above the configured raise threshold | Recorded | — |
| 8.5 | Time how long the delta takes to fall back below the clear threshold | Recorded | — |
| 8.6 | Judge whether the configured raise / clear thresholds are appropriate for this module and zone, **justified against the observed noise** | Judgement recorded with reasoning | CB-G13 |

> ⚠ **A food-storage environment and a test vapour source are in tension.** Record
> what source you used, and confirm it is safe to use where food is stored. A
> methanol-based or solvent-based source in a food-storage area is a safety
> decision, not a convenience. If in doubt, use a source you have confirmed is
> food-safe, and say which one in the report.

### Step 9 — Clock and door

| # | Action | Pass criterion | Record as |
|---|---|---|---|
| 9.1 | Set the clock with `RTCEPOCH` | `STATUS` reports the RTC ready | — |
| 9.2 | Remove USB for 60 s and restore power | Clock retained and still trusted | CB-R2 |
| 9.3 | Leave the clock running for at least 24 h against a reference | Drift rate recorded | CB-R1 |
| 9.4 | Time a door-open event to the alert | Duration recorded | CB-D2 |
| 9.5 | Operate the magnet rapidly and repeatedly | No false transitions | CB-D5 |
| 9.6 | Measure the P0 idle and closed levels | Both recorded | CB-D3, CB-D4 |

### Step 10 — System timing

| # | Action | Pass criterion | Record as |
|---|---|---|---|
| 10.1 | Time from the first violating sample to the confirmed alert | Recorded | CB-T3b |
| 10.2 | Time from confirmation to buzzer and LED response | Recorded — this is the number SRS §1.7 asks for | CB-T4b |
| 10.3 | Time from the start of a sustained excursion to the alert | Recorded, and labelled distinctly from 10.2 | CB-T5b |

### Step 11 — Sign off

| # | Action |
|---|---|
| 11.1 | Every row carries either a measured value with a method, or an explicit "Not measured" |
| 11.2 | Every measured value carries a source |
| 11.3 | Every Pass row carries an evidence ID from §8 |
| 11.4 | The storage environment is recorded and photographed |
| 11.5 | The core and library versions are recorded |
| 11.6 | The report states plainly that no food-safety limit is claimed by any value in this table |

---

## 5. Fields to record for every entry

Copy this block for each new measurement.

| Field | Description | Example of an acceptable entry |
|---|---|---|
| **Row ID** | The `CB-…` identifier from §3 | `CB-G9` |
| **Quantity** | What was measured, in plain words | MQ-135 baseline at AIN0 |
| **Unit** | With the qualifier that makes it unambiguous | mV at AIN0 (not at MQ-135 A0) |
| **Measured value** | The number observed | *(your value)* |
| **Capture date and time** | Local time, with timezone | *(your entry)* |
| **Operator** | Who took the reading | *(your name)* |
| **Instrument** | Type, and identifier if it has one | *(your entry)* |
| **Capture conditions** | Zone state, door state, time since power-on, environment, sensor position, whether the baseline was persisted or freshly captured | *(your entry)* |
| **Method** | Number of samples, sampling interval, averaging applied, how the value was derived | *(your entry)* |
| **Source** | Datasheet, manufacturer document, cited guidance, or "measured observation" | *(your entry)* |
| **Assumption or measured** | An explicit label — never leave this ambiguous | `Measured` |
| **Evidence ID** | From §8 | `EV-7` |
| **Notes** | Anything a reviewer would need to reproduce or would otherwise question | *(your entry)* |

### 5.1 Words that must not appear in this table

| Never write | Write instead |
|---|---|
| "approximately correct" | The measured value, with its uncertainty if you have one |
| "typical" | The value observed in **your** capture |
| "per datasheet" as a *measured* entry | Cite the datasheet in the Source column and leave the Measured cell empty |
| "ppm" anywhere in a gas row | mV at AIN0, and a delta from the stored baseline |
| "safe" / "unsafe" | Millivolts, percent, degrees, seconds — measurement units only |
| "calibrated" about the MQ-135 | "relative baseline captured under stated conditions" |
| A value with no units | Always include the unit |

---

## 6. MQ-135 baseline rules

These rules exist because the MQ-135 is a low-cost sensor and an easy place to
overclaim. They are not stylistic preferences.

| # | Rule | Reason |
|---|---|---|
| **G1** | **The MQ-135 must be allowed to warm up and stabilise before any baseline is recorded.** The firmware performs a full 60 s warm-up on **every** boot, including when a valid baseline was persisted — the stored baseline is adopted only once warm-up completes, so the heater is never read cold. | A cold heater produces a rising, meaningless reading. |
| **G2** | **The baseline is captured under controlled conditions:** zone closed, no vapour source present, the sensor in its final mounting position. | A baseline captured with the lid open or the sensor in your hand is not the zone baseline. |
| **G3** | **The baseline is a zone-level value, never a per-item value.** One MQ-135 describes one shared storage zone. | SRS §1.6-x is explicit: where one MQ-135 monitors a shared zone, the gas reading **must not be attributed to any specific food item.** |
| **G4** | **Record the baseline in millivolts at AIN0 and a delta from it. Never in ppm and never as a concentration.** | No traceable gas calibration has been performed. SRS §1.6-v forbids reporting ppm without one. |
| **G5** | **A delta is positive-only.** When the current reading is below the baseline, the reported delta is 0. | Prevents a negative "improvement" reading from looking like an event. |
| **G6** | **The raise and clear thresholds are deliberately different** (50 mV raise, 40 mV clear by default). Do not set them equal. | Two distinct thresholds stop a signal sitting on the limit from oscillating. |
| **G7** | **Warm-up and baseline capture are display-only "Data Unavailable" states.** They are deliberately excluded from the confirmed sensor-fault mask, so no remote fault alert fires. | A 60 s warm-up on every boot is normal. Alerting a remote channel about it would be a false alarm on every power-up. |
| **G8** | **A confirmed read or plausibility fault puts the gas path into a faulted state and discards the baseline.** Recovery requires a **new** baseline before data is trusted again. | A sensor that faulted mid-capture has not demonstrated a valid baseline. |
| **G9** | **Readings outside the plausibility window are rejected, not clamped.** | The window catches a disconnected sensor reading near 0 V and a shorted divider reading full scale — both wiring faults that would otherwise look like extreme gas conditions. |
| **G10** | **After any change to the MQ-135 supply, the divider, the gain, or the baseline sample count, re-baseline.** | See §7. |
| **G11** | **Gas readings alone must never confirm spoilage.** | SRS §1.6-iv is explicit. The gas reading is one input to a Check Food verdict, and that verdict means *inspect it*, not *it is spoiled*. |

### 6.1 What the gas path reports, in full

| Reported quantity | Unit | Meaning | Never |
|---|---|---|---|
| Gas state | state name | `warming`, `capturing baseline`, `ready`, or `fault` | — |
| Baseline | mV at AIN0 | The stored reference | ppm, concentration, ppm-equivalent |
| Current input | mV at AIN0 | The smoothed divided analog reading | ppm |
| Delta | mV | Current minus baseline, floored at 0 | ppm |
| ADS code | integer | The raw conversion code, for diagnosis | A concentration |

### 6.2 Plausibility and ceiling reference

| Bound | Value | Meaning when exceeded |
|---|---|---|
| Minimum plausible AIN0 | 10 mV | Confirmed MQ-135 read fault — typically a disconnected sensor or an open divider leg |
| Maximum plausible AIN0 | 3 300 mV | Confirmed MQ-135 read fault — typically a shorted divider; also the hard design ceiling for the ADC input |
| ADS1115 absolute maximum analog input | VDD + 0.3 V | Exceeding it risks the ADC |
| Implied maximum permissible MQ-135 A0 | ≈ 10 350 mV (≈ 10.35 V) at the 3 300 mV ceiling, from the divider constants | A measured A0 above this means the divider values are wrong |

---

## 7. The baseline fingerprint: divider, gain, and supply

### 7.1 What the persisted baseline record actually contains

The gas baseline is persisted in the device's flash filesystem and is validated
on load. **This is a real, implemented protection** — but its coverage has one
important gap.

| Field in the persisted record | Covered by the fingerprint? | On mismatch |
|---|---|---|
| Magic value and record version | ✔ Yes | Baseline discarded, recaptured |
| **Top divider resistor value** | ✔ Yes | Baseline discarded, recaptured |
| **Bottom divider resistor value** | ✔ Yes | Baseline discarded, recaptured |
| **ADC full-scale millivolts** (the gain setting) | ✔ Yes | Baseline discarded, recaptured |
| **Baseline sample count** | ✔ Yes | Baseline discarded, recaptured |
| Stored baseline value, checked against the plausibility window | ✔ Yes | Baseline discarded, recaptured |
| Integrity checksum | ✔ Yes | Baseline discarded, recaptured |
| **MQ-135 supply voltage** | ✗ **NOT covered** | ⚠ **Nothing is invalidated** |

### 7.2 The gap, stated plainly

**The MQ-135 analog output is ratiometric to its heater supply.** If you change
the supply voltage, the same physical gas concentration produces a different
millivolt output, and the stored baseline silently stops being comparable — but
the record still validates, because the supply voltage is not part of the
fingerprint.

**Operational rule until this is fixed:**

> **Re-baseline after any change to the MQ-135 supply voltage, and treat the supply
> voltage as part of the baseline's identity.**

Recording the supply voltage in the table (row **CB-G1**) exists specifically so
that a later reader can tell whether two baselines are comparable at all. A
baseline captured at supply A and a baseline captured at supply B are two
different measurements even if both look plausible.

**Open decision Q-8** proposes adding the supply voltage to the persisted record
so a supply change invalidates it automatically. That is a small, contained
firmware change, and it removes a real class of confusing bench failure. It is
recorded here as a recommendation, not as done.

### 7.3 Full invalidation rule

| Change | Stored baseline still valid? | Action required |
|---|---|---|
| Top divider resistor value changed | ✗ No — fingerprint mismatch | Update constants; the firmware will recapture |
| Bottom divider resistor value changed | ✗ No — fingerprint mismatch | Update constants; the firmware will recapture |
| ADS1115 gain setting changed | ✗ No — fingerprint mismatch | Update constants; the firmware will recapture |
| Baseline sample count changed | ✗ No — fingerprint mismatch | Update constants; the firmware will recapture |
| **MQ-135 supply voltage changed** | ⚠ **Undetected — the record still validates** | **Re-baseline manually, and record the supply in CB-G1** |
| Sensor moved to a different position in the zone | ⚠ **Undetected** | **Re-baseline manually** |
| Zone opened / aired out substantially | ⚠ **Undetected** | Decide deliberately: a legitimately changed baseline, or a still-valid one |
| Firmware reflashed with unchanged constants | ✔ Yes | None |
| Sensor module physically replaced, identical supply and position | ⚠ **Undetected** | **Re-baseline manually** |
| Storage environment changed (refrigerator → insulated box) | ⚗ **Not comparable at all** | Re-baseline and re-measure everything in this document |

---

## 8. Evidence register

A calibration row may only be marked Pass when an evidence artifact exists. Use
these IDs to keep the report and the artifacts in step.

| ID | Evidence item | What it proves | Method | Artifact |
|---|---|---|---|---|
| **EV-1** | I²C bus scan output at boot | All five I²C addresses answer; no address collision | Serial log at 115200 | Log file or screenshot |
| **EV-2** | 3.3 V rail reading, idle and during a Wi-Fi upload | Rail capacity holds under transmit peaks | Meter, plus a capture of the upload window | Photo with the reading visible |
| **EV-3** | DS3231 charging path disabled | No charging current can reach the CR2032 | Continuity / diode mode **before power is applied** | Photo of the modified board plus a meter reading |
| **EV-4** | RTC retention across a power cycle | SRS §1.6-ix satisfied | `RTCEPOCH`, power-cycle, `STATUS` | Log excerpt |
| **EV-5** | AIN0 reading across heater start-up | AIN0 stays below the 3 300 mV ceiling | Scope or meter during warm-up | Screenshot with the reading visible |
| **EV-6** | Fitted divider values measured | The 4.7 kΩ / 2.2 kΩ constants correspond to real parts | Multimeter in Ω mode, both resistors | Photo with the reading visible |
| **EV-7** | Baseline record | This table is populated from a real capture | `BASELINE` output plus 10 samples | Log excerpt plus the completed table |
| **EV-8** | Gas excursion test | The delta threshold raises a `gas_relative_high` alert | Deliberate, food-safe vapour source in the zone | Video clip plus log |
| **EV-9** | Level-shifter identification and idle levels | The shifter is bidirectional and correctly referenced | Part marking plus idle SDA/SCL on both sides | Photo plus meter reading |
| **EV-10** | Temperature excursion | A confirmed violation raises red LED, buzzer, and a queued alert within 2–5 s **of confirmation** | Warm object in the zone | Video clip showing a clock |
| **EV-11** | Humidity excursion | As above. The DHT11 pull-up must be fitted first, or the excursion cannot be produced at all. | Breath or a damp cloth in the zone | Video clip |
| **EV-12** | Door-left-open test | A `door_open` alert after the configured timeout | Remove the magnet; time it | Video clip plus log |
| **EV-13** | Reed bounce test | No false door transitions | Rapid magnet movement | Log excerpt |
| **EV-14** | Sensor-disconnect test | `Sensor Fault / Data Unavailable`, **not** a misleading green | Disconnect one sensor | Video clip plus log |
| **EV-15** | Alert-sensitivity test | A single bad transaction does **not** raise a remote fault alert | Wiggle a connector | Log excerpt |
| **EV-16** | Network-failure test | Local alerts continue; events queue; `QUEUECOUNT` rises | Disable the access point | Log plus `QUEUECOUNT` output |
| **EV-17** | Reconnection and buffered sync | Events drain; none is lost; duplicates identifiable by `event_id` | Restore the access point | Log plus per-event notification captures |
| **EV-18** | Wi-Fi reconnect without a reboot | Monitoring resumes unattended | Restore the access point while running | Log excerpt |
| **EV-19** | LittleFS persistence | Records survive a power cycle and are validated | Power-cycle, then `LIST` / `QUEUECOUNT` / `BASELINE` | Log excerpt |
| **EV-20** | Queue-full behaviour | The overflow alert is local-only and does not recurse | Fill all 24 slots offline | Log excerpt |
| **EV-21** | Demonstration video | Mandatory SRS §1.9 deliverable | — | Video file |
| **EV-22** | Storage environment photograph | Which environment was used, and the mounting arrangement | Photograph | Image file |
| **EV-23** | Board silkscreen photograph | The silkscreen agrees with the authoritative GPIO map | Photograph | Image file |
| **EV-24** | DHT11 DATA idle level | The pull-up is present and the line is not floating | Meter with the ESP8266 powered | Photo with the reading visible |
| **EV-25** | Core and library version record | The report states the versions that were actually compiled | Build output | Text capture |

**Rule for the submission:** a calibration row may only be marked **Pass** when an
evidence ID is attached. A row without evidence is **Not measured**, never
**Pass**.

---

## 9. Assumption-to-measurement traceability

Every compile-time assumption in the firmware that this document can discharge,
with the row that discharges it. The right-hand column is deliberately empty.

| Firmware assumption | Current value | Nature | Discharged by | Measured value | Status |
|---|---|---|---|---|---|
| Temperature acceptable range, minimum | 0 °C | Prototype assumption, not per food category | [`FOOD_THRESHOLD_MATRIX.md`](./FOOD_THRESHOLD_MATRIX.md) | | ○ |
| Temperature acceptable range, maximum | 8 °C | Prototype assumption, not per food category | [`FOOD_THRESHOLD_MATRIX.md`](./FOOD_THRESHOLD_MATRIX.md) | | ○ |
| Temperature hysteresis | ±1.0 °C | Set to at least the prototype sensor uncertainty | CB-T4 | | ○ |
| Humidity acceptable range, minimum | 30 % RH | Prototype assumption | [`FOOD_THRESHOLD_MATRIX.md`](./FOOD_THRESHOLD_MATRIX.md) | | ○ |
| Humidity acceptable range, maximum | 85 % RH | Prototype assumption | [`FOOD_THRESHOLD_MATRIX.md`](./FOOD_THRESHOLD_MATRIX.md) | | ○ |
| Humidity hysteresis | ±5 % RH | Set to at least the prototype sensor uncertainty | CB-H4 | | ○ |
| Consecutive-sample confirmation | 3 samples | Reduces false alerts per SRS §1.6-v | CB-T3b | | ○ |
| Use Soon point | 75 % of the item's window | Convention, not a standard | Demonstrated in the demo, not measured | | ○ |
| Alert rearm window | 60 s | Prevents an alert storm | Not a calibration row | | ● design value |
| Door-open timeout | 30 s | Prototype assumption | CB-D2 | | ○ |
| Reed debounce window | 80 ms | Prototype assumption | CB-D1, CB-D5 | | ○ |
| Buzzer pattern | 3 beeps, 200 ms on / 150 ms off | Audible without being intrusive | Not a calibration row | | ● design value |
| Red blink cadence | 250 ms | Display choice | Not a calibration row | | ● design value |
| MQ-135 warm-up | 60 s | Prototype assumption for this module | **CB-G8** | | ○ |
| MQ-135 baseline sample count | 30 at 1 000 ms | Reduces warm-up drift in the stored mean | CB-G17 | | ● design value |
| MQ-135 steady-state averaging | 4 samples per pass, smoothing weight 0.25 | Averaging / smoothing per SRS §1.6-v | CB-G11 | | ● design value |
| MQ-135 abnormal delta, raise | 50 mV at AIN0 | **Placeholder — unmeasured** | **CB-G13**, justified against **CB-G11** | | ○ **tune after the first excursion test** |
| MQ-135 abnormal delta, clear | 40 mV at AIN0 | **Placeholder — unmeasured** | **CB-G13** | | ○ |
| MQ-135 divider, top | 4 700 Ω | **Placeholder** | **CB-G2** | | ○ |
| MQ-135 divider, bottom | 2 200 Ω | **Placeholder** | **CB-G3** | | ○ |
| MQ-135 supply voltage | Not a firmware constant | **Unknown** | **CB-G1** | | ○ **BLOCKING** |
| ADS1115 gain | GAIN_ONE, ±4.096 V | Matches the divided signal with headroom | CB-G14 | | ● design value, fingerprinted |
| ADS1115 AIN0 hard ceiling | 3 300 mV | Protects the ADC input | **CB-G5**, **CB-G6** | | ○ |
| ADS1115 AIN0 minimum plausible | 10 mV | Catches a disconnected sensor | Deliberate sensor disconnect test | | ○ |
| I²C bus clock | 100 kHz | Breadboard and shifter margin | Bus scan reliability | | ● design value |
| Threshold confirmation window | ~10–15 s end to end | Three samples at a 5 s poll cadence | CB-T3b, CB-T5b | | ○ |
| Local alert latency from confirmation | Well under 1 s | Raised inside the confirming pass | **CB-T4b** | | ○ |

---

## 10. Sign-off

| Item | Status | Name | Date |
|---|---|---|---|
| All electrical safety gates passed before any measurement | | | |
| Fingerprint (§3.5) recorded before any measurement | | | |
| Temperature rows measured or explicitly marked not measured | | | |
| Humidity rows measured or explicitly marked not measured | | | |
| Gas rows measured or explicitly marked not measured | | | |
| Gas supply voltage measured — **CB-G1** | | | |
| Divider values measured — **CB-G2**, **CB-G3** | | | |
| Door and clock rows measured or explicitly marked not measured | | | |
| Gas abnormal delta tuned from excursion evidence — **CB-G13** | | | |
| No ppm value appears anywhere in this table | | | |
| No food-safety limit is claimed by any value in this table | | | |
| Every Pass row carries an evidence ID | | | |
| Storage environment recorded and photographed — **EV-22** | | | |

### 10.1 Statement to include in the project report

> *The calibration and baseline values in this table were captured on the bench on
> the dates recorded in each row, under the stated conditions, using the stated
> instruments. Every gas value is an ADS1115 pin voltage in millivolts, or a delta
> from a stored baseline captured in the same zone. No gas concentration, ppm
> value, or calibration claim is made. No value in this table is a certified
> food-safety limit; the freshness thresholds are controlled prototype/demo
> assumptions documented in the Food Threshold Matrix.*

---

*FreshGuard — Sensor Calibration and Baseline Table. ESP8266MOD prototype.*
*This table is supplied blank by design. No measurement has been taken and no
value has been invented.*
