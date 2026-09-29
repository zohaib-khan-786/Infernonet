# FreshGuard — IoT-Based Smart Food Freshness Monitor

> **Theme:** Zero Food Waste | **Category:** Smart IoT Revolution | **Competition:** TechWiz 7 (Aptech)
> **Specification:** FreshGuard SRS v1.0 | **Controller:** ESP8266MOD (NodeMCU / D1-style development board)
> **Authoritative implementation:** [`FreshGuard.ino`](./FreshGuard.ino) · **Design document:** [`FOOD_STORAGE_ARCHITECTURE.md`](./FOOD_STORAGE_ARCHITECTURE.md)

FreshGuard is a single-node, single-zone prototype that monitors the environmental
conditions inside one food-storage environment — a refrigerator, or an insulated
cooler box where a refrigerator is not available, as SRS §1.2 Note permits. It
combines those zone readings with per-item storage duration and expiry data,
applies a fixed decision rule set, and reports one of four freshness-condition
statuses locally on an LCD, three LEDs, and a buzzer.

> ### ⚠ Read this before you believe anything in this package
>
> 1. **No physical testing has been performed.** Nothing in this documentation
>    claims that a board was powered, wired, measured, or observed. The firmware
>    itself prints `No physical testing is implied by this firmware build.` at
>    boot.
> 2. **No sensor has been calibrated.** Every numeric threshold shipped in the
>    firmware is a *controlled prototype/demo assumption*. The
>    [calibration and baseline table](docs/CALIBRATION_BASELINE.md) is supplied
>    **blank**, on purpose.
> 3. **No gas concentration is reported, ever.** The MQ-135 path reports
>    ADS1115 pin millivolts and a delta from a stored baseline. It never reports
>    ppm and makes no calibration claim.
> 4. **FreshGuard does not determine food safety.** The worst outcome it can
>    report is *Check Food — requires human inspection*. Follow product labels,
>    applicable storage guidance, and normal food-safety practice regardless of
>    what any indicator shows.
> 5. **No credentials or certificate fingerprints appear in this repository.**
>    Both cloud paths are disabled by construction until you supply a key *and* a
>    verified fingerprint.

---

## Table of contents

1. [What FreshGuard does](#1-what-freshguard-does)
2. [Status legend](#2-status-legend)
3. [Hardware and bill of materials](#3-hardware-and-bill-of-materials)
4. [Provisional pin map](#4-provisional-pin-map)
5. [Installation](#5-installation)
6. [Library list](#6-library-list)
7. [USB power and safe bring-up order](#7-usb-power-and-safe-bring-up-order)
8. [Secrets and TLS configuration](#8-secrets-and-tls-configuration)
9. [Serial command reference](#9-serial-command-reference)
10. [Demonstration flow](#10-demonstration-flow)
11. [Dashboard scope — Option A vs future Option B](#11-dashboard-scope--option-a-vs-future-option-b)
12. [SRS alignment summary](#12-srs-alignment-summary)
13. [Known limitations](#13-known-limitations)
14. [Documentation package](#14-documentation-package)
15. [Open decisions awaiting an answer](#15-open-decisions-awaiting-an-answer)
16. [License and attribution](#16-license-and-attribution)

---

## 1. What FreshGuard does

FreshGuard answers one question — *is this food still in an acceptable monitored
condition, approaching its limit, or needing a human look?* — and it answers it
honestly, including when it does not know.

| Stage | What happens |
|---|---|
| **Sense** | BMP280 supplies temperature and pressure. DHT11 supplies **humidity only**. MQ-135 supplies a relative gas reading through a divider and an external ADS1115 ADC. A reed switch reports the door. |
| **Validate** | Every reading is checked for finiteness and a plausibility window, then debounced — three failures raise a fault, three successes clear it. Readings are exponentially smoothed. |
| **Decide** | A confirmed threshold latch produces a zone verdict. Each registered item produces a duration verdict from DS3231 time. The overall status is the **most severe** of the two. |
| **Respond locally** | LCD pages, one green / yellow / red LED, and a buzzer. None of this depends on Wi-Fi. |
| **Buffer** | Every confirmed alert is appended to a bounded, CRC-protected 24-slot queue in LittleFS and retained until the server acknowledges it. |
| **Publish** | Telemetry to ThingSpeak every 30 s and alert notifications through an IFTTT webhook, both over HTTPS with a pinned certificate fingerprint. Both are **switched off** in this build. |

### The four statuses

| Rank | Status | Meaning | Indicator |
|---|---|---|---|
| 3 | **Sensor Fault / Data Unavailable** | A required input is faulted or has not yet produced data. The verdict is *unknown*, not *good*. | Red LED **blinks** |
| 2 | **Check Food** | A confirmed environmental threshold violation, or an item at or past its expiry / duration limit. | Red LED solid + buzzer |
| 1 | **Use Soon** | An item has passed 75 % of its storage-duration or expiry window. | Yellow LED |
| 0 | **Fresh / Normal** | All monitored conditions are inside the configured range. | Green LED |

**The single most important behaviour:** a real required-sensor fault outranks
every food verdict, including *Check Food*. When data is missing, FreshGuard
says so rather than guessing. This is a direct requirement of SRS §1.6-vii and
§1.6-xvi, and it is why the system can never show a misleading green light.

### Scope boundary — one sentence

**One** ESP8266 node monitors **one** shared storage zone. A single MQ-135
describes that zone; it is never attributed to a specific food item. Item
verdicts come from storage duration and expiry, which are per-item.

---

## 2. Status legend

Every capability claim in this package carries one of four markers.

| Marker | Meaning |
|---|---|
| ● | **Implemented.** Present in `FreshGuard.ino` and reachable at runtime. Not necessarily proven on a bench. |
| ○ | **Planned or optional.** Described for completeness; not built. Must never be presented as delivered. |
| △ | **Requires bench verification.** A compile-time configuration value, a datasheet claim, or a wiring assumption that nobody has measured. |
| ✗ | **Not implemented**, and outside the mandatory SRS set. Listed so its absence is a decision, not an oversight. |

---

## 3. Hardware and bill of materials

### 3.1 Parts required by SRS §1.8.1

| # | Component | Qty | Role in FreshGuard | Status |
|---|---|---|---|---|
| 1 | ESP8266MOD development board (NodeMCU / D1 style) | 1 | The single controller. Runs all sensing, decision, alerting, buffering, and transport logic. | ● |
| 2 | DHT11 temperature/humidity sensor | 1 | **Humidity only.** The firmware never reads its temperature output. The BMP280 is the sole temperature source. See deviation D-1. | ● |
| 3 | MQ-135 gas / air-quality sensor | 1 | Relative gas indication for the shared zone. Digital output D0 is deliberately left unconnected. | ● |
| 4 | DS3231 RTC module (HW-084 style) | 1 | Authoritative wall-clock time for storage durations, alert timestamps, and door timing across controller power loss. | ● |
| 5 | CR2032 coin cell | 1 | RTC backup. ⚠ **Charging path must be disabled before power is applied.** | △ critical |
| 6 | Reed switch with magnet | 1 | Door open / closed. Contacts between PCF8574 P0 and ground; closed reads LOW. | ● |
| 7 | Buzzer / alarm | 1 | Audible local alert. | ● |
| 8 | 16×2 character LCD with I²C backpack | 1 | Local status display. | ● |
| 9 | LED indicators | 3 | Green = Fresh/Normal, Yellow = Use Soon, Red = Check Food. Red blinks on data unavailable. | ● |
| 10 | Regulated power supply / USB adapter | 1 | Laptop USB supplies the 5 V input. | ● |
| 11 | Breadboard, jumper wires | 1 set | Prototype interconnection. | ● |
| 12 | Food containers + storage environment | 3 or more | At least one must hold an RFID tag. | ● |
| 13 | Mobile / laptop | 1 | Serial console, flashing, and dashboard access. | ● |
| 14 | RFID reader and RFID tags | As required | Item identity. Optional in the SRS; **built** here. | ● |
| 15 | QR code labels | As required | Item identity. Optional in the SRS; **not built** — see D-3. | ✗ |

### 3.2 Additional parts this design requires — not in the SRS list

Each of these is forced by a specific engineering need, not added for
convenience. All are called out in the firmware header and in
[`FOOD_STORAGE_ARCHITECTURE.md` §17.3](./FOOD_STORAGE_ARCHITECTURE.md).

| # | Additional part | Qty | Why it is required | Status |
|---|---|---|---|---|
| A1 | **PCF8574 I/O expander** | 1 | The ESP8266 has no spare pins once I²C (2), DHT single-wire (1), and the four RC522 SPI pins (4) are allocated. It carries the reed input, three LED drives, the buzzer, and the RC522 reset line. | ● |
| A2 | **ADS1115 16-bit ADC module** | 1 | The ESP8266's single 10-bit ADC has a narrow input window, no gain stage, and no reference. The ADS1115 replaces it for the MQ-135 analog signal. The SRS conditions an ADC on Raspberry Pi only; the intent is served better here. | ● |
| A3 | **BMP280 temperature/pressure sensor** | 1 | The DHT11's ±2 °C accuracy and 1 °C resolution are the weakest link in a temperature-threshold system. The BMP280 gives ±1 °C at 0.01 °C resolution, shares the I²C bus, and adds pressure. | ● |
| A4 | **BSS138-type bidirectional level shifter** | 1 | The LCD module is a 5 V part on a 3.3 V bus. ⚠ The actual fitted part is **unknown** and must be identified before the LCD is powered. | △ critical |
| A5 | **Resistor divider, 4.7 kΩ top / 2.2 kΩ bottom** | 1 set | Attenuates MQ-135 A0 into the ADS1115 input range. Values are placeholders until the fitted resistors are measured. | △ |
| A6 | **Pull-up resistors, 4.7 kΩ – 10 kΩ** | 3 | Two I²C bus pull-ups to 3.3 V, plus the DHT11 DATA pull-up. The DHT11 resistor is **required** unless the breakout already carries one — the firmware cannot substitute for it in software. | △ |
| A7 | **NPN transistor or NMOSFET driver** | 4 | Green, yellow, red, and buzzer loads must not be connected directly to a PCF8574 quasi-bidirectional output. The port switches the base or gate; the driver carries the current. | ● |
| A8 | **LED series resistors, 220 Ω – 330 Ω** | 3 | Current limiting on every indicator LED. | ● |
| A9 | **Flyback diode** | 1 | Protects P0 from the inductive kick when a reed coil de-energises. Cathode to the P0-connected side, anode to ground. ⚠ Verify polarity before assembly. | △ |
| A10 | **Optional 10 kΩ pull-up for P0** | 1 | The PCF8574's quasi-bidirectional pull-up is weak (about 100 µA typical). Fit only if the P0 idle level proves unstable with real contacts. | △ |
| A11 | **Decoupling capacitors, 100 nF** | 1 per module | Close to each module, plus suitable bulk capacitance. | △ |
| A12 | **Insulated box / cooler** | 1 | Storage-environment substitute, explicitly permitted by SRS §1.2 Note. | ○ |

### 3.3 Deliberately unused

| Net | Why |
|---|---|
| **ESP8266 A0 (analog input)** | The MQ-135 analog output is **never** connected here. △ Verify nothing is attached to A0 during final wiring. |
| **MQ-135 D0 (digital threshold)** | A hardwired digital threshold has no traceability to a zone baseline. |
| **RC522 IRQ** | Passed to the library as unused. The card poll is a bounded synchronous exchange, so an interrupt is not needed. |
| **PCF8574 P6, P7** | Configured as inputs, left unconnected, reserved for expansion. |
| **ESP8266 GPIO0, GPIO1, GPIO2, GPIO3, EN, RST** | Boot-mode, UART0, and auto-program pins. No peripheral may connect here. |

---

## 4. Provisional pin map

> ⚠ **GPIO numbers are authoritative. Silkscreen labels are provisional.**
> The labels below are the common NodeMCU 1.0 / D1-mini naming and **must be
> confirmed against the actual board** before power is applied. If your board's
> silkscreen disagrees, the GPIO numbers win and the silkscreen is what needs
> re-reading. This is open decision **Q-9**.

| ESP8266 GPIO | Typical silkscreen △ | Net | Direction | Electrical requirement | Status |
|---|---|---|---|---|---|
| GPIO4 | D2 | I²C SDA — shared by BMP280, DS3231, ADS1115, PCF8574, LCD | Bidirectional, 3.3 V | 4.7 kΩ – 10 kΩ pull-up to **3.3 V only**. Never pull to 5 V. | ● △ |
| GPIO5 | D1 | I²C SCL — same devices | Output / open-drain | 4.7 kΩ – 10 kΩ pull-up to 3.3 V. Bus clocked at **100 kHz** for breadboard and shifter margin. | ● △ |
| GPIO16 | D0 | DHT11 DATA | Bidirectional single-wire | **External 4.7 kΩ – 10 kΩ pull-up to 3.3 V, required unless the breakout already carries one.** Idle level must read 3.3 V, not floating. | ● △ |
| GPIO12 | D6 | RC522 MISO | Input | Not a boot-strapping pin. | ● |
| GPIO13 | D7 | RC522 MOSI | Output | — | ● |
| GPIO14 | D5 | RC522 SCK | Output | — | ● |
| GPIO15 | D8 | RC522 NSS (SS) | Output | **Must be LOW at reset.** The board pulls down; some RC522 breakouts fit a pull-up. △ Measure before first power-on. | ● △ caution |
| **A0** | A0 | **UNUSED** | — | **Must remain unconnected.** | ● rule |
| 3V3 | 3V3 | 3.3 V power rail | Power | Supplies BMP280, DHT11, ADS1115, DS3231, PCF8574, RC522 logic, and the I²C pull-ups. △ MQ-135 is deliberately *not* on this list — its supply requirement is unverified. | ● △ |
| GND | GND | Common ground | Power | One common ground across every module, including the shifter's low side. | ● |
| 5V / VIN | VIN, 5V | USB 5 V input | Power | **The ESP8266 is not 5 V tolerant.** Never route 5 V to a GPIO. | ● |
| — | D3, TX, RX, EN, RST | **Reserved** | — | Boot-mode, UART0, auto-program. No peripheral may connect here. | ● rule |

**I²C addresses:** PCF8574 `0x20` · LCD `0x27` · ADS1115 `0x48` · DS3231 `0x68` ·
BMP280 `0x76`. All pairwise distinct; the collision check is enforced at compile
time, and a bus scan runs automatically at boot.

**Full details, ASCII wiring diagram, and the complete safety checklist:**
[`docs/WIRING_AND_PIN_MAP.md`](docs/WIRING_AND_PIN_MAP.md).

---

## 5. Installation

### 5.1 Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Arduino IDE | 2.x recommended | The IDE installs the board package from Board Manager. |
| ESP8266 board package | 3.1.2 is what this build was **checked against** | ⚠ Record the version actually installed on your machine. Do not state a version in your report that you did not compile with. |
| FTDI / CH340 USB driver | — | Required for the board's USB-to-serial adapter. |
| USB data cable | — | A **charge-only** cable will not flash or open a serial port. |
| `arduino-cli` (optional) | 2.x | Only needed for the headless path in §5.3. |

### 5.2 Arduino IDE

1. Open **Tools → Board → Boards Manager**.
2. Search for `esp8266`, install the **esp8266 by ESP8266 Community** package.
   Note the installed version — you will record it in your report.
3. Select **Tools → Board → NodeMCU 1.0 (ESP-12E Module)**.
4. Confirm **Tools → Flash Size** is set to **4MB (FS:1MB)** or larger, matching
   your board's actual flash.
5. Select the correct **Tools → Port**. Leave **Tools → Upload Speed** at the
   default 115200 unless uploads fail.
6. Open `FreshGuard.ino`. Because the folder is named `Tech Wiz` rather than
   `FreshGuard`, copy the sketch into a folder named **`FreshGuard`** so the
   Arduino IDE accepts it. A sketch folder and its `.ino` file must share a name.
7. Install the libraries listed in [§6](#6-library-list) via
   **Tools → Manage Libraries**.
8. Verify the build (**Tools → Verify**) before touching hardware. Note any
   warnings; the compile-time self-checks in the sketch are assertion checks, not
   runtime validation of physical wiring.
9. Flash with **Tools → Upload**.

**Board FQBN:** `esp8266:esp8266:nodemcu`

### 5.3 Arduino CLI (headless / repeatable path)

The same target is addressable from the command line by its fully qualified
board name. Use this if you want a scripted, repeatable flash.

```bash
# Show the exact FQBN and options the CLI resolves for this target
arduino-cli board details --fqbn esp8266:esp8266:nodemcu

# Confirm the toolchain is reachable before flashing
arduino-cli version
arduino-cli core list

# Compile only, with full warnings — do this before any hardware step
arduino-cli compile --fqbn esp8266:esp8266:nodemcu --warnings all FreshGuard

# Flash (replace the port with the one printed by `arduino-cli board list`)
arduino-cli upload --fqbn esp8266:esp8266:nodemcu --port COM5 FreshGuard

# Open the serial monitor at the console baud rate
arduino-cli monitor --port COM5 --config baudrate=115200
```

> **Record before you report.** `arduino-cli core list` prints the installed
> `esp8266` core version. Write it down. This is open decision **Q-11**.

---

## 6. Library list

All libraries are installed through **Tools → Manage Libraries** (Arduino Library
Manager) or the CLI equivalent. Versions are **not pinned** in the sketch — it
names libraries by function only. Record the resolved versions at build time; a
different release can change a driver detail.

| Library | Author / Manager name | Used for | Required |
|---|---|---|---|
| ESP8266WiFi, ESP8266HTTPClient, WiFiClientSecure, LittleFS, Wire, SPI, Esp | ESP8266 core package | Board support, HTTPS transport, I²C, SPI, on-board flash filesystem | ● Yes |
| DHT sensor library | Adafruit | DHT11 **humidity** read | ● Yes |
| Adafruit BMP280 Library | Adafruit | Temperature and pressure | ● Yes |
| Adafruit ADS1X15 | Adafruit | 16-bit ADC for the MQ-135 analog signal | ● Yes |
| RTClib | Adafruit | DS3231 real-time clock | ● Yes |
| LiquidCrystal I2C | Frank de Brabander (widely mirrored) | I²C character LCD | ● Yes |
| MFRC522 | Miguel Balboa | RC522 RFID reader | ○ Optional identity |

> ⚠ **LiquidCrystal I2C is not one library.** Several incompatible forks share
> that name and their constructor and backlight APIs differ. The sketch expects
> the fork that offers a two-argument begin call taking a column count and a row
> count, together with backlight and no-backlight calls. If the build fails on
> the LCD, substitute a different fork rather than editing the sketch.

CLI equivalent:

```bash
arduino-cli lib install "DHT sensor library"
arduino-cli lib install "Adafruit BMP280 Library"
arduino-cli lib install "Adafruit ADS1X15"
arduino-cli lib install "RTClib"
arduino-cli lib install "LiquidCrystal I2C"
arduino-cli lib install "MFRC522"
arduino-cli lib list          # record the resolved versions
```

---

## 7. USB power and safe bring-up order

> **Order is a safety requirement, not a convenience.** Steps G1–G3 exist to
> prevent damage to the DS3231's coin cell and to the ESP8266.

### 7.1 Power

| Rule | Detail |
|---|---|
| Single source | USB 5 V from the laptop powers the board only. Do not connect a second supply. |
| Rails | The board's on-board regulator produces the 3.3 V rail that feeds BMP280, DHT11, ADS1115, DS3231, PCF8574, RC522 logic, and the I²C pull-ups. |
| 5 V tolerance | The ESP8266 is **not** 5 V tolerant. No 5 V signal may reach any GPIO. Continuity-check every signal net back to its source rail. △ |
| Rail capacity △ | Wi-Fi transmit peaks dominate. Scope the 3.3 V rail during association and during an upload; add bulk capacitance if it sags. |
| Common ground | One ground for all modules, including the shifter's low side. |
| Decoupling △ | 100 nF near each module, plus suitable bulk capacitance. |

### 7.2 Gated bring-up order

| Gate | Action | Pass criterion |
|---|---|---|
| **G1** | Identify the level-shifter part. Locate and disable the DS3231 HW-084 charging path. Confirm ESP8266-side I²C pull-ups reference 3.3 V. | Charging path verifiably open; shifter confirmed bidirectional; pull-up rail confirmed. **Do not apply power until this passes.** |
| **G2** | Power the board with **no peripherals attached**. Open the serial monitor at 115200 baud. | Boot banner, free-heap line, and I²C bus scan appear; configuration self-check reports OK. |
| **G3** | Confirm the bus scan reports **no devices**. | Scan reports none — confirms nothing phantom is answering. |
| **G4** | Attach the PCF8574 only. Power-cycle. | Bus scan shows `0x20`; startup log confirms P0 as input and P1–P5 as verified outputs. |
| **G5** | Verify the LED drivers, then the buzzer. | Each indicator lights or beeps as commanded; all three LEDs turn off cleanly. |
| **G6** | Attach the reed switch and magnet. | Door state changes on the `STATUS` line; rapid magnet movement does not chatter. |
| **G7** | Attach the BMP280. | Bus scan shows `0x76`; temperature and pressure appear on LCD page 0. |
| **G8** | Attach the DHT11. Fit the DATA pull-up **unless the breakout already carries one.** | Humidity appears; idle DATA level reads 3.3 V, not floating. |
| **G9** | Attach the DS3231. | Bus scan shows `0x68`. |
| **G10** | Set the clock with `RTCEPOCH <current epoch>`. | `STATUS` reports the RTC ready with no fault. **Registration is blocked until this passes.** |
| **G11** | Power-cycle, remove USB for 60 s, restore power. | Clock retained and still trusted. |
| **G12** | Attach the RC522 on hardware SPI. | Startup reports reader version `0x91` or `0x92`; a tag produces a UID. If the board fails to boot, suspect the GPIO15 pull-up. |
| **G13** | **Only now** power the LCD module. | Bus scan shows `0x27`; pages rotate. |
| **G14** | Attach the MQ-135 through the measured divider. | Gas state moves warming → capturing baseline → ready. |
| **G15** | Let the baseline settle. Read `BASELINE`. | `state=ready` with a stable baseline in millivolts. Roughly 60 s with a valid persisted baseline, otherwise roughly 90 s. |
| **G16** | Power-cycle and confirm persistence. | The three LittleFS files exist; the persisted baseline reloads and matches the configuration. |

**Full procedure with pass/fail criteria and recovery steps:**
[`docs/INSTALLATION_AND_EXECUTION.md`](docs/INSTALLATION_AND_EXECUTION.md).

---

## 8. Secrets and TLS configuration

> **No real key, fingerprint, SSID, or password belongs in this repository.**
> The sketch ships with `REPLACE_ME…` placeholders and no valid fingerprints.
> There is nothing to redact in the tracked source — keep it that way.

### 8.1 The enablement interlock

Each cloud path requires **two independent conditions**. Both must hold, or the
firmware refuses to open a connection and prints a line saying so.

| Condition | ThingSpeak telemetry | IFTTT notification |
|---|---|---|
| 1. A real, non-placeholder credential | Write API key | Webhook key |
| 2. A host-specific SHA-1 certificate fingerprint **and** its enable flag set to true | Fingerprint array + enable flag | Fingerprint array + enable flag |

The current build satisfies **neither** condition for either path, so no
request is attempted and nothing is transmitted. TLS verification is never
silently downgraded — the unverified-TLS shortcut is deliberately never used.
Leaving it in place is a state you must actively choose.

### 8.2 Configuration procedure

1. **Copy, do not edit in place.** Duplicate the sketch into a **local,
   unsubmitted** working copy. The tracked file keeps its placeholders.
2. **Set Wi-Fi credentials** in the copy. Until they are non-placeholder, the
   serial log prints `[WiFi] Credentials are placeholders; offline mode remains
   active` and all sensing, analysis, and local alerts continue normally.
3. **Obtain the certificate fingerprint through a trusted channel** for each
   host you intend to reach. Do not copy it from an unverified source.
4. **Record the fingerprint source and the date** in your deployment notes.
   Fingerprints are not secret, but they are environment-specific and a provider
   certificate rotation silently breaks telemetry until the value is updated.
5. **Set the enable flag to true** in the same edit that replaces the array.
6. **Set the ThingSpeak write key.** The device needs write access only. Any
   dashboard should read with a **separate read key**.
7. **Set the IFTTT webhook key** and configure the IFTTT action so it fires on
   the value combinations you actually care about. Only the alert type and
   message fields vary — the identity field is a fixed string and the webhook
   event name is fixed in the firmware, so an action configured to match only
   the fixed values will not fire when the type or message differs.
8. **Verify both paths** with `[ThingSpeak] HTTP 200` and a test notification
   containing the event ID.
9. **Rotate every key after any public demonstration.** A leaked webhook key
   lets anyone post fake alerts to your notification channel.

### 8.3 Handling rules

| Rule | Why |
|---|---|
| Never commit real secrets | The submitted sketch must contain only placeholders. |
| Keep keys out of the tracked file entirely | If your workflow allows it, move credentials to an untracked header or a build-time define. If not, at minimum treat the flashed copy as a secret artefact and never copy it back over the tracked file. |
| Know where each key travels | The ThingSpeak key travels in a URL **query parameter**; the IFTTT webhook key travels in the URL **path**. Any proxy, packet capture, server access log, or debug log on the path will see it. Do not attach a request-dumping logger during a demo. |
| Keep keys out of the serial log | The firmware logs only the HTTP status code and the event ID. Preserve that — do not add request echoing to make debugging easier, and scrub any captured log before submitting it. |
| Screenshots and video | Capture with placeholder or redacted keys. A channel screenshot is the risk case: check the URL bar and the visible channel identifier before it goes in the report. |
| Least privilege | Scope the webhook to one event and only the notification channels you use. |

---

## 9. Serial command reference

Line-oriented, non-blocking, **115200 baud**. Commands are case-insensitive.
Lines are capped at 256 bytes; an over-long line is discarded with a warning
rather than partially executed. This serial interface is the **only**
administration surface in this build — thresholds are compile-time constants, and
there is no web-based threshold configuration.

| Command | Purpose | Notes |
|---|---|---|
| `HELP` | List commands | Also printed automatically at boot. |
| `STATUS` | Full report: zone status, overall status, confirmed sensor faults, storage/admin faults, per-sensor readiness, gas baseline / input / delta, door state, optional-function state | The complete, untruncated fault source. |
| `LIST` | Every registered item with its duration verdict | Up to 12 items. |
| `QUEUECOUNT` | Pending events and queue capacity | Capacity is 24. |
| `BASELINE` | Gas state; when ready, baseline, current, and delta. When not ready, progress count and an explicit "Data Unavailable; no remote fault alert" note. | Millivolts at AIN0. Never ppm. |
| `RTCEPOCH <unix_epoch>` | Set the DS3231 clock and clear the oscillator-stopped flag | Rejected below a 2024-01-01 sanity floor. |
| `REMOVE <UID_HEX>` | Remove a registered item | UID as uppercase hex, no separators. |
| `LCD ON` / `LCD OFF` | Toggle the backlight | `LCD OFF` also stops page updates, so the display **freezes** at its last content rather than continuing to refresh dark. |
| `REG <UID_HEX>\|<name>\|<category>\|<qty>\|<location>\|<days>\|<expiryEpoch>` | Register or update an item | Seven pipe-separated fields. |

### REG field rules

| Field | Rule |
|---|---|
| `UID_HEX` | 2 – 20 hex characters, even length, no separators. Up to 10 bytes. |
| `name` | Required, non-empty, up to 23 characters. |
| `category` | Up to 15 characters. Defaults to `Other` if left empty. |
| `qty` | Up to 11 characters. Defaults to `1` if left empty. |
| `location` | Up to 23 characters. Defaults to `Storage zone` if left empty. |
| `days` | 0 – 3650. Storage-duration limit. |
| `expiryEpoch` | Unix epoch seconds, or `0` to use the duration limit. **At least one of `days` or `expiryEpoch` must be non-zero.** |

Additional behaviour you should know before you demo:

- A valid DS3231 time is **required** for registration. If the clock is not
  trusted, `REG` is refused.
- The **store date is set to the current RTC time on first registration.**
  Re-registering an existing UID updates the metadata and **preserves the
  original store date**, so an accidental re-registration cannot reset an
  item's age.
- There is no field for a backdated storage date. Items cannot be backdated.
- An expiry **in the past** is rejected at registration, as is a duration of zero
  with no expiry. This protects data integrity; see open decision **Q-5**.
- Field text has control characters and separators replaced with spaces, so a
  record can never corrupt the file format.

---

## 10. Demonstration flow

A demonstration must register at least one item. With an empty inventory the
overall status equals the zone status, and **Use Soon cannot occur at all** — a
zone with no registered items shows green even though nothing is tracked.

### 10.1 Preparing a demo that reaches Use Soon and Check Food

Items cannot be backdated, and a one-day duration needs roughly 18 hours to reach
Use Soon. The supported, no-code-change approach is to register an item with a
**near-future expiry epoch**: the store date becomes *now* and the window becomes
short, so Use Soon arrives quickly and Check Food follows shortly after. Choose a
window of a few hours so both states are reachable in one session.

The expiry epoch is current time **plus a few hours in seconds**. This exercises
the real expiry path using only the documented `REG` command.

### 10.2 Recommended demo order

| # | Beat | What to do | What the audience should see | SRS reference |
|---|---|---|---|---|
| 1 | Identity | Present a registered RFID tag to the RC522 | Serial log names the item and its status; LCD page 2 shows the item and its verdict | §1.6-i |
| 2 | Normal state | Zone closed, at steady state | Green LED; LCD page 0 shows temperature, pressure, humidity; status page shows Fresh/Normal | §1.6-xvi |
| 3 | Gas warm-up | Note the ~60 s warm-up and ~30 s baseline capture | Data Unavailable with progress; **no** remote fault alert fires | §1.6-v |
| 4 | High temperature | Introduce a warm object into the zone | Red LED + buzzer + queued `temperature_high` alert | §1.6-xii |
| 5 | Abnormal humidity | Breath or a damp cloth into the zone | Red LED + buzzer + queued `humidity_high` alert | §1.6-xii |
| 6 | Abnormal gas | A deliberate vapour source in the zone | `gas_relative_high` alert whose message reports **millivolts and delta, never ppm** | §1.6-iv |
| 7 | Door left open | Remove the magnet and hold the door open past the timeout | One `door_open` alert — **once per open cycle**, not repeatedly | §1.6-vi |
| 8 | Use Soon | Let the short demo window cross 75 % | Yellow LED; `food_use_soon` alert queued and delivered | §1.6-xi |
| 9 | Check Food | Let the window close | Red solid LED; `food_check` alert queued and delivered | §1.6-xi |
| 10 | Sensor fault | Disconnect one sensor | **Red blinking**, "Sensor Fault / Data Unavailable" — **never** a misleading green | §1.6-vii |
| 11 | Offline resilience | Disable the access point | Local sensing, analysis, and alerts **continue**; `QUEUECOUNT` rises | §1.6-xv |
| 12 | Reconnection and sync | Restore the access point | Queued events drain; each notification carries a unique `event_id` | §1.6-xv |
| 13 | Dashboard | Show the ThingSpeak channel | Fields 1–8 populated; charts for the zone picture | §1.6-xx |
| 14 | Storage/admin fault | Fill the 24-slot queue offline, then restore the network | A `storage_fault` alert; **freshness status unchanged**; the overflow alert is local-only and does not recurse | Project rule |

### 10.3 Timing expectations — state these precisely

| Claim | Figure | Basis |
|---|---|---|
| Local alert after **confirmation** | Well under a second | A confirmed latch raises its alert inside the same evaluation pass that confirms it. |
| Detection from the **start** of a sustained excursion | Roughly 10–15 s | A violation must survive 3 consecutive samples at the 5 s poll cadence. |
| ThingSpeak telemetry | Every 30 s | SRS platform minimum is 15 s. |
| Alert delivery retry | Every 5 s while events are pending | One bounded request per loop pass. |

**When you state a 2–5 second response in your report, say from which point you
measured it.** The SRS figure is measured from a *confirmed* violation. Measuring
from the first reading that moved gives a different, longer number. Confusing the
two is the easiest way to make a correct design look non-compliant.

---

## 11. Dashboard scope — Option A vs future Option B

SRS §1.6-xx explicitly permits the selected IoT platform to serve as the dashboard
and data-visualisation interface; a separate second dashboard is not mandatory.
§1.6-xii, §1.6-xvii, and §1.6-xix, however, require alert display, food
inventory, expiry information, storage duration, and per-item freshness on a
dashboard. This is the largest open scope decision in the project, and it is
**open decision Q-1**.

| Data a dashboard needs | Available from the current build? | How |
|---|---|---|
| Sensor readings | ● Yes | ThingSpeak fields 1, 2, 7 |
| Relative gas reading and delta | ● Yes | ThingSpeak fields 3 and 4 — as **millivolts and a delta**, never as ppm |
| Door state | ● Yes | ThingSpeak field 5 |
| Overall freshness status | ● Yes | ThingSpeak field 6 |
| Sensor-fault / data-unavailable status | ● Yes | ThingSpeak field 8, bits 0–7 |
| Storage/admin fault status | ● Yes | ThingSpeak field 8, bits 8–11 |
| Charts and trend visualisation | ● Yes | ThingSpeak channel charts |
| **Active alerts with text** | ● Partially | Delivered as IFTTT notifications, but only to whatever channel the IFTTT action is configured for — not to a queryable store. |
| **Food inventory** | ✗ No | The item registry lives only in the device's LittleFS. There is no publish path for it. |
| **Storage duration / expiry per item** | ✗ No | Same reason. |
| **Per-item freshness status** | ✗ No | Requires the registry. |

| Option | Approach | Trade-off |
|---|---|---|
| **A. Platform dashboard is sufficient** *(recommended for the mandatory deliverable)* | Invoke SRS §1.6-xx. Use the ThingSpeak channel and its charts for the zone picture, and IFTTT-driven notifications for alerts. Document explicitly that item-level inventory is device-local only, viewable through the `LIST` serial command. | Smallest possible change and satisfies the letter of §1.6-xx, but §1.6-xix's inventory review and consumption planning are only partially served. |
| **B. Add the item registry to the transport** *(future work, not built)* | Extend the transport so a registry snapshot — UID, name, category, quantity, location, store date, expiry, duration limit, per-item verdict — accompanies telemetry, or publish a per-item status code into additional platform fields. | Meets the full §1.6-xvii field list. Costs protocol work, exceeds the platform's eight free fields, and raises the question of inventory size. |

**Recommendation: Option A for the mandatory deliverable, with the gap stated
plainly in the report.** Option B is a reasonable future capability, not a gap in
the deliverable, provided you disclose it. MQTT is *not* required by the SRS; it
buys lower latency and a bidirectional command path, and costs a broker, TLS to
a broker, a second transport to test, and a backend to run.

---

## 12. SRS alignment summary

| SRS requirement | Implementation | Status |
|---|---|---|
| §1.6-i Data collection — temperature, humidity, gas, door | BMP280, DHT11, MQ-135 via ADS1115, reed | ● |
| §1.6-i QR-code sticker identification | Replaced by RFID tags | ✗ Optional in the SRS; documented deviation D-3 |
| §1.6-ii DHT11 measures temperature and humidity | DHT11 supplies **humidity only**; BMP280 supplies temperature and pressure | ● with deviation D-1. Humidity monitoring is fully retained. |
| §1.6-iii Safe sensor interfacing | Divider, level shifter, driver transistors, common ground, 3.3 V discipline | ● design / △ build |
| §1.6-iv Gas monitoring, relative readings only | ADS1115 millivolts + delta; D0 unused; never ppm | ● |
| §1.6-v Calibration, baseline, averaging, hysteresis | Warm-up, 30-sample baseline capture, CRC-protected persistence, 4-sample averaging, smoothing, hysteresis, 3-sample confirmation | ● with △ values |
| §1.6-vi Door monitoring with timeout | Reed on P0, 50 ms poll, 80 ms debounce, 30 s timeout, one alert per open cycle | ● |
| §1.6-vii Sensor fault handling, no misleading Fresh | Fourth status, three fault classes, debounce, separate masks | ● |
| §1.6-viii Food registration | Serial `REG`, 12-item capacity, validated store | ● |
| §1.6-ix DS3231 retains time across power loss | RTC module with trust flag, oscillator-stopped check, epoch floor, `RTCEPOCH` | ● / △ retention unverified |
| §1.6-x Freshness analysis inputs and threshold matrix | All five inputs plus category; matrix template supplied | ● / ○ matrix to populate |
| §1.6-xi Three freshness statuses + decision rule matrix | Four statuses; 13 pre-filled rules supplied | ● / ○ rules to verify |
| §1.6-xii Threshold alerts including mandatory remote notification | Buzzer, LCD, LittleFS store, IFTTT notification | ● with △ — the **dashboard** leg is the gap |
| §1.6-xiii–xiv Data processing, storage, Wi-Fi and cloud | On-device processing; ThingSpeak over HTTPS | ● — credentials are placeholders |
| §1.6-xv Offline operation and synchronisation | Local operation continues; bounded queue; event ID, timestamp, sync state; at-least-once with bounded retention | ● — high-frequency sample buffering not built (SRS-optional) |
| §1.6-xvi Data display with fault state | LCD pages, LED mapping, fourth status | ● |
| §1.6-xvii Dashboard and monitoring interface | ThingSpeak channel for the zone picture only | ✗ partial — see §11 |
| §1.6-xviii Alerts and recommendations | Alert vocabulary covers use-soon, temperature, gas, door, inspection | ● |
| §1.6-xix Food management support | `LIST` on serial; not on a dashboard | ✗ partial — depends on the Q-1 decision |
| §1.6-xx Data visualisation | ThingSpeak charts | ● |
| §1.6-xxi IoT Test Matrix | Supplied with all mandatory scenarios, unexecuted | ○ must be executed with evidence |
| §1.7 Security | Fingerprint-pinned TLS, no unverified mode, placeholder-only secrets, no secret logging | ● |
| §1.7 Environmental and electrical safety | Full checklist in the wiring document | △ must be discharged with evidence |
| §1.8.1 Hardware BOM | Complete, with 9–12 parts beyond the SRS list | ● |
| §1.8.2 Software | Arduino C/C++ for ESP8266; listed libraries; ThingSpeak + IFTTT | ● |
| §1.9 Documentation, no source code | This package contains no C++, JavaScript, or SQL listings | ● |

---

## 13. Known limitations

| # | Limitation | Consequence | Disclosure |
|---|---|---|---|
| L-1 | **Prototype thresholds are zone-wide, not per food category.** The threshold matrix supports per-category values; the firmware applies one uniform band. | A tomato and a piece of cheese are judged by identical limits. | Disclose. Per-category values would need a configuration interface that does not exist. See Q-3. |
| L-2 | **No dashboard for item-level data.** | §1.6-xii, §1.6-xvii, §1.6-xix partially met. | Disclose and choose Option A or B. See §11 and Q-1. |
| L-3 | **No high-frequency sample buffering.** Only alert events are buffered. | Telemetry during an outage is lost; history resumes after reconnection. | SRS §1.6-xv makes this optional. Disclose. |
| L-4 | **Gas is relative, never calibrated.** | The gas reading is a trend against a stored baseline, not a measurement. | Already the documented design. Keep the wording in every user-facing string. |
| L-5 | **Baseline identity omits the MQ-135 supply voltage.** | Changing the heater supply silently invalidates comparability with a stored baseline. | **Bench rule: re-baseline after any supply change** and treat the supply as part of the baseline's identity until it is added to the record. See Q-8. |
| L-6 | **Alert idempotency is not guaranteed across reboots.** Per-item latches live in RAM only. | A Use Soon or Check Food alert may re-fire after a restart. | The `event_id` still differs, so a receiver can distinguish re-fires. Disclose. |
| L-7 | **Thresholds are compile-time only.** | Changing a limit requires a reflash. | Serial `REG` covers item data. Thresholds deliberately stayed static rather than adding an unaudited remote-write path. |
| L-8 | **The main loop is cooperative, not strictly non-blocking.** Several jobs call synchronous, bounded APIs: an HTTPS request (up to 2 s), every LittleFS queue read and write, the RFID poll every 500 ms, and the DHT11 single-wire read. | Loop latency is **bounded and known**, not unbounded and not zero. A pass that scans a full queue or performs an upload is measurably longer than one that does neither. | Every item is short relative to its job interval, and HTTP work is isolated behind the transport seam and rate-limited to one request per pass. The only deliberate wait is a 50 ms RFID reset delay, and it is **setup-only**. |
| L-9 | **The platform's eight free fields cap the telemetry.** | No room for item-level data without a field-count increase. | Feeds directly into the Q-1 decision. |
| L-10 | **SHA-1 fingerprint pinning is rotation-fragile.** A certificate change silently breaks telemetry. | Requires a manual fingerprint update after provider rotation. | Record the fingerprint source and date in the deployment notes. |
| L-11 | **One shared zone, one node.** | No multi-zone or multi-node support. | Out of scope for the prototype. |
| L-12 | **Bounded capacity: 12 inventory items, 24 queued events.** | A full queue is reported honestly as a storage/admin fault rather than silently dropping events. | A corrupt slot blocks the events behind it rather than being skipped; order is best-effort by slot index, not strict FIFO. Build against bounded retention and at-least-once event IDs. |
| L-13 | **Store date is set by the device clock at registration.** There is no user-supplied backdated field. | Items cannot be backdated. | The main impediment to a fast Check Food demo. Use the near-future expiry approach in §10.1. See Q-4. |
| L-14 | **Reed P0 uses the weak quasi-bidirectional pull-up** (about 100 µA typical). | Real contacts may read noisily. | △ Fit an external 10 kΩ pull-up if the idle level proves unstable. |
| L-15 | **Alert-queue ordering is best-effort, not FIFO.** | A receiver must not depend on delivery order. | Order by `event_id` or `timestamp` if you need one. |
| L-16 | **The DHT11 DATA pull-up cannot be provided in software.** The firmware never enables a software pull-up, and the pin offers no usable one. | A DHT11 breakout without an onboard pull-up reads as permanently unavailable. | △ Fit 4.7 kΩ – 10 kΩ to 3.3 V unless the board clearly carries one. A floating line is a silent demo failure. See Q-12. |
| L-17 | **Library and core versions are not pinned.** | A different core or library release can change a driver detail, including the Wi-Fi start behaviour this design relies on. | Record the resolved core and library versions at build time. See Q-11. |
| L-18 | **ADC re-initialisation is deferred by the gas warm-up window.** | An ADC that failed to initialise at boot is not retried until warm-up elapses. | The availability mask already reports the input as unavailable, so the display is not wrong — recovery is simply slower than expected. |
| L-19 | **Deep sleep would forfeit the DHT pin.** ESP8266 wake-from-reset is wired to the same pin this design uses for the DHT11. | A future low-power revision must move the DHT11 or accept a pin change. | Recorded now, cheap to know later. |
| L-20 | **The RFID reader consumes the entire hardware SPI bus.** | A second SPI device would need software SPI on other pins. | This is why the reader's reset line sits on the expander rather than consuming another GPIO. |

---

## 14. Documentation package

| Document | What it contains |
|---|---|
| [`README.md`](./README.md) | This file — overview, BOM, installation, secrets, commands, demo flow, scope, limitations. |
| [`FOOD_STORAGE_ARCHITECTURE.md`](./FOOD_STORAGE_ARCHITECTURE.md) | The design document. Module map, data flow, decision semantics, presentation contract, telemetry contract, traceability, and the full open-decision register. |
| [`docs/WIRING_AND_PIN_MAP.md`](docs/WIRING_AND_PIN_MAP.md) | Authoritative GPIO map, silkscreen warning, I²C address table, expander pin map, ASCII wiring diagram, level-shifter wiring, and the full power / grounding / decoupling / safety checklist. Every unverified item is marked △. |
| [`docs/CALIBRATION_BASELINE.md`](docs/CALIBRATION_BASELINE.md) | The **blank** calibration and baseline table, the measurement procedure, the fields to record, the gas baseline rules, and the divider / gain / supply fingerprint caveat. Evidence IDs are pre-assigned. |
| [`docs/FOOD_THRESHOLD_MATRIX.md`](docs/FOOD_THRESHOLD_MATRIX.md) | Per-category threshold matrix template with explicit prototype-assumption columns, a cited-source column, and the rule that gas is zone-level millivolts and delta — never ppm, never a food-safety certification. |
| [`docs/FRESHNESS_DECISION_RULE_MATRIX.md`](docs/FRESHNESS_DECISION_RULE_MATRIX.md) | The 13 decision rules with explicit precedence, non-masking of storage/admin faults, display-only warm-up and baseline states, and the door and item rules. |
| [`docs/IOT_TEST_MATRIX.md`](docs/IOT_TEST_MATRIX.md) | Every mandatory scenario plus network sync and duplicate prevention, with the SRS-required columns. **Every unexecuted row reads *Not run* with a blank actual result.** |
| [`docs/INSTALLATION_AND_EXECUTION.md`](docs/INSTALLATION_AND_EXECUTION.md) | Numbered, safety-gated installation, flashing, serial configuration, first boot, sensor registration, cloud enablement, demo, and reset and recovery steps. |

**How the documents relate.** The firmware is the single source of truth. This
README and the `docs/` package are the *operator and evaluator* view of it; the
architecture document is the *design* view. Where any of them disagree with
`FreshGuard.ino`, the firmware is correct and the documentation is wrong.

**SRS §1.9 requires that documentation not contain source code.** This package
contains no C++, JavaScript, or SQL listings. Behaviour is specified as tables,
prose, pin maps, ASCII and Mermaid diagrams, and explicit procedures. Hex
register values, pin numbers, field names, and threshold constants are
specification data, not source code.

---

## 15. Open decisions awaiting an answer

These need a decision before the affected documentation can be finalised. The
full register with options and recommendations is in
[`FOOD_STORAGE_ARCHITECTURE.md` §18](./FOOD_STORAGE_ARCHITECTURE.md).

| # | Decision | Effect if unanswered |
|---|---|---|
| Q-1 | Dashboard scope — Option A or Option B | §1.6-xii, §1.6-xvii, §1.6-xvii remain partially met |
| Q-2 | MQ-135 supply voltage | The gas baseline is provisional; highest bench priority after the charging-path check |
| Q-3 | Should the threshold matrix drive the firmware, or stay documentation | A per-category table with no code path could read as misleading |
| Q-4 | How to demonstrate Check Food live | Items cannot be backdated; a one-day duration needs hours |
| Q-5 | Whether to allow a past expiry at registration | Currently rejected, which protects data integrity |
| Q-6 | Refrigerator or insulated box for the demonstration | Determines the achievable temperature band and condensation risk |
| Q-7 | Gas threshold tuning | An untuned value must not be shipped as if it were measured |
| Q-8 | Add the MQ-135 supply voltage to the baseline record | A silent-invalidation gap remains |
| Q-9 | Which board revision is on the bench | Silkscreen labels stay provisional |
| Q-10 | Level-shifter part number | The LCD must stay unpowered |
| Q-11 | Which core and library versions are installed | Do not state a version in the report that you did not compile |
| Q-12 | Does the DHT11 breakout already carry a DATA pull-up | Humidity may read as permanently unavailable |
| Q-13 | Is a 32-bit event ID wide enough | A correctness-of-claim question, not a live defect |

---

## 16. License and attribution

- **Specification:** FreshGuard Software Requirements Specification v1.0,
  © Aptech Limited. Used as the authoritative requirement source for this
  prototype.
- **Design document:** [`FOOD_STORAGE_ARCHITECTURE.md`](./FOOD_STORAGE_ARCHITECTURE.md),
  derived from SRS v1.0 and from `FreshGuard.ino`.
- **Firmware:** [`FreshGuard.ino`](./FreshGuard.ino) — the authoritative
  implementation.
- **Third-party libraries** remain under their own licences; see §6.
- **Demonstration video** (`.mp4`) is a mandatory SRS §1.9 deliverable. Capture it
  with placeholder or redacted credentials visible nowhere in frame.

> *FreshGuard — IoT-Based Smart Food Freshness Monitor. ESP8266MOD prototype.*
> *No physical testing is claimed or implied by this documentation package.*
#   I n f e r n o n e t  
 