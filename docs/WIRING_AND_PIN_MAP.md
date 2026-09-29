# FreshGuard — Wiring and Pin Map

> **Authoritative implementation:** [`FreshGuard.ino`](../FreshGuard.ino). Where this
> document and the firmware disagree, **the firmware is correct and this document
> is wrong**.
> **Design context:** [`FOOD_STORAGE_ARCHITECTURE.md`](../FOOD_STORAGE_ARCHITECTURE.md)
> **Operator procedure:** [`INSTALLATION_AND_EXECUTION.md`](./INSTALLATION_AND_EXECUTION.md)

> ## ⚠ Before you apply power
>
> 1. **GPIO numbers in this document are authoritative. Silkscreen labels are
>    provisional** and are the *common* NodeMCU 1.0 / D1-mini naming. They vary
>    between development boards of the same family. Confirm yours against the
>    physical board. Open decision **Q-9**.
> 2. **The DS3231 charging path must be disabled and verified before power is
>    applied.** See [§9](#9-ds3231--cr2032--mandatory-pre-power-gate). This is
>    the single most damaging mistake available in this build.
> 3. **The level-shifter part is unidentified.** Leave the LCD unpowered until
>    [§7](#7-lcd-and-the-bss138-level-shifter) is satisfied. Open decision **Q-10**.
> 4. **Nothing in this document has been verified on a bench.** Every item marked
>    △ must be measured or inspected and recorded as evidence before you rely on it.

---

## Table of contents

1. [Status legend](#1-status-legend)
2. [Controller pin map — authoritative](#2-controller-pin-map--authoritative)
3. [I2C address map](#3-i2c-address-map)
4. [PCF8574 expander pin map](#4-pcf8574-expander-pin-map)
5. [System wiring diagram (ASCII)](#5-system-wiring-diagram-ascii)
6. [MQ-135 analog path — divider and ADS1115](#6-mq-135-analog-path--divider-and-ads1115)
7. [LCD and the BSS138 level shifter](#7-lcd-and-the-bss138-level-shifter)
8. [DHT11 data pull-up](#8-dht11-data-pull-up)
9. [DS3231 / CR2032 — mandatory pre-power gate](#9-ds3231--cr2032--mandatory-pre-power-gate)
10. [RC522 SPI map](#10-rc522-spi-map)
11. [Reed switch, LED drivers, buzzer, flyback](#11-reed-switch-led-drivers-buzzer-flyback)
12. [Power, grounding, decoupling and safety checklist](#12-power-grounding-decoupling-and-safety-checklist)
13. [ESP8266 boot and strapping cautions](#13-esp8266-boot-and-strapping-cautions)
14. [Condensation, moisture and food-contact checklist](#14-condensation-moisture-and-food-contact-checklist)
15. [Verifications still outstanding](#15-verifications-still-outstanding)

---

## 1. Status legend

| Marker | Meaning |
|---|---|
| ● | **Implemented.** Present in the firmware and reachable at runtime. |
| △ | **Requires bench verification.** A compile-time value, a datasheet claim, or a wiring assumption that nobody has measured. |
| ✗ | **Not implemented.** Do not wire. |

---

## 2. Controller pin map — authoritative

The ESP8266 boot-samples certain pins at reset. Every pin the firmware depends on
is chosen to avoid those, and the firmware additionally enforces pin distinctness,
I²C address non-collision, hysteresis adequacy, divider ordering, and expander
direction at **compile time** — so a bad edit fails the build rather than
producing a mis-wired board. Those checks validate *configuration consistency*.
**They do not validate physical wiring.**

| ESP8266 GPIO | Typical silkscreen △ | Net | Direction (firmware) | Electrical requirement | Status |
|---|---|---|---|---|---|
| **GPIO4** | D2 | I²C **SDA** — shared by BMP280, DS3231, ADS1115, PCF8574, LCD | Bidirectional, 3.3 V | 4.7 kΩ – 10 kΩ pull-up to **3.3 V only**. **Never pull to 5 V.** | ● △ |
| **GPIO5** | D1 | I²C **SCL** — same devices | Output / open-drain | 4.7 kΩ – 10 kΩ pull-up to 3.3 V. Bus clocked at **100 kHz** for breadboard and level-shifter margin. | ● △ |
| **GPIO16** | D0 | **DHT11 DATA** | Bidirectional single-wire | **External 4.7 kΩ – 10 kΩ pull-up to 3.3 V, required unless the breakout already carries one.** The firmware never enables a software pull-up and this pin provides no usable one, so **nothing in software can substitute for the resistor.** Idle level must read 3.3 V, not floating. | ● △ |
| **GPIO12** | D6 | RC522 **MISO** | Input | Not a boot-strapping pin. | ● |
| **GPIO13** | D7 | RC522 **MOSI** | Output | — | ● |
| **GPIO14** | D5 | RC522 **SCK** | Output | — | ● |
| **GPIO15** | D8 | RC522 **NSS (SS)** | Output | **Must be LOW at reset.** The board provides a pull-down, but some RC522 breakouts fit a pull-up on the SS line. The firmware drives it HIGH after boot. | ● △ caution |
| **A0** | A0 | **UNUSED — leave open** | — | **Must remain unconnected.** The MQ-135 analog output goes to the ADS1115, never here. △ Verify nothing is attached during final wiring. | ● rule |
| **3V3** | 3V3 | 3.3 V power rail | Power | Supplies BMP280, DHT11, ADS1115, DS3231, PCF8574, RC522 logic, and the I²C pull-ups. △ **The MQ-135 is deliberately not on this list** — its supply requirement is unverified. See [§6](#6-mq-135-analog-path--divider-and-ads1115). | ● △ capacity |
| **GND** | GND | Common ground | Power | A single common ground across all modules, including the shifter's low side. | ● |
| **5V / VIN** | VIN, 5V | USB 5 V input | Power | Powers the board's on-board regulator. **The ESP8266 is not 5 V tolerant — never route 5 V to a GPIO.** | ● |
| GPIO0, GPIO1, GPIO2, GPIO3, EN, RST | D3, TX, RX, EN, RST | **Reserved** | — | Boot-mode, UART0, and auto-program pins. **No peripheral may connect here.** GPIO1/GPIO3 carry the 115200-baud console the bring-up procedure depends on. | ● rule |

**Conflict check.** GPIO4, GPIO5, GPIO12, GPIO13, GPIO14, GPIO15, and GPIO16
are all distinct, and the DHT pin differs from both I²C pins. Enforced at compile
time.

**Why the ESP8266's own ADC is not used.** Its single 10-bit converter has a
narrow usable input window, poor noise performance, and no instrumentation
amplifier or gain stage. The ADS1115 replaces it. This is a hard rule, restated
in the firmware header.

---

## 3. I2C address map

| Address | Device | How the address is set | Conflict |
|---|---|---|---|
| `0x20` | **PCF8574** I/O expander | A0 / A1 / A2 tied to ground | None |
| `0x27` | **16×2 LCD** with PCF8574 backpack | Backpack solder jumpers; configurable | None. If the backpack answers elsewhere, update the constant and re-run the bus scan. |
| `0x48` | **ADS1115** 16-bit ADC | ADDR tied to ground (default) | None. ADDR to VDD / SDA / SCL yields `0x49` / `0x4A` / `0x4B`. |
| `0x68` | **DS3231** RTC | Fixed | None. Some modules carry an AT24C32 EEPROM at `0x57`; it will appear in the scan and can be ignored. |
| `0x76` | **BMP280** temp/pressure | SDO tied to ground | None. SDO to VCC yields `0x77`. |

All five addresses are pairwise distinct; the collision check is enforced at
compile time. A bus scan runs automatically at boot at **100 kHz** and labels any
address it finds with the expected device name, so a mis-strapped module is
diagnosed from the serial log rather than by guesswork.

**Expected addresses in ascending order after a complete build:**
`0x20`, `0x27`, `0x48`, `0x68`, `0x76`. A sixth device at `0x57` is an
on-module EEPROM and is benign.

---

## 4. PCF8574 expander pin map

The expander exists because the ESP8266 has no spare pins once I²C (2), DHT
single-wire (1), and the four hardware-SPI lines (4) are allocated. It is an
**additional required part**, not in the SRS bill of materials.

The firmware writes configuration register value **`0xC1`** at startup and reads
it back. In the PCF8574 configuration register, **1 means input / high-impedance**
and **0 means quasi-bidirectional output**. So `0xC1` = binary `1100 0001`:
P0, P6, P7 are inputs; P1–P5 are outputs.

| Pin | Direction | Net | Driver / protection requirement | Polarity |
|---|---|---|---|---|
| **P0** | **Input** | Reed switch contacts to ground | The quasi-bidirectional pull-up is weak (about 100 µA typical). △ Fit an external **10 kΩ pull-up to 3.3 V** if the idle level proves unstable with real contacts. **Flyback diode** across an inductive reed coil: **cathode to the P0-connected side, anode to ground.** △ Verify polarity before assembly. | Contacts **closed = LOW = door closed** |
| **P1** | Output | Green LED (Fresh/Normal) | **Never** connect a high-current LED directly to a quasi-bidirectional port. Use an NPN transistor or NMOSFET driver plus a **220–330 Ω** series resistor. | Active high by default |
| **P2** | Output | Yellow LED (Use Soon) | Same driver requirement. | Active high |
| **P3** | Output | Red LED (Check Food); blinks for Sensor Fault / Data Unavailable | Same driver requirement. | Active high |
| **P4** | Output | Buzzer | Transistor driver, plus **flyback protection** across an inductive element. | Active high |
| **P5** | Output | RC522 **RST** | A logic-level input; **may be driven directly**, no driver needed. | **Active low** |
| **P6, P7** | Input | Unused | **Leave open.** Reserved for expansion. | — |

**Polarity correction.** A single compile-time constant declares whether the
controlled outputs are active-high or active-low. If your transistor drivers
invert a signal, flip **that one constant** and re-test. Do not scatter inversions
through the presentation code.

**Verified writes.** Every output write is followed by a read of the input
register, which reflects actual pin levels. A mismatch is treated as a genuine
bus or load fault rather than a successful write, and the cached shadow is *not*
updated, so a later attempt retries the failed transition. This is why an LED or
buzzer that fails to switch raises a real fault instead of being silently
believed to have worked.

**Load rule, stated once:** the PCF8574 port switches the base or gate of a driver.
It does **not** carry LED or buzzer current.

---

## 5. System wiring diagram (ASCII)

Read left to right: controller on the left, buses in the middle, peripherals on
the right. `△` marks anything unverified. The diagrams below are schematic
intent, not a substitute for checking your actual module pinouts — △ **module
layouts vary; read the silkscreen on the board in front of you.**

```text
                     ┌──────────────────────────────────────┐
   USB from laptop ───┤ 5V/VIN                          GND ├───┐
   (5 V only)        │                                      │   │
                     │  ESP8266MOD  (NodeMCU / D1 style)    │   │
   serial console    │  ┌────┐                    ┌────┐    │   │
   115200 baud  ◄────┤  │GPIO│                    │GPIO│    │   │
   (GPIO1/GPIO3)     │  └────┘                    └────┘    │   │
                     │                                      │   │
                     │  GPIO4  ─── I2C SDA ──────────┐     │   │
                     │  GPIO5  ─── I2C SCL ──────┐   │     │   │
                     │                          │   │     │   │
                     │  GPIO16 ─── DHT DATA ─┐   │   │     │   │
                     │                       │   │   │     │   │
                     │  GPIO12 ─── MISO ──┐  │   │   │     │   │
                     │  GPIO13 ─── MOSI ──┐│  │   │   │     │   │
                     │  GPIO14 ─── SCK  ──┐││  │   │   │     │   │
                     │  GPIO15 ─── NSS  ─┐│││  │   │   │     │   │
                     │                    ││││  │   │   │     │   │
                     │  3V3 ──────────┐  ││││  │   │   │     │   │
                     │  GND ──────────┼──┼┼┼──┼───┼───┼─────┼───┤
                     └─────────────────┼──┼┼┼──┼───┼───┼─────┼───┘
                                       │  │││  │   │   │     │
      ┌────────────────────────────────┘  │││  │   │   │     │
      │  ┌──────────────────────────┐    │││  │   │   │     │
      │  │ 3.3 V DOMAIN  ── 100 nF  │    │││  │   │   │     │
      │  │  at every module + bulk  │    │││  │   │   │     │
      │  │  △ verify rail under     │    │││  │   │   │     │
      │  │    Wi-Fi transmit peaks  │    │││  │   │   │     │
      │  └──────────────────────────┘    │││  │   │   │     │
      │                                  │││  │   │   │     │
      │  ┌───────────────────────────────┴┴┴┴┐ │   │   │     │
      │  │   I2C BUS  (100 kHz)              │ │   │   │     │
      │  │   pull-ups 4.7k-10k to 3V3 ONLY   │ │   │   │     │
      │  │   △  no ESP8266-side pull-up to 5V│ │   │   │     │
      │  │                                   │ │   │   │     │
      │  │  SDA ─┬───────────────────────────┼─┼───┼─────┼──┐  │
      │  │       ├── BMP280  0x76             │ │   │     │  │  │
      │  │       ├── DS3231  0x68             │ │   │     │  │  │
      │  │       ├── ADS1115 0x48             │ │   │     │  │  │
      │  │       ├── PCF8574 0x20             │ │   │     │  │  │
      │  │       │                            │ │   │     │  │  │
      │  │  SCL ─┴──(same five devices)───────┴─┴───┴─────┘  │  │
      │  │                                                │  │  │
      │  │   ═══════ passes through BSS138 shifter ════════╪══╪══│
      │  │            LV = 3V3        HV = 5V               │  │  │
      │  │            △ IDENTIFY THE PART FIRST              │  │  │
      │  │                                                │  │  │
      │  │  PCF8574 expander  0x20                          │  │  │
      │  │  ┌──────────────────────────────────┐            │  │  │
      │  │  │ P0  INPUT  reed contacts to GND  │            │  │  │
      │  │  │ P1 OUTPUT -> driver -> GREEN LED │            │  │  │
      │  │  │ P2 OUTPUT -> driver -> YELLOW LED│            │  │  │
      │  │  │ P3 OUTPUT -> driver -> RED LED   │            │  │  │
      │  │  │ P4 OUTPUT -> driver -> BUZZER    │            │  │  │
      │  │  │      + flyback on inductive load │            │  │  │
      │  │  │ P5 OUTPUT ------> RC522 RST  (lo)│            │  │  │
      │  │  │       active low, direct drive   │            │  │  │
      │  │  │ P6, P7 INPUT   leave open (spare)│            │  │  │
      │  │  └──────────────────────────────────┘            │  │  │
      │  │                                                    │  │  │
      │  │  GAS PATH  (analog, zone level, never ppm)        │  │  │
      │  │  ┌──────────────────────────────────────┐         │  │  │
      │  │  │ MQ-135                                │         │  │  │
      │  │  │   VCC ──> supply  △ UNVERIFIED        │         │  │  │
      │  │  │   GND ──> common ground              │         │  │  │
      │  │  │   D0  ──> UNUSED, leave open         │         │  │  │
      │  │  │   A0 ──┬──[4.7k]──┬──[2.2k]── GND   │         │  │  │
      │  │  │         │          │                │         │  │  │
      │  │  │         │     ADS1115 AIN0           │         │  │  │
      │  │  │         │     (GAIN_ONE, 128 SPS)   │         │  │  │
      │  │  │         └─────────> ESP8266 A0       │         │  │  │
      │  │  │                   ╳ NEVER WIRED      │         │  │  │
      │  │  └──────────────────────────────────────┘         │  │  │
      │  └───────────────────────────────────────────────────┘  │  │
      │                                                          │  │
      │  LCD 16x2 + I2C backpack  0x27                            │  │
      │  ┌──────────────────────────────────────┐               │  │
      │  │ VCC ──> 5V  △ only after §7 passes   │───────────────┘  │
      │  │ GND ──> common ground                │                  │
      │  │ SDA/SCL ──> HIGH side of the shifter│                  │
      │  └──────────────────────────────────────┘                  │
      │                                                            │
      └────────────────────────────────────────────────────────────┘
```

**Wiring rules that this diagram encodes:**

| Rule | Consequence if broken |
|---|---|
| One common ground for **all** modules, including the shifter's low side | Intermittent I²C errors, misreported sensor faults, erratic gas baseline |
| I²C pull-ups reference **3.3 V only** on the ESP8266 side | 5 V on a GPIO destroys the ESP8266 |
| 100 nF decoupling at every module | Brown-outs during Wi-Fi transmit bursts produce false sensor faults |
| The MQ-135 analog output **never** reaches the ESP8266 A0 | Out-of-range input on a non-5 V-tolerant pin |
| The LCD is powered **last**, after the shifter is identified | Unknown voltage translation on a live bus |

---

## 6. MQ-135 analog path — divider and ADS1115

### 6.1 The network

```text
      MQ-135 A0 ●──────[ 4.7 kΩ ]──────┬────── ADS1115 AIN0
                                       │
                                  [ 2.2 kΩ ]
                                       │
                                      GND

  Divider scale  = 2.2k / (4.7k + 2.2k) = 2.2 / 6.9 = 0.3188
  AIN0 ceiling   = 3300 mV
  Implied A0 max = 3300 / 0.3188  ≈ 10 350 mV  ≈ 10.35 V

  Plausibility window at AIN0 : 10 mV … 3300 mV
    - below 10 mV  -> implausible -> confirmed MQ-135 read fault
                       (catches a disconnected sensor reading ~0 V)
    - above 3300 mV -> implausible -> confirmed MQ-135 read fault
                       (catches a shorted divider reading full scale)
```

### 6.2 ADS1115 configuration

| Setting | Value | Reason |
|---|---|---|
| I²C address | `0x48` | ADDR strap to ground (default) |
| Channel | **AIN0** (single-ended) | The divided MQ-135 signal |
| Gain | **GAIN_ONE**, ±4.096 V full scale | Matches the divided signal with headroom. Enforced at compile time, including an assertion that the full scale is 4096 **mV**, not 4096 V. |
| Data rate | **128 SPS** | The steady-state pass averages 4 back-to-back conversions. |
| Bus clock | 100 kHz | Breadboard and shifter margin |
| Re-initialisation | Retried on the 5 s cadence, **deferred until gas warm-up completes** | An ADC that failed at boot is retried once warm-up elapses, not before |

### 6.3 MQ-135 supply voltage — unverified and blocking

| Fact | Status |
|---|---|
| The firmware's power note deliberately **excludes** the MQ-135 from the 3.3 V rail list | ● design decision |
| The divider is dimensioned to tolerate an A0 up to about 10.35 V | ● derived from the constants |
| That tolerance is consistent with a breakout intended for a **higher heater supply** | △ inference, not a measurement |
| **The exact module's supply requirement is unknown** | △ **unresolved — Q-2** |
| **The effect of supply voltage on the analog output is unknown** | △ **unresolved** |
| The MQ-135 heater draws significant start-up current | △ affects the 3.3 V rail budget if fed from it |

**Bench action.** Measure the supply voltage actually present at the module, and
record it in [`CALIBRATION_BASELINE.md`](./CALIBRATION_BASELINE.md). Until then the
gas baseline is provisional. Highest bench priority **after** the DS3231 charging-path
check.

### 6.4 Divider values are placeholders

The 4.7 kΩ / 2.2 kΩ values are **assumed**. They are also written into the gas
baseline record, so changing them **invalidates a stored baseline** and forces a
recapture. Measure the fitted resistors with a multimeter (resistor removed from
the circuit, or lifted at one end) and update the constants and the table if they
differ from nominal.

### 6.5 Digital output D0 is unused

A hardwired digital threshold compares against an on-module potentiometer with no
traceability to the zone baseline. **Leave D0 open.** The analog path carries a
documented baseline and delta instead.

---

## 7. LCD and the BSS138 level shifter

> ⚠ **Hard gate.** The LCD must not be powered until this section is satisfied.

The I²C bus runs at 3.3 V on the ESP8266 side. A common HD44780 I²C backpack is a
5 V part. A level translator sits between them.

```text
                     3.3 V DOMAIN                5 V DOMAIN
                   (ESP8266 side)              (LCD side)

              ┌──────┐                       ┌──────┐
   3V3 ───────┤ 4.7k ├─────┐          ┌──────┤ 4.7k ├────── 5V
              └──────┘     │          │      └──────┘
                          │          │
   I2C SDA ───────────────┤          ├────────────── LCD SDA
   (GPIO4)                 │  shifter │                 (0x27)
   [4.7k-10k               │   BSS138 │    [pull-ups
    pull-up to 3V3         │  type    │     live on the
    △ CONFIRM]             │  △ ?     │     backpack]
                          │          │
   I2C SCL ───────────────┤          ├────────────── LCD SCL
   (GPIO5)                 │          │                 (0x27)
   [4.7k-10k               └──────────┘
    pull-up to 3V3]

   LV = 3V3        HV = 5V        GND = common on BOTH sides
```

| Check | Requirement | Method | Status |
|---|---|---|---|
| **Part type** | The shifter is **bidirectional** (BSS138-type), **not** a unidirectional MOSFET shifter. | Read the part marking on the board. | △ **critical — Q-10** |
| **Low-side reference** | LV = **3.3 V**. | Continuity to the 3V3 rail. | △ |
| **High-side reference** | HV = **5 V**. | Continuity to the 5 V rail. | △ |
| **Low-side pull-ups** | The **only** ESP8266-side I²C pull-ups go to 3.3 V. There is **no** pull-up to 5 V on the ESP8266 side. | Measure idle SDA and SCL on the low side. Both must sit at 3.3 V. | △ **critical** |
| **High-side pull-ups** | The 5 V side carries its own pull-ups, normally already on the backpack. | Measure idle SDA and SCL on the high side. | △ |
| **Common ground** | The shifter's GND is the **same** ground as everything else. | Continuity check. | △ |
| **LCD supply** | The LCD module is powered at 5 V **only** after the checks above. | Sequencing, not inspection. | △ |
| **Address** | `0x27` (configurable via backpack jumpers). | Bus scan after power. If it answers elsewhere, update the constant and re-scan. | △ |

**If the fitted part is unidirectional:** a unidirectional MOSFET shifter cannot
translate the I²C clock stretching that the HD44780 performs. The LCD connection
must be redesigned — do not attempt to make it work with a substitute
bidirectional board that fits, and verify the backlight and contrast are controlled
separately from the data lines.

---

## 8. DHT11 data pull-up

> ⚠ **Hardware gate, not a software setting.** The firmware never enables a
> software pull-up, and the ESP8266 pin used here offers no usable one. **No
> software change can substitute for the resistor.**

```text
        3V3
         │
     [4.7k – 10k]      ← REQUIRED unless the breakout already carries one
         │
         ├────────────── DHT11 DATA  ──────── ESP8266 GPIO16  (silkscreen D0)
         │                            △
   DHT11 VCC ──> 3V3              verify the idle level reads
   DHT11 GND ──> common ground      3.3 V, NOT floating
```

| Requirement | Why | Verification |
|---|---|---|
| External **4.7 kΩ – 10 kΩ** pull-up from DATA to **3.3 V** | The single-wire bus is single-ended; without a defined high level the line floats | Power the ESP8266 with the DHT11 connected and **nothing else on the bus**. Measure DATA idle. It must read 3.3 V, not floating. |
| Pull to **3.3 V**, never 5 V | The DHT11 module's data line is not 5 V tolerant on the ESP8266 side | Continuity from the resistor's top terminal to the 3V3 rail. |
| The firmware requests **humidity only** | The DHT11's temperature output is never read anywhere in the system. There is no discarded value and no DHT11 temperature in any log, alert, or telemetry field. | By construction — the BMP280 is the sole temperature source. |
| An open-circuit symptom worth knowing | A floating line reads humidity as **permanently unavailable**, which surfaces as *Data Unavailable* rather than a wrong number | If humidity is permanently unavailable and the DHT11 is otherwise correct, suspect the missing pull-up. |

**Open decision Q-12:** whether the fitted breakout already carries a DATA
pull-up. Measure it (P11 in the safety checklist). A floating line is a *silent*
demo failure, not a loud one.

---

## 9. DS3231 / CR2032 — mandatory pre-power gate

> ### ⚠ STOP. Do not apply power until this gate passes.
>
> Many HW-084-style DS3231 breakout boards **charge the installed primary CR2032
> cell from 5 V / VIN**. A CR2032 is a **primary** cell: it is not rechargeable.
> Applying 5 V to a charging path built for a rechargeable cell can leak, vent,
> or rupture the coin cell — and a venting coin cell inside a refrigerator is a
> chemical-safety incident, not a component failure.

| Check | Requirement | Method | Status |
|---|---|---|---|
| **Charging path disabled** | The on-board charging path to the CR2032 must be **open** before the module is ever powered | Per the **exact** module schematic — usually a resistor, a diode, or a board link that must be cut or removed | △ **CRITICAL GATE** |
| **No current path to the cell** | Confirm with a multimeter that no charging current can reach the cell | Continuity or diode mode, with the cell removed if practical | △ **CRITICAL GATE** |
| **Operate at 3.3 V only** | Power the module from the board's **3.3 V** rail. **Never from 5 V / VIN.** | Wiring inspection | △ **CRITICAL GATE** |
| **No 5 V leakage at 3.3 V** | At 3.3 V, confirm no onboard pull-up or regulator is tied to 5 V / VIN | Schematic plus multimeter | △ |
| **Cell installed correctly** | Observe the correct polarity marking on the holder | Visual | △ |
| **RTC retention** | After power removal the clock must be retained and still trusted | `RTCEPOCH`, remove USB for 60 s, restore power, then `STATUS` | △ evidence EV-4 |

**Evidence required before the gate is considered passed:** a photograph of the
modified board and a multimeter reading showing the charging path open.

---

## 10. RC522 SPI map

The ESP8266's hardware SPI is fixed to GPIO12 / 13 / 14 / 15. This is exactly why
the reader's **reset** line was moved to the expander rather than consuming a fifth
GPIO.

| RC522 pin | ESP8266 net | Typical silkscreen | Direction | Notes |
|---|---|---|---|---|
| **MISO** | **GPIO12** | D6 | Input | Not a boot-strapping pin. |
| **MOSI** | **GPIO13** | D7 | Output | |
| **SCK** | **GPIO14** | D5 | Output | |
| **NSS / SS** | **GPIO15** | D8 | Output | ⚠ **Must be LOW at reset.** The board pulls down; some breakouts fit a pull-up. △ Measure before first power-on. |
| **RST** | **PCF8574 P5** | — | Output via expander | **Active low.** Logic-level input — may be driven directly, no driver needed. Pulsed once during setup, then held released for the whole session. |
| **IRQ** | **Unused** | — | — | Passed to the library as an unused pin. The card poll is a bounded synchronous exchange, so an interrupt is not needed. |
| **3.3 V** | 3V3 rail | 3.3V | Power | **The RC522 is a 3.3 V part.** |
| **GND** | Common ground | GND | Power | |

> ### ⚠ A genuinely confusing silkscreen
>
> Many RC522 breakouts silkscreen the chip-select pin as **"SDA"**. That is **not**
> the I²C SDA net. On this reader, that pin is the SPI **NSS / SS** line and goes
> to **GPIO15**. Two different nets on the ESP8266 are both labelled "SDA" on
> two different boards in this build. Read the pin labels relative to the RC522's
> own function names — MISO, MOSI, SCK, SS — and never by the word "SDA" alone.

**Expected startup result.** The firmware reads the reader's version register and
accepts `0x91` or `0x92`. Any other value sets an **optional** fault bit, which
degrades item *identity* only — never a freshness verdict. If the board fails to
boot after attaching the reader, suspect the GPIO15 pull-up.

**Cost note.** The reader is polled every 500 ms with a bounded synchronous SPI
exchange. This occupies the loop for the duration of each transaction.

---

## 11. Reed switch, LED drivers, buzzer, flyback

### 11.1 Reed switch

```text
        3V3
         │
   [10 kΩ]  △ OPTIONAL external pull-up, fit only if the P0 idle
         │      level proves unstable with real contacts
         │
   PCF8574 P0  ●──── reed contact ───── GND

   Contacts closed  -> P0 = LOW  -> door CLOSED
   Contacts open    -> P0 = HIGH -> door OPEN
   (firmware treats "not LOW" as open; the closed level is asserted
    at compile time, because this wiring requires it)
```

| Property | Value | Status |
|---|---|---|
| Poll interval | 50 ms | ● |
| Debounce window | 80 ms | ● |
| Door-open timeout | 30 s from the debounced open transition | ● |
| Alert cadence | **Once per open cycle**, not once per poll | ● |
| Quasi-bidirectional pull-up | Weak — about 100 µA typical | △ |
| External 10 kΩ pull-up | Fit only if measured idle/closed levels are unstable | △ |

### 11.2 Inductive-load protection — flyback diode

```text
   PCF8574 P4 ──[driver base/gate]── NPN/NMOSFET ──+── Buzzer ── GND
                                               │
                                     +════════+  │   cathode -> + side
                                     |  FLYBACK|  │
                                     |  DIODE  |◄─┘   anode   -> GND side

   (Reed coil, if your reed switch has one: same arrangement
    across the coil, cathode to the P0-connected side.)
```

| Rule | Detail |
|---|---|
| **Diode polarity** | **Cathode to the + side** of the inductive load, **anode to ground.** Getting this backwards is a dead short across the driver. |
| **Which loads need it** | Buzzer (if inductive) and any reed coil. LED strings do not need one. |
| **Verify before assembly** | △ Diode-mode measurement of the assembled board, or at minimum a careful visual polarity check. |
| **Driver is mandatory** | △ A high-current LED or buzzer connected directly to a quasi-bidirectional port exceeds its drive capability and is explicitly forbidden. |
| **Series resistors** | △ 220 – 330 Ω on every indicator LED, without exception. |

### 11.3 Indicator LED wiring

```text
   PCF8574 P1 ──┬──[ 220-330 Ω ]──|>|── GND     GREEN
   PCF8574 P2 ──┬──[ 220-330 Ω ]──|>|── GND     YELLOW
   PCF8574 P3 ──┬──[ 220-330 Ω ]──|>|── GND     RED
                │
                └── each branch passes through its own NPN/NMOSFET
                    driver; the port drives the base/gate only.
```

| Condition | Green (P1) | Yellow (P2) | Red (P3) | Buzzer (P4) |
|---|---|---|---|---|
| Fresh / Normal | On | Off | Off | Off |
| Use Soon | Off | On | Off | Off unless an alert is active |
| Check Food | Off | Off | **Solid** | 3 beeps, 200 ms on / 150 ms off |
| Sensor Fault / Data Unavailable | Off | Off | **Blinking, 250 ms** | 3 beeps on a new fault transition |
| Any confirmed alert | Per status | Per status | Per status | 3 beeps |

LEDs are driven from the **overall** status — the most severe of the zone verdict
and every item's duration verdict — not from the zone status alone. If your
transistor drivers invert a signal, flip the single polarity constant; do not
invert inside the presentation code.

---

## 12. Power, grounding, decoupling and safety checklist

> **⚠ None of the checks below have been performed.** Each row is a requirement
> to be satisfied on the bench and recorded as evidence. A row with no evidence is
> open, not passed.

| # | Check | Requirement | Method | Status |
|---|---|---|---|---|
| **P1** | Single power source | USB 5 V from the laptop powers the board only. No second supply is connected. | Visual inspection | △ |
| **P2** | 3.3 V logic rail | The on-board regulator's 3.3 V output supplies BMP280, DHT11, ADS1115, DS3231, PCF8574, RC522 logic, and all pull-ups | Schematic check plus rail measurement under load | △ |
| **P3** | Rail capacity | The regulator and USB path must supply ESP8266 Wi-Fi transmit peaks **plus** all peripherals. Wi-Fi bursts dominate the transient budget. | Scope the 3.3 V rail during association and during an upload; keep margin; add bulk capacitance if it sags | △ |
| **P4** | 5 V tolerance | The ESP8266 is **not** 5 V tolerant. No 5 V signal may reach any GPIO. | Continuity-check every signal net back to its source rail | △ |
| **P5** | Common ground | One common ground for all modules, including the shifter's low side | Visual plus continuity check | △ |
| **P6** | Decoupling | 100 nF close to each module, plus suitable bulk capacitance | Visual inspection against the breadboard layout | △ |
| **P7** | LED current | 220 – 330 Ω series resistor on every LED driven through a transistor | Visual inspection | △ |
| **P8** | LED / buzzer port loading | No high-current LED or buzzer connected directly to a PCF8574 quasi-bidirectional output. The port switches the base or gate only. | Visual inspection | △ |
| **P9** | Reed flyback | Flyback diode across an inductive coil: cathode to the P0-connected side, anode to ground. Polarity verified before assembly. | Visual inspection plus diode-mode measurement | △ |
| **P10** | Reed pull-up | External 10 kΩ pull-up to 3.3 V on P0 if the quasi-bidirectional pull-up proves marginal with real contacts | Measure the P0 idle level and the closed level | △ |
| **P11** | DHT11 pull-up | 4.7 kΩ – 10 kΩ pull-up to 3.3 V on DATA, **fitted unless the breakout already carries one.** This is a hardware gate; the firmware cannot add it. | Measure the idle DATA level with the ESP8266 powered and the DHT11 connected. It must sit at 3.3 V, not floating. | △ |
| **P12** | I²C pull-up rail | ESP8266-side I²C pull-ups go to **3.3 V**. The 5 V side of the shifter carries its own pull-ups. There is **no** ESP8266-side pull-up to 5 V. | Measure idle SDA and SCL on **both** sides of the shifter | △ |
| **P13** | ADS1115 analog ceiling | AIN0 must remain below **3300 mV in every state**. With the 4.7 kΩ / 2.2 kΩ network this corresponds to an MQ-135 A0 of about **10.35 V** maximum. The ADS1115 absolute maximum analog input is VDD + 0.3 V. | Scope AIN0 across heater start-up and across a full gas excursion | △ |
| **P14** | Divider values | The 4.7 kΩ and 2.2 kΩ resistors are placeholders until the fitted parts are measured. | Multimeter in Ω mode, both resistors | △ |
| **P15** | DS3231 charging path | **Never power an HW-084 module at 5 V.** Disable the charging path per the exact module schematic and confirm with a multimeter that **no charging current can reach the cell.** | Multimeter: charging-path continuity removed, no current path to the cell | △ **CRITICAL** |
| **P16** | DS3231 3.3 V operation | At 3.3 V, confirm no onboard pull-up or regulator is tied to 5 V / VIN. | Schematic plus multimeter | △ |
| **P17** | Level shifter type | The shifter is **provisionally assumed** to be bidirectional BSS138-type: low side 3.3 V, high side 5 V, pull-ups on each side to its own rail. **The actual part is unknown.** | Read the part marking; confirm bidirectional, not a unidirectional MOSFET shifter | △ **CRITICAL** |
| **P18** | LCD supply sequencing | The LCD module is powered at 5 V **only** once P12 and P17 are satisfied. Until then, leave it unpowered. | Sequencing, not inspection | △ |
| **P19** | Condensation and food contact | The MQ-135 and DHT11 wiring stays clear of condensation, moisture, and direct contact with food or water. Sensor bodies are not immersed or splashed. | Visual inspection and mounting choice | △ |
| **P20** | Enclosure and placement | The assembly is placed in or near the storage environment with short wiring, without trapping moisture. | Visual inspection | △ |
| **P21** | Breadboard rail pairing | Confirm the breadboard's split-rail orientation before inserting modules. A half-inserted module bridging the split is a classic false-fault source. | Visual inspection with the board unpowered | △ |
| **P22** | Ribbon / jumper integrity | No partially-seated jumper and no bent pin. A single high-resistance contact presents as a debounced sensor fault, not as an open circuit, and is hard to diagnose later. | Visual inspection, and a continuity check of each signal net with the board unpowered | △ |
| **P23** | ESP8266 A0 open | Nothing is attached to A0. | Visual inspection | △ |
| **P24** | MQ-135 D0 open | Nothing is attached to the digital output. | Visual inspection | △ |
| **P25** | Boot pins clear | No jumper lands on GPIO0, GPIO2, EN, or RST. | Visual inspection | △ |
| **P26** | Absorbent / drainage | If the environment is a cooler box, include something that wicks condensation away from the breadboard. | Visual inspection | △ |

---

## 13. ESP8266 boot and strapping cautions

| Caution | Detail | Required action |
|---|---|---|
| **GPIO15 must be LOW during reset** | The ESP8266 samples this pin at reset to select boot mode. The RC522 NSS line is wired here. The board provides a pull-down, but some RC522 breakouts fit a pull-up on the SS line. | △ **Before first power-on**, measure GPIO15 with the RC522 attached and the board unpowered. If it reads high, remove the module's pull-up, fit a stronger pull-down (for example 4.7 kΩ), or omit the reader. |
| **GPIO0 and GPIO2 must stay untouched** | Both are boot-strapping pins. This design avoids them entirely, which is a deliberate strength. | Confirm no jumper lands on D3 / GPIO0 or the GPIO2 net during final wiring. |
| **UART0 pins reserved** | GPIO1 (TX) and GPIO3 (RX) carry the 115200-baud console the bring-up procedure depends on. | Do not share them with a peripheral. |
| **EN and RST reserved** | The auto-program circuit must keep working so the board can be re-flashed without soldering. | Do not bridge or load these pins. |
| **I²C pull-ups reference 3.3 V** | The LCD side of the shifter carries its own pull-ups to 5 V; the ESP8266 side must have **none** above 3.3 V. | △ Measure the ESP8266-side idle SDA and SCL levels before connecting the LCD. |
| **Deep sleep would forfeit the DHT pin** | If a future revision adds deep sleep, ESP8266 wake-from-reset is wired to GPIO16 — which this design already uses for the DHT11. | Recorded now as a design consequence, not a present defect. |

---

## 14. Condensation, moisture and food-contact checklist

SRS §1.7 requires that components used inside or near refrigerators, food-storage
areas, or containers be positioned safely and protected from condensation,
excessive moisture, and direct food contact.

| Requirement | Practical approach | Status |
|---|---|---|
| No direct food contact | Keep every module and its wiring out of the container with the food. The RFID tag may sit with the item; the reader and sensor bodies may not. | △ |
| No immersion or splashing | Do not rinse or wash any part of the assembly. | △ |
| Condensation management | Short wiring, no cable loops that trap water, and a drip path away from the breadboard. | △ |
| Heater self-heating is not food heating | The MQ-135 has a heater. It is a **sensor** heater, not a warming element. | ● documented |
| Temperature band reachability | An insulated box will not hold a chilled band as a refrigerator does. This changes what the excursion tests can demonstrate — open decision **Q-6**. | △ |
| Cleaning | Clean with a dry or barely damp cloth on the exterior only, with the assembly powered down and dried before re-powering. | △ |

---

## 15. Verifications still outstanding

Nothing in this document has been bench-verified. Each item below is a **gate**
that must be discharged with evidence before the corresponding wiring step in
[`INSTALLATION_AND_EXECUTION.md`](./INSTALLATION_AND_EXECUTION.md) may proceed.

| Priority | Item | Section | Evidence | Blocking? |
|---|---|---|---|---|
| 1 | DS3231 charging path disabled and verified open | [§9](#9-ds3231--cr2032--mandatory-pre-power-gate) | Photograph + meter reading | **Yes — before any power** |
| 2 | Level-shifter part identified as bidirectional | [§7](#7-lcd-and-the-bss138-level-shifter) | Part marking photo + idle levels | **Yes — before LCD power** |
| 3 | Board silkscreen confirmed against the GPIO map | [§2](#2-controller-pin-map--authoritative) | Photograph of the board | **Yes — before first power** |
| 4 | ESP8266-side I²C pull-ups reference 3.3 V | [§7](#7-lcd-and-the-bss138-level-shifter) | Continuity check | **Yes — before LCD power** |
| 5 | GPIO15 reads low at reset with the RC522 attached | [§10](#10-rc522-spi-map) | Meter reading, unpowered | **Yes — before adding the reader** |
| 6 | DHT11 DATA pull-up fitted and idle level measured | [§8](#8-dht11-data-pull-up) | Meter reading | **Yes — before expecting humidity** |
| 7 | No 5 V reaches any GPIO | P4 | Continuity check, unpowered | **Yes — before first power** |
| 8 | MQ-135 supply voltage measured and recorded | [§6.3](#63-mq-135-supply-voltage--unverified-and-blocking) | Meter reading | Yes — before trusting the gas baseline |
| 9 | Fitted divider values measured | [§6.4](#64-divider-values-are-placeholders) | Meter in Ω mode | Yes — before trusting the gas baseline |
| 10 | AIN0 stays below 3300 mV across heater start-up | P13 | Scope or meter during warm-up | Yes — before trusting the gas path |
| 11 | 3.3 V rail holds under Wi-Fi transmit peaks | P3 | Scope during association and upload | Yes — before the demo |
| 12 | Flyback diode polarity confirmed | [§11.2](#112-inductive-load-protection--flyback-diode) | Visual + diode mode | Yes — before closing the buzzer branch |
| 13 | LED driver polarity confirmed | [§11.3](#113-indicator-led-wiring) | Visual + functional test | Yes — before relying on the LEDs |

---

*FreshGuard — Wiring and Pin Map. ESP8266MOD prototype.*
*Derived from SRS v1.0, from `FOOD_STORAGE_ARCHITECTURE.md`, and from the
authoritative `FreshGuard.ino`. No physical testing is claimed or implied.*
