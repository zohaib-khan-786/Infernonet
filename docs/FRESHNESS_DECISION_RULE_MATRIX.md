# FreshGuard — Freshness Decision Rule Matrix

> **SRS requirement:** §1.6-xi — *"Teams should prepare a Freshness Decision Rule
> Matrix defining how combinations of temperature, humidity, gas, storage-duration
> and expiry conditions result in Fresh/Normal, Use Soon or Check Food status."*
> **Deliverable:** SRS §1.9 requires a **Freshness Decision Rule Matrix**.

> ## ⚠ What "pre-filled" means here
>
> These 13 rules are transcribed from the firmware's actual decision logic, which
> is the authoritative implementation. They describe **what the code does**, not
> what a reviewer wishes it did.
>
> **No rule in this matrix has been executed on hardware.** Verification is the job
> of row **T-16** in [`IOT_TEST_MATRIX.md`](./IOT_TEST_MATRIX.md), which reads
> *Not run* until someone runs it.
>
> **Nothing here is a food-safety determination.** The worst outcome any rule can
> produce is *Check Food — requires human inspection*.

---

## Table of contents

1. [The four statuses and their severity order](#1-the-four-statuses-and-their-severity-order)
2. [Precedence — the rule that governs all other rules](#2-precedence--the-rule-that-governs-all-other-rules)
3. [The 13 decision rules](#3-the-13-decision-rules)
4. [Rule R-09 — required sensor fault](#4-rule-r-09--required-sensor-fault)
5. [Rule R-10 — storage and admin faults never mask a food verdict](#5-rule-r-10--storage-and-admin-faults-never-mask-a-food-verdict)
6. [Rule R-11 — warm-up and baseline are display-only](#6-rule-r-11--warm-up-and-baseline-are-display-only)
7. [Rule R-12 — the door rule](#7-rule-r-12--the-door-rule)
8. [Rules R-01 to R-03 — the item duration rules](#8-rules-r-01-to-r-03--the-item-duration-rules)
9. [Rule R-13 — the untrustworthy clock](#9-rule-r-13--the-untrustworthy-clock)
10. [Where a status can come from](#10-where-a-status-can-come-from)
11. [Alert type vocabulary](#11-alert-type-vocabulary)
12. [Timing mechanisms behind the rules](#12-timing-mechanisms-behind-the-rules)
13. [The three masks, and why conflating them makes a chart lie](#13-the-three-masks-and-why-conflating-them-makes-a-chart-lie)
14. [Verifying the matrix](#14-verifying-the-matrix)
15. [Known consequences an evaluator should know](#15-known-consequences-an-evaluator-should-know)

---

## 1. The four statuses and their severity order

SRS §1.6-xi defines three freshness conditions. SRS §1.6-vii and §1.6-xvi
additionally require a **separate data-quality state** that must never be
presented as *Fresh/Normal*. The firmware therefore implements **four** statuses
in a fixed severity order.

| Rank | Status | Meaning | Indicator | Local action | SRS basis |
|---|---|---|---|---|---|
| **3** | **Sensor Fault / Data Unavailable** | At least one required input is faulted, or has not yet produced data. The verdict is *unknown*, not *good*. | Red LED **blinks**; green and yellow off | Buzzer + LCD naming the affected inputs | §1.6-vii, §1.6-xvi |
| **2** | **Check Food** | Human inspection required — a confirmed environmental threshold violation, or an item at or past its expiry or duration limit. | Red LED solid | Buzzer + LCD alert | §1.6-xi |
| **1** | **Use Soon** | An item has passed 75 % of its storage-duration or expiry window. | Yellow LED | Queued `food_use_soon` alert | §1.6-xi |
| **0** | **Fresh / Normal** | All monitored conditions are inside the configured acceptable range. | Green LED | None | §1.6-xi |

**The severity order is the whole point.** The most severe status wins. A real
required-sensor fault therefore overrides a *Fresh* reading **and** a *Check Food*
reading. When data is missing, FreshGuard says so rather than guessing — which is
exactly what §1.6-vii demands, and it is why *"any real required-sensor fault
overrides Fresh"* holds **by construction** rather than by special case.

---

## 2. Precedence — the rule that governs all other rules

```text
   ┌──────────────────────────────────────────────────────────────────┐
   │  IS ANY REQUIRED INPUT FAULTED OR NOT YET PRODUCING DATA?       │  ← R-09, R-11, R-13
   │                                                                  │
   │      YES ──────────────────────────────────────────────┐         │
   │                                                        ▼         │
   │                                            ┌────────────────────┐  │
   │                                            │  Sensor Fault /    │  │
   │  NO ───┐                                    │  Data Unavailable  │  │
   │         ▼                                    │  RED BLINKS        │  │
   │  ┌──────────────────────────────┐            └────────────────────┘  │
   │  │ ANY CONFIRMED ENVIRONMENTAL  │  YES ──▶  ┌────────────────────┐  │
   │  │ THRESHOLD LATCH ACTIVE?      │           │  Check Food        │  │
   │  └──────────────┬───────────────┘           │  RED SOLID + BUZZER│  │
   │            NO   │                           └────────────────────┘  │
   │                 ▼                                                  │
   │  ┌──────────────────────────────┐  YES ──▶  ┌────────────────────┐  │
   │  │ ANY ITEM AT OR PAST ITS      │           │  Check Food        │  │
   │  │ EXPIRY OR DURATION LIMIT?    │           └────────────────────┘  │
   │  └──────────────┬───────────────┘                                  │
   │            NO   │                                                  │
   │                 ▼                                                  │
   │  ┌──────────────────────────────┐  YES ──▶  ┌────────────────────┐  │
   │  │ ANY ITEM PAST 75% OF ITS     │           │  Use Soon          │  │
   │  │ WINDOW?                      │           │  YELLOW            │  │
   │  └──────────────┬───────────────┘           └────────────────────┘  │
   │            NO   │                                                  │
   │                 ▼                                                  │
   │            ┌────────────────────┐                                 │
   │            │  Fresh / Normal   │                                 │
   │            │  GREEN            │                                 │
   │            └────────────────────┘                                 │
   └──────────────────────────────────────────────────────────────────┘
                                │
   INDEPENDENTLY, in the same cycle ──▶ storage/admin fault is reported
   as a SEPARATE condition and changes NONE of the above.  ← R-10
```

### 2.1 Precedence in one sentence

> **A required-sensor fault outranks every food verdict, including Check Food.
> A storage or admin fault is a separate channel that changes no food verdict at
> all — not even by masking one.**

### 2.2 Precedence table

| Priority | Condition | Resulting status | Can anything below it change the outcome? |
|---|---|---|---|
| 1 | Any required input faulted or unavailable | **Sensor Fault / Data Unavailable** | **No.** This overrides everything, including Check Food. |
| 2 | Any confirmed environmental threshold latch | **Check Food** | No. Item rules can only match, never downgrade. |
| 3 | Any item at or past its expiry or duration limit | **Check Food** | No. |
| 4 | Any item past 75 % of its window | **Use Soon** | No. |
| 5 | Nothing above applies | **Fresh / Normal** | — |
| — | Any storage or admin fault | **Unchanged** | Never masks anything above. |

### 2.3 What "most severe wins" means in practice

| Situation | Zone verdict | Item verdict | **Overall status** | Why |
|---|---|---|---|---|
| All readings in range, one item at 40 % of its window | Fresh/Normal | Fresh/Normal | **Fresh / Normal** | Nothing to escalate |
| All readings in range, one item at 80 % | Fresh/Normal | Use Soon | **Use Soon** | The item escalates the overall status |
| Temperature confirmed high, all items fresh | Check Food | Fresh/Normal | **Check Food** | The zone escalates the overall status |
| **Temperature confirmed high AND one item at 80 %** | Check Food | Use Soon | **Check Food** | More severe wins — Use Soon does not downgrade it |
| **Temperature confirmed high AND one item past its limit** | Check Food | Check Food | **Check Food** | Same verdict, two causes, one alert path |
| **BMP280 disconnected, one item past its limit** | Sensor Fault | Check Food | **Sensor Fault / Data Unavailable** | Sensor Fault is rank 3 and outranks Check Food |
| **BMP280 disconnected, all readings previously in range** | Sensor Fault | — | **Sensor Fault / Data Unavailable** | Never a misleading green |
| Queue full, everything else normal | Fresh/Normal | Fresh/Normal | **Fresh / Normal** + a `storage_fault` alert | R-10: an admin problem is not a food verdict |

> **The seventh row is the one that matters.** A storage fault while the food is
> fine does **not** turn the status red-blinking, and a storage fault does not
> hide a red-solid Check Food. Conflating the two would both hide a real spoilage
> warning and cry wolf about the food.

---

## 3. The 13 decision rules

These rules are pre-filled from the firmware's actual logic. Columns marked
**Verified?** are for row T-16 in the IoT Test Matrix and currently read *Not run*.

| Rule ID | Temperature | Humidity | Gas (relative, **zone level**) | Storage duration / expiry | Required inputs available? | **Resulting status** | LED | Local action | Remote notification | SRS reference | Verified? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **R-01** | In range | In range | Delta below threshold | Before 75 % of window | Yes | **Fresh / Normal** | Green | None | Telemetry only | §1.6-xi | Not run |
| **R-02** | In range | In range | Delta below threshold | 75 – 100 % of window | Yes | **Use Soon** | Yellow | Queued `food_use_soon` alert | IFTTT notification | §1.6-xi, §1.6-xii | Not run |
| **R-03** | In range | In range | Delta below threshold | At or past limit | Yes | **Check Food** | Red solid | Queued `food_check` alert | IFTTT notification | §1.6-xi, §1.6-xii | Not run |
| **R-04** | **Above max** — confirmed over 3 consecutive samples, hysteresis applied | Any | Any | Any | Yes | **Check Food** | Red solid | Buzzer + LCD alert | Queued `temperature_high` | §1.6-xii | Not run |
| **R-05** | **Below min** — confirmed over 3 consecutive samples, hysteresis applied | Any | Any | Any | Yes | **Check Food** | Red solid | Buzzer + LCD alert | Queued `temperature_low` | §1.6-xii | Not run |
| **R-06** | Any | **Above max** — confirmed over 3 consecutive samples | Any | Any | Yes | **Check Food** | Red solid | Buzzer + LCD alert | Queued `humidity_high` | §1.6-xii | Not run |
| **R-07** | Any | **Below min** — confirmed over 3 consecutive samples | Any | Any | Yes | **Check Food** | Red solid | Buzzer + LCD alert | Queued `humidity_low` | §1.6-xii | Not run |
| **R-08** | Any | Any | **Delta above threshold** — millivolts at AIN0, **never ppm** | Any | Yes | **Check Food** | Red solid | Buzzer + LCD alert | Queued `gas_relative_high` | §1.6-iv | Not run |
| **R-09** | Any | Any | Any | Any | **No** — at least one required input is faulted or unavailable | **Sensor Fault / Data Unavailable** | Red **blinking** | Buzzer; LCD names the affected inputs | Queued `sensor_fault` on **new** bits only | §1.6-vii, §1.6-xvi | Not run |
| **R-10** | Any | Any | Any | Any | Yes, but a **storage or admin fault** is present (LittleFS, inventory, queue full, configuration) | **Unchanged by R-01 … R-09** | **Unchanged** | Storage/admin fault reported **separately**, with the explicit note that freshness status is unaffected | Queued `storage_fault` | Project rule, §9.4 of the architecture document | Not run |
| **R-11** | Any | Any | Gas is **warming up** or **capturing baseline** | Any | Warm-up / baseline counts as unavailable **for display only** | **Sensor Fault / Data Unavailable** until the gas path reaches `ready` | Red blinking | Progress shown on the LCD | **No remote sensor-fault alert** | §1.6-vii intent; architecture §9.4 rule 3 | Not run |
| **R-12** | Any | Any | Any | **Door open beyond the configured timeout** | Yes | **Status unchanged**; a separate door alert fires **once per open cycle** | Unchanged | Buzzer + LCD alert | Queued `door_open` | §1.6-vi, §1.6-xii | Not run |
| **R-13** | Any | Any | Any | Any, but the **DS3231 time is untrustworthy** | No | **Sensor Fault / Data Unavailable** | Red blinking | LCD reports DS3231 / time as the affected input | Queued `sensor_fault` | §1.6-ix, §1.6-vii | Not run |

### 3.1 Reading rule for evaluators

> **R-09 outranks R-01 through R-08, and R-10 never changes the outcome of R-01
> through R-08. That pair of statements is the entire point of this matrix.**
> Everything else is a threshold value.

### 3.2 Which rules require inventory

| Rule | Reachable with an **empty** inventory? |
|---|---|
| R-01, R-04 – R-09, R-11 – R-13 | ● Yes — zone-level rules |
| R-02 (Use Soon) | ✗ **No** — requires at least one registered item |
| R-03 (Check Food by duration) | ✗ **No** — requires at least one registered item |
| R-10 | ● Yes |

---

## 4. Rule R-09 — required sensor fault

### 4.1 The rule

> **A real required-sensor fault overrides Fresh — and overrides Check Food.**

An item is in the availability mask when it is debounced-faulted **or** has not yet
produced its first valid reading. A non-empty mask sets the zone status to
*Sensor Fault / Data Unavailable* **before any threshold evaluation happens**.
Because Sensor Fault is rank 3, the most-severe-wins rule propagates it to the
overall status, and it outranks Check Food.

This is a direct requirement of SRS §1.6-vii and §1.6-xvi: *the system should not
display a misleading Fresh or Normal status when a sensor or input fault is
detected.*

### 4.2 Required inputs, and what "required" means

| Input | In the availability mask? | Fault bit |
|---|---|---|
| BMP280 temperature / pressure | ● Yes | 0 |
| DHT11 humidity | ● Yes | 1 |
| ADS1115 | ● Yes | 2 |
| MQ-135 reading | ● Yes — **and** during warm-up or baseline capture (see R-11) | 3 |
| DS3231 / time | ● Yes | 4 |
| PCF8574 read | ● Yes | 5 |
| PCF8574 write | ● Yes | 6 |
| Reed input | ● Yes | 7 |
| **RC522** (optional identity) | ✗ **No** | 12 — optional class |
| **LCD** (optional display) | ✗ **No** | 13 — optional class |

**Optional functions never force a Sensor Fault status.** A failed RFID reader
degrades *which item you are looking at*; it never degrades a *freshness verdict*.
This is a deliberate design choice, not an oversight.

### 4.3 Fault debounce

| Property | Value | Consequence |
|---|---|---|
| Failures to raise a fault | 3 consecutive samples | One bad bus transaction cannot raise a fault |
| Successes to clear a fault | 3 consecutive samples | One lucky read cannot clear a fault |
| One observation per scheduled pass | Yes | A whole 4-sample averaging pass produces **one** failure observation, not four |

### 4.4 What R-09 must never do

| Never | Why |
|---|---|
| Show green while a required input is faulted | SRS §1.6-xvi forbids a misleading Fresh/Normal indication |
| Fire a remote alert for a single failed transaction | Three-sample confirmation exists precisely to prevent this |
| Fire a remote alert for a warm-up or baseline capture | That is normal behaviour on every boot — see R-11 |
| Be triggered by a storage or admin fault | Those are a separate class — see R-10 |
| Be triggered by an optional-function fault | Identity and display are not freshness inputs |

---

## 5. Rule R-10 — storage and admin faults never mask a food verdict

### 5.1 The rule

> **A storage or admin fault is a separate condition. It never enters the
> availability mask, never changes the zone status, and never changes the overall
> status. It is reported alongside, never instead of, a food verdict.**

The alert message for a storage fault carries an explicit, human-readable note
that the freshness status is unaffected. Its alert type is distinct from the
sensor-fault type.

### 5.2 Storage and admin fault bits

| Bit | Condition | Class |
|---|---|---|
| 8 | LittleFS | Storage / admin |
| 9 | Inventory store | Storage / admin |
| 10 | Alert queue full | Storage / admin |
| 11 | Configuration self-check | Storage / admin |

### 5.3 Why this separation exists

| Conflated | Correct |
|---|---|
| A full alert queue would turn the status red-blinking, implying the food is suspect when it is not | A full queue is reported as a storage/admin fault; the freshness status is unchanged |
| A storage fault could hide a genuine Check Food verdict | The food verdict is computed and displayed independently |
| The operator cannot tell *which* problem occurred | The serial report and LCD pages 3 and 4 name sensor and storage faults separately |
| A false alarm trains the operator to ignore the indicator | A real spoilage warning stays meaningful |

### 5.4 The recursion case — a full queue

This is the interesting edge case, and the firmware handles it without a special
case.

| Step | What happens |
|---|---|
| 1 | The queue reaches capacity. A storage/admin fault bit is set. |
| 2 | The alert that triggered the condition **cannot itself be queued**, because there is no free slot. |
| 3 | It is therefore presented **locally only** — LCD and buzzer — and the serial log records that it was not queued. |
| 4 | The attempt to alert *about* the storage fault would also not fit, so it is not attempted. |
| 5 | Recursion is broken by the **announced-mask latch**: once a storage bit has been announced, it is not announced again. One overflow produces **one** local-only alert, not an endless chain. |

**What you should see in a demonstration.** Exactly one `storage_fault` alert,
presented locally, no cascade of alerts, and the freshness status unchanged
throughout.

---

## 6. Rule R-11 — warm-up and baseline are display-only

### 6.1 The rule

> **Gas warm-up and baseline capture make the status Data Unavailable, but they
> must never produce a remote sensor-fault alert.**

During warm-up and baseline capture, the MQ-135 bit **is** added to the
availability mask, so the display correctly says *Data Unavailable*. It is
deliberately **not** added to the confirmed-fault mask. Only genuine, debounced
read failures or plausibility failures enter the confirmed mask.

### 6.2 The gas state machine

```text
   ┌────────────┐
   │  power-on  │
   └─────┬──────┘
         ▼
   ┌──────────────────┐
   │   Warming up     │  Full 60 s on EVERY boot, even when a valid
   │   (fixed window) │  baseline was persisted. The stored baseline is
   └────────┬─────────┘  adopted only once warm-up completes, so the
            │            heater is never read cold.
            ▼
      ┌───────────┐
      │ baseline  │──── yes ───▶ ┌────────┐
      │ persisted?│              │ Ready  │  Stored baseline adopted;
      └─────┬─────┘              └────────┘  delta measured against it
            │ no                       ▲
            ▼                          │
      ┌─────────────────────┐          │ 3 consecutive good samples
      │  Capturing baseline │──────────┘
      │  (30 samples at     │  ◀── a confirmed read or plausibility
      │   1 s intervals)    │      fault forces a re-capture
      └─────────┬───────────┘
                │ confirmed read or plausibility fault
                ▼
        ┌────────────┐
        │  Faulted   │  Unavailable. A new baseline is required before
        └────────────┘  data is trusted again.
```

### 6.3 Why the distinction is a correctness requirement, not a nicety

| Behaviour | Consequence if wrong |
|---|---|
| Warm-up **is** in the availability mask | The system shows a misleading green light while the gas sensor is not yet producing usable data. That is exactly the failure SRS §1.6-xvi forbids. |
| Warm-up **is not** in the confirmed-fault mask | Every single power-up raises a spurious `sensor_fault` notification to a remote channel. An alert that always fires is an alert nobody reads. |

Both halves are required. Neither alone is correct.

### 6.4 The timing you will actually observe

| Situation | Time until the gas path is `ready` |
|---|---|
| A valid baseline was persisted and the fingerprint matches | Approximately 60 s (warm-up only) |
| No valid baseline, or the fingerprint did not match | Approximately 90 s (60 s warm-up + 30 samples at 1 s) |
| After a confirmed gas fault clears | A new full capture is required before data is trusted |

> **A demo note.** The first ~90 seconds after power-up are a period where the
> status is *Data Unavailable* and the fault mask telemetry is **not** set. That
> looks like a gap on a chart and is not one. Say so before someone asks.

---

## 7. Rule R-12 — the door rule

### 7.1 The rule

> **A door-open event beyond the configured timeout produces a one-shot door
> alert. It does not change the freshness status.**

### 7.2 The full door logic

| Property | Value / behaviour |
|---|---|
| Detection | Reed switch contacts between the expander input pin and ground; closed reads LOW |
| Poll interval | 50 ms |
| Debounce window | 80 ms |
| Door-open timeout | 30 s from the debounced open transition |
| Alert cadence | **Once per open cycle**, not once per poll |
| Latch reset | Re-armed when the door closes, or when the reed input itself becomes unavailable |
| Effect on status | **None.** A door-open event does not raise or lower the freshness status |
| Local action | Buzzer (3 beeps, 200 ms on / 150 ms off) + LCD alert overlay for 10 s |
| Remote | Queued `door_open` event, delivered on the 5 s retry cadence |
| Buzzer while Use Soon | Off **unless** an alert is active |

### 7.3 Why door-open does not produce Check Food

| Argument | Detail |
|---|---|
| An open door **does** affect the zone, but through the temperature path | A warm zone will be caught by R-04 or R-05 through the normal temperature latches. The door rule is a **separate, earlier, more specific** signal. |
| SRS §1.6-vi treats it as its own requirement | *"If it remains open for too long, the system will activate a buzzer and send a notification."* It specifies an alert, not a status change. |
| A status change would be misleading | A door momentarily left open does not make the food Check Food. It makes the *operator* aware that conditions may be drifting. |
| It still gets a proactive remote notification | §1.6-xii's mandatory proactive notification is satisfied. |

### 7.4 What to demonstrate

| Action | Expected |
|---|---|
| Open the door and hold it past the timeout | **Exactly one** `door_open` alert, with the buzzer and LCD overlay |
| Keep holding it open | **No further** door alerts. The one-shot latch holds. |
| Close and re-open the door | A **new** alert, once per cycle |
| Wiggle the magnet rapidly | **No** false transitions — the 80 ms debounce must hold |

---

## 8. Rules R-01 to R-03 — the item duration rules

### 8.1 The three states

For each registered item, the firmware derives a duration verdict from the DS3231
clock. Exactly one of the following applies.

| Item state | Condition | Status |
|---|---|---|
| **Fresh** | Elapsed < 75 % of the item's window | Fresh / Normal |
| **Use Soon** | Elapsed ≥ 75 % of the window, and before the deadline | Use Soon |
| **Check Food** | Now ≥ the deadline | Check Food |

### 8.2 The window, precisely

| Item configuration | Window length | Deadline |
|---|---|---|
| A **non-zero expiry epoch** | Expiry − store date | The expiry epoch |
| **Expiry of 0** (duration mode) | `durationLimitDays` × 86 400 seconds | Store date + window |
| **Both zero** | — | **Rejected at registration.** At least one must be provided. |

**A non-zero expiry takes precedence over the duration limit.** If both are
provided, the expiry is used and the duration is ignored for the verdict.

### 8.3 Use Soon is reachable only through inventory

| Inventory state | Overall status | Why |
|---|---|---|
| **Empty** | Equals the zone status | No items means no duration verdicts |
| **Empty**, and a Use Soon condition is somehow "expected" | **Impossible** | The zone can never produce Use Soon. Only a registered item can. |

> ### ⚠ Consequence an evaluator should know
>
> **A zone with no registered items shows green even though nothing is tracked.**
> The LEDs are driven by the *overall* status, and with an empty inventory the
> overall status equals the zone status. This is a deliberate single-zone design
> choice, documented in the firmware header — and it is why **a demonstration must
> register at least one item**. An evaluator watching an empty, unconfigured zone
> will see green and may reasonably conclude the system is doing nothing.

### 8.4 The store date is set by the device, and cannot be backdated

| Property | Behaviour | Consequence |
|---|---|---|
| On **first** registration | Store date = current DS3231 time | An item cannot be registered as already old |
| On **re-registration** of an existing identity | Store date is **preserved** | An accidental re-registration cannot silently reset an item's age |
| Backdating | **Not possible** — no field for it | The main impediment to a fast Check Food demonstration |

**The supported way to demonstrate Use Soon and Check Food quickly** is to
register an item with a **near-future expiry epoch**: the store date becomes *now*
and the window becomes short. This exercises the real expiry path using only the
documented registration command, with no code change. Open decision **Q-4**.

### 8.5 Item verdicts are confirmed, not instantaneous

| Property | Value |
|---|---|
| Confirmation | 3 consecutive samples, the same latch mechanism as an environmental threshold |
| Rearm window | 60 s |
| Effect | A newly registered item does **not** alert on its first evaluation |
| Across a reboot | Item latches live in RAM only, so a Use Soon or Check Food alert **may re-fire** after a restart. The `event_id` still differs, so a receiver can distinguish re-fires. |

### 8.6 Item verdict combined with the zone

An item is displayed with its **own** duration verdict combined with the zone
verdict, taking the more severe. A specific food item is never blamed for a
zone-level gas excursion.

| Zone verdict | Item duration verdict | Item's displayed status |
|---|---|---|
| Fresh/Normal | Fresh/Normal | Fresh/Normal |
| Fresh/Normal | Use Soon | Use Soon |
| Fresh/Normal | Check Food | Check Food |
| Check Food | Fresh/Normal | **Check Food** — the zone condition applies to this item too |
| Check Food | Check Food | Check Food |
| Sensor Fault | anything | **Sensor Fault / Data Unavailable** |
| Storage/admin fault | anything | **Unchanged** by R-10 |

---

## 9. Rule R-13 — the untrustworthy clock

### 9.1 The rule

> **Storage duration and expiry cannot be evaluated without a trustworthy clock.
> If the DS3231 time is not trustworthy, the status is Sensor Fault / Data
> Unavailable.**

### 9.2 What makes the clock untrustworthy

| Condition | Detected how |
|---|---|
| The RTC did not acknowledge on the bus | No ACK at its address |
| The oscillator-stopped status flag is set in the RTC status register | Read once at initialisation and again on every poll |
| The clock reads below a sanity floor (2024-01-01) | Value comparison |

### 9.3 What the firmware does about it

| Behaviour | Detail |
|---|---|
| Status | **Sensor Fault / Data Unavailable**, red blinking |
| Availability mask | The DS3231 / time bit is set |
| Remote | A `sensor_fault` alert naming the clock, on new bits only |
| **Registration is blocked** | An item cannot be registered without a valid clock, because its store date would be meaningless |
| Alert timestamps | An event raised while the clock is untrustworthy carries a zero timestamp **and** a separate "time not valid" flag — a zero timestamp means *the time was untrustworthy*, not *epoch zero* |
| Recovery | Set the clock with `RTCEPOCH <current epoch>`. The oscillator-stopped flag is cleared at the same time. |

---

## 10. Where a status can come from

| Status | From the **zone** (environment) | From an **item** (storage duration) |
|---|---|---|
| **Sensor Fault / Data Unavailable** | ● Any required input unavailable or faulted — R-09, R-11, R-13 | ● Untrustworthy clock, or a zero-length window |
| **Check Food** | ● Any confirmed environmental threshold latch active — R-04 … R-08 | ● Now ≥ the expiry epoch, or now ≥ store date + duration limit. Also **now < store date**, meaning the clock moved backwards. |
| **Use Soon** | ✗ **The zone can never produce Use Soon** | ● Elapsed ≥ 75 % of the window — R-02 |
| **Fresh / Normal** | ● No latch active and all inputs available | ● Elapsed < 75 % of the window — R-01 |

### 10.1 The clock-moved-backwards case

If the current time is **earlier** than an item's store date, the item is reported
as **Check Food**, not as Fresh. A backwards clock is treated as an integrity
problem, not as an item that has somehow got younger. This is a deliberate choice:
silently recomputing ages against a bad clock would be a worse lie than a
conservative Check Food.

---

## 11. Alert type vocabulary

These are the only alert types the system can raise. Any notification, log line,
chart legend, or report paragraph should use one of these tokens.

| `type` token | Raised when | Local action | Rule |
|---|---|---|---|
| `temperature_high` | BMP280 temperature above the configured maximum, confirmed over 3 consecutive samples | Buzzer + LCD alert | R-04 |
| `temperature_low` | BMP280 temperature below the configured minimum | Buzzer + LCD alert | R-05 |
| `humidity_high` | DHT11 humidity above the configured maximum | Buzzer + LCD alert | R-06 |
| `humidity_low` | DHT11 humidity below the configured minimum | Buzzer + LCD alert | R-07 |
| `gas_relative_high` | Gas delta above the configured threshold — **millivolts at AIN0, never ppm** | Buzzer + LCD alert | R-08 |
| `door_open` | Door open beyond the configured timeout, **once per open cycle** | Buzzer + LCD alert | R-12 |
| `food_use_soon` | An item passed 75 % of its window | Buzzer + LCD alert | R-02 |
| `food_check` | An item reached its expiry or duration limit | Buzzer + LCD alert | R-03 |
| `sensor_fault` | A **new** bit appeared in the confirmed sensor-fault mask | Buzzer + LCD alert naming the inputs | R-09, R-13 |
| `storage_fault` | A **new** bit appeared in the storage / admin mask | Buzzer + LCD alert stating freshness is unaffected | R-10 |

### 11.1 Alert vocabulary rules

| Rule | Reason |
|---|---|
| A `sensor_fault` fires on **new** bits only | A persistent fault does not alert repeatedly. A *new* bit inside the rearm window is logged and suppressed, so a burst of distinct bits cannot storm either. |
| A `storage_fault` fires on **new** bits only | Same mechanism, same reason. |
| A `door_open` fires **once per open cycle** | A held-open door must not produce an alert stream. |
| `gas_relative_high` reports **millivolts and a delta** | Never ppm, never a concentration. |
| The overall rearm window is 60 s | Prevents a flapping condition from producing an alert storm. |
| There is no `gas_ok`, no `fresh` alert, and no "spoiled" type | The system reports changes and required actions, never verdicts on food |

---

## 12. Timing mechanisms behind the rules

These values are the difference between a working system and a flapping one.

| Mechanism | Value | Purpose | Enforced at compile time? |
|---|---|---|---|
| Consecutive-sample confirmation | 3 samples | One bad bus transaction or one door bounce cannot raise a local or remote alert | ● |
| Recovery confirmation | 3 samples | A single lucky read cannot clear a fault | ● |
| Item-duration confirmation | 3 samples, same latch mechanism, same 60 s rearm | An item's verdict is confirmed, not instantaneous | ● |
| Temperature hysteresis | ±1.0 °C around the limit | At least as wide as the prototype temperature sensor's documented tolerance, so the value cannot chatter from sensor error alone | ✔ **Yes** — a build below this fails to compile |
| Humidity hysteresis | ±5 % RH | At least as wide as the prototype humidity sensor's documented tolerance | ✔ **Yes** — a build below this fails to compile |
| Gas hysteresis | **50 mV to raise, 40 mV to clear** | Two distinct thresholds, deliberately non-equal, so a signal on the limit cannot oscillate | ✔ **Yes** — a build where clear ≥ raise fails to compile |
| Alert rearm | 60 s | Prevents a flapping condition from producing an alert storm | ● |
| One-shot door alert | Per open cycle | A held-open door alerts once, not continuously | ● |
| Environmental poll | 5 s | Drives threshold evaluation | ● |

### 12.1 Timing, stated precisely

| Question | Answer |
|---|---|
| How long from a **confirmed** violation to a local alert? | Well under a second. A confirmed latch raises its alert inside the same evaluation pass that confirms it. **This is the figure SRS §1.7's 2–5 seconds refers to.** |
| How long from the **start** of a sustained excursion to a confirmed alert? | Roughly 10–15 s. A violation must survive 3 consecutive samples at the 5 s poll cadence. |
| How long from the start of a door-open event to a `door_open` alert? | The configured 30 s timeout, plus one debounced open transition. |
| How long after power-on before the gas path is `ready`? | ~60 s with a valid persisted baseline; ~90 s without one. |
| How long before a queued alert is attempted after Wi-Fi returns? | The 5 s retry cadence. |

> **When you report a response time, say from which point you measured it.** The
> two numbers differ by more than an order of magnitude and conflating them is
> the easiest way to make a correct design look non-compliant.

---

## 13. The three masks, and why conflating them makes a chart lie

The firmware maintains **three** related masks. Treating them as one is the most
common way a reader draws a wrong conclusion from correct telemetry.

| Mask | What it contains | Where it appears | What it drives |
|---|---|---|---|
| **Confirmed sensor mask** | Only debounced, genuine faults | **Transmitted** as the low bits of the platform fault field | `sensor_fault` alerts and the LEDs |
| **Availability mask** | The confirmed mask **plus** inputs that have not yet produced data **plus** the gas warm-up / baseline state | LCD page 3 — **not transmitted** | The *Sensor Fault / Data Unavailable* **display** |
| **Storage / admin mask** | LittleFS, inventory, queue-full, configuration | **Transmitted** as the mid bits of the same platform field | Reported separately; never changes a freshness verdict |

### 13.1 The consequence a dashboard reader will notice

> During the first roughly 90 seconds after a power-up, a gas sensor that is still
> warming up shows as **Data Unavailable on the LCD** while setting **no bit** in
> the transmitted fault field. A chart therefore shows a healthy-looking fault
> mask at the same moment the device is correctly reporting that it is not ready.
>
> **This is intended behaviour, not a telemetry gap.** It is exactly why R-11 keeps
> warm-up out of the confirmed mask. Expect to be asked about it, and be ready to
> explain it.

---

## 14. Verifying the matrix

Every rule in §3 carries a **Verified?** column that currently reads *Not run*.
Discharging it is a single test row.

| What to verify | How | Test row |
|---|---|---|
| That each of R-01 … R-13 produces exactly the stated status | Reproduce each rule's input condition and observe the status | **T-16** in [`IOT_TEST_MATRIX.md`](./IOT_TEST_MATRIX.md) |
| That R-09 overrides a Check Food | Disconnect a sensor while an item is past its limit | **T-16**, and **T-08** |
| That R-10 does not mask a Check Food | Raise a storage fault while an item is past its limit | **T-17** |
| That R-11 produces no remote alert | Power-cycle and watch for any notification in the first 90 s | **T-10** |
| That R-12 fires once per open cycle | Open, hold, close, re-open | **T-05** |
| That 3-sample confirmation blocks false positives | Wiggle a connector for a single sample | **T-09** |
| That hysteresis prevents chatter | Move a reading to sit exactly on a limit | Part of **T-02** / **T-03** |

**Rule for the submission:** a rule may only be marked Verified when the test row
has an **actual result** and an **evidence ID**. A rule with no evidence is *Not
run*, never *Pass*.

---

## 15. Known consequences an evaluator should know

| # | Consequence | Why it exists | Disposition |
|---|---|---|---|
| 1 | **Use Soon requires registered inventory.** With an empty inventory the status equals the zone status and Use Soon cannot occur. | The zone alone has no duration information | Documented in the firmware header. **A demo must register at least one item.** |
| 2 | **Thresholds are compile-time only.** Changing a limit requires a reflash. | Deliberate — avoids adding an unaudited remote-write path | Serial registration covers item data. Disclose. |
| 3 | **One uniform band for the whole zone**, not per food category. | No threshold-configuration interface exists | The [Food Threshold Matrix](./FOOD_THRESHOLD_MATRIX.md) is documentation, not enforcement. Open decision **Q-3**. |
| 4 | **Item alert latches are RAM-only.** A Use Soon or Check Food alert may re-fire after a restart. | Simplicity of the store format | The `event_id` differs, so a receiver can distinguish re-fires. Disclose. |
| 5 | **The clock-moved-backwards case reports Check Food** rather than recomputing. | A conservative reading of an integrity problem | Deliberate. Document it. |
| 6 | **A corrupt queue slot blocks the events behind it** rather than being skipped. | An event is never silently dropped | Surfaces as a storage/admin fault. Disclose. |
| 7 | **Alert delivery is best-effort in slot order, not strict FIFO.** A receiver must not assume ordering. | The queue is a fixed array scanned linearly | Order by `event_id` or timestamp if you need one. |
| 8 | **Gas is relative, never calibrated.** | No traceable gas calibration is performed | Already the documented design. Keep the wording in every user-facing string. |

---

## Cross-references

| Document | Relationship |
|---|---|
| [`../README.md`](../README.md) | The four statuses in summary; demo flow; limitations |
| [`../FOOD_STORAGE_ARCHITECTURE.md`](../FOOD_STORAGE_ARCHITECTURE.md) | §9 is the design narrative behind this matrix; §15.3 is the upstream template |
| [`FOOD_THRESHOLD_MATRIX.md`](./FOOD_THRESHOLD_MATRIX.md) | Supplies the threshold values these rules evaluate |
| [`CALIBRATION_BASELINE.md`](./CALIBRATION_BASELINE.md) | Where the gas baseline and delta are measured |
| [`IOT_TEST_MATRIX.md`](./IOT_TEST_MATRIX.md) | Row T-16 verifies this matrix; T-17 verifies R-10 |
| [`INSTALLATION_AND_EXECUTION.md`](./INSTALLATION_AND_EXECUTION.md) | The procedure that produces a system in the state these rules describe |

---

*FreshGuard — Freshness Decision Rule Matrix. ESP8266MOD prototype.*
*Rules transcribed from the authoritative `FreshGuard.ino`. No rule has been
executed on hardware; all verification columns read "Not run". Nothing in this
document is a food-safety determination.*
