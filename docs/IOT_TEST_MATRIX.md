# FreshGuard — IoT Test Matrix

> **SRS requirement:** §1.6-xxi — *"Teams should prepare and execute an IoT Test
> Matrix. The matrix should contain the following columns: Test ID, Test Scenario,
> Input/Condition, Expected Result, Actual Result, Pass/Fail Status and Evidence."*
> **Deliverable:** SRS §1.9 requires an **IoT Test Matrix with Evidence**.

> ## ⚠ Every row in this matrix is unexecuted
>
> **No test has been run. No hardware has been built.** The **Actual Result** and
> **Pass/Fail Status** columns are empty and read *Not run* for all 22 rows.
>
> **A row may only be marked Pass when an actual observed result is written and an
> evidence ID is attached.** A row without evidence is **Not run**, never **Pass**.
> Writing "Pass" in a status column with nothing in Actual Result is a false claim
> about work that was never performed, and it is the single most damaging thing this
> document could contain.

---

## Table of contents

1. [How to complete a row](#1-how-to-complete-a-row)
2. [Mandatory scenario coverage map](#2-mandatory-scenario-coverage-map)
3. [The test matrix](#3-the-test-matrix)
4. [Test procedure notes, row by row](#4-test-procedure-notes-row-by-row)
5. [Evidence register](#5-evidence-register)
6. [Preconditions before executing the matrix](#6-preconditions-before-executing-the-matrix)
7. [Result summary](#7-result-summary)
8. [Sign-off](#8-sign-off)

---

## 1. How to complete a row

### 1.1 Column meanings

| Column | What goes in it |
|---|---|
| **Test ID** | The stable identifier. Never renumber; add new rows with new IDs. |
| **Test Scenario** | One line naming what is being verified. |
| **Input / Condition** | Exactly what you will do or change, precisely enough that someone else could repeat it. "Disconnected" is not a condition; "pull the BMP280 SDA jumper while the zone is closed" is. |
| **Expected Result** | The behaviour the design predicts. Written **before** the test is run. |
| **Actual Result** | **What you observed.** Blank until run. Include the observed value, not a paraphrase of the expectation. |
| **Pass / Fail Status** | `Not run` until executed. Then `Pass` or `Fail` — and a `Fail` is a legitimate, valuable result. |
| **Evidence** | One or more IDs from §5. Required for a `Pass`. |

### 1.2 Rules for the status column

| Situation | Correct entry |
|---|---|
| Test not yet performed | **Not run**, Actual Result blank |
| Test performed, expectation met, evidence attached | **Pass**, with the evidence ID |
| Test performed, expectation not met | **Fail**, with the evidence ID **and** a description of the observed behaviour |
| Test performed, evidence artifact lost or not captured | **Not run** — an unverifiable result is not a result |
| Test performed, expectation partly met | **Fail**, with the detail. Partial credit belongs in the narrative, not in the status. |

> **A `Fail` row is worth more than a fabricated `Pass` row.** It is actionable, it
> is honest, and it is what an evaluator is looking for. A row marked Pass with an
> empty Actual Result tells a reviewer the matrix was filled in rather than worked.

### 1.3 Rules for the evidence column

| Rule | Reason |
|---|---|
| Attach an evidence ID to every Pass **and** every Fail | Both outcomes need to be checkable |
| Evidence must be a **real artifact**: a log file, a photograph with a reading visible, a video clip, a measurement capture | A claim without an artifact is not evidence |
| A screenshot with no clock and no reading visible proves very little | Include the timestamp and the measured value in frame |
| A video clip must show the clock **or** the serial log alongside | "It alerted" is not demonstrable without timing |
| Never attach the same artifact to more rows than it actually demonstrates | One screenshot of a boot log is not evidence for nine scenarios |

---

## 2. Mandatory scenario coverage map

Every scenario SRS §1.6-xxi names as a mandatory minimum is covered.

| # | Mandatory scenario (SRS wording) | Test row(s) | Covered |
|---|---|---|---|
| 1 | Normal temperature/humidity/gas sensor readings | **T-01** | ✔ |
| 2 | High temperature | **T-02** | ✔ |
| 3 | Abnormal humidity | **T-03** | ✔ |
| 4 | Abnormal gas reading | **T-04** | ✔ |
| 5 | Door left open beyond the configured timeout | **T-05** | ✔ |
| 6 | Use Soon condition | **T-06** | ✔ |
| 7 | Check Food condition | **T-07** | ✔ |
| 8 | Invalid / disconnected sensor, and 'Sensor Fault/Data Unavailable' status verification | **T-08**, **T-21** | ✔ |
| 9 | Temporary network failure | **T-11** | ✔ |
| 10 | Network reconnection, buffered-event synchronisation, and duplicate-prevention verification | **T-12**, **T-13** | ✔ |
| 11 | Local alert verification | **T-14** | ✔ |
| 12 | Remote notification verification | **T-15** | ✔ |
| 13 | Freshness Decision Rule verification | **T-16** | ✔ |

**Additional rows beyond the mandatory minimum** (project additions, not SRS
requirements): T-09 single-bad-transaction rejection, T-10 gas warm-up and
baseline, T-17 storage/admin fault non-masking, T-18 clock retention across power
loss, T-19 storage persistence, T-20 item registration and update, T-22 network
reconnect without a reboot.

**Thirteen mandatory scenarios, 22 rows, all currently `Not run`.**

---

## 3. The test matrix

| Test ID | Test scenario | Input / Condition | Expected Result | Actual Result | Pass / Fail Status | Evidence |
|---|---|---|---|---|---|---|
| **T-01** | **Normal readings** | Zone closed, at steady state, all sensors healthy, gas baseline `ready`, at least one item registered with a window far from its deadline | Zone status Fresh/Normal; green LED; temperature, pressure and humidity displayed; gas baseline and delta displayed in **millivolts**; ThingSpeak fields 1–8 populated | *(blank)* | **Not run** | EV-1, EV-7, EV-22 |
| **T-02** | **High temperature** | Introduce a warm object into the closed zone and hold it until the reading exceeds the configured maximum for 3 consecutive samples | `temperature_high` alert raised; red LED solid; buzzer within **2–5 s of confirmation** (roughly 10–15 s from the start of a sustained excursion, at the 5 s poll cadence with 3-sample confirmation); event queued; notification delivered; message reports the observed temperature and the prototype maximum | *(blank)* | **Not run** | EV-10 |
| **T-03** | **Abnormal humidity** | Breath, or place a damp cloth in the closed zone, until humidity exceeds the configured maximum for 3 consecutive samples. **The DHT11 DATA pull-up must be fitted first, or the excursion cannot be produced at all.** | `humidity_high` alert raised; red LED solid; buzzer; event queued; notification delivered | *(blank)* | **Not run** | EV-11, EV-24 |
| **T-04** | **Abnormal gas reading** | Introduce a recorded, food-safe vapour source into the closed zone and hold it until the AIN0 delta exceeds the configured threshold | `gas_relative_high` alert raised; message reports **millivolts and a delta — never ppm**; red LED solid; buzzer; event queued; notification delivered; AIN0 remained below the 3300 mV ceiling throughout | *(blank)* | **Not run** | EV-5, EV-8 |
| **T-05** | **Door left open beyond timeout** | Remove the magnet and hold the door open past the configured 30 s timeout; then keep it open for a further 60 s; then close and re-open | Exactly **one** `door_open` alert per open cycle — not repeated while held; buzzer; LCD alert overlay; event queued. A second alert fires only after close and re-open. Status itself is **unchanged** by the door event. | *(blank)* | **Not run** | EV-12 |
| **T-06** | **Use Soon condition** | Register an item with a near-future expiry so the window closes within the demo session; let elapsed time cross 75 % of the window; keep environmental readings normal | Yellow LED; overall status Use Soon; `food_use_soon` alert queued and delivered; the zone verdict remains Fresh/Normal on the status report | *(blank)* | **Not run** | EV-17 |
| **T-07** | **Check Food condition** | Let the same item's window close; keep environmental readings normal | Red LED solid; overall status Check Food; `food_check` alert queued and delivered; message names the item and asks for inspection — **not** "discard" and **not** "unsafe" | *(blank)* | **Not run** | EV-17 |
| **T-08** | **Invalid / disconnected sensor** | With the zone closed and readings healthy, disconnect one sensor (for example pull the BMP280 SDA jumper) and leave it disconnected | After 3 consecutive failed samples: status becomes **Sensor Fault / Data Unavailable**; red LED **blinks**; green and yellow off; `sensor_fault` alert names the affected sensor; **a misleading green is never shown** | *(blank)* | **Not run** | EV-14 |
| **T-09** | **Single bad transaction** | Wiggle a sensor connector or briefly disturb one bus transaction, affecting **one** sample only, then restore it | **No alert raised**; the 3-sample confirmation prevents a false positive; a transient does not set a confirmed fault bit | *(blank)* | **Not run** | EV-15 |
| **T-10** | **Gas warm-up and baseline capture** | Power-cycle and observe the first ~90 s | Status shows **Data Unavailable** with a progress count during warm-up and baseline capture; **no remote sensor-fault notification is sent** at any point during warm-up; the transmitted fault mask stays clear while the display reports unavailable; state reaches `ready` with a baseline in millivolts | *(blank)* | **Not run** | EV-7 |
| **T-11** | **Temporary network failure** | With credentials configured, disable the access point while the zone is healthy | Local sensing, freshness analysis, and local alerts **continue without interruption**; events queue locally; `QUEUECOUNT` rises; the device does not reboot or stall; the freshness status is unaffected by the outage | *(blank)* | **Not run** | EV-16 |
| **T-12** | **Network reconnection and buffered sync** | Restore the access point with events pending | Queued events drain in **best-effort slot order** — **not** strict FIFO; every event is delivered with a unique `event_id` for normal operation; **no event is lost**; `QUEUECOUNT` falls to zero; the device continued monitoring throughout | *(blank)* | **Not run** | EV-17 |
| **T-13** | **Duplicate prevention** | With the T-12 events delivered, compare the received notifications against the queued event IDs and the serial log | Each delivered notification carries the `event_id` recorded for that event; any repeated `event_id` is identifiable as a duplicate; the device does not reuse an ID within normal operation or after a reset; if a 2xx was received but local removal failed, the event is **deliberately retained** and a duplicate is produced in preference to a silent loss — and that is the documented, intended behaviour | *(blank)* | **Not run** | EV-17 |
| **T-14** | **Local alert verification** | Trigger each alert class in turn: temperature, humidity, gas, door, item use-soon, item check, sensor fault | For each class: the correct LED state, the correct LCD alert text on the overlay, and the buzzer all fire within **2–5 s of confirmation**; the overlay pre-empts paging for its full duration; the buzzer completes its three-beep pattern and returns to silence | *(blank)* | **Not run** | EV-10, EV-11, EV-12 |
| **T-15** | **Remote notification verification** | With both credentials and both verified fingerprints configured, trigger one alert of each class | Each alert produces a notification carrying the correct `event_id`, the correct alert type token, and the correct human-readable message; no `gas` notification contains ppm or a concentration; events are cleared from the queue only after a 2xx response | *(blank)* | **Not run** | EV-17 |
| **T-16** | **Freshness Decision Rule verification** | Reproduce each of R-01 … R-13 from [`FRESHNESS_DECISION_RULE_MATRIX.md`](./FRESHNESS_DECISION_RULE_MATRIX.md), including the override and non-masking cases | The observed status matches the matrix row **exactly**, including: R-09 overriding a Check Food verdict; R-10 leaving the freshness status unchanged; R-11 producing no remote alert; R-12 firing once per open cycle | *(blank)* | **Not run** | EV-14, EV-17 |
| **T-17** | **Storage/admin fault non-masking** | With the access point disabled, raise alerts until all 24 queue slots are full; then restore the network | A `storage_fault` alert is raised and identifies the storage/admin class; the **freshness status is unchanged**; the overflow alert is **local-only** and is not itself queued; the recursion breaks after **one** alert rather than cascading | *(blank)* | **Not run** | EV-20 |
| **T-18** | **Clock retention across power loss** | Set the clock with `RTCEPOCH`; remove USB for 60 s; restore power | The clock is retained and still trusted; `STATUS` reports the time as ready; storage durations remain correct; no `sensor_fault` is raised for the clock | *(blank)* | **Not run** | EV-4 |
| **T-19** | **Storage persistence** | Register an item, capture a gas baseline, raise one queued event, then power-cycle | Inventory, the alert queue, and the gas baseline all reload and validate on boot; `LIST`, `QUEUECOUNT`, and `BASELINE` report the same data as before the power cycle; no data loss; an invalid file is left untouched for recovery rather than silently cleared | *(blank)* | **Not run** | EV-19 |
| **T-20** | **Item registration and update** | Register a new item; then re-register the **same** UID with different metadata | The store date is **preserved** on update; the item count does **not** increase; the metadata is updated; the original store date is unchanged, so an accidental re-registration cannot reset the item's age | *(blank)* | **Not run** | EV-19 |
| **T-21** | **Sensor-fault recovery** | With a sensor disconnected (from T-08), reconnect it | After 3 consecutive good samples the fault clears and the status returns to a food verdict; for the gas path specifically, a **new baseline is required** before its data is trusted again; the status does not return to a misleading green before that | *(blank)* | **Not run** | EV-14 |
| **T-22** | **Network reconnect without a reboot** | Cycle the access point while the device is running and healthy, with and without pending events | Monitoring resumes unattended with no reboot; queued events drain; the local alert path was never interrupted; reconnection is automatic without a serial command | *(blank)* | **Not run** | EV-18 |

---

## 4. Test procedure notes, row by row

These notes are **preparation**, not results. They exist so each row is executed
the same way twice.

### T-01 — Normal readings

- Allow the gas path to reach `ready` before starting. Roughly 60 s with a valid
  persisted baseline, otherwise roughly 90 s.
- At least one item must be registered, or Use Soon can never occur and the
  overall status equals the zone status.
- Record the observed temperature, pressure, humidity, gas baseline in
  **millivolts**, and delta. Do not record a gas concentration.
- Confirm all eight telemetry fields are populated, and that field 8 shows no
  sensor bits.

### T-02 — High temperature

- Start timing from the **first** sample that exceeds the maximum, and also record
  the time to **confirmation**. Both numbers go in the Actual Result.
- Hold the warm object in place; do not remove it during the confirmation window,
  or the latch will not arm.
- Record the exact temperature at which the alert fired and the configured maximum
  it exceeded.

### T-03 — Abnormal humidity

- **Check the DHT11 DATA pull-up before this test.** Without it, humidity reads as
  permanently unavailable and the excursion cannot be produced. A failing T-03 with
  a healthy DHT11 is usually a missing pull-up, not a logic fault.
- Breath is the simplest source; a damp cloth gives a larger, more controllable
  excursion. Record which was used.
- Note that humidity hysteresis is ±5 % RH, so the value must clear the limit by
  more than that to behave predictably.

### T-04 — Abnormal gas reading

- Record the vapour source and **confirm it is safe to use in a food-storage
  area**. Do not use a solvent near food.
- Record the peak AIN0 value and the peak delta. The peak value must stay below
  the 3300 mV ceiling — if it does not, the divider values are wrong and the
  divider row in the calibration table must be updated.
- The expected result explicitly forbids ppm in the message. Check the delivered
  notification text for it.
- If this test never fires, the configured delta threshold is probably above the
  excursion actually produced. That is a real finding; record the observed delta
  and revisit the threshold in the calibration table rather than declaring the
  test a pass.

### T-05 — Door left open

- The critical observation is **how many** alerts fire. One per open cycle.
- Hold the door open for at least 60 s past the timeout to prove it does not
  repeat.
- Also record that the **status itself did not change** because of the door.
  A door-open event is an alert, not a food verdict.

### T-06 and T-07 — Use Soon and Check Food

- Items cannot be backdated. To reach both states in one session, register an item
  with a **near-future expiry epoch** so the store date is *now* and the window is
  short. This uses only the documented registration command.
- Verify the **store date** reported for the item matches registration time.
- For T-07, check the delivered message text asks for **inspection**. A message
  saying "discard" or "unsafe" is a defect in the messaging, not a pass.

### T-08 — Invalid / disconnected sensor

- Disconnect a sensor that the availability mask treats as required — the
  temperature sensor is the clearest choice.
- Wait for the full 3-sample confirmation window before concluding anything.
- The single most important observation: **a green LED must never appear** while
  a required input is faulted. If green appears at any moment, that is a Fail.

### T-09 — Single bad transaction

- Disturb **one** sample only, then restore. The whole point is that a single bad
  transaction must not raise an alert.
- Also confirm that no fault bit is set in the transmitted mask afterwards.
- This is the row that demonstrates the averaging and consecutive-reading
  validation that SRS §1.6-v requires.

### T-10 — Gas warm-up and baseline

- Power-cycle and start the timer immediately.
- Watch for **any** remote notification during the first ~90 s. A
  `sensor_fault` notification during warm-up is a Fail.
- Also record the discrepancy a chart will show: the display says Data
  Unavailable while the transmitted fault mask is clear. This is intended.
- Record the time to `ready` in both cases: with and without a persisted baseline.

### T-11 — Temporary network failure

- Disable the access point **without** rebooting the device.
- The load-bearing observation is that the **local alert path keeps working**.
  Trigger a threshold violation during the outage and prove the buzzer and LED
  still respond.
- Record `QUEUECOUNT` before and after. It must rise.
- Confirm the freshness status was unaffected by the outage.

### T-12 — Reconnection and buffered sync

- Record the number of events queued during the outage, and the number delivered
  after reconnection. **Every queued event must be delivered.**
- Record the order they arrived in. Do **not** claim it was FIFO — the queue is a
  fixed array scanned linearly, so ordering is best-effort by slot index. The
  honest statement is that the receiver must not depend on order.
- Confirm `QUEUECOUNT` reaches zero.

### T-13 — Duplicate prevention

- Build a table of `event_id` → alert type from the serial log, and compare it
  against the delivered notifications.
- The device does not reuse an ID after a reset, and IDs are reserved before the
  slot write. Note honestly that the 32-bit counter has a **theoretical** wrap
  boundary; the claim to verify is "unique for normal operation", not
  "provably never collides".
- If a duplicate **is** observed, check whether the log shows a 2xx followed by a
  failed local removal. That case deliberately retains the event to avoid a silent
  loss. Document it as intended behaviour, not as a defect.

### T-14 — Local alert verification

- Work through every alert class and record, for each: which LED state, whether the
  buzzer sounded, and the exact LCD overlay text.
- Confirm the buzzer returns to silence after its pattern rather than latching on.
- Measure the time **from confirmation** and record it separately from the time
  from the start of the excursion.

### T-15 — Remote notification verification

- Requires both credentials **and** both verified fingerprints. Without them the
  firmware is disabled by construction and will refuse to attempt a request.
  That refusal is itself worth recording as evidence for the interlock test.
- Check each notification for the correct `event_id`, type token, and message.
- Check that no notification contains a gas concentration.
- Confirm events are cleared only after a 2xx.

### T-16 — Freshness Decision Rule verification

- This is the longest row. Work through R-01 … R-13 in order from
  [`FRESHNESS_DECISION_RULE_MATRIX.md`](./FRESHNESS_DECISION_RULE_MATRIX.md).
- The three cases that matter most:
  - **R-09 overriding Check Food** — disconnect a sensor while an item is past its
    limit. Sensor Fault must win.
  - **R-10 not masking** — raise a storage fault while an item is past its limit.
    The status must stay Check Food.
  - **R-11 producing no remote alert** — power-cycle and confirm silence.
- Record the observed status for each rule next to the expected status.

### T-17 — Storage/admin fault non-masking

- Fill all 24 slots by disabling the network and raising more than 24 alerts.
- The key observation is **exactly one** storage-fault alert, not a cascade.
- Confirm the freshness status is unchanged throughout.
- Confirm the overflow alert is presented **locally only** and the serial log
  records that it was not queued.

### T-18 — Clock retention

- The 60 s removal window is a real test of the backup cell.
- Confirm the clock is **trusted** on return, not merely present. A clock that
  returned but is not trusted produces a `sensor_fault`, which fails this row.

### T-19 — Storage persistence

- Do not power-cycle immediately after writing; LittleFS is synchronous in this
  design but the boot-time validation is what you are testing.
- Confirm the gas baseline reloads **and matches** the current configuration
  fingerprint. If the divider values changed since capture, the baseline is
  correctly invalidated — that is a Pass with a different explanation, not a Fail.

### T-20 — Item registration and update

- Record the store date immediately after the first registration.
- Re-register the same UID with different metadata.
- The store date must be **identical**. A changed store date is a Fail, because
  an accidental re-registration must not be able to reset an item's age.

### T-21 — Sensor-fault recovery

- Reconnect the sensor from T-08 and wait for 3 consecutive good samples.
- For the gas path specifically, confirm a **new baseline** is required before the
  data is trusted. Returning straight to Fresh from a faulted gas state would be a
  Fail.

### T-22 — Network reconnect without a reboot

- Cycle the access point while running, with and without pending events.
- Confirm the device re-associates automatically, with **no** serial command and
  **no** reboot. Record whether the serial log shows a disconnect and a reconnect
  without a boot banner between them.

---

## 5. Evidence register

| ID | Evidence item | What it proves | Method | Artifact |
|---|---|---|---|---|
| **EV-1** | I²C bus scan output at boot | All five I²C addresses answer; no address collision | Serial log at 115200 | Log file or screenshot |
| **EV-2** | 3.3 V rail reading, idle and during a Wi-Fi upload | Rail capacity holds under transmit peaks | Meter, plus a capture of the upload window | Photo with the reading visible |
| **EV-3** | DS3231 charging path disabled | No charging current can reach the CR2032 | Continuity / diode mode **before power is applied** | Photo of the modified board plus a meter reading |
| **EV-4** | Clock retention across a power cycle | SRS §1.6-ix satisfied | `RTCEPOCH`, power-cycle, `STATUS` | Log excerpt |
| **EV-5** | AIN0 reading across heater start-up | AIN0 stays below the 3300 mV ceiling | Scope or meter during warm-up | Screenshot with the reading visible |
| **EV-6** | Fitted divider values measured | The compiled divider constants correspond to real parts | Multimeter in Ω mode, both resistors | Photo with the reading visible |
| **EV-7** | Baseline record | The calibration table is populated from a real capture | `BASELINE` output plus 10 samples | Log excerpt plus the completed table |
| **EV-8** | Gas excursion test | The delta threshold raises a `gas_relative_high` alert | Deliberate, food-safe vapour source in the zone | Video clip plus log |
| **EV-9** | Level-shifter identification and idle levels | The shifter is bidirectional and correctly referenced | Part marking plus idle SDA/SCL on both sides | Photo plus meter reading |
| **EV-10** | Temperature excursion | A confirmed violation raises red LED, buzzer, and a queued alert within 2–5 s **of confirmation** | Warm object in the zone | Video clip showing a clock |
| **EV-11** | Humidity excursion | As above. The DHT11 pull-up must be fitted first. | Breath or a damp cloth in the zone | Video clip |
| **EV-12** | Door-left-open test | A `door_open` alert after the configured timeout, fired once per open cycle | Remove the magnet; time it | Video clip plus log |
| **EV-13** | Reed bounce test | No false door transitions | Rapid magnet movement | Log excerpt |
| **EV-14** | Sensor-disconnect test | `Sensor Fault / Data Unavailable`, **not** a misleading green | Disconnect one sensor | Video clip plus log |
| **EV-15** | Alert-sensitivity test | A single bad transaction does **not** raise a remote fault alert | Wiggle a connector | Log excerpt |
| **EV-16** | Network-failure test | Local alerts continue; events queue; `QUEUECOUNT` rises | Disable the access point | Log plus `QUEUECOUNT` output |
| **EV-17** | Reconnection and buffered sync | Events drain; none is lost; duplicates identifiable by `event_id` | Restore the access point | Log plus per-event notification captures |
| **EV-18** | Wi-Fi reconnect without a reboot | Monitoring resumes unattended | Restore the access point while running | Log excerpt |
| **EV-19** | Storage persistence | Records survive a power cycle and are validated | Power-cycle, then `LIST` / `QUEUECOUNT` / `BASELINE` | Log excerpt |
| **EV-20** | Queue-full behaviour | The overflow alert is local-only and does not recurse | Fill all 24 slots offline | Log excerpt |
| **EV-21** | Demonstration video | Mandatory SRS §1.9 deliverable | — | Video file |
| **EV-22** | Storage environment photograph | Which environment was used, and the mounting arrangement | Photograph | Image file |
| **EV-23** | Board silkscreen photograph | The silkscreen agrees with the authoritative GPIO map | Photograph | Image file |
| **EV-24** | DHT11 DATA idle level | The pull-up is present and the line is not floating | Meter with the ESP8266 powered | Photo with the reading visible |
| **EV-25** | Core and library version record | The report states the versions that were actually compiled | Build output | Text capture |
| **EV-26** | Serial log, full session | The complete, untruncated source of zone status, overall status, and per-sensor readiness | Continuous capture at 115200 for the whole test session | Log file |
| **EV-27** | Enablement-interlock log | Both cloud paths refuse to transmit until a key **and** a verified fingerprint are supplied | Boot log with placeholders in place | Log excerpt |

> **EV-26 is the highest-value artifact in this register.** The serial status line
> is the complete, untruncated source of truth. A full-session log supports many
> rows at once — but only for what it actually shows.

> **EV-27 records a negative result.** The interlock working means the system
> *refuses* to transmit. That refusal is evidence of a security control, and it is
> worth capturing before you enable anything.

---

## 6. Preconditions before executing the matrix

Do not begin T-01 until every line below is satisfied. A precondition failure
produces a cascade of confusing row failures.

| # | Precondition | Why | Reference |
|---|---|---|---|
| 1 | **DS3231 charging path disabled and verified open** | A venting coin cell in a refrigerator is a chemical-safety incident | [`WIRING_AND_PIN_MAP.md` §9](./WIRING_AND_PIN_MAP.md) |
| 2 | **Level-shifter part identified**; LCD powered only after verification | An unknown part on a live 3.3 V bus | [`WIRING_AND_PIN_MAP.md` §7](./WIRING_AND_PIN_MAP.md) |
| 3 | **Board silkscreen confirmed** against the authoritative GPIO map | Every bus and every test result depends on it | [`WIRING_AND_PIN_MAP.md` §2](./WIRING_AND_PIN_MAP.md) |
| 4 | **No 5 V on any GPIO**; ESP8266-side I²C pull-ups reference 3.3 V | The controller is not 5 V tolerant | [`WIRING_AND_PIN_MAP.md` P4, P12](./WIRING_AND_PIN_MAP.md) |
| 5 | **DHT11 DATA pull-up fitted and idle level verified** | Without it, T-03 is impossible and humidity is permanently unavailable | [`WIRING_AND_PIN_MAP.md` §8](./WIRING_AND_PIN_MAP.md) |
| 6 | **MQ-135 supply voltage measured and recorded** | The gas baseline is not comparable without it | [`CALIBRATION_BASELINE.md` CB-G1](./CALIBRATION_BASELINE.md) |
| 7 | **Divider values measured** | Divider values are fingerprinted into the baseline record | [`CALIBRATION_BASELINE.md` CB-G2, CB-G3](./CALIBRATION_BASELINE.md) |
| 8 | **Gas abnormal delta tuned or explicitly accepted as an assumption** | An untuned threshold either flaps or never fires | [`CALIBRATION_BASELINE.md` CB-G13](./CALIBRATION_BASELINE.md) |
| 9 | **RTC clock set and trusted** | Registration is blocked without it; T-06, T-07 and T-18 depend on it | Installation procedure |
| 10 | **At least one item registered** | Use Soon is unreachable with an empty inventory | Installation procedure |
| 11 | **A demo item with a short window registered** | Items cannot be backdated; T-06 and T-07 need a short window | [`FRESHNESS_DECISION_RULE_MATRIX.md` §8](./FRESHNESS_DECISION_RULE_MATRIX.md) |
| 12 | **Both cloud credentials and both verified fingerprints configured** | T-15 is impossible without them; the firmware refuses to transmit otherwise | [`../README.md` §8](../README.md) |
| 13 | **Serial logging enabled for the whole session** | The status line is the complete evidence source | Evidence register |
| 14 | **Core and library versions recorded** | The report must state what was actually compiled | Evidence register EV-25 |
| 15 | **Food-safety disclaimer agreed** | Nothing in this matrix certifies safety | Every document in this package |

---

## 7. Result summary

> **Current state: no test has been executed.**

| Metric | Value |
|---|---|
| Total rows | 22 |
| Mandatory SRS scenarios covered | 13 of 13 |
| Rows executed | **0** |
| Rows passing | **0** |
| Rows failing | **0** |
| Rows not run | **22** |
| Evidence artifacts collected | **0** |
| Mandatory demonstration video captured | **No** — EV-21 outstanding |

### 7.1 Completion table — fill after execution

| Test ID | Scenario | Status | Evidence | Tested by | Date |
|---|---|---|---|---|---|
| T-01 | Normal readings | Not run | | | |
| T-02 | High temperature | Not run | | | |
| T-03 | Abnormal humidity | Not run | | | |
| T-04 | Abnormal gas reading | Not run | | | |
| T-05 | Door left open beyond timeout | Not run | | | |
| T-06 | Use Soon condition | Not run | | | |
| T-07 | Check Food condition | Not run | | | |
| T-08 | Invalid / disconnected sensor | Not run | | | |
| T-09 | Single bad transaction | Not run | | | |
| T-10 | Gas warm-up and baseline | Not run | | | |
| T-11 | Temporary network failure | Not run | | | |
| T-12 | Reconnection and buffered sync | Not run | | | |
| T-13 | Duplicate prevention | Not run | | | |
| T-14 | Local alert verification | Not run | | | |
| T-15 | Remote notification verification | Not run | | | |
| T-16 | Decision rule verification | Not run | | | |
| T-17 | Storage/admin fault non-masking | Not run | | | |
| T-18 | Clock retention across power loss | Not run | | | |
| T-19 | Storage persistence | Not run | | | |
| T-20 | Item registration and update | Not run | | | |
| T-21 | Sensor-fault recovery | Not run | | | |
| T-22 | Network reconnect without a reboot | Not run | | | |

---

## 8. Sign-off

| Item | Status | Name | Date |
|---|---|---|---|
| All 15 preconditions in §6 satisfied and recorded | | | |
| Every mandatory scenario in §2 executed | | | |
| Every row has an actual observed result — no expectation copied into the result column | | | |
| Every Pass row has an evidence ID attached | | | |
| Every Fail row has an evidence ID and a written explanation | | | |
| No row is marked Pass with an empty Actual Result | | | |
| T-16 completed against all 13 decision rules | | | |
| T-12 and T-13 completed, with the ordering claim stated honestly | | | |
| No gas notification contains a concentration, ppm, or ppm-equivalent | | | |
| No row or result claims a food-safety determination | | | |
| Demonstration video captured and filed (EV-21) | | | |
| Core and library versions recorded (EV-25) | | | |

### 8.1 Statement to include in the project report

> *The IoT Test Matrix was executed on the dates recorded per row. Each row
> reports an observed result and the evidence artifact that supports it. Rows that
> did not meet their expected result are reported as Fail with an explanation;
> none has been re-labelled. A row was marked Pass only when an actual result was
> recorded and an evidence artifact was attached. The gas path reports
> millivolts at the ADC input and a delta from a stored baseline; no test, result,
> or notification in this matrix asserts a gas concentration. No result in this
> matrix constitutes a food-safety determination.*

---

## Cross-references

| Document | Relationship |
|---|---|
| [`../README.md`](../README.md) | The demonstration flow in §10 is the narrative form of T-01 … T-17 |
| [`../FOOD_STORAGE_ARCHITECTURE.md`](../FOOD_STORAGE_ARCHITECTURE.md) | §14 is the upstream evidence register; §15.4 the upstream matrix template |
| [`FRESHNESS_DECISION_RULE_MATRIX.md`](./FRESHNESS_DECISION_RULE_MATRIX.md) | T-16 verifies all 13 rules in that document |
| [`CALIBRATION_BASELINE.md`](./CALIBRATION_BASELINE.md) | Preconditions 6–8; the EV-6, EV-7, EV-8 artifacts |
| [`WIRING_AND_PIN_MAP.md`](./WIRING_AND_PIN_MAP.md) | Preconditions 1–5; the EV-3, EV-9, EV-23, EV-24 artifacts |
| [`FOOD_THRESHOLD_MATRIX.md`](./FOOD_THRESHOLD_MATRIX.md) | Supplies the threshold values T-02, T-03 and T-04 exercise |
| [`INSTALLATION_AND_EXECUTION.md`](./INSTALLATION_AND_EXECUTION.md) | The procedure that produces a system in the state this matrix tests |

---

*FreshGuard — IoT Test Matrix. ESP8266MOD prototype.*
*No test has been executed. Every row reads "Not run" with a blank actual result.
No hardware testing is claimed or implied.*
