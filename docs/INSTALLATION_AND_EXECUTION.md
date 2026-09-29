# FreshGuard — Installation and Execution

> **SRS deliverables:** §1.9 requires **Installation Instructions** and
> **Execution Instructions**.
> **Related documents:** [`README.md`](../README.md) ·
> [`FOOD_STORAGE_ARCHITECTURE.md`](../FOOD_STORAGE_ARCHITECTURE.md) ·
> [`WIRING_AND_PIN_MAP.md`](./WIRING_AND_PIN_MAP.md) ·
> [`CALIBRATION_BASELINE.md`](./CALIBRATION_BASELINE.md) ·
> [`IOT_TEST_MATRIX.md`](./IOT_TEST_MATRIX.md)

> ## ⚠ Read this first
>
> **No step in this document has been performed.** There is no photograph, no
> measurement, and no log from a real build behind any pass criterion below.
> Every gate is written as a requirement to be satisfied on your bench, not as a
> step someone has already taken.
>
> **Steps 1 through 4 are safety gates, not setup steps.** They exist to prevent
> damage to the DS3231's coin cell and to the ESP8266. **Do not apply power
> before gate 4 passes.**

---

## Table of contents

1. [Conventions used in this document](#1-conventions-used-in-this-document)
2. [Phase A — Safety gates, before any power](#2-phase-a--safety-gates-before-any-power)
3. [Phase B — Software installation](#3-phase-b--software-installation)
4. [Phase C — Compile and flash](#4-phase-c--compile-and-flash)
5. [Phase D — Staged hardware bring-up](#5-phase-d--staged-hardware-bring-up)
6. [Phase E — First-boot serial configuration](#6-phase-e--first-boot-serial-configuration)
7. [Phase F — Sensor registration](#7-phase-f--sensor-registration)
8. [Phase G — Cloud enablement](#8-phase-g--cloud-enablement)
9. [Phase H — Calibration and baseline](#9-phase-h--calibration-and-baseline)
10. [Phase I — Demonstration](#10-phase-i--demonstration)
11. [Phase J — Reset and recovery](#11-phase-j--reset-and-recovery)
12. [Troubleshooting by symptom](#12-troubleshooting-by-symptom)
13. [Execution checklist](#13-execution-checklist)

---

## 1. Conventions used in this document

| Convention | Meaning |
|---|---|
| **GATE** | A hard safety or correctness gate. Do not proceed past a failed gate. |
| **△** | Requires bench verification. Not yet done. |
| ● | Implemented in the firmware. |
| Serial block | Text typed at the serial console. Not source code. |
| Shell block | A command run in a terminal. |

**Board FQBN:** `esp8266:esp8266:nodemcu`
**Serial console:** 115200 baud, 8N1, no flow control.

---

## 2. Phase A — Safety gates, before any power

> ### ⛔ Do not connect USB until every gate in this phase passes.
>
> Gate A1 protects a **primary cell from a charging circuit built for a
> rechargeable one**. Gate A2 protects a **3.3 V microcontroller bus** from an
> unidentified level translator. Both failures are physical damage, not a
> configuration mistake.

### Gate A1 — DS3231 charging path — **hard gate**

Many HW-084-style DS3231 breakout boards charge the installed CR2032 from 5 V or
VIN. A CR2032 is a **primary** cell. It is not rechargeable.

| Step | Action | Pass criterion | Evidence |
|---|---|---|---|
| A1.1 | With the board **completely unpowered and disconnected from USB**, identify the charging path on the DS3231 module. Consult the **exact** module schematic. | The charging component — usually a resistor, a diode, or a board link — is positively identified. | Photo of the module |
| A1.2 | Remove or open the charging path as the schematic indicates. | The path is physically open. | Photo after modification |
| A1.3 | With the coin cell **removed if practical**, measure continuity from the charging circuit to the cell contacts. | **No continuity.** No charging current can reach the cell. | Meter reading, photographed |
| A1.4 | Reinsert the coin cell, observing the polarity marking on the holder. | Correct polarity. | Visual |
| A1.5 | Record that the module will be powered from the **3.3 V** rail only, never from 5 V / VIN. | Written down. | Note in deployment log |

> **Gate A1 passes only when A1.3 shows an open path.** A visual inspection alone
> is not sufficient. File EV-3.

### Gate A2 — Level-shifter identification — **hard gate**

The LCD module is a 5 V part. The ESP8266 bus is 3.3 V. The translator between them
is **provisionally assumed** to be a bidirectional BSS138-type device, and the
actual part is unknown.

| Step | Action | Pass criterion | Evidence |
|---|---|---|---|
| A2.1 | Read the part marking on the fitted level shifter. | The part is positively identified. | Photo of the marking |
| A2.2 | Determine whether it is **bidirectional** (BSS138-type) or a **unidirectional** MOSFET shifter. | **Bidirectional.** A unidirectional device cannot translate the clock stretching an HD44780 performs, and the LCD connection must be redesigned. | Note in deployment log |
| A2.3 | Confirm the low-side reference is the **3.3 V** rail. | Continuity from LV to 3V3. | Meter reading |
| A2.4 | Confirm the high-side reference is the **5 V** rail. | Continuity from HV to 5V. | Meter reading |
| A2.5 | Confirm the **only** ESP8266-side I²C pull-ups go to 3.3 V, and that none goes to 5 V. | No ESP8266-side pull-up references 5 V. | Continuity check, board unpowered |
| A2.6 | Confirm the shifter's ground is the **same** ground as everything else. | Continuity to the common ground. | Continuity check |
| A2.7 | **Leave the LCD module unpowered until Phase D step D13.** | LCD not connected to 5 V yet. | Visual |

> **Gate A2 fails if the part cannot be identified.** In that case: do not power the
> LCD, substitute nothing, and record the blocker. Open decision **Q-10**.

### Gate A3 — Board silkscreen confirmation

| Step | Action | Pass criterion | Evidence |
|---|---|---|---|
| A3.1 | Photograph the development board, silkscreen legible. | Photograph obtained. | EV-23 |
| A3.2 | Compare every silkscreen label against the authoritative GPIO map in [`WIRING_AND_PIN_MAP.md` §2](./WIRING_AND_PIN_MAP.md). | **GPIO numbers win.** If the silkscreen disagrees, trust the GPIO number and re-read the board. | Note in deployment log |
| A3.3 | Confirm the board is a NodeMCU / D1-style ESP8266MOD. | Confirmed. | Visual |

### Gate A4 — Pre-power continuity and strapping checks

All with the board **unpowered** and USB **disconnected**.

| Step | Action | Pass criterion | Status |
|---|---|---|---|
| A4.1 | Confirm nothing is connected to the ESP8266 **A0** pin. | A0 is open. | △ |
| A4.2 | Confirm nothing is connected to the MQ-135 **D0** digital output. | D0 is open. | △ |
| A4.3 | Confirm **no 5 V reaches any GPIO.** Trace every signal net back to its source rail. | Every signal net is 3.3 V-referenced or open. | △ |
| A4.4 | Confirm no jumper lands on **GPIO0**, **GPIO2**, **EN**, or **RST**. | All four clear. | △ |
| A4.5 | Confirm the breadboard's split-rail orientation and that no module bridges the split. | Correct. | △ |
| A4.6 | Measure **GPIO15** with the RC522 attached, board unpowered. It must read LOW at reset. | Reads LOW. If it reads HIGH, remove the module's SS pull-up, fit a stronger pull-down, or omit the reader. | △ |
| A4.7 | Confirm the DHT11 breakout's DATA pull-up situation. | Record whether the breakout already carries one. | △ |
| A4.8 | Confirm LED series resistors (220–330 Ω) and transistor drivers are present for all three indicators and the buzzer. | All four branches correct. | △ |
| A4.9 | Confirm flyback diode polarity across any inductive load. | **Cathode to the + side, anode to ground.** | △ |

> ### ⛔ Phase A complete
>
> Only now may you connect USB. A failure at any gate means **stop and fix the
> wiring**, not "power it and see what happens."

---

## 3. Phase B — Software installation

### B1 — Arduino IDE path

| Step | Action | Pass criterion |
|---|---|---|
| B1.1 | Open **Tools → Board → Boards Manager**. | Opens. |
| B1.2 | Search `esp8266`; install **esp8266 by ESP8266 Community**. | Installed. **Write down the version number.** |
| B1.3 | Select **Tools → Board → NodeMCU 1.0 (ESP-12E Module)**. | FQBN corresponds to `esp8266:esp8266:nodemcu`. |
| B1.4 | Set **Tools → Flash Size** to match the board's actual flash — 4MB (FS:1MB) or larger. | Matches the board. |
| B1.5 | Select the correct **Tools → Port**. | The board appears. |
| B1.6 | Leave **Upload Speed** at the default unless uploads fail. | — |
| B1.7 | Install the **USB-to-serial driver** for the board's adapter (FTDI or CH340) if the port does not appear. | Port appears. |
| B1.8 | Use a **USB data** cable. A charge-only cable will not flash and will not open a serial port. | Port appears. |

> **Sketch folder name.** The Arduino IDE requires a sketch folder and its `.ino`
> file to share a name. This project's folder is named differently from the
> sketch, so **copy `FreshGuard.ino` into a folder named `FreshGuard`** before
> opening it in the IDE. The IDE will silently refuse to open a sketch whose
> folder name does not match.

### B2 — Arduino CLI path

```bash
# Confirm the toolchain
arduino-cli version
arduino-cli core list

# Install or update the board package
arduino-cli core update-index
arduino-cli core install esp8266:esp8266

# Confirm the exact FQBN and its options resolve
arduino-cli board details --fqbn esp8266:esp8266:nodemcu

# List connected boards to find the port
arduino-cli board list
```

| Step | Pass criterion |
|---|---|
| B2.1 | `core list` shows the installed `esp8266` core. **Record the version.** |
| B2.2 | `board details` resolves for `esp8266:esp8266:nodemcu`. |
| B2.3 | `board list` shows the connected board. |

### B3 — Libraries

| Library | Manager name | Required |
|---|---|---|
| DHT sensor library | Adafruit | ● |
| Adafruit BMP280 Library | Adafruit | ● |
| Adafruit ADS1X15 | Adafruit | ● |
| Adafruit RTClib | RTClib | ● |
| LiquidCrystal I2C | Frank de Brabander (widely mirrored) | ● |
| MFRC522 | Miguel Balboa | ○ optional identity |
| ESP8266 core (Wi-Fi, HTTP, TLS, LittleFS, Wire, SPI) | Board package | ● |

CLI:

```bash
arduino-cli lib install "DHT sensor library"
arduino-cli lib install "Adafruit BMP280 Library"
arduino-cli lib install "Adafruit ADS1X15"
arduino-cli lib install "RTClib"
arduino-cli lib install "LiquidCrystal I2C"
arduino-cli lib install "MFRC522"

arduino-cli lib list        # record the resolved versions
```

| Step | Pass criterion |
|---|---|
| B3.1 | All required libraries resolve. **Record every resolved version.** |
| B3.2 | The LCD library offers a two-argument begin call taking a column count and a row count, together with backlight and no-backlight calls. | **⚠ Several incompatible forks share this name.** If the build fails on the LCD, substitute a different fork rather than editing the sketch. |
| B3.3 | The build environment record in [`CALIBRATION_BASELINE.md` §3.5](./CALIBRATION_BASELINE.md) is filled in. |

---

## 4. Phase C — Compile and flash

### C1 — Compile before touching hardware

```bash
arduino-cli compile --fqbn esp8266:esp8266:nodemcu --warnings all FreshGuard
```

Or in the IDE: **Tools → Verify**.

| Step | Action | Pass criterion |
|---|---|---|
| C1.1 | Compile with all warnings enabled. | Compiles successfully. |
| C1.2 | Read the warnings. | Recorded. Some are benign; unexpected ones are not. |
| C1.3 | Understand what a successful compile proves. | **Only that the code is internally consistent.** The sketch's compile-time self-checks validate configuration — distinct pin numbers, distinct I²C addresses, adequate hysteresis, correct divider ordering, correct expander direction. **They validate nothing about physical wiring.** A clean build is not a working board. |
| C1.4 | Record the core version and library versions. | Written down. |

> **The sketch prints its own disclaimer at boot:** `No physical testing is
> implied by this firmware build.` That sentence is not decoration. A successful
> compile is not evidence that the hardware works.

### C2 — Flash

```bash
arduino-cli upload --fqbn esp8266:esp8266:nodemcu --port COM5 FreshGuard
```

Or in the IDE: **Tools → Upload**.

| Step | Action | Pass criterion |
|---|---|---|
| C2.1 | Connect USB. | Board enumerated. |
| C2.2 | Flash. | Upload completes. |
| C2.3 | If the board enters a permanent boot loop, the flashing mode did not engage. | See [§11.3](#113-recovering-from-a-boot-loop). |

### C3 — Open the console

```bash
arduino-cli monitor --port COM5 --config baudrate=115200
```

| Step | Action | Pass criterion |
|---|---|---|
| C3.1 | Open the serial monitor at **115200** baud. | Connects. |
| C3.2 | Reset the board. | The boot banner appears. |
| C3.3 | Do not type anything yet. | The banner, the configuration check, and the bus scan complete on their own. |

---

## 5. Phase D — Staged hardware bring-up

> **Attach one module at a time.** Each step below isolates a failure to a single
> new component. Skipping ahead means a failure has several possible causes.

### D1 — Board alone, no peripherals

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D1.1 | With **no peripherals attached**, power the board and open the console. | Boot banner appears. | Check the USB cable and the port. |
| D1.2 | Read the boot output. | The configuration self-check reports **OK**. No fatal configuration line. | A failure here means the **constants** are wrong, not the wiring. Do not attach anything. |
| D1.3 | Read the I²C bus scan. | The scan runs at 100 kHz. | — |
| D1.4 | **Confirm the scan reports no devices.** | `no responding devices`. | If a phantom address answers, a module is still attached. Remove it. This step is the control for every later bus observation. |
| D1.5 | Note the free-heap line and the safety notice. | Both present. | — |

### D2 — PCF8574 only

The expander is the hub for the LEDs, buzzer, reed, and RFID reset. Everything
downstream depends on it.

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D2.1 | Attach the PCF8574: 3.3 V, ground, SDA, SCL. | — | — |
| D2.2 | Power-cycle. | — | — |
| D2.3 | Read the bus scan. | `0x20` is listed. | Check the address straps and the pull-ups. |
| D2.4 | Read the startup log. | The expander reports OK, with **P0 configured as input** and **P1–P5 as verified outputs**. | A config read-back mismatch is a real fault. Do not continue. |

### D3 — LED drivers

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D3.1 | With drivers and series resistors connected, command each indicator. | Green, yellow, and red each light as commanded. | If a light is inverted, flip the single output-polarity constant and re-test. **Do not** invert inside the presentation code. |
| D3.2 | Command all off. | All three turn off cleanly. | A write that does not take effect raises a real fault — the firmware verifies each output by reading the pin levels back. |
| D3.3 | Confirm the indicator follows the **overall** status, not the zone status alone. | A registered item past its limit turns the indicator red even when zone readings are acceptable. | This is deliberate single-zone behaviour. Document it rather than "fixing" it. |

### D4 — Buzzer

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D4.1 | Command a buzzer pattern. | Audible beep sequence. | Check the driver and the flyback diode polarity. |
| D4.2 | Watch the log. | **No expander write fault is reported.** | A write fault here means the driver is loading the port beyond its capability. |

### D5 — Reed switch

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D5.1 | Attach the reed switch between the expander input pin and ground, with the magnet in place. | — | — |
| D5.2 | Read `STATUS`. | Door state is consistent with the physical position. | Contacts **closed = LOW = door closed.** If inverted, the wiring is wrong — the firmware asserts this level at compile time. |
| D5.3 | Move the magnet rapidly, repeatedly. | **No chatter.** Door state changes cleanly. | If it chatters, the quasi-bidirectional pull-up is too weak. Fit the external 10 kΩ pull-up. |
| D5.4 | Remove the magnet and leave it removed. | Door reads OPEN, with a log line. | — |

### D6 — BMP280

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D6.1 | Attach the temperature/pressure sensor. | — | — |
| D6.2 | Power-cycle and read the bus scan. | `0x76` is listed. | If it answers at `0x77`, the address strap differs — update the constant and re-scan. |
| D6.3 | Wait one poll interval. | Temperature and pressure appear. | — |
| D6.4 | If the LCD is already attached and verified, check LCD page 0. | Temperature and pressure shown. | — |

### D7 — DHT11

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D7.1 | Confirm the DATA pull-up. | 4.7 kΩ – 10 kΩ to **3.3 V** fitted, **unless** the breakout already carries one. | This is a hardware requirement. **No software setting substitutes for it.** |
| D7.2 | Attach the sensor. | — | — |
| D7.3 | Power the ESP8266 with the sensor connected and nothing else on the bus; measure the DATA idle level. | Reads **3.3 V**, not floating. | A floating line reads humidity as permanently unavailable — a *Data Unavailable* state, not a wrong number. |
| D7.4 | Wait one poll interval and read `STATUS`. | Humidity present. | If permanently unavailable with the pull-up fitted, check the sensor's pinout — some breakouts label the pins differently. |

> **Note on the DHT11 temperature output.** The firmware requests **humidity only**
> and never reads the temperature output. The BMP280 is the sole temperature
> source. If a report mentions a DHT11 temperature, that is a documentation error.

### D8 — DS3231

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D8.1 | Confirm Gate A1 passed and is filed as evidence. | Evidence exists. | **Do not power the module.** Go back to Gate A1. |
| D8.2 | Attach the RTC module to the **3.3 V** rail and ground, plus SDA and SCL. | — | Never 5 V. |
| D8.3 | Power-cycle and read the bus scan. | `0x68` is listed. | An `0x57` device may also appear — that is an on-module EEPROM and is benign. |
| D8.4 | Read `STATUS`. | The clock reports available **or** explicitly reports lost power / oscillator stopped. | Both outcomes are informative. Neither blocks the next step. |

### D9 — Set and verify the clock

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D9.1 | Obtain the current Unix epoch from a trusted source. | A current epoch value. | A value below the firmware's 2024-01-01 sanity floor is rejected. |
| D9.2 | Send the command below at the serial console. | The firmware confirms the new epoch. | `Invalid epoch or RTC unavailable` means the RTC did not acknowledge, or the value is below the floor. |
| D9.3 | Read `STATUS`. | The clock reports **ready with no fault**. | — |
| D9.4 | **Gate:** item registration is blocked until the clock is trusted. | Clock trusted. | Do not attempt registration yet. |

Serial — Phase E covers this in full, but the exact call is:

```text
RTCEPOCH 1758777600
```

Replace the number with the current epoch. Expected response:

```text
[DS3231] Set to epoch <your value>
```

### D10 — Verify clock retention

| Step | Action | Pass criterion | Evidence |
|---|---|---|---|
| D10.1 | Remove USB. | Board unpowered. | — |
| D10.2 | Wait **60 seconds**. | — | — |
| D10.3 | Restore USB and read `STATUS`. | The clock is retained **and still trusted**. | EV-4 |
| D10.4 | If the clock returned but is not trusted, a `sensor_fault` is raised. | — | That is a Fail against SRS §1.6-ix. Investigate the cell and the holder. |

### D11 — RC522 RFID reader

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D11.1 | Confirm Gate A4.6 passed — GPIO15 reads LOW at reset with the reader attached. | Confirmed. | If HIGH, remove the module's SS pull-up, fit a stronger pull-down, or omit the reader. |
| D11.2 | Attach the reader: MISO → GPIO12, MOSI → GPIO13, SCK → GPIO14, NSS/SS → GPIO15, RST → **expander P5**, 3.3 V, ground. | — | ⚠ **Do not confuse the reader's "SDA" silkscreen with I²C SDA.** On many RC522 boards that pin is the SPI chip-select. Read MISO / MOSI / SCK / SS. |
| D11.3 | Power-cycle. | The board **boots normally**. | If the board fails to boot, suspect the GPIO15 pull-up. |
| D11.4 | Read the startup log. | The reader reports a version of `0x91` or `0x92`. | Any other version sets an **optional** fault. Item identity is degraded; freshness is unaffected. |
| D11.5 | Present a tag. | The serial log prints a UID. | — |

### D12 — MQ-135 through the divider

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D12.1 | Measure and **record** the supply voltage at the module. | A measured value, written into [`CALIBRATION_BASELINE.md` CB-G1](./CALIBRATION_BASELINE.md). | This is a blocking measurement. |
| D12.2 | Measure and record the fitted divider values. | Both recorded as CB-G2 and CB-G3. | If they differ from the compiled constants, update the constants — this **invalidates any stored baseline** and forces a recapture. |
| D12.3 | Wire the divider exactly as specified. | MQ A0 → 4.7 kΩ → AIN0 node, with 2.2 kΩ from the AIN0 node to ground. | — |
| D12.4 | Confirm **D0 is unconnected** and **A0 is unconnected**. | Both open. | — |
| D12.5 | Power-cycle. | The gas state progresses. | — |
| D12.6 | Watch the gas state. | warming → capturing baseline → ready. | A plausible-range rejection at any point indicates a wiring or divider problem, not a gas condition. |
| D12.7 | Confirm the ADC input stayed below its ceiling. | The divided input remained under 3300 mV in every state. | Exceedance means the divider values are wrong for this module's output range. |

### D13 — LCD, and only now

| Step | Action | Pass criterion | If it fails |
|---|---|---|---|
| D13.1 | Confirm Gate A2 passed. | Evidence exists. | **Stop.** Do not power the LCD. |
| D13.2 | Measure idle SDA and SCL on **both** sides of the shifter. | ESP8266 side at 3.3 V; LCD side at 5 V. | Any 5 V on the ESP8266 side is a stop condition. |
| D13.3 | Power the LCD module. | — | This is the first time 5 V is applied to the LCD. |
| D13.4 | Power-cycle and read the bus scan. | `0x27` is listed. | If it answers elsewhere, update the constant and re-scan. |
| D13.5 | Watch the display. | Pages rotate. | — |
| D13.6 | Send `LCD OFF`, then `LCD ON`. | Backlight switches; paging resumes after `ON`. | Note: `LCD OFF` also **stops page updates**, so the display freezes at its last content rather than refreshing dark. This is intended. |

### D14 — Confirm persistence

| Step | Action | Pass criterion | Evidence |
|---|---|---|---|
| D14.1 | Confirm the alert queue, the inventory store, and the gas baseline exist in the on-board filesystem. | All three present after a successful boot. | EV-19 |
| D14.2 | Power-cycle. | The persisted gas baseline reloads and matches the current configuration. | EV-19 |
| D14.3 | Read `QUEUECOUNT` and `BASELINE`. | Both report coherent values. | — |

---

## 6. Phase E — First-boot serial configuration

### E1 — Console setup

| Step | Action | Pass criterion |
|---|---|---|
| E1.1 | Open the console at 115200 baud. | Connects. |
| E1.2 | Send `HELP`. | The command list is printed. It is also printed automatically at boot. |
| E1.3 | Note the line-length limit. | Lines are capped at **256 bytes**. An over-long line is discarded with a warning rather than partially executed. |

### E2 — Read the current state

Send these in order and keep the output. This is your baseline record.

| Command | What it tells you |
|---|---|
| `STATUS` | Zone status, overall status, confirmed sensor faults, storage/admin faults, per-sensor readiness, gas baseline / input / delta, door state, optional-function state. **The complete, untruncated fault source.** |
| `LIST` | Registered items with their duration verdicts. |
| `QUEUECOUNT` | Pending events and queue capacity. |
| `BASELINE` | Gas state; when ready, baseline, current, and delta in millivolts. |

> **Read `STATUS` carefully before changing anything.** If it already shows a
> storage/admin fault, fix that first — it will otherwise confuse every later step.

### E3 — Display control

| Command | Effect |
|---|---|
| `LCD ON` | Backlight on, paging resumes |
| `LCD OFF` | Backlight off **and** page updates stop — the display freezes at its last content |

---

## 7. Phase F — Sensor registration

### F1 — Confirm prerequisites

| Step | Check | Blocking? |
|---|---|---|
| F1.1 | The bus scan shows all expected devices. | Yes — register nothing until the zone can be evaluated |
| F1.2 | The clock is trusted (`STATUS` shows it ready). | **Yes** — registration is refused without a valid clock |
| F1.3 | The gas path is `ready`, or you accept a Data Unavailable display until it is. | No, but note it |
| F1.4 | You have an RFID tag UID in hand for the item. | Yes, for the RFID-based flow |

### F2 — Register an item

```text
REG A1B2C3D4|Milk|Dairy|1|Door shelf|5|0
```

| Field | Rule |
|---|---|
| UID | 2 – 20 hex characters, even length, no separators. Up to 10 bytes. Use the tag's UID from the reader log. |
| name | Required, non-empty, up to 23 characters. |
| category | Up to 15 characters. Defaults to `Other` if empty. |
| qty | Up to 11 characters. Defaults to `1` if empty. |
| location | Up to 23 characters. Defaults to `Storage zone` if empty. |
| days | 0 – 3650. Storage-duration limit. |
| expiryEpoch | Unix epoch seconds, or `0` to use the duration limit. |

| Constraint | Behaviour |
|---|---|
| At least one of `days` or `expiryEpoch` | Must be non-zero, or registration is refused |
| A valid clock | Required; registration is refused otherwise |
| An **expiry in the past** | **Rejected.** Data-integrity protection. See open decision **Q-5** |
| Duration of zero with no expiry | Rejected |
| Inventory capacity | **12 items maximum.** A 13th is refused; remove an item first |

Expected response on success:

```text
[Inventory] Registered A1B2C3D4 (stored day <epoch>)
```

### F3 — Update an item

Send `REG` again with the **same UID** and changed metadata.

| Property | Expected behaviour |
|---|---|
| Store date | **Preserved.** An accidental re-registration must not reset the item's age. |
| Item count | Does **not** increase. |
| Metadata | Updated. |
| Response | Reads `Updated` rather than `Registered`. |

Verify with `LIST` and compare the store date against the first registration.
This is test row **T-20**.

### F4 — Remove an item

```text
REMOVE A1B2C3D4
```

Expected response:

```text
[Inventory] Removed and saved
```

### F5 — Prepare a demonstration item

> **A demonstration must register at least one item.** With an empty inventory the
> overall status equals the zone status, and **Use Soon can never occur**.

Items cannot be backdated, and a one-day duration needs roughly 18 hours to reach
Use Soon. To reach both Use Soon and Check Food inside one demo session, register
an item with a **near-future expiry epoch**:

| Step | Action |
|---|---|
| F5.1 | Note the current Unix epoch. |
| F5.2 | Choose a window of a few **hours**, expressed in seconds. |
| F5.3 | Compute the target epoch: current epoch plus the window in seconds. |
| F5.4 | Register the item with that value in the expiry field, and `0` in the days field. |
| F5.5 | Confirm the store date is *now*, so the window is exactly what you chose. |
| F5.6 | Use Soon arrives at 75 % of the window; Check Food at the end. |

This uses **only the documented registration command** — no code change — and it
exercises the real expiry path. Open decision **Q-4**.

### F6 — Verify registration

| Command | Expected |
|---|---|
| `LIST` | The item appears with a valid store date and a duration verdict. |
| `STATUS` | Overall status reflects the most severe of the zone and item verdicts. |

---

## 8. Phase G — Cloud enablement

> ### 🔒 Nothing in this phase is optional, and nothing in it is safe to skip.
>
> **The submitted sketch must contain only `REPLACE_ME…` placeholders and no valid
> fingerprints.** Real values go into a **local, unsubmitted** copy. Keep the
> tracked file clean.

### G1 — Prepare a local working copy

| Step | Action | Rationale |
|---|---|---|
| G1.1 | Copy the sketch into a **local, unsubmitted** folder. | Every build, backup, and archive of the tracked file must stay secret-free. |
| G1.2 | Never copy the flashed copy back over the tracked file. | The tracked source must remain placeholder-only at all times. |
| G1.3 | If your workflow allows it, move credentials to an untracked header or a build-time define. | The strongest form of the rule. |

### G2 — Wi-Fi credentials

| Step | Action | Pass criterion |
|---|---|---|
| G2.1 | Set the SSID and password in the local copy. | Non-placeholder values. |
| G2.2 | Flash. | — |
| G2.3 | Read the boot log. | A connection line with an address appears. |
| G2.4 | Confirm the placeholder warning is **absent**. | No line saying the credentials are placeholders. |

> **If the credentials stay as placeholders, the device is fully functional in
> offline mode.** Sensing, freshness analysis, local alerts, buffering, and the
> serial interface all work. Only cloud synchronisation and remote notification
> are suspended. SRS §1.6-xv explicitly requires this.

### G3 — Certificate fingerprints

| Step | Action | Pass criterion |
|---|---|---|
| G3.1 | Obtain the current certificate fingerprint **for each host** through a **trusted channel**. | Not from an unverified source. |
| G3.2 | Record the **source** and the **date** of each fingerprint in your deployment notes. | Written down. Fingerprints are not secret, but they are environment-specific. |
| G3.3 | Replace the fingerprint array in the local copy. | Real values. |
| G3.4 | Set the matching enable flag to `true` **in the same edit**. | Both changed together. |
| G3.5 | Do this for each service independently. | — |

> **Fingerprints are per host and break silently on certificate rotation.** A
> changed certificate stops telemetry until the value is updated. This is a
> known fragility of the design, not a defect in your setup.

### G4 — Enable telemetry

| Step | Action | Pass criterion |
|---|---|---|
| G4.1 | Set the telemetry write key. | The **write** key is for the device only. Any dashboard should read with a **separate read key**. |
| G4.2 | Flash and reboot. | A telemetry line reports a 2xx status. |
| G4.3 | Open the channel. | All eight fields populated. |
| G4.4 | Confirm the sentinel convention. | Unavailable values appear as the documented sentinel, never as a plausible-looking number. |

**Telemetry field contract — what each field means:**

| Field | Meaning | Unit |
|---|---|---|
| 1 | Temperature | °C |
| 2 | Relative humidity | % RH |
| 3 | Gas input at the ADC input | **mV — relative, never ppm** |
| 4 | Gas delta from the stored baseline | **mV** |
| 5 | Door state | 0 closed / 1 open |
| 6 | **Overall** freshness status | 0 Fresh/Normal, 1 Use Soon, 2 Check Food, 3 Sensor Fault |
| 7 | Pressure | hPa — context only, no threshold |
| 8 | Combined confirmed fault mask | 16-bit bit field |

> **Field 6 is the *overall* status, not the zone status.** Use Soon is reachable
> only through registered inventory.

### G5 — Enable remote notification

| Step | Action | Pass criterion |
|---|---|---|
| G5.1 | Set the webhook key. | — |
| G5.2 | **Configure the webhook action for the value combinations you actually care about.** | The action fires for those combinations. |
| G5.3 | Trigger one test alert. | A notification arrives containing the event ID, the type token, and the message. |
| G5.4 | Confirm the queue clears only after a 2xx. | A non-2xx leaves the event queued. |

> ⚠ **Only the alert type and message fields actually vary.** The identity field
> is a fixed string and the webhook event name is fixed in the firmware. An action
> configured to match only the fixed values will **not** fire when the type or
> message differs. This is a configuration step, not a code change.

### G6 — Verify the interlock before and after

| Step | Action | Pass criterion |
|---|---|---|
| G6.1 | With placeholders in place, capture the boot log. | Both services print a line saying they are disabled until a key **and** a verified fingerprint are set. File as EV-27. |
| G6.2 | Confirm no request is attempted and no connection is opened. | No traffic. |
| G6.3 | After enabling, confirm requests succeed. | 2xx status lines. |

**A working interlock refuses to transmit.** That refusal is the security control
working, and it is worth capturing as evidence before you enable anything.

### G7 — Rotate after any public demonstration

| Step | Action |
|---|---|
| G7.1 | After any demonstration, **rotate the telemetry write key and the webhook key.** |
| G7.2 | A leaked webhook key lets anyone post fake alerts to your notification channel. |
| G7.3 | Confirm the submitted project file contains **only placeholders**. |
| G7.4 | Scrub any captured serial log before submitting it. |
| G7.5 | Check every screenshot and the video for visible keys, channel identifiers, and URL bars. |

---

## 9. Phase H — Calibration and baseline

Execute [`CALIBRATION_BASELINE.md` §4](./CALIBRATION_BASELINE.md) in order. It
begins with the safety gates, then the fingerprint record, then the measurements.

| Step | Action | Pass criterion |
|---|---|---|
| H1 | Complete the fingerprint record (core version, library versions, board, FQBN, environment). | Every cell filled. **Nothing is comparable without this.** |
| H2 | Measure and record the MQ-135 supply voltage. | **CB-G1 filled.** This is the blocking measurement. |
| H3 | Measure and record the fitted divider values. | **CB-G2, CB-G3 filled.** |
| H4 | Capture temperature, pressure, and humidity. | CB-T and CB-H rows filled. |
| H5 | Let warm-up complete, then capture the gas baseline. | **CB-G9 filled**, in millivolts. |
| H6 | Repeat the baseline capture three times. | **CB-G10 filled.** |
| H7 | Perform a controlled gas excursion. | Peak value and peak delta recorded. |
| H8 | **Judge the abnormal delta against the observed noise** and record the decision. | **CB-G13 filled**, with reasoning. |
| H9 | Time the door-open alert. | CB-D2 filled. |
| H10 | Time threshold detection and local response, **separately**. | CB-T3b, CB-T4b, CB-T5b filled and labelled. |
| H11 | Attach evidence IDs. | Every Pass row has one. |

> **Do not fill a cell you did not measure.** Mark it *Not measured*. An honest gap
> is far more defensible than an invented number, and an invented number is a false
> claim that an evaluator can check.

---

## 10. Phase I — Demonstration

### I1 — Before the demonstration

| Step | Check | Pass criterion |
|---|---|---|
| I1.1 | All Phase A gates passed and evidenced. | Evidence exists. |
| I1.2 | The clock is set and trusted. | `STATUS` confirms. |
| I1.3 | At least one item is registered. | `LIST` shows it. |
| I1.4 | A short-window demo item is registered. | Use Soon and Check Food are both reachable. |
| I1.5 | The gas path is `ready`. | `BASELINE` reports ready. |
| I1.6 | Credentials are configured — **or** you have decided to demonstrate offline and say so. | Deliberate. |
| I1.7 | The serial log is being captured for the whole session. | EV-26. |
| I1.8 | **No screenshot will expose a key, a channel identifier, or a URL bar.** | Checked. |

### I2 — Demonstration order

Follow the beats in [`README.md` §10](./../README.md#10-demonstration-flow) and
record evidence against the corresponding rows in
[`IOT_TEST_MATRIX.md`](./IOT_TEST_MATRIX.md).

| Beat | Test row | Evidence |
|---|---|---|
| Identity — present a registered tag | T-01 | EV-26 |
| Normal state | T-01 | EV-1, EV-7 |
| Gas warm-up and baseline | T-10 | EV-7 |
| High temperature | T-02 | EV-10 |
| Abnormal humidity | T-03 | EV-11, EV-24 |
| Abnormal gas | T-04 | EV-8, EV-5 |
| Door left open | T-05 | EV-12 |
| Use Soon | T-06 | EV-17 |
| Check Food | T-07 | EV-17 |
| Sensor fault | T-08 | EV-14 |
| Offline resilience | T-11 | EV-16 |
| Reconnection and sync | T-12, T-13 | EV-17 |
| Dashboard | T-01 | Dashboard capture |
| Storage/admin fault | T-17 | EV-20 |

### I3 — The mandatory video

| Step | Action | Pass criterion |
|---|---|---|
| I3.1 | Record sensor monitoring. | Visible. |
| I3.2 | Record the freshness-condition status changing. | Visible. |
| I3.3 | Record threshold alerts — buzzer and indicator. | Audible and visible. |
| I3.4 | Record the dashboard and data visualisation. | Visible. |
| I3.5 | Capture a clock in frame where a timing claim is made. | Otherwise the timing claim is unverifiable. |
| I3.6 | **Check the whole video for exposed credentials.** | None visible. |
| I3.7 | Save as `.mp4`. | SRS §1.9 requires this file. |

### I4 — What to say, and what not to say

| Say | Never say |
|---|---|
| "The gas reading is a relative change in millivolts against a stored baseline." | "The gas level reached X ppm." |
| "Check Food means a human should inspect it." | "The food is spoiled." / "The food is unsafe." / "Discard the food." |
| "The system reports that a required sensor is unavailable." | "The system says the food is fine." |
| "These thresholds are controlled prototype assumptions." | "These are the correct storage limits." |
| "Item-level data is held on the device and is not published to the platform." | "The dashboard shows your inventory." |
| "Local alerts continue during a network outage." | "Nothing is lost." *(unacknowledged events are retained, ordering is best-effort, and a duplicate is deliberately possible in preference to a silent loss)* |

---

## 11. Phase J — Reset and recovery

### 11.1 Soft reset

| Step | Action | Effect |
|---|---|---|
| J1.1 | Send `REG`-class data changes rather than rebooting where possible. | No state is lost. |
| J1.2 | If a soft reset is needed, use the board's reset button. | RAM-only latches reset. Per-item alerts may re-fire after restart — the event ID differs, so a receiver can distinguish re-fires. |
| J1.3 | Persisted data survives. | The queue, the inventory, and the gas baseline all reload. |
| J1.4 | **Runtime alert latches do not survive.** | Disclosed as a known limitation. |

### 11.2 Clearing stored data

| Step | Action | Warning |
|---|---|---|
| J2.1 | To clear **one item**, send `REMOVE <UID>`. | Preferred. Keeps everything else. |
| J2.2 | To clear **everything**, erase the flash filesystem and re-flash. | ⚠ **This deletes the alert queue, the inventory, and the gas baseline.** Take a copy of the log first. |
| J2.3 | Re-run the first-boot configuration. | The clock must be set again. |
| J2.4 | Re-register items. | The store dates are gone and will be set to the current time. |

> **An invalid existing file is left untouched for recovery**, not silently cleared,
> on purpose. If the device reports a storage fault about a file, do not erase it
> reflexively — capture it first, then decide.

### 11.3 Recovering from a boot loop

| Symptom | Likely cause | Action |
|---|---|---|
| Board resets continuously on power-up, no console output | Boot-strapping pin loaded. Most often GPIO15 held high by the RFID reader's SS pull-up. | Remove the reader, or remove its pull-up, or fit a stronger pull-down. Measure GPIO15 **unpowered** first. |
| Board resets when a module is attached | That module is loading a boot pin or injecting 5 V onto a GPIO. | Power down, disconnect that module, and re-verify continuity. |
| Board does not enumerate on USB | Charge-only cable, or a missing USB-to-serial driver. | Use a data cable; install the driver. |
| Upload fails to start | The board is not in flashing mode. | Hold **FLASH**, tap **RST**, release **FLASH**. |
| Board enumerates but no console output | Wrong baud rate. | Try 115200, then 74880, then 9600. |
| Console output is garbled | Wrong baud or a bad cable. | Lower the baud; shorten or replace the cable. |

### 11.4 Recovery by symptom

See [§12](#12-troubleshooting-by-symptom) for symptom-driven recovery.

### 11.5 Full reset — last resort

| Step | Action | Consequence |
|---|---|---|
| J5.1 | Erase the flash filesystem. | **All** stored data is lost: queue, inventory, gas baseline. |
| J5.2 | Re-flash the sketch. | — |
| J5.3 | Re-set the clock. | Item store dates restart. |
| J5.4 | Re-register items. | — |
| J5.5 | Re-capture the gas baseline. | The old baseline is gone. |
| J5.6 | Rotate any credentials that were in the flashed copy. | If the flashed copy held real keys, **rotate them**. |

---

## 12. Troubleshooting by symptom

| Symptom | Most likely cause | Check | Fix |
|---|---|---|---|
| Boot banner never appears | Wrong baud, or a boot-strapping pin loaded | Try other baud rates; measure GPIO15 unpowered | Correct the baud; clear the offending pull-up |
| Configuration self-check reports a failure | Constants are wrong, **not** the wiring | Read the fatal line | Fix the constant. Do not attach peripherals. |
| I²C scan shows no devices at D1 | Correct — nothing is attached | — | Proceed to D2 |
| I²C scan shows an unexpected address | A module is attached, or an address strap differs | Compare against the address table | Remove or re-strap, then re-scan |
| A device answers at a different address | Address strap differs from the assumption | Read the module's datasheet | Update the constant and re-scan |
| Humidity permanently unavailable | **Missing DHT11 DATA pull-up** | Measure the idle DATA level unpowered on the bus | Fit 4.7 kΩ – 10 kΩ to 3.3 V. **Software cannot fix this.** |
| Temperature shows a fault | BMP280 not answering, or a bad bus contact | Bus scan; check SDA and SCL | Re-seat; check pull-ups |
| Status is Data Unavailable right after power-up | **Normal.** The gas path is warming up. | `BASELINE` | Wait ~60–90 s |
| Data Unavailable persists well past warm-up | A required input never produced a reading | `STATUS` — the availability line names the input | Follow the named input |
| Gas never reaches `ready` | A confirmed read or plausibility fault | `BASELINE`; the serial log names the fault | Check the divider, the wiring, and the supply |
| A gas reading is rejected as implausible | Disconnected sensor, or a shorted divider | Measure the divided input | Correct the wiring; check the divider values |
| Registration is refused | The clock is not trusted, or both window fields are zero, or the expiry is in the past, or the inventory is full | `STATUS`, then `LIST` | Set the clock; supply a valid window; remove an item |
| An item's store date changed unexpectedly | It should not — the store date is preserved on update | Compare `LIST` output across registrations | Investigate; this would be a defect |
| LEDs do not light | Driver wiring, or a reversed branch | Command each indicator individually | Flip the single polarity constant; **do not** invert inside the presentation code |
| Buzzer does not sound | Driver, or flyback diode fitted backwards | Check the driver and the diode polarity | Correct the wiring |
| Buzzer latches on | The verified-write path failed | `STATUS` for an expander write fault | Check the driver load and the bus |
| LCD shows nothing | Not powered, or the shifter is wrong | Bus scan; idle levels on both sides | Confirm Gate A2; power the LCD only after it passes |
| LCD is garbled | Bus too fast for the wiring, or a marginal pull-up | — | The bus is already clocked conservatively at 100 kHz; check pull-ups and cable length |
| Wi-Fi never connects | Placeholder credentials, or no access point in range | The boot log | Configure credentials in the local copy |
| Telemetry never sends | **Both** a key **and** a verified fingerprint are required | The boot log | Supply both. This is by design. |
| Notifications never arrive | Webhook action configured for the wrong value combination | The delivery log | Reconfigure the action for the type and message you care about |
| Events never drain | No route, or a non-2xx response | `QUEUECOUNT`; the send log | Fix connectivity or the endpoint. Events are **retained**, not dropped. |
| A duplicate notification arrives | A 2xx was received but the local removal failed | The queue log | **Intended.** The design prefers a duplicate over a silent loss. Document it. |
| A storage/admin fault appears | LittleFS, inventory, queue full, or a configuration fault | `STATUS`; the storage/admin line names it | The freshness status is **unaffected** by this. Fix the named item. |
| The device is slow to respond | A synchronous operation: an HTTPS request, a queue rescan, or the RFID poll | — | Expected and bounded. Not a hang. |
| A fault clears but the gas data is not trusted | **Correct.** A new baseline is required after a gas fault. | `BASELINE` | Wait for the recapture. |
| The dashboard shows no fault during the first 90 s | **Correct.** Warm-up is display-only and sets no transmitted fault bit. | — | Explain it. It is intended. |
| The dashboard shows no item data | **Expected.** Item data is device-local. | `LIST` | Option A limitation. See the README dashboard scope section. |

---

## 13. Execution checklist

### Phase A — Safety gates

- [ ] **Gate A1** — DS3231 charging path disabled, verified open, evidence filed (EV-3)
- [ ] **Gate A2** — level shifter identified as bidirectional, evidence filed (EV-9)
- [ ] **Gate A3** — board silkscreen confirmed (EV-23)
- [ ] **Gate A4** — no 5 V on any GPIO; boot pins clear; A0 and D0 open; flyback polarity checked
- [ ] **USB connected only now**

### Phase B — Software

- [ ] Board package installed; **core version recorded**
- [ ] Board selected — FQBN `esp8266:esp8266:nodemcu`
- [ ] Port selected; data cable confirmed
- [ ] All required libraries installed; **versions recorded**
- [ ] LCD library fork confirmed to expose the expected API

### Phase C — Compile and flash

- [ ] Compiled with warnings enabled; warnings reviewed
- [ ] Compiled successfully
- [ ] Flashed
- [ ] Console open at 115200 baud

### Phase D — Staged bring-up

- [ ] D1 board alone; self-check OK; bus scan shows **no devices**
- [ ] D2 expander attached; `0x20` seen; P0 input and P1–P5 verified outputs confirmed
- [ ] D3 LED drivers verified, including polarity
- [ ] D4 buzzer verified; no write fault
- [ ] D5 reed switch verified, including debounce
- [ ] D6 temperature/pressure sensor attached; `0x76` seen
- [ ] D7 humidity sensor attached; **pull-up confirmed**; idle level measured (EV-24)
- [ ] D8 RTC attached; `0x68` seen
- [ ] D9 clock set and trusted
- [ ] D10 clock retained across 60 s power removal (EV-4)
- [ ] D11 RFID reader attached; version accepted; tag reads
- [ ] D12 gas sensor attached; supply voltage and divider values measured
- [ ] D13 LCD attached and powered **only after Gate A2**; `0x27` seen
- [ ] D14 persistence confirmed (EV-19)

### Phase E — Serial configuration

- [ ] `HELP` verified
- [ ] `STATUS` captured as the baseline record
- [ ] `LIST`, `QUEUECOUNT`, `BASELINE` captured
- [ ] `LCD ON` / `LCD OFF` verified

### Phase F — Registration

- [ ] Clock trusted (blocking prerequisite)
- [ ] At least one item registered; `LIST` confirms
- [ ] Update tested: store date **preserved**, count unchanged
- [ ] Short-window demo item registered for Use Soon and Check Food
- [ ] `REMOVE` tested if applicable

### Phase G — Cloud

- [ ] Local unsubmitted working copy in use
- [ ] Tracked file still contains **only placeholders**
- [ ] Interlock evidence captured **before** enabling (EV-27)
- [ ] Wi-Fi credentials set; placeholder warning absent
- [ ] Fingerprints obtained through a trusted channel; **source and date recorded**
- [ ] Telemetry write key set; dashboard reads with a **separate read key**
- [ ] All eight telemetry fields verified
- [ ] Webhook action configured for the value combinations you need
- [ ] One test notification received with the correct event ID
- [ ] Queue clears only after a 2xx

### Phase H — Calibration

- [ ] Fingerprint record complete
- [ ] MQ-135 supply voltage measured (CB-G1) — **blocking**
- [ ] Divider values measured (CB-G2, CB-G3)
- [ ] Temperature, pressure, humidity rows measured or explicitly marked not measured
- [ ] Gas baseline captured in millivolts (CB-G9)
- [ ] Gas excursion performed; observed delta recorded
- [ ] Abnormal delta judged against observed noise (CB-G13)
- [ ] Door timeout measured (CB-D2)
- [ ] Detection and local-response timings measured **separately** (CB-T3b, CB-T4b, CB-T5b)
- [ ] Every Pass row has an evidence ID
- [ ] **No ppm value anywhere; no food-safety claim anywhere**

### Phase I — Demonstration

- [ ] All prerequisites confirmed
- [ ] Full serial log captured (EV-26)
- [ ] All demonstration beats performed with evidence
- [ ] IoT Test Matrix executed and completed
- [ ] Demonstration video recorded and filed (EV-21)
- [ ] Video and screenshots checked for exposed credentials
- [ ] Dashboard scope decision stated: Option A or Option B

### Phase J — Recovery prepared

- [ ] Soft-reset procedure understood
- [ ] Data-clearing procedure understood, with its consequences
- [ ] Boot-loop recovery procedure understood
- [ ] Symptom table available during the session
- [ ] Key-rotation plan agreed for after any public demonstration

---

## Cross-references

| Document | Relationship |
|---|---|
| [`../README.md`](../README.md) | Overview, BOM, library list, secret handling, serial reference, demo flow |
| [`../FOOD_STORAGE_ARCHITECTURE.md`](../FOOD_STORAGE_ARCHITECTURE.md) | §13 is the upstream bring-up order; §14 the upstream evidence register |
| [`WIRING_AND_PIN_MAP.md`](./WIRING_AND_PIN_MAP.md) | Every Phase A and Phase D wiring detail, with the full safety checklist |
| [`CALIBRATION_BASELINE.md`](./CALIBRATION_BASELINE.md) | Phase H in full |
| [`IOT_TEST_MATRIX.md`](./IOT_TEST_MATRIX.md) | Phase I test rows and the evidence register |
| [`FOOD_THRESHOLD_MATRIX.md`](./FOOD_THRESHOLD_MATRIX.md) | Supplies the threshold values the Phase I beats exercise |
| [`FRESHNESS_DECISION_RULE_MATRIX.md`](./FRESHNESS_DECISION_RULE_MATRIX.md) | The rules demonstrated in Phase I and verified by row T-16 |

---

*FreshGuard — Installation and Execution. ESP8266MOD prototype.*
*No step in this document has been performed. No hardware testing, measurement, or
successful dashboard capture is claimed or implied.*
