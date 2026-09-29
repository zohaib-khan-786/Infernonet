/*
 * ============================================================================
 * FreshGuard - ESP8266 food-storage monitor
 * SRS v1.0 / TechWiz 7
 * ============================================================================
 *
 * CONFIRMED PROVISIONAL BOARD MAP - VERIFY THE LABELS ON THE ACTUAL
 * ESP8266MOD BOARD before applying power. The project has confirmed this is a
 * standard NodeMCU/D1-style pin assignment, but silk-screen labels still vary
 * between development boards:
 *
 *   ESP8266 GPIO4  -> I2C SDA
 *   ESP8266 GPIO5  -> I2C SCL
 *   ESP8266 GPIO16 is FREE. The DHT11 was removed: the BME280 measures humidity
 *   itself (chip id 0x60) over the same I2C bus, so GPIO16 no longer carries a
 *   1-wire humidity line. Do not assign it without re-checking the boot straps
 *   in the pin table below.
 *   ESP8266 GPIO12 -> RC522 MISO
 *   ESP8266 GPIO13 -> RC522 MOSI
 *   ESP8266 GPIO14 -> RC522 SCK
 *   ESP8266 GPIO15 -> RC522 SDA/SS/NSS
 *
 * I2C devices (all 3.3 V logic unless stated otherwise):
 *   BME280 0x76  - temperature + pressure + humidity. This is the ONLY
 *                   environmental sensor on the I2C bus that reports humidity;
 *                   the DHT11 that used to provide it has been removed, so a
 *                   fault in this one chip takes down all three measurements.
 *   DS3231  0x68  - RTC
 *   ADS1115 0x48  - MQ-135 A0 through an external resistor divider on AIN0
 *   PCF8574 0x20  - ADDITIONAL REQUIRED PART: reed input, LEDs, buzzer,
 *                    and RC522 reset (RC522 consumes the hardware SPI pins)
 *   LCD     0x27  - configurable; 5 V module behind a BSS138-style shifter
 *
 * PCF8574 wiring (direct Wire register access; no PCF8574 library):
 *   P0 input  reed switch contacts to GND; closed = LOW, open = HIGH
 *   P1 output green LED   - SINK wiring, active-low
 *   P2 output yellow LED  - SINK wiring, active-low
 *   P3 output red LED     - SINK wiring, active-low
 *   P4 output buzzer gate - TO-220 IRFZ44N, active-high
 *   P5 output RC522 RST (active low)
 *   Add a flyback diode across an inductive reed coil: cathode to the coil's
 *   P0-connected side, anode to GND. Verify polarity before assembly.
 *
 * WHY THE OUTPUT STAGES ARE MIXED (see PCF_PIN_ACTIVE_HIGH below)
 *   A PCF8574 port is quasi-bidirectional: its HIGH state sources only about
 *   100 uA, while its LOW state sinks 25 mA. That 250x asymmetry decides the
 *   wiring for each load.
 *   - LEDs are driven from the 5 V rail INTO the pin, so the pin's strong
 *     pull-down MOSFET closes the path at ~8 mA, inside the 25 mA rating, and
 *     the weak HIGH source simply holds the LED off at a few tens of
 *     millivolts. No driver transistor is needed, and the pin never sources
 *     more than 100 uA.
 *   - The buzzer is inductive and draws up to 30 mA, which EXCEEDS the 25 mA
 *     sink rating, so it needs a real driver: a TO-220 IRFZ44N low-side switch
 *     with a 100k gate pull-down (silence at boot and on an I2C hang) and a
 *     1N4148 flyback diode. A MOSFET is used rather than an NPN because the
 *     port's 100 uA is ample to charge a gate (a few picofarads) but nowhere
 *     near enough to hold an NPN base in saturation.
 *   - P5 may drive the RC522 logic input directly: reset is a TTL input
 *     drawing ~40 uA, which is precisely what the 100 uA pull-up was designed
 *     for. That is the port's intended use.
 *   The three conventions do not share one polarity, which is why there is a
 *   per-pin table rather than a single active-high flag.
 *
 * INDICATOR AND ALERT POLICY (deliberate, documented choice)
 *   - The three LEDs are driven from OVERALL status, which is the worst of the
 *     active zone result and the shared-zone inventory-duration result. An item
 *     with insufficient inventory therefore shows a fault LED even when the
 *     measured zone readings are acceptable.
 *   - The LCD and serial report show zone status and overall status separately,
 *     so the reason for an overall fault is always visible as text.
 *   - This is a usability trade-off for a single unattended zone. Change the
 *     serviceStatusLeds() call in loop() to zone status only if the LEDs must
 *     ignore inventory duration.
 *
 * POWER / SAFETY
 *   - USB supplies 5 V to the development board. Use the board's regulated
 *     3.3 V output for BME280, ADS1115, DS3231, PCF8574 and RC522
 *     logic. The ESP8266 is not 5 V tolerant.
 *   - Common ground is required. Use short wiring, 100 nF decoupling near each
 *     module and suitable bulk capacitance. Verify the board 3.3 V regulator
 *     and USB path can supply ESP8266 Wi-Fi peaks plus all peripherals.
 *   - The BME280 is the only environmental sensor on the I2C bus. A single
 *     fault there loses temperature, pressure and humidity together, so its
 *     decoupling is the one that matters most.
 *   - MQ-135 heater/startup current and the exact breakout supply requirement
 *     are unknown. Recommended prototype divider: A0 -> 4.7k -> ADS1115 AIN0
 *     -> 2.2k -> GND. The 4.7k/2.2k values are placeholders until the physical
 *     resistors are measured. With that network AIN0 must remain below 3300 mV
 *     in every state (approximately 10.35 V maximum at MQ-135 A0). Never
 *     connect MQ-135 A0 directly to the ESP8266 A0 or ADS1115. MQ-135 D0 is
 *     intentionally unused. Gas thresholds are expressed at ADS1115 AIN0.
 *   - LCD VCC is 5 V only when its pull-ups and shifter are verified. The
 *     shifter is provisionally treated as bidirectional BSS138-style: LV=3.3 V,
 *     HV=5 V, pull-ups on each side to its own rail, and no ESP8266-side
 *     pull-up to 5 V. The actual shifter type is unknown and must be checked.
 *   - DS3231 HW-084 + CR2032 WARNING: never power this module at 5 V. Many
 *     HW-084 boards can charge the installed primary CR2032 from 5 V/VIN.
 *     Disable that charging path (normally a resistor/diode or board link per
 *     the exact module schematic) and verify with a multimeter that no charging
 *     current can reach the CR2032 before connecting it. At 3.3 V, also verify
 *     that no onboard pull-up or regulator is tied to 5 V/VIN.
 *   - The MQ-135 wiring must stay away from condensation and direct
 *     contact with food/water.
 *
 * GAS SEMANTICS
 *   This firmware reports only ADS1115 pin millivolts/counts and a change from
 *   a CRC-protected baseline persisted in LittleFS (or a new in-RAM baseline
 *   after warm-up). It never reports ppm and makes no calibration claim.
 *   MQ_BASELINE_SAMPLE_COUNT, MQ_WARMUP_MS and
 *   MQ_ABNORMAL_DELTA_MV are controlled prototype assumptions to be replaced
 *   by documented module/test evidence. Gas readings describe the shared
 *   storage zone and are not attributed to one food item.
 *
 * LIBRARIES (Arduino Library Manager)
 *   - Adafruit BME280 Library
 *   - Adafruit BME280 Library
 *   - Adafruit ADS1X15
 *   - RTClib
 *   - LiquidCrystal I2C (begin(cols, rows)/backlight() API)
 *   - MFRC522 by Miguel Balboa
 *   ESP8266 Wi-Fi, HTTP, LittleFS, Wire and SPI are core libraries.
 *
 * SERIAL COMMANDS
 *   HELP
 *   STATUS
 *   LIST
 *   QUEUECOUNT
 *   BASELINE
 *   SNAPSHOT                     print the exact next snapshot body
 *   RTCEPOCH <unix_epoch>       set DS3231 after validating its hardware
 *   REMOVE <UID_HEX>
 *   CLEARINV YES                erase the whole registry (no undo, must confirm)
 *   LCD ON | LCD OFF
 *   REG <UID_HEX>|<name>|<category>|<quantity>|<location>|<durationDays>|<expiryEpoch>
 *   REG ...|<expiryEpoch>|<manufactureEpoch>
 *
 * expiryEpoch=0 uses durationDays. The storage date is set to the current RTC
 * time on first registration. Re-registering an existing UID updates metadata
 * without resetting its storage date. The eighth field is optional; omit it and
 * manufactureEpoch is stored as 0, which means "unknown".
 *
 * CLEARINV exists because loadInventory() deliberately refuses an on-disk
 * format it does not recognise and leaves the file in place. That refusal is
 * correct - a version 1 record read with version 2 rules reads the next line's
 * first token as a manufacture epoch - but without an erase path it leaves the
 * device with an empty, faulted registry and no way out but a reflash. The
 * confirmation token is mandatory and must be exactly "YES"; bare CLEARINV
 * prints what it would do and deletes nothing.
 *
 * MQTT COMMAND TOPIC  (shared wire contract with the backend)
 *   Subscribe: freshguard/<deviceId>/cmd, QoS 1. Two ops are implemented:
 *
 *     {"op":"item.register","uid":"1778F106","name":"Milk","category":"Dairy",
 *      "quantity":"1","location":"Fridge","duration_days":7,
 *      "expiry_epoch":0,"manufacture_epoch":0}
 *
 *     {"op":"item.clear","confirm":"YES"}
 *
 *   expiry_epoch 0 means "use duration_days instead"; omitted means the same
 *   thing, because there is no absolute expiry to apply. manufacture_epoch 0
 *   means "unknown" and is stored as such. Both keys may be omitted entirely,
 *   which is NOT the same as being sent as 0: an omitted key falls back to the
 *   documented default, while a key that is present but unreadable - a string
 *   where a number belongs, a negative, a truncated document - is REJECTED
 *   rather than defaulted. Defaulting a malformed value would register an item
 *   with a silently wrong shelf life, and the registry has no undo.
 *
 *   item.clear obeys exactly the same rules. In particular an ABSENT "confirm"
 *   is a refusal and not consent, a present-but-wrong value is refused, and any
 *   other op is logged and discarded. A future command sharing this topic must
 *   never be able to reach the item table.
 *
 *   The command supplies metadata only. It cannot set a verdict, an exposure
 *   count or the stored date: storeDateEpoch comes from the DS3231, and the
 *   status field in every snapshot is computed by analyseItemDuration() on this
 *   device. The reply is the next snapshot, which carries the whole registry in
 *   items[] - there is no separate acknowledgement message.
 *
 * CLOCK TRUST AND WHERE THE REPORTED EPOCH COMITS FROM
 *   THE MEASURED PROBLEM THIS EXISTS TO SOLVE
 *
 *   The DS3231 is not broken. It counts correctly - a raw register dump showed
 *   00:34:54 -> 00:35:22 -> 00:35:50 over 20 s intervals with a valid BCD date -
 *   and it never sets the oscillator-stopped flag. What it is, persistently, is
 *   about 4-5 hours behind the server: roughly 17,946 s against a 900 s
 *   tolerance. The backend's clock-trust rule therefore raises
 *   device_clock_skew_exceeds_max and withholds the ENTIRE date layer, so no
 *   food item can ever get a verdict. A working clock at the wrong time is
 *   functionally indistinguishable from no clock at all, and it is far more
 *   dangerous, because every number the device emits looks plausible.
 *
 *   The offset's cause has deliberately NOT been chased. It is a module-level
 *   or board-level fault (timezone baked into the module, a mis-set oscillator
 *   load cap, a bad first power-on) and none of those are diagnosable from
 *   firmware running on the same bus as the fault. So the dependency is removed
 *   instead: the device takes its time from the server.
 *
 *   HOW THE AUTHORITY IS CHOSEN
 *   The ingest POST response carries server_time_epoch. On every successful
 *   ingest the device measures (server_time_epoch - its own clock) and keeps a
 *   running correction. The correction is applied to the device's own clock
 *   rather than replacing it, so the RTC stays a genuine independent source and
 *   a sudden server error cannot silently rewrite the device's idea of the day.
 *   After SERVER_SYNC_MIN_SAMPLES agreeing samples the corrected clock becomes
 *   the authority and every snapshot reports it.
 *
 *   THE FALLBACK CHAIN, in order, all of them ADVANCING:
 *     server_synced  a server anchor was learned and the device's own
 *                    millis() has carried it forward since. This is the normal
 *                    state once the device has synced, online OR offline - the
 *                    anchor is corrected, so a dropped network costs accuracy
 *                    by seconds, never a frozen date.
 *     rtc            no server anchor yet: within the first few samples after
 *                    connecting, or when every ingest has failed. The raw DS3231
 *                    reading, reported as the honest thing it is, ~5 h out.
 *     rtc_offset     no server anchor and the DS3231 is not trusted, but a
 *                    last-known-good reading exists: that reading advanced by
 *                    millis(). Moves, but the anchor is only as good as the last
 *                    good read.
 *     none           no time at all. epoch 0, time_valid false.
 *
 *   A frozen epoch is never an acceptable output. Every branch above advances
 *   with millis(), so losing the network degrades the time source rather than
 *   freezing it.
 *
 *   THE EVIDENCE THE BACKEND GETS
 *   Every snapshot carries, together:
 *     time_source     "server_synced" | "rtc" | "rtc_offset" | "none"
 *     clock_offset_s  the measured correction in seconds, signed. Positive
 *                     means the server is AHEAD of the device. 0 with a
 *                     time_source of "rtc" or "none" means "not measured yet",
 *                     not "no error".
 *     rtc_alive       whether the oscillator is actually advancing
 * Without time_source and clock_offset_s a reader cannot tell a real RTC
 *   reading from a corrected one, and the clock-trust rule has to guess from the
 *   epoch alone - which is precisely the information the fix creates.
 *
 *   time_valid HAS CHANGED MEANING, deliberately, and this is the one contract
 *   change in this file. It used to mean "a real reading from this device's own
 *   DS3231", i.e. false for anything derived. That is the wrong invariant for
 *   the job: reporting epoch 0 / time_valid false for a device whose clock is
 *   correct-but-skewed leaves the backend withholding the date layer for
 *   exactly the same reason it always did, which fixes nothing. It now means
 *   "this snapshot carries a real, advancing, non-synthesised time reference" -
 *   true for rtc, server_synced and rtc_offset, false only for none. The
 *   distinction it used to draw is preserved, in the field that can carry it:
 *   time_source. The backend still makes the trust decision; it is simply given
 *   the evidence to make it with.
 *
 *   LIVENESS IS MEASURED AGAINST ELAPSED TIME, NOT AGAINST "DID IT CHANGE"
 *   The DS3231 is polled every I2C_RTC_POLL_INTERVAL_MS (60 s). A read that
 *   returns the same value as the previous one is only evidence of a dead
 *   oscillator if real time actually passed between the two reads - and at a
 *   60 s cadence it did. So the test is: did the value advance by at least the
 *   elapsed real time, less a small tolerance for the chip's one-second register
 *   granularity? A frozen clock fails that by a factor of sixty. A legitimate
 *   60 s interval passes it by sixty seconds. A single unchanged read is not
 *   enough: two consecutive failures are required, so a pair of reads that
 *   happened to land in the same one-second bucket cannot trip it. A FAILED I2C
 *   read never counts as a stall - the chip did not answer, so there is no
 *   second value to compare, and counting it would make an intermittent bus
 *   glitch look like a dead clock.
 *
 *   THE DS3231 HAS NO BATTERY-LOW BIT. THE EARLIER "BAT" REPORT IS GONE.
 *   A previous revision of this file decoded status register 0x0F bit 3 as
 *   "BAT - replace the CR2032" and carried it all the way through to a
 *   rtc_battery_low field, a storage/admin fault bit and an operator alert.
 *   That claim was invented. The Maxim/Analog DS3231 datasheet register map has
 *   no battery-low status bit at all, and 0x0F bit 3 is EN32kHz - the 32.768 kHz
 *   output enable. The chip measured 0x0F = 0x08, so the "battery is low" line
 *   fired on every boot of a module whose backup cell nobody had ever tested,
 *   and it was a fabricated instruction to buy a part.
 *   The DS3231 is powered from VCC whenever the board is powered, and while VCC
 *   is up the backup cell is not even in circuit. There is no register that
 *   reports its state, so this firmware now makes NO claim about it whatsoever
 *   - not "low", and not "OK" either. An unmeasurable quantity is reported as
 *   unmeasured, and the CR2032 remains the operator's periodic maintenance item
 *   to be discovered by testing it, exactly as it was before this bit existed.
 *
 *   STATUS REGISTER 0x0F, DECODED AS THE DATASHEET DEFINES IT
 *     bit 7  OSF      oscillator stop flag
 *     bit 6  reserved, reads 0
 *     bit 5  reserved, reads 0
 *     bit 4  reserved, reads 0
 *     bit 3  EN32kHz  32.768 kHz square-wave output enable   (NOT a battery flag)
 *     bit 2  BSY      temperature conversion in progress
 *     bit 1  A2F      alarm 2 flag
 *     bit 0  A1F      alarm 1 flag
 *
 *   OSF is bit 7, so it is 0x80. The earlier firmware masked 0x20 - bit 5, a
 *   reserved bit that always reads 0. That mistake was harmless in one
 *   direction and bad in the other: it could never raise a false oscillator
 *   fault, but it also could never DETECT a real one, so the one status bit
 *   that matters was dead. Only OSF feeds faults.ds3231; EN32kHz is a
 *   configuration bit, BSY is transient, and A1F/A2F are cleared by the chip
 *   when the matching alarm block is read.
 *
 *   THE FULL REGISTER MAP, AS THE DATASHEET DEFINES IT
 *     00h Seconds              07h-0Ah  Alarm 1 block (sec/min/hour/date-day)
 *     01h Minutes              0Bh-0Dh  Alarm 2 block (sec/min/hour/date-day)
 *     02h Hours                0Eh      Control register
 *     03h Day of week          0Fh      Control/Status register
 *     04h Date                 10h      Aging Offset
 *     05h Month/Century        11h      Temperature MSB
 *     06h Year                 12h      Temperature LSB
 *
 *   THERE ARE NO "OFFSET SECONDS" OR "OFFSET MINUTES" REGISTERS ON THIS PART.
 *   The earlier firmware called 0x0D an "offset-seconds register", reported its
 *   invalid BCD as a hardware anomaly, and reasoned at length about a second
 *   "offset register at 0x0E" that the datasheet also does not describe. 0x0D is
 *   the DATE/DAY byte of ALARM 2. 0x0E is the control register (EOSC, 32 kHz
 *   output, converter square-wave rate, interrupt enable and mask) and has no
 *   offset field. Both the description and the reasoning were wrong; the chip
 *   has exactly one aging-offset register, at 0x10, and it is not BCD.
 *
 *   0x0D IS REPORTED, NEVER WRITTEN
 *   The byte at 0x0D reads invalid BCD, and the datasheet states that register
 *   state is undefined at power-on until the host writes it. So the value is
 *   simply what an unprogrammed Alarm 2 date/day byte looks like. It is printed
 *   raw and decoded so a human can see it, and it is NEVER written: 0x0D is a
 *   live alarm register, and writing a byte into it on a guess is how a working
 *   clock silently acquires an alarm it did not have before. The firmware uses
 *   no alarms at all, so there is nothing to gain and a date to lose.
 *
 *   THE TEMPERATURE CHANNEL IS 0x11/0x12 AND IS PLAUSIBLE
 *   The earlier firmware read 0x07/0x08 - the start of the Alarm 1 block - and
 *   reported "about 0.25 C", then called the temperature channel broken. The
 *   real registers read a normal die temperature, because they were never
 *   read. Decoding: 0x11 is a signed 8-bit WHOLE-degree value, bit 7 being the
 *   sign, and bits 7-6 of 0x12 hold quarter-degree steps (0, 0.25, 0.50, 0.75).
 *   The chip refreshes its internal temperature roughly every 64 s, so a reading
 *   can legitimately be up to a minute stale; it is a die temperature, not the
 *   storage-zone air temperature, and the BME280 remains the measurement the
 *   product reports. NEITHER 0x11 NOR 0x12 IS EVER WRITTEN.
 *
 *   The chip's own timekeeping is demonstrably working - verified by raw
 *   register dump, 00:34:54 -> 00:35:22 -> 00:35:50 over 20 s intervals with a
 *   valid BCD date - and the ~5 h skew is corrected from the server clock. No
 *   calibration register is touched on this part at all.
 *
 *   The device is the sole authority for its own measurements. No fallback here
 *   synthesises a sensor value; only the clock has an alternative source.
 *
 * SECURITY
 *   The credential and TLS values below are intentionally placeholders. There
 *   are no real secrets in this file. HTTP is used only through ESP8266's
 *   HTTPS-capable client with host-specific certificate fingerprints pinned;
 *   setInsecure() is deliberately not used. A queued notification is removed
 *   only after a 2xx response. Event IDs make delivery at-least-once; the
 *   receiving service deduplicates on (device_id, boot_generation, event_id),
 *   and the queue seeds its event_id counter from the clock so that a queue
 *   file recreated mid-run cannot walk back into ids this device has already
 *   published - the one collision the boot_generation dimension cannot see.
 *
 * ESP8266WiFi.begin() was verified non-blocking in the installed ESP8266 core
 * 3.1.2: it starts the connection and returns without waiting for WL_CONNECTED.
 * ESP8266HTTPClient remains synchronous, and MFRC522 SPI card polling plus the
 * 50 ms setup reset wait can briefly stall the loop. HTTP work is isolated
 * behind the transport seam below and runs at most one bounded request at a
 * time. A production system requiring strictly non-blocking TLS would move
 * this seam to a separately validated asynchronous transport.
 * ============================================================================
 */

#include <Arduino.h>
#include <Esp.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <SPI.h>
#include <LittleFS.h>
#include <FS.h>
#include <Adafruit_BME280.h>
#include <Adafruit_ADS1X15.h>
#include <RTClib.h>
#include <LiquidCrystal_I2C.h>
#include <MFRC522.h>
#include <PubSubClient.h>
#include <math.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

// The Arduino .ino preprocessor emits generated function prototypes immediately
// after the include block, which is well before the real definitions further
// down. A prototype that names one of these types cannot see it, and the build
// fails at the definition site with "X was not declared in this scope" rather
// than at the prototype. Declaring every type used in a function signature here
// - before any generated prototype can reference it - resolves the names without
// duplicating any definition. Opaque enum declarations are valid from C++11.
struct FaultDebounceState;
struct ConfirmedLatch;
struct FoodItem;
struct ItemRuntime;
struct AlertEvent;
struct QueueHeaderDisk;
struct QueueSlotDisk;
struct QueueSlotDiskV1;
struct MqBaselineDisk;
struct SensorFaults;
struct NotificationTransport;
enum class FreshnessStatus : uint8_t;
enum class MqState : uint8_t;
enum class MqReadResult : uint8_t;
enum class BuzzerState : uint8_t;
enum class TimeSource : uint8_t;

// ============================================================================
// Compile-time board and wiring constants
// ============================================================================

static constexpr uint8_t PIN_I2C_SDA = 4;
static constexpr uint8_t PIN_I2C_SCL = 5;

// GPIO16 is intentionally not defined here. It carried the DHT11 1-wire line
// until humidity moved onto the BME280, and is now spare. It is the only
// non-boot-strapped pin left on the ESP8266 that is safe to use at any time.

static constexpr uint8_t PIN_RC522_MISO = 12;
static constexpr uint8_t PIN_RC522_MOSI = 13;
static constexpr uint8_t PIN_RC522_SCK = 14;
static constexpr uint8_t PIN_RC522_SS = 15;

static constexpr uint8_t PCF8574_ADDRESS = 0x20;

// PCF8574 register map (NXP datasheet). The slave address is the three
// strapped pins A2/A1/A0 - 0x20 here, all grounded - and the register select
// is a SEPARATE 6-bit field in the first data byte after the address. So 0x20
// is the only address that responds, and that is correct.
//
//   0x00  Input port 0        read-only, reflects the actual pin levels
//   0x01  Output port 0       read/write
//   0x02  Input port 1
//   0x03  Output port 1       <-- NOT the configuration register
//   0x04  Port 0 invert
//   0x05  Port 1 invert
//   0x06  Port 0 CONFIG       <-- this one
//   0x07  Port 1 config
//
// THE PCF8574 HAS NO ADDRESSABLE REGISTER FILE.
//
// TI PCF8574 datasheet Rev. K, Functional description: "This device does not
// have internal configuration or status registers."
// NXP PCF8574/PCF8574A datasheet: "A quasi-bidirectional I/O is an input or
// output port without using a direction control register" and "The simplicity
// of one register (no need for the pointer register or, technically, the
// command byte)".
//
// An earlier version of this firmware used a register map of 0x00 input,
// 0x01 output, 0x04/0x05 invert, 0x06/0x07 configuration. That map does not
// exist on this chip; it was pattern-matched from the PCA95xx and MCP23xxx
// families, where 0x06 really is a direction register. The consequence was a
// firmware that read a phantom configuration register, compared it against
// 0xC1, could never match, and declared a perfectly good expander faulty. The
// device was echoing the command byte because that is what a single-register
// part does when a master keeps addressing registers it does not have.
//
// The real interface is one byte in each direction:
//   write  address + one data byte  -> the data byte appears on the 8 pins
//   read   address + no data byte   -> returns the live level of the 8 pins
//
// A pin is an input purely because something external holds it low. A pin
// written 1 is a weak source (about 100 uA); the master reads 1 unless the
// pin is pulled down. That is how the reed switch works here: closed pulls the
// pin to ground and the read returns 0.
static constexpr uint8_t PCF_PIN_REED = 0;
static constexpr uint8_t PCF_PIN_LED_GREEN = 1;
static constexpr uint8_t PCF_PIN_LED_YELLOW = 2;
static constexpr uint8_t PCF_PIN_LED_RED = 3;
static constexpr uint8_t PCF_PIN_BUZZER = 4;
static constexpr uint8_t PCF_PIN_RC522_RST = 5;

static constexpr uint8_t PCF_OUTPUT_PORT_MASK = 0xFF;
static constexpr uint8_t PCF_CONTROL_PIN_MASK =
    static_cast<uint8_t>((1U << PCF_PIN_LED_GREEN) |
                         (1U << PCF_PIN_LED_YELLOW) |
                         (1U << PCF_PIN_LED_RED) |
                         (1U << PCF_PIN_BUZZER) |
                         (1U << PCF_PIN_RC522_RST));

// P0 in the latch must be 1. A written 1 is a weak source on this chip, which
// is what lets the reed switch pull the pin to ground and be read back as 0.
// Writing 0 would drive the pin low and fight the switch.
static constexpr uint8_t PCF_REED_LATCH_BIT = 0x01;



static constexpr uint8_t REED_CLOSED_LEVEL = LOW;

static constexpr uint8_t BME280_I2C_ADDRESS = 0x76; // 0x77 if SDO is tied high.
static constexpr uint8_t DS3231_ADDRESS = 0x68;
static constexpr uint8_t ADS1115_ADDRESS = 0x48; // Set from the actual ADDR strap.
static constexpr uint8_t LCD_ADDRESS = 0x27;      // Configurable PCF8574 backpack address.
static constexpr uint8_t LCD_COLUMNS = 16;
static constexpr uint8_t LCD_ROWS = 2;

// The register range I2CDUMP walks, INCLUSIVE AT BOTH ENDS.
//
// WHY IT ENDS AT 0x12 AND NOT 0x0F. The previous range was 0x00-0x0F, which is
// the whole register file of a PCF8574 and stops one byte short of the three
// registers a DS3231 diagnostic actually needs. Per the Maxim/Analog DS3231
// datasheet the map runs:
//
//   00h Seconds          07h-0Ah  Alarm 1 block (sec/min/hour/date-day)
//   01h Minutes          0Bh-0Dh  Alarm 2 block (sec/min/hour/date-day)
//   02h Hours            0Eh      Control register
//   03h Day of week      0Fh      Control/Status register
//   04h Date             10h      Aging Offset
//   05h Month/Century    11h      Temperature MSB
//   06h Year             12h      Temperature LSB
//
// 0x12 is the last register the part has. Dumping only to 0x0F left the aging
// offset and the entire temperature channel invisible, which is why the
// firmware fell back to reading 0x07/0x08 - the start of the Alarm 1 block -
// and concluded from that garbage that the temperature channel was broken.
//
// It is a named pair rather than literals repeated in three places, and
// dumpI2cRegisters() static_asserts that the upper bound is still 0x12 so a
// later "tidy-up" cannot quietly narrow it again.
static constexpr uint8_t I2C_DUMP_FIRST = 0x00U;
static constexpr uint8_t I2C_DUMP_LAST = 0x12U;

// ============================================================================
// User configuration
// ============================================================================
//
// WARNING - LIVE CREDENTIALS ARE SET HERE.
//
// The values below are a real WiFi network and the real device ingest key for a
// running backend. They are compiled into the firmware image and are readable
// by anyone with the .ino file, the build artefacts, or the flash dump.
//
// This is acceptable for bench bring-up on a trusted machine and is NOT
// acceptable for a shipped product. Before any real deployment:
//   1. move these into a separate secrets header that is not committed, and
//   2. put the ingest key behind a provisioning flow rather than a #define.
//
// The backend stores only the SHA-256 of the ingest key, so this plaintext is
// the single copy the device and the operator share.

static const char WIFI_SSID[] = "Zohaib Khan (Software Engineer)";
static const char WIFI_PASSWORD[] = "kdx.2655";

static const char THINGSPEAK_API_KEY[] = "REPLACE_ME_THINGSPEAK_WRITE_KEY";
static const char THINGSPEAK_URL[] = "https://api.thingspeak.com/update";
static const char IFTTT_EVENT[] = "freshguard_alert";
static const char IFTTT_WEBHOOK_KEY[] = "REPLACE_ME_IFTTT_WEBHOOK_KEY";

// Host-specific SHA-1 certificate fingerprint placeholders. Obtain and verify
// the current certificate fingerprint through a trusted channel. Keep the
// enable flags false until the byte arrays are replaced.
static constexpr bool THINGSPEAK_TLS_FINGERPRINT_ENABLED = false;
static const uint8_t THINGSPEAK_TLS_FINGERPRINT[20] = {
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

static constexpr bool IFTTT_TLS_FINGERPRINT_ENABLED = false;
static const uint8_t IFTTT_TLS_FINGERPRINT[20] = {
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

// ---------------------------------------------------------------------------
// FreshGuard service (Option B): device -> dashboard snapshot sync
// ---------------------------------------------------------------------------
// One strict JSON snapshot per BACKEND_SNAPSHOT_INTERVAL_MS:
//   POST <BACKEND_URL>/api/v1/ingest/devices/<BACKEND_DEVICE_ID>/snapshots
//   X-FreshGuard-Key: <BACKEND_INGEST_KEY>
// BACKEND_URL is the origin only, with no trailing slash and no /api suffix,
// e.g. "http://192.168.1.50:8080" or "https://freshguard.example.org".
//
// The service stores only the SHA-256 of this key (FG_INGEST_KEY_SHA256); the
// plaintext exists here and in the operator's password manager. There are no
// real secrets in this file.
//
// Plain HTTP is acceptable only for a LAN-only trial. Before the service is
// reachable from anything but localhost, set the fingerprint flag true and
// replace the byte array with a fingerprint obtained through a trusted channel.
static const char BACKEND_URL[] = "http://192.168.100.81:8080";
static const char BACKEND_DEVICE_ID[] = "fg-01";
static const char BACKEND_INGEST_KEY[] = "a2700d5c00d0d77d6e23179782447ce55c64c785994177bb";

// ---------------------------------------------------------------------------
// MQTT transport
// ---------------------------------------------------------------------------
// The device publishes snapshots to a broker rather than POSTing them. The
// backend subscribes to the topic and runs the identical ingest pipeline, so it
// remains the single system of record and the dashboard is unchanged - MQTT
// replaces the wire, not the architecture.
//
// What this buys over HTTP POST, which is kept as an automatic fallback:
//   - the broker buffers while the backend is down, so a snapshot is not lost
//     because an HTTP request timed out
//   - one publish can feed the dashboard, Home Assistant and anything else
//   - the dashboard is pushed the instant the device publishes, rather than
//     being limited by how often the device can complete a TCP handshake
//
// HTTP stays configured and is used whenever the broker is unreachable, so a
// broker outage degrades the system rather than breaking it.
static const char MQTT_BROKER_HOST[] = "192.168.100.81";
static constexpr uint16_t MQTT_BROKER_PORT = 1883;
static const char MQTT_BASE_TOPIC[] = "freshguard";
static const char MQTT_STATUS_TOPIC[] = "online";
static const char MQTT_USER[] = "fg-01";
static const char MQTT_PASSWORD[] = "a371f1d0bf83cbc3de80daf77a7902ea";
static constexpr uint32_t MQTT_KEEPALIVE_S = 30;
static constexpr uint32_t MQTT_RECONNECT_INTERVAL_MS = 5000UL;

// Last Will and Testament. The broker publishes this on mqttStatusTopic if the
// socket dies without a clean DISCONNECT - a power cut, a WiFi drop, a NAT
// timeout - which are the failures the operator has no other way to see. The
// connect path already publishes "offline"/"online" retained on every connect,
// so this uses the same topic and the same payload the dashboard already reads;
// there is no second status concept to keep in step.
//
// QoS 1 rather than 0: the will is the only notification of an unplanned death,
// and QoS 0 drops it on a link that was already marginal. A retained status
// topic is exactly the case a broker is expected to hold.
static constexpr uint8_t MQTT_WILL_QOS = 1;
static const char MQTT_WILL_OFFLINE[] = "offline";

// How many reconnect attempts to report individually before falling back to
// logging only a change of state. See serviceMqtt().
static constexpr uint8_t MQTT_RECONNECT_TRACE_ATTEMPTS = 3;
// Consecutive loop() failures tolerated before the link is torn down and
// rebuilt. loop() is what drives the keepalive pings, so a run of failures
// means the socket is dead while the client still believes it is not - the
// exact state this device used to sit in indefinitely.
static constexpr uint8_t MQTT_LOOP_FAILURE_LIMIT = 3;
// PubSubClient.h already #defines MQTT_MAX_PACKET_SIZE (256) and MQTT_KEEPALIVE,
// and the preprocessor substitutes those macros inside any later declaration of
// the same name, so this cannot reuse them. MQTT_FG_ prefix keeps the two apart.
//
// Raised from 1536 to 2048, and the reason is measured rather than guessed. A
// full snapshot is a fixed ~1035 bytes with an empty registry, and each item adds
// roughly 190-220 bytes, so the 12-item ceiling this device can actually reach
// needs ~3.5 KB. At 1536 the publish was already failing at THREE items - the
// device logged "publish failed; falling back to HTTP" and the item never reached
// the dashboard over the transport that is supposed to be carrying it. 2048 holds
// a four-item registry, which is the point at which the operator is actively
// building an inventory from the dashboard rather than the point at which they
// are stress-testing the table.
//
// The heap cost is real but affordable: the client allocates this once at
// configure time and the sketch sits at ~48 KB of the 80 KB static budget.
// BACKEND_PAYLOAD_CAPACITY is 4096, so the HTTP path was never the constraint -
// only the MQTT buffer was, and only above the item count that matters.
static constexpr uint16_t MQTT_FG_MAX_PACKET_SIZE = 2048;

static constexpr bool BACKEND_TLS_FINGERPRINT_ENABLED = false;
static const uint8_t BACKEND_TLS_FINGERPRINT[20] = {
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

// Snapshot sync: a slow heartbeat plus an immediate push when something
// actually happens.
//
// A fixed interval alone is the wrong shape for a food-safety device. The
// readings that change slowly (temperature, humidity, pressure) do not need
// sub-second reporting, but the things an operator actually acts on do: a door
// opening, a card being scanned, a threshold being crossed, a sensor failing.
// Those were queued and then sat invisible until the next tick, up to 30
// seconds later, which reads on the dashboard exactly like the system being
// stuck.
//
// So: heartbeat every BACKEND_SNAPSHOT_INTERVAL_MS, plus an immediate POST
// whenever requestBackendPost() is called, rate-limited by
// BACKEND_MIN_POST_GAP_MS so a flapping reed or a burst of alerts cannot turn
// into a request flood. The dashboard is SSE-push, so a prompt POST is a
// prompt update on screen.
static constexpr uint32_t BACKEND_SNAPSHOT_INTERVAL_MS = 10000UL;
static constexpr uint32_t BACKEND_MIN_POST_GAP_MS = 2000UL;

// ---------------------------------------------------------------------------
// Change detection: how far a reading must move from the value in the LAST
// PUBLISHED snapshot before the device asks for a push straight away instead
// of waiting for the next heartbeat.
// ---------------------------------------------------------------------------
//
// WHY NOT THE SENSOR'S OWN RESOLUTION
// The BME280 reports temperature, humidity and pressure to 0.01, so a 0.01
// threshold is satisfied by the last bit. On a settled sensor that bit moves on
// nearly every pass, so the device would publish at the full SENSOR_POLL_INTERVAL_MS
// rate forever, for a reading that has not meaningfully changed - a request flood
// that looks like a fault and is indistinguishable from one. The test has to be
// "did something an operator can act on move", not "did a digit move".
//
// WHY THESE FOUR NUMBERS
//   0.1 C   10x the reported resolution and comfortably above the pass-to-pass
//           jitter of a settled reading. It is also one tenth of
//           SENSOR_HYSTERESIS_C (1.0 C), so a change-triggered publish can never
//           outrun the verdict it is meant to accompany - the temperature can be
//           reported moving long before it is worth alarming about.
//   0.5 %RH 50x the resolution, one tenth of HUMIDITY_HYSTERESIS_PCT (5.0). The
//           BME280's +/-3 %RH figure is a calibration accuracy, not noise: on an
//           unmoved sensor the smoothed value stays well inside 0.5 %RH.
//   0.3 hPa 30x the resolution. Pressure is the twitchiest of the three on this
//           build because the MQ-135 heater warms the board it shares, so it gets
//           the widest gate of the three rather than riding its own thermal drift.
//   2 mV    The ADS1115 at GAIN_ONE quantises +/-4.096 V to 0.125 mV per LSB, so
//           2 mV is 16 counts - clear of the converter's own resolution and of
//           the jitter left by the MQ_NORMAL_SAMPLE_COUNT average, while staying
//           an order of magnitude below MQ_ABNORMAL_DELTA_MV (50 mV). A change
//           here therefore never implies a gas event by itself: that remains the
//           alert path, with its own hysteresis, and is unchanged.
//
// These are NOT verdicts and are deliberately separate from every threshold in
// the freshness logic. Nothing below changes what is reported as fresh; it only
// changes WHEN the device tells the backend about it.
static constexpr float PUBLISH_CHANGE_TEMPERATURE_C = 0.1F;
static constexpr float PUBLISH_CHANGE_HUMIDITY_PCT = 0.5F;
static constexpr float PUBLISH_CHANGE_PRESSURE_HPA = 0.3F;
static constexpr float PUBLISH_CHANGE_MQ_MV = 2.0F;

// The service rejects a body over FG_BODY_LIMIT_BYTES (4096 by default) with a
// hard 413, so the device buffer is the same size and a snapshot that would
// overflow is dropped rather than truncated into invalid JSON.
static constexpr size_t BACKEND_PAYLOAD_CAPACITY = 4096;
static constexpr uint8_t BACKEND_MAX_EVENTS = 4; // service hard cap per snapshot
// The ingest 200 response, bounded so a chatty or misconfigured endpoint cannot
// make the read loop run away on the transport path.
//
// TWO fields out of it are load-bearing, and that is why this grew from 256.
// `server_time_epoch` is the clock fix, and the acknowledgement triple
// (`outcome`, plus `events.received/inserted/duplicates`) is what decides
// whether a queue slot may leave the device - see the rule block above
// sendBackendSnapshot(). The service emits `note` LAST (ingest/routes.js), so
// all of them precede it; but with a large `seq`/`uptime_s`/`boot_count` the
// `events` object itself can land past the 255th byte, and `server_time_epoch`
// sits after that. A half-read acknowledgement is indistinguishable from a
// backend that never answered, so 256 was not a safe number to hang the drain
// on; 512 holds the whole body with room to spare (~432 bytes worst case).
static constexpr size_t INGEST_ACK_CAPACITY = 512;

static constexpr bool ALLOW_COMPILE_TIME_RTC_SET = false;
static constexpr uint32_t MIN_VALID_RTC_EPOCH = 1704067200UL; // 2024-01-01 sanity floor.

// Prototype/demo assumptions, not certified food-safety limits.
// Hysteresis is set at least to the documented prototype sensor uncertainty:
// BME280 is now the only environmental sensor. Its factory accuracy is
// +/-1 C and +/-3 %RH, so the hysteresis below is a prototype assumption, not a
// certified food-safety limit. Replace with cited, product-specific
// evidence rather than treating these values as certified limits.
static constexpr float PROTOTYPE_TEMP_MIN_C = 0.0F;
static constexpr float PROTOTYPE_TEMP_MAX_C = 8.0F;
static constexpr float PROTOTYPE_HUMIDITY_MIN_PCT = 30.0F;
static constexpr float PROTOTYPE_HUMIDITY_MAX_PCT = 85.0F;
static constexpr float SENSOR_HYSTERESIS_C = 1.0F;
static constexpr float HUMIDITY_HYSTERESIS_PCT = 5.0F;
static constexpr uint8_t THRESHOLD_CONSECUTIVE_SAMPLES = 3;
static constexpr uint16_t ITEM_USE_SOON_PERCENT = 75;
static constexpr uint32_t ALERT_REARM_MS = 60000UL;
static constexpr uint32_t DOOR_OPEN_TIMEOUT_MS = 30000UL;


// MQ-135 analog conditioning - as actually built.
//
//   MQ-135 AOUT ---> ADS1115 A0, with 10k from A0 to GND.
//
// The 10k is the sensor's LOAD RESISTOR, not a divider. It completes the
// divider that the sensing element forms with the supply, and AIN0 therefore
// sees the sensor's output directly. An earlier version of this file described
// a 4.7k/2.2k divider that was never fitted, so every reported millivolt value
// was scaled by 0.319 and did not correspond to anything the hardware produced.
// MQ_AIN0_SCALE below is therefore 1.0: the reading at AIN0 IS the reading.
//
// The sensor is powered at 3.3V rather than the datasheet's 5V, because the
// ADS1115 input must never exceed its own 3.3V supply. A weaker heater means a
// longer warm-up, which is why MQ_WARMUP_MS is generous and why the baseline is
// only accepted once consecutive passes have stopped drifting.
static constexpr uint32_t MQ_LOAD_OHMS = 10000UL;
static constexpr float MQ_AIN0_SCALE = 1.0F;
static constexpr adsGain_t MQ_ADS_GAIN = GAIN_ONE;       // +/-4.096 V.
static constexpr uint16_t MQ_ADS_DATA_RATE = RATE_ADS1115_128SPS;
static constexpr uint16_t MQ_ADS_DATA_RATE_SPS = 128;    // Update if the rate constant changes.
static constexpr float MQ_ADS_FULL_SCALE_MV = 4096.0F; // GAIN_ONE: +/-4.096 V.
static constexpr float MQ_ADS_FULL_SCALE_VOLTS = MQ_ADS_FULL_SCALE_MV / 1000.0F;
static constexpr float MQ_AIN0_HARD_LIMIT_MV = 3300.0F;
static constexpr float MQ_AIN0_MIN_PLAUSIBLE_MV = 10.0F; // Rejects 0 V/disconnected.
// A 3.3V heater needs far longer than the datasheet's 5V case, where the
// element reaches thermal equilibrium in well under a minute.
static constexpr uint32_t MQ_WARMUP_MS = 180000UL;
// The baseline must be taken from a settled sensor. Measured drift on this
// build was roughly 7 mV per pass while still climbing, so anything tighter
// than this would accept a value that is still moving.
static constexpr float MQ_BASELINE_MAX_DRIFT_MV = 2.0F;
static constexpr uint8_t MQ_BASELINE_SAMPLE_COUNT = 30;
static constexpr uint32_t MQ_BASELINE_SAMPLE_INTERVAL_MS = 1000UL;
static constexpr uint8_t MQ_NORMAL_SAMPLE_COUNT = 4;
static constexpr float MQ_ABNORMAL_DELTA_MV = 50.0F;    // Placeholder AIN0 delta, never ppm.
static constexpr float MQ_CLEAR_DELTA_MV = 40.0F;
// Baseline follow rate, per averaging pass, while the delta is inside the
// clear threshold. See the tracking block in serviceMqSensor() for why this is
// gated rather than continuous.
static constexpr float MQ_BASELINE_TRACKING_FACTOR = 0.02F;

// ---------------------------------------------------------------------------
// Administrator-configured limits (SRS requirement xii)
// ---------------------------------------------------------------------------
// The constants above remain the compiled-in defaults and the fallback whenever
// the backend is unreachable or has nothing configured. They are NOT bypassed:
// a failed fetch leaves the device behaving exactly as it did before.
//
// Every limit is read through an accessor rather than used directly at each use
// site, so there is exactly one place where "configured or default" is decided.
// Using the constants inline is precisely what made these values impossible to
// change without recompiling.
//
// A fetched value is range-checked against the compiled bounds before it is
// accepted. A threshold is the single number that decides whether food gets
// flagged, so a corrupted value must not be able to set a band so narrow that
// everything alarms, or so wide that nothing ever does.
struct Thresholds {
  float tempMinC = PROTOTYPE_TEMP_MIN_C;
  float tempMaxC = PROTOTYPE_TEMP_MAX_C;
  float humidityMinPct = PROTOTYPE_HUMIDITY_MIN_PCT;
  float humidityMaxPct = PROTOTYPE_HUMIDITY_MAX_PCT;
  float gasAbnormalDeltaMv = MQ_ABNORMAL_DELTA_MV;
  float gasClearDeltaMv = MQ_CLEAR_DELTA_MV;
  uint16_t useSoonPercent = ITEM_USE_SOON_PERCENT;
  uint32_t doorTimeoutMs = DOOR_OPEN_TIMEOUT_MS;
  uint32_t revision = 0;    // 0 = compiled defaults; no profile applied
  bool configured = false;  // true once a valid profile has been applied
};

static Thresholds activeThresholds;
static uint32_t lastThresholdFetchMs = 0;
static bool thresholdsFetched = false;
static uint32_t lastThresholdWarnMs = 0;
// Fetched shortly after boot so a device restart picks up any change made while
// it was down, then periodically so a mid-life change propagates without a
// reboot.
static constexpr uint32_t THRESHOLD_FETCH_INTERVAL_MS = 300000UL;

// Fetches the configured profile over HTTP and applies it. Returns the revision
// now in force, or the existing one if the fetch failed.
//
// Failure is deliberately silent apart from a single log line: the compiled
// defaults remain in force, the device keeps working, and the next attempt
// retries. A threshold service being briefly unavailable must never take the
// freshness monitoring offline with it.
static float limitTempMinC()       { return activeThresholds.tempMinC; }
static float limitTempMaxC()       { return activeThresholds.tempMaxC; }
static float limitHumidityMinPct() { return activeThresholds.humidityMinPct; }
static float limitHumidityMaxPct() { return activeThresholds.humidityMaxPct; }
static float limitGasAbnormalMv()  { return activeThresholds.gasAbnormalDeltaMv; }
static float limitGasClearMv()     { return activeThresholds.gasClearDeltaMv; }
static uint16_t limitUseSoonPct()  { return activeThresholds.useSoonPercent; }
static uint32_t limitDoorOpenMs()  { return activeThresholds.doorTimeoutMs; }


// ---------------------------------------------------------------------------
// Applying a configured profile
// ---------------------------------------------------------------------------
// The parser is deliberately small and has no JSON library behind it. It locates
// "key": and reads the number after it, which is unambiguous only because the
// device endpoint returns a flat document with short unique keys
// (rev/tmin/tmax/hmin/hmax/gabn/gclr/usp/dtms). Any key it does not recognise
// is left at the compiled default, so an older or unexpected response degrades
// to current behaviour instead of to nonsense.
//
// A limit is also bounded before it is accepted. These are the numbers that
// decide whether food is flagged, so an out-of-range value - from a corrupted
// response or a mistyped entry that slipped past server validation - must not be
// able to make the device alarm on everything or on nothing.
static bool jsonFindNumber(const char* json, const char* key, float* out) {
  if (!json || !key || !out) return false;
  char pattern[24];
  const int written = snprintf(pattern, sizeof(pattern), "\"%s\":", key);
  if (written < 0 || static_cast<size_t>(written) >= sizeof(pattern)) return false;
  const char* at = strstr(json, pattern);
  if (!at) return false;
  at += written;
  while (*at == ' ') ++at;
  char* end = nullptr;
  const float value = strtof(at, &end);
  if (end == at) return false;
  *out = value;
  return true;
}

static bool jsonFindLong(const char* json, const char* key, long* out) {
  float value = 0.0F;
  if (!jsonFindNumber(json, key, &value)) return false;
  *out = static_cast<long>(value);
  return true;
}

// Returns the applied revision, or 0 when the profile was unusable and the
// compiled defaults are still in force.
static uint32_t applyThresholdProfile(const char* json) {
  long revision = 0;
  if (!jsonFindLong(json, "rev", &revision) || revision <= 0) return 0;

  Thresholds next;  // starts at the compiled defaults
  float value = 0.0F;
  int accepted = 0;

  struct Field { const char* key; float* target; float low; float high; };
  const Field fields[] = {
    {"tmin", &next.tempMinC,       -40.0F,  90.0F},
    {"tmax", &next.tempMaxC,       -40.0F,  90.0F},
    {"hmin", &next.humidityMinPct,   0.0F, 100.0F},
    {"hmax", &next.humidityMaxPct,   0.0F, 100.0F},
    {"gabn", &next.gasAbnormalDeltaMv, 0.1F, 10000.0F},
    {"gclr", &next.gasClearDeltaMv,  0.1F, 10000.0F},
  };
  for (const Field& field : fields) {
    if (!jsonFindNumber(json, field.key, &value)) continue;
    if (!(value >= field.low && value <= field.high)) {
      Serial.printf("[Limits] %s=%.2f out of range, keeping default %.2f\n",
                    field.key, static_cast<double>(value),
                    static_cast<double>(*field.target));
      continue;
    }
    *field.target = value;
    ++accepted;
  }
  if (jsonFindNumber(json, "usp", &value) && value >= 1.0F && value <= 100.0F) {
    next.useSoonPercent = static_cast<uint16_t>(value);
    ++accepted;
  }
  // door_timeout_ms is a whole number of milliseconds and can exceed the range
  // a float represents exactly, so it is read as a long rather than through the
  // float path. Reading it as a float would be fine in practice at 30000 ms and
  // wrong in principle at larger values.
  long timeoutMs = 0;
  if (jsonFindLong(json, "dtms", &timeoutMs) && timeoutMs >= 1000L && timeoutMs <= 86400000L) {
    next.doorTimeoutMs = static_cast<uint32_t>(timeoutMs);
    ++accepted;
  }

  // Hysteresis must stay sane: a clear threshold at or above the abnormal one
  // would latch the gas condition on permanently.
  if (next.gasClearDeltaMv >= next.gasAbnormalDeltaMv) {
    next.gasClearDeltaMv = MQ_CLEAR_DELTA_MV;
    next.gasAbnormalDeltaMv = MQ_ABNORMAL_DELTA_MV;
  }
  if (next.tempMinC >= next.tempMaxC) {
    next.tempMinC = PROTOTYPE_TEMP_MIN_C;
    next.tempMaxC = PROTOTYPE_TEMP_MAX_C;
  }
  if (next.humidityMinPct >= next.humidityMaxPct) {
    next.humidityMinPct = PROTOTYPE_HUMIDITY_MIN_PCT;
    next.humidityMaxPct = PROTOTYPE_HUMIDITY_MAX_PCT;
  }

  next.revision = static_cast<uint32_t>(revision);
  next.configured = true;
  activeThresholds = next;
  Serial.printf("[Limits] Applied revision %lu (%d field(s)): T %.1f..%.1f C, "
                "RH %.0f..%.0f%%, gas %.1f/%.1f mV, use-soon %u%%, door %lu ms\n",
                static_cast<unsigned long>(next.revision), accepted,
                static_cast<double>(next.tempMinC), static_cast<double>(next.tempMaxC),
                static_cast<double>(next.humidityMinPct), static_cast<double>(next.humidityMaxPct),
                static_cast<double>(next.gasClearDeltaMv), static_cast<double>(next.gasAbnormalDeltaMv),
                static_cast<unsigned>(next.useSoonPercent),
                static_cast<unsigned long>(next.doorTimeoutMs));
  return next.revision;
}

static constexpr uint32_t SENSOR_POLL_INTERVAL_MS = 5000UL;
static constexpr uint32_t I2C_RTC_POLL_INTERVAL_MS = 60000UL;
static constexpr uint32_t REED_POLL_INTERVAL_MS = 50UL;
static constexpr uint32_t REED_DEBOUNCE_MS = 80UL;
static constexpr uint32_t RFID_POLL_INTERVAL_MS = 500UL;
// How long ONE presentation of one tag is allowed to occupy the reader.
//
// WHY A WINDOW IS NEEDED AT ALL
// A card held against the antenna is not one scan, it is a stream of successful
// reads. PICC_HaltA() parks the card in HALT so it stops answering, but the field
// resets when the tag is nudged, when it is lifted a millimetre and put back, and
// some tags re-enter READY on their own. At RFID_POLL_INTERVAL_MS that is two
// reads a second, each of which would queue its own event.
//
// WHY IT MATTERS MORE THAN A COSMETIC DUPLICATE
// The queue holds 24 slots and a full queue makes appendAlertEvent() REFUSE new
// events - the loudest condition is kept and the newest is lost, which for a
// food-safety device means the temperature_high that arrived while somebody was
// scanning a yoghurt pot never gets recorded. A scan must not be able to silence
// an alert, so the scan is the thing that gives way.
//
// WHY 5000 ms
// Longer than any deliberate presentation - a person lifts a tag away within a
// second or two - so a single touch produces exactly one event; and short enough
// that deliberately re-presenting the same tag is a new scan, not a repeat. It is
// not a "minimum time between scans" in the reporting sense: the key is the last
// UID read, so scanning two different tags back to back produces two events with
// no waiting at all.
static constexpr uint32_t RFID_SCAN_DEBOUNCE_MS = 5000UL;
static constexpr uint32_t LCD_PAGE_INTERVAL_MS = 2500UL;
static constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 10000UL;
static constexpr uint32_t THINGSPEAK_INTERVAL_MS = 30000UL; // ThingSpeak minimum is 15 s.
static constexpr uint32_t ALERT_RETRY_INTERVAL_MS = 5000UL;
static constexpr uint8_t SENSOR_FAULT_CONFIRM_SAMPLES = 3;
static constexpr uint8_t SENSOR_FAULT_RECOVER_SAMPLES = 3;
static constexpr uint16_t HTTP_TIMEOUT_MS = 2000;

static constexpr uint8_t MAX_INVENTORY_ITEMS = 12;
static constexpr uint8_t ALERT_QUEUE_CAPACITY = 24;
static constexpr size_t SERIAL_LINE_CAPACITY = 256;
static constexpr size_t ALERT_MESSAGE_CAPACITY = 97;

// A card UID carried as hex text on the wire and in the event queue.
//
// parseUidHex() caps UID text at 20 characters, so 10 bytes is the longest UID
// this firmware will ever register or read and 20 hex digits plus a terminator is
// the exact requirement - no slack, and no truncation of a longer one. The queue
// slot and the in-memory event are both sized from this constant, so the field
// cannot quietly be made smaller than the thing it has to hold.
//
// The SPELLING is fixed by formatUid() and is the same one the registry uses:
// uppercase hex, no separators, no "0x" - see the comment there, which is why a
// scan of a registered tag matches inventory_item.uid byte for byte.
static constexpr size_t EVENT_UID_CAPACITY = 21;

// The longest UID this build can hold, in bytes. Mirrors the text cap above.
static constexpr uint8_t EVENT_UID_MAX_BYTES = EVENT_UID_CAPACITY / 2;

static const char QUEUE_PATH[] = "/fg_events.bin";
// Migration scratch file. Never read at runtime; if a migration is interrupted
// it is simply overwritten on the next boot.
static const char QUEUE_MIGRATE_PATH[] = "/fg_events.v1.tmp";
static const char INVENTORY_PATH[] = "/fg_inventory.txt";
static const char MQ_BASELINE_PATH[] = "/fg_mq_base.bin";

static constexpr uint16_t SENSOR_FAULT_BME280 = 1U << 0;
static constexpr uint16_t SENSOR_FAULT_BME280_HUMIDITY = 1U << 1;
static constexpr uint16_t SENSOR_FAULT_ADS1115 = 1U << 2;
static constexpr uint16_t SENSOR_FAULT_MQ135 = 1U << 3;
static constexpr uint16_t SENSOR_FAULT_DS3231 = 1U << 4;
static constexpr uint16_t SENSOR_FAULT_PCF8574_READ = 1U << 5;
static constexpr uint16_t SENSOR_FAULT_PCF8574_WRITE = 1U << 6;
static constexpr uint16_t SENSOR_FAULT_REED = 1U << 7;
// Number of distinct sensor conditions tracked, used only for the LCD summary
// line so it can report "6 of 6 reporting" without hard-coding a count that
// would drift whenever a bit is added.
static constexpr uint16_t SENSOR_FAULT_COUNT = 8;

static constexpr uint16_t STORAGE_FAULT_LITTLEFS = 1U << 8;
static constexpr uint16_t STORAGE_FAULT_INVENTORY = 1U << 9;
static constexpr uint16_t STORAGE_FAULT_ALERT_QUEUE = 1U << 10;
static constexpr uint16_t STORAGE_FAULT_CONFIGURATION = 1U << 11;

static constexpr uint16_t OPTIONAL_FAULT_RC522 = 1U << 12;
static constexpr uint16_t OPTIONAL_FAULT_LCD = 1U << 13;

// NOTE: bit 14 was STORAGE_FAULT_RTC_BATTERY, fed by a fabricated "BAT" decode
// of DS3231 status register 0x0F bit 3. The DS3231 has no battery-low bit -
// 0x0F bit 3 is EN32kHz - so there is nothing to report and the bit is
// deliberately unused rather than reused for something else. The CR2032 is a
// periodic operator maintenance item found by testing the cell, not something
// this firmware can observe. See the header note "THE DS3231 HAS NO BATTERY-LOW
// BIT" and readDs3231TemperatureC() for what the chip does expose.

// Configuration-only self-checks; these do not validate physical wiring.
static_assert(PIN_I2C_SDA != PIN_I2C_SCL, "I2C pins must differ");

static_assert(PIN_RC522_MISO != 0 && PIN_RC522_MOSI != 0 &&
              PIN_RC522_SCK != 0 && PIN_RC522_SS != 0,
              "Invalid SPI pin");
static_assert(PIN_RC522_MISO != PIN_RC522_MOSI &&
              PIN_RC522_MISO != PIN_RC522_SCK &&
              PIN_RC522_MISO != PIN_RC522_SS &&
              PIN_RC522_MOSI != PIN_RC522_SCK &&
              PIN_RC522_MOSI != PIN_RC522_SS &&
              PIN_RC522_SCK != PIN_RC522_SS,
              "SPI pins must differ");
static_assert(PIN_RC522_MISO != PIN_I2C_SDA && PIN_RC522_MISO != PIN_I2C_SCL &&
              PIN_RC522_MOSI != PIN_I2C_SDA && PIN_RC522_MOSI != PIN_I2C_SCL &&
              PIN_RC522_SCK != PIN_I2C_SDA && PIN_RC522_SCK != PIN_I2C_SCL &&
              PIN_RC522_SS != PIN_I2C_SDA && PIN_RC522_SS != PIN_I2C_SCL,
              "SPI and I2C pins conflict");
static_assert(PCF8574_ADDRESS != LCD_ADDRESS && PCF8574_ADDRESS != BME280_I2C_ADDRESS &&
              PCF8574_ADDRESS != DS3231_ADDRESS && PCF8574_ADDRESS != ADS1115_ADDRESS,
              "I2C address collision");
static_assert(LCD_ADDRESS != BME280_I2C_ADDRESS && LCD_ADDRESS != DS3231_ADDRESS &&
              LCD_ADDRESS != ADS1115_ADDRESS && BME280_I2C_ADDRESS != DS3231_ADDRESS &&
              BME280_I2C_ADDRESS != ADS1115_ADDRESS && DS3231_ADDRESS != ADS1115_ADDRESS,
              "I2C address collision");
static_assert(SENSOR_HYSTERESIS_C >= 1.0F && HUMIDITY_HYSTERESIS_PCT >= 5.0F,
              "Prototype hysteresis must cover documented sensor uncertainty");
static_assert(MQ_ADS_GAIN == GAIN_ONE, "MQ ADS1115 range must use GAIN_ONE");
static_assert(MQ_ADS_FULL_SCALE_MV == 4096.0F,
              "GAIN_ONE full scale must be 4096 mV, not 4096 V");
static_assert(MQ_LOAD_OHMS >= 1000UL,
              "MQ load resistor must be at least 1k to form a divider with the sensor");
static_assert(MQ_AIN0_SCALE > 0.0F && MQ_AIN0_SCALE <= 1.0F,
              "MQ AIN0 scale must be a positive fraction, not a multiplier");
static_assert(MQ_BASELINE_MAX_DRIFT_MV > 0.0F,
              "Baseline settling tolerance must be positive");
static_assert(MQ_AIN0_MIN_PLAUSIBLE_MV > 0.0F &&
              MQ_AIN0_MIN_PLAUSIBLE_MV < MQ_AIN0_HARD_LIMIT_MV,
              "MQ plausibility bounds are invalid");
static_assert(MQ_CLEAR_DELTA_MV < MQ_ABNORMAL_DELTA_MV,
              "MQ clear threshold must be below alarm threshold");
static_assert(sizeof(PCF_OUTPUT_PORT_MASK) * 8 == 8 && PCF_OUTPUT_PORT_MASK == 0xFF,
              "PCF8574 output shadow must be a full 8-bit port");
static_assert(PCF_PIN_REED <= 7 && PCF_PIN_LED_GREEN <= 7 &&
              PCF_PIN_LED_YELLOW <= 7 && PCF_PIN_LED_RED <= 7 &&
              PCF_PIN_BUZZER <= 7 && PCF_PIN_RC522_RST <= 7,
              "PCF8574 pin index out of range");
static_assert((PCF_CONTROL_PIN_MASK & (1U << PCF_PIN_REED)) == 0,
              "Reed pin cannot be an output");
static_assert((PCF_REED_LATCH_BIT & (1U << PCF_PIN_REED)) != 0,
              "PCF8574 P0 latch bit must be 1 so the reed pin is a weak source");
static_assert(REED_CLOSED_LEVEL == LOW,
              "P0 reed-to-GND wiring requires closed level LOW");
static_assert(ALERT_QUEUE_CAPACITY > 0 && MAX_INVENTORY_ITEMS > 0,
              "Bounded storage must be non-zero");
static_assert(MQ_BASELINE_SAMPLE_COUNT > 0 && MQ_NORMAL_SAMPLE_COUNT > 0,
              "MQ sample counts must be non-zero");

// ============================================================================
// Types and fixed-size state
// ============================================================================

enum class FreshnessStatus : uint8_t {
  Fresh = 0,
  UseSoon = 1,
  CheckFood = 2,
  SensorFault = 3
};

enum class MqState : uint8_t {
  WarmingUp,
  CapturingBaseline,
  Ready,
  Faulted
};

enum class MqReadResult : uint8_t {
  Ok,
  AdcUnavailable,
  Implausible
};

enum class BuzzerState : uint8_t {
  Idle,
  On,
  OffGap
};

struct SensorFaults {
  bool bme280;
  bool bme280Humidity;
  bool ads1115;
  bool mq135;
  bool ds3231;
  bool pcf8574Read;
  bool pcf8574Write;
  bool reed;
  bool littlefs;
  bool inventory;
  bool alertQueue;
  bool configuration;
  bool rc522; // Optional identity function.
  bool lcd;    // Optional display function.
};
// There is deliberately no `rtcBattery` member. It existed only to carry the
// fabricated 0x0F bit-3 "BAT" decode described above; the DS3231 exposes no
// backup-cell state, so a struct field for it could only ever carry a fiction.

struct FaultDebounceState {
  bool active;
  uint8_t failureCount;
  uint8_t recoveryCount;
  uint32_t lastTransitionMs;
};

struct ConfirmedLatch {
  bool active;
  uint8_t consecutive;
  uint32_t lastRaisedMs;
};

struct FoodItem {
  uint8_t uid[10];
  uint8_t uidLength;
  char name[24];
  char category[16];
  char quantity[12];
  char location[24];
  uint32_t storeDateEpoch;
  uint32_t expiryEpoch; // 0 means use durationLimitDays.
  uint16_t durationLimitDays;
  // Added last, and it has to stay last. The LittleFS record is positional
  // text, so a field inserted anywhere but the end would shift every field
  // after it and silently re-read an old file at the wrong offsets. The record
  // version (see INVENTORY_VERSION) is what makes that safe to detect; keeping
  // the field at the end is what keeps the earlier offsets unchanged.
  //
  // 0 means "manufacture date unknown". Nothing derives a verdict from it: it
  // is dashboard-supplied metadata, reported in items[] and stored, and the
  // freshness maths reads only storeDateEpoch, expiryEpoch and
  // durationLimitDays.
  uint32_t manufactureEpoch;
};

struct ItemRuntime {
  ConfirmedLatch useSoon;
  ConfirmedLatch checkFood;
};

struct AlertEvent {
  uint32_t eventId;
  uint32_t timestampEpoch;
  bool timeValid;
  char type[20];
  // The tag this event is about, hex, as the reader read it. Empty for every
  // event that is not about a tag, which is the honest encoding: the service
  // stores an absent uid as NULL and never as "" or a sentinel, and it is
  // optional in the schema precisely so the eleven pre-existing event types are
  // unaffected by its existence.
  char uid[EVENT_UID_CAPACITY];
  char message[ALERT_MESSAGE_CAPACITY];
};

// The queue file header, fixed at 16 bytes (see the static_assert below).
//
// `nextEventId` is the highest id this FILE has spoken for - the id the last
// append issued, or the seed a freshly created file reserves - and which of the
// two it is depends on who wrote it. That ambiguity is resolved in exactly one
// place, initializeAlertQueue(), rather than at each read, because reading it
// the wrong way is a duplicate-id generator: an id already sitting in a slot
// handed out a second time collides on the backend's (device_id,
// boot_generation, event_id) key and one of the two events is dropped with a
// 2xx. `reserved` stays 0 and is not a semantic flag, and the layout does NOT
// change with the event_id seeding fix - so QUEUE_VERSION is deliberately not
// bumped, and an existing file keeps its pending events instead of being
// refused behind a CLEARQ it did not ask for.
struct QueueHeaderDisk {
  uint32_t magic;
  uint16_t version;
  uint16_t capacity;
  uint32_t nextEventId;
  uint32_t reserved;
};

struct QueueSlotDisk {
  uint32_t magic;
  uint8_t syncState; // 0 = empty, 1 = pending synchronization.
  uint8_t timeValid;
  uint32_t eventId;
  uint32_t timestampEpoch;
  char type[20];
  char message[ALERT_MESSAGE_CAPACITY];
  // The tag this event is about, hex, as the reader read it. Placed last, just
  // before `crc`, so it is the only thing this build added to the on-disk slot.
  char uid[EVENT_UID_CAPACITY];
  uint32_t crc;
};

// The version 1 queue slot: the layout above without the per-event uid. Kept so
// the file an older build wrote can be READ rather than discarded, which is the
// difference between a queue that comes back and a queue that is dead forever.
//
// Never written by this build, and deliberately NOT read by raw byte offset -
// migrateAlertQueueV1() copies field by field, because a struct with padding is
// not a description of a byte range and pretending otherwise is how a migration
// ends up reinterpreting memory.
struct QueueSlotDiskV1 {
  uint32_t magic;
  uint8_t syncState;
  uint8_t timeValid;
  uint32_t eventId;
  uint32_t timestampEpoch;
  char type[20];
  char message[ALERT_MESSAGE_CAPACITY];
  uint32_t crc;
};

// The migration identifies an old file by its SIZE, which only works while the v2
// slot is strictly the larger one. If a future field is ever removed instead, this
// fires rather than letting a v1 file be mistaken for a v2 one.
static_assert(sizeof(QueueSlotDisk) > sizeof(QueueSlotDiskV1),
              "the current slot must be the larger one, or the v1 file size no"
              " longer identifies a v1 file");
// `crc` must stay last: crc32() is taken over offsetof(QueueSlotDisk, crc), so
// anything after it would be written but never checked.
static_assert(offsetof(QueueSlotDisk, crc) + sizeof(uint32_t) == sizeof(QueueSlotDisk),
              "QueueSlotDisk::crc must be the final field");
// A migrated event must not lose any of its text, or a v1 message would arrive
// truncated and mean something else.
static_assert(sizeof(QueueSlotDiskV1::message) <= sizeof(QueueSlotDisk::message),
              "message[] must not shrink between queue versions");
static_assert(sizeof(QueueSlotDiskV1::type) <= sizeof(QueueSlotDisk::type),
              "type[] must not shrink between queue versions");
// The header is not versioned with the slot and must not grow: the migration
// copies it through unchanged, so a field added here would be read as part of
// the first v1 slot.
static_assert(sizeof(QueueHeaderDisk) == 16, "QueueHeaderDisk must stay 16 bytes");

struct MqBaselineDisk {
  uint32_t magic;
  uint16_t version;
  uint16_t dividerTopOhms;
  uint16_t dividerBottomOhms;
  uint16_t fullScaleMv;
  uint16_t sampleCount;
  float baselineMv;
  uint32_t crc;
};

static constexpr uint32_t QUEUE_MAGIC = 0x46513031UL; // "FG01"
// Version 2 is version 1 plus a per-event `uid`, which grew the slot and with it
// the file. The version number alone cannot save an upgrade: initializeAlertQueue()
// also compares the file size, so a v1 file is a size mismatch and would be
// refused outright - leaving queueReady false, which makes appendAlertEvent()
// fail for EVERY condition, so a warm fridge and a dead sensor would both go
// unrecorded. migrateAlertQueueV1() therefore widens the old file before that
// check runs, keeping every pending event with an empty uid, which is exactly
// what "this event is not about a tag" means on the wire.
static constexpr uint16_t QUEUE_VERSION = 2;
static constexpr uint16_t QUEUE_VERSION_1 = 1;
static constexpr uint32_t QUEUE_SLOT_MAGIC = 0x46514531UL; // "FQE1"
static constexpr uint32_t MQ_BASELINE_MAGIC = 0x4651424DUL; // "FQBM"
static constexpr uint16_t MQ_BASELINE_VERSION = 1;

// On-disk layout of /fg_inventory.txt, carried in the file header as a tag.
//
// Version 1 wrote eight fields per record; version 2 appends manufacture_epoch
// as a ninth. The two are not interchangeable and the difference is invisible
// from the data: a v1 record read by v2 rules would take the last field of the
// NEXT line as a manufacture epoch, which parses as a number often enough to go
// unnoticed. So the tag is compared before a single record is read, and a
// mismatch refuses the whole file with the reason logged. It is left on flash
// untouched rather than rewritten or deleted - the operator may still want the
// records, and this firmware is not the thing that decides they are unreadable.
//
// Bump this whenever a record gains, loses or reorders a field.
static constexpr uint16_t INVENTORY_VERSION = 2;
static const char INVENTORY_MAGIC[] = "FG2";

// ============================================================================
// PCF8574 channel polarity - MUST stay below the struct definitions
// ============================================================================
// Placement is load-bearing, not cosmetic.
//
// The Arduino build rewrites a .ino into a .cpp and inserts a block of
// auto-generated prototypes near the top of the file. That insertion point
// anchors on the first function-like construct the tagger finds, so any helper
// function defined ABOVE the struct definitions pulls the whole prototype block
// up with it. A prototype such as
//
//     static bool updateFaultDebounce(FaultDebounceState*, bool, uint32_t);
//
// would then be emitted before `struct FaultDebounceState` exists, and the
// build fails with "'FaultDebounceState' was not declared in this scope" - an
// error that points at a perfectly correct line and has nothing to do with it.
//
// Keeping these helpers below the structs keeps the generated prototypes below
// them too. The robust alternative is to move every type into its own .h, which
// the includes make visible ahead of any prototype; that is a larger change
// than this sketch currently needs.

/**
 * Per-channel drive polarity. There is deliberately no single global flag,
 * because the three output styles wired to P1-P5 do NOT share a convention:
 *
 *   P1-P3  LEDs.  Wired rail -> LED -> resistor -> pin, so the pin SINKS and
 *          the internal pull-down MOSFET closes the path. The LED therefore
 *          lights when the pin is LOW: active-low. This keeps the expander's
 *          weak source off the current path entirely - ~8 mA per lit channel
 *          against the pin's 25 mA sink rating.
 *   P4     Buzzer.  Wired to a TO-220 IRFZ44N gate through a 100k pull-down,
 *          so the pin SOURCES and the load conducts when the pin is HIGH:
 *          active-high.
 *   P5     RC522 reset - active-low, same convention as the LEDs. Driven
 *          through pcfSetOutputActive() now rather than pcfSetRawBit(), so the
 *          idle pattern below can hold it de-asserted in a single write.
 *
 * In short: P4 is the only active-high channel. Everything else is active-low,
 * so the table is a single equality rather than an exclusion list - an
 * exclusion list is what got this wrong once already, by omitting P5.
 */
static constexpr bool PCF_PIN_ACTIVE_HIGH(uint8_t pin) {
  return pin == PCF_PIN_BUZZER;
}

static constexpr uint8_t PCF_INACTIVE_BIT(uint8_t pin) {
  return PCF_PIN_ACTIVE_HIGH(pin) ? 0x00 : static_cast<uint8_t>(1U << pin);
}

/**
 * The output pattern that leaves every switched load OFF.
 *
 * Derived from the polarity table rather than written as a literal, so the two
 * cannot drift apart. Writing 0x00 here would be wrong for the LED channels:
 * with them wired to sink, all-zeros lights all three.
 */
static constexpr uint8_t PCF_OUTPUTS_INACTIVE =
    static_cast<uint8_t>(PCF_INACTIVE_BIT(PCF_PIN_LED_GREEN) |
                         PCF_INACTIVE_BIT(PCF_PIN_LED_YELLOW) |
                         PCF_INACTIVE_BIT(PCF_PIN_LED_RED) |
                         PCF_INACTIVE_BIT(PCF_PIN_BUZZER) |
                         PCF_INACTIVE_BIT(PCF_PIN_RC522_RST));

static_assert(PCF_PIN_ACTIVE_HIGH(PCF_PIN_BUZZER),
              "buzzer is driven from a MOSFET gate, so it must stay active-high");
static_assert(!PCF_PIN_ACTIVE_HIGH(PCF_PIN_LED_GREEN) &&
              !PCF_PIN_ACTIVE_HIGH(PCF_PIN_LED_YELLOW) &&
              !PCF_PIN_ACTIVE_HIGH(PCF_PIN_LED_RED),
              "LEDs are wired rail -> LED -> pin, so they must stay active-low");
static_assert(PCF_OUTPUTS_INACTIVE ==
                  ((1U << PCF_PIN_LED_GREEN) | (1U << PCF_PIN_LED_YELLOW) |
                   (1U << PCF_PIN_LED_RED) | (1U << PCF_PIN_RC522_RST)),
              "idle pattern must hold the LED sinks and RC522 reset off while the buzzer gate stays low");

// Adafruit_BME280 has no TwoWire constructor: the bus is supplied to begin(),
// which defaults to &Wire. Its begin() also validates chip id 0x60, so a
// mislabelled BMP280 is rejected here rather than misread as a BME280.
static Adafruit_BME280 bme280;
static Adafruit_ADS1115 ads1115;
static RTC_DS3231 rtc;
static LiquidCrystal_I2C lcd(LCD_ADDRESS, LCD_COLUMNS, LCD_ROWS);
static MFRC522 rc522(PIN_RC522_SS, MFRC522::UNUSED_PIN);

static SensorFaults faults = {};
static FoodItem inventory[MAX_INVENTORY_ITEMS];
static ItemRuntime itemRuntime[MAX_INVENTORY_ITEMS];
static uint8_t inventoryCount = 0;
static int8_t latestScannedItem = -1;

static float temperatureC = NAN;
static float pressureHpa = NAN;
static float humidityPct = NAN;
static float mqInputMv = NAN;
static float mqDeltaMv = NAN;
static int16_t mqAdcCode = 0;
static MqState mqState = MqState::WarmingUp;
static bool mqBaselineReady = false;
static float mqBaselineMv = NAN;
static float mqBaselineSum = 0.0F;
static uint8_t mqBaselineCount = 0;
// Baseline capture has two phases: wait for the sensor to stop drifting, then
// average a run of settled passes. Without the first phase the stored baseline
// is a value the sensor merely passed through on the way up.
static bool mqSettling = false;
static uint16_t mqSettlePasses = 0;
static float mqSettlingPreviousMv = 0.0F;
static uint32_t lastAdsInitAttemptMs = 0;

static bool bmeDataReady = false;
static bool humidityReady = false;
static bool ds3231TimeReady = false;
static bool pcfReadReady = false;
static bool pcfInitialized = false;

static uint8_t pcfOutputShadow = 0x00;
static bool doorOpen = false;
static bool reedCandidate = false;
static bool reedStableInitialized = false;
static uint32_t reedCandidateSinceMs = 0;
static uint32_t doorOpenSinceMs = 0;
static bool doorAlertSentForOpenCycle = false;

static bool rtcReady = false;
static bool rtcClockTrusted = false;
static uint32_t rtcEpoch = 0;

static bool adsReady = false;
static bool bmeReady = false;
static bool lcdReady = false;
static bool lcdBacklightOn = true;
static bool rc522Ready = false;

static bool storageReady = false;
static bool queueReady = false;
static bool inventoryStoreReady = false;
// The counter behind every event_id. 0 means "no counter has been established
// yet" and deliberately NOT 1. The initialiser here used to be 1, so any path
// that reached appendAlertEvent() without first loading a seeded header would
// hand out ids from the bottom of the number line - which is exactly the band
// every earlier life of this device has already published. A reflash recreated
// the queue file, the counter restarted at 1, and the backend's dedupe silently
// swallowed ~12,400 follow-on events while every POST returned 2xx and the
// queue drain looked perfectly healthy. Every path that needs an id now goes
// through seedQueuedEventId() or a validated header; neither can produce 1.
static uint32_t nextQueuedEventId = 0;
// Within-boot high-water mark: the greatest event_id this boot has reserved or
// issued. The backend scopes its dedupe by boot_generation, which it increments
// when uptime DECREASES - so a reboot that restarts the counter is covered
// upstream. What upstream cannot see is a counter restarting while uptime
// keeps counting: CLEARQ at the console, or a queue file recreated mid-run by
// flash recovery. (A header rejected after a brownout does not restart the
// counter at all - it stops the queue until CLEARQ, which reseeds through this
// clamp either way.) This variable is the layer for exactly that case: every
// reseed is clamped above it, so no id handed out during this boot can ever
// repeat, whatever the clock does in between (a server time correction can
// step the reported epoch BACKWARDS by hours on this hardware - see
// rememberServerTime()).
static uint32_t lastIssuedQueuedEventId = 0;
static uint8_t queuedEventCount = 0;

static bool wifiConnected = false;
static bool wifiConfigured = false;
static bool wifiCredentialsWarned = false;
static uint32_t lastWifiBeginMs = 0;

static bool thingspeakConfigured = false;
static bool thingspeakConfigWarned = false;
static bool iftttConfigured = false;
static bool iftttConfigWarned = false;
static BearSSL::WiFiClientSecure transportTls;

// Option B service sync. `backendSeq` is monotonic within one boot; the
// service treats a decreasing `uptime` as the reboot signal and restarts its
// own sequence tracking, so resetting both together on boot is correct.
static bool backendConfigured = false;
static bool mqttConfigured = false;
static bool backendConfigWarned = false;
static uint32_t backendSeq = 0;

// MQTT transport state. Declared with the other transport state rather than in
// the MQTT section further down, because the configuration check configures the
// client long before that section is reached.
static void onMqttMessage(char* topic, uint8_t* payload, unsigned int length);
// This PubSubClient version fixes the message callback at construction - there
// is no setCallback() - and only offers callback constructors that also take the
// server. The host, port and callback therefore all go in here, which replaces
// the setServer() call the configuration code used to make. Passing the callback
// is what makes the retained threshold profile arrive on connect instead of
// having to poll a topic over a port this network filters.
//
// One callback therefore serves every topic this device subscribes to, so it
// dispatches on `topic` internally. Registering a second handler is not an
// option in this library version, and treating the command topic as if it were
// the config topic would apply a threshold profile to an item registration.
static WiFiClient mqttNetworkClient;
static PubSubClient mqttClient(MQTT_BROKER_HOST, MQTT_BROKER_PORT,
                               onMqttMessage, mqttNetworkClient);
static bool mqttConnected = false;
static uint32_t lastMqttAttemptMs = 0;
static uint32_t mqttPublishFailures = 0;
static uint8_t mqttLoopFailures = 0;
static uint32_t mqttConnects = 0;
static char mqttSnapshotTopic[64];
static char mqttStatusTopic[64];
static char mqttConfigTopic[64];
static char mqttCommandTopic[64];

// Set by anything worth surfacing immediately. Deliberately not persisted: a
// pending push is worthless after a reboot, because the boot snapshot already
// reports the current state. Defined here rather than beside the interval
// constants because it reads backendConfigured and lastBackendAttemptMs, which
// are declared further down - a definition above them cannot compile.
static bool backendPostRequested = false;

static void requestBackendPost() { backendPostRequested = true; }

static uint32_t lastBackendAttemptMs = 0;

// The sensor values the backend last ACCEPTED, not the last ones read.
//
// Anchoring to what was published is what makes one change one event. Compared
// against the last READ values, a change seen during a post cooldown would keep
// re-triggering on every later poll, because the "previous" value it is measured
// against had itself moved on: the device would never stop asking, and the
// cooldown would be the only thing holding the cadence down.
//
// NAN means "no baseline yet" and is left alone by the comparison, which is
// exactly the behaviour wanted before the first snapshot of a boot: there is
// nothing to have changed relative to, and the heartbeat is about to publish
// the boot state anyway. A channel that is unavailable at the moment of a
// publish stays NAN here, so the reading that finally arrives is not mistaken
// for a change away from a value that was never reported.
struct PublishedReadings {
  float temperatureC;
  float humidityPct;
  float pressureHpa;
  float mqInputMv;
  float mqDeltaMv;
};
static PublishedReadings lastPublishedReadings = {NAN, NAN, NAN, NAN, NAN};

// Bumped whenever the in-memory registry changes, so the service can tell a
// genuine list change from an unchanged re-send.
static uint32_t inventoryRevision = 1;

// The highest cmd_seq this device has actually APPLIED, persisted in the
// inventory file's header alongside the item count rather than in a second
// storage system, so it shares the registry's already-proven save/load/CRC
// discipline and cannot drift out of step with it.
//
// This only became necessary once the session went persistent. A clean session
// could not redeliver anything, so a duplicate could not arrive. A persistent
// session can - the broker replays an unacked QoS 1 command, and a session that
// outlives a power cycle replays everything still queued - and item.clear and
// item.register are not idempotent for free. Zero means "nothing applied yet",
// which accepts every cmd_seq a backend that counts from 1 can send, and is
// also what a registry file written before this field existed loads as.
static uint32_t lastAppliedCmdSeq = 0;

static uint32_t bootMs = 0;
static uint32_t lastSensorPollMs = 0;
static uint32_t lastMqReadMs = 0;

// Heartbeat or an explicit request, whichever comes first, subject to a minimum
// gap so a flapping reed or a burst of alerts cannot become a request flood.
static bool backendPostDue(uint32_t nowMs) {
  if (!backendConfigured) return false;
  const uint32_t sinceLast = static_cast<uint32_t>(nowMs - lastBackendAttemptMs);
  if (sinceLast < BACKEND_MIN_POST_GAP_MS) return false;
  return backendPostRequested || sinceLast >= BACKEND_SNAPSHOT_INTERVAL_MS;
}
static uint32_t lastRtcPollMs = 0;
static uint32_t lastReedPollMs = 0;
static uint32_t lastRfidPollMs = 0;
static uint32_t lastLcdPageMs = 0;
static uint32_t lastTransportAttemptMs = 0;
static uint32_t lastThingSpeakAttemptMs = 0;

// Queue acknowledgement state. The RULE lives with the code that reads it,
// above sendBackendSnapshot(); this is only the storage.
//
// Both sets are RAM only, on purpose. They record what THIS boot has been TOLD,
// not anything about the event itself, and a reboot that loses them costs only a
// re-send of a slot that is still on flash - the service de-duplicates it, or
// files it under the new boot generation, and neither loses anything. The
// dangerous direction would be persisting them: a device that boots already
// believing an obligation was settled never tries again, and the resulting gap
// is indistinguishable from an alert that never happened.
//
// Ids are never issued twice inside one boot (seedQueuedEventId()'s high-water
// clamp), so a stale entry left by a popped or cleared slot can never match a
// later event - it is dead bytes, not a false acknowledgement.
static uint32_t inFlightEventIds[BACKEND_MAX_EVENTS];   // ids in the payload being sent
static uint8_t inFlightEventCount = 0;
static uint32_t storageAckedEventIds[BACKEND_MAX_EVENTS]; // ids the service confirmed a row for
static uint8_t storageAckedEventCount = 0;
// The one event_id the notification webhook has been delivered for. A single
// value is enough even though there are 24 slots: the notification leg only ever
// offers the HEAD of the queue, so at most one delivery can be outstanding and
// unconfirmed at any moment.
static uint32_t webhookDeliveredEventId = 0;

static ConfirmedLatch temperatureHighLatch = {};
static ConfirmedLatch temperatureLowLatch = {};
static ConfirmedLatch humidityHighLatch = {};
static ConfirmedLatch humidityLowLatch = {};
static ConfirmedLatch gasHighLatch = {};

static FaultDebounceState bme280Debounce = {};
static FaultDebounceState bme280HumidityDebounce = {};
static FaultDebounceState ads1115Debounce = {};
static FaultDebounceState mq135Debounce = {};
static FaultDebounceState ds3231Debounce = {};
static FaultDebounceState pcfReadDebounce = {};
static FaultDebounceState pcfWriteDebounce = {};

static FreshnessStatus zoneStatus = FreshnessStatus::SensorFault;
static uint16_t announcedSensorFaultMask = 0;
static uint16_t announcedStorageFaultMask = 0;
static uint32_t lastSensorFaultAlertMs = 0;
static uint32_t lastStorageFaultAlertMs = 0;

static uint8_t buzzerRemainingBeeps = 0;
static BuzzerState buzzerState = BuzzerState::Idle;
static uint32_t buzzerNextTransitionMs = 0;
static uint16_t buzzerOnMs = 200;
static uint16_t buzzerOffMs = 150;

static uint32_t redBlinkNextMs = 0;
static bool redBlinkOn = false;
static uint8_t lcdPage = 0;

// Tag-presentation debounce. The key is the LAST tag read, not a counter: a card
// held against the antenna is one presentation, while two different tags brought
// up in succession are two presentations and neither waits for the other.
//
// lastScanMs is left at its previous value while a card is being suppressed, so
// the window always runs from the first presentation of that tag rather than
// being extended by every poll - otherwise a tag that never leaves the field
// would never be re-reportable at all. The flag is only so the console gets one
// line per suppressed presentation instead of one per 500 ms poll.
static uint8_t rfidLastScanUid[EVENT_UID_MAX_BYTES] = {0};
static uint8_t rfidLastScanUidLength = 0;
static uint32_t rfidLastScanMs = 0;
static bool rfidDebounceReported = false;

static char lcdAlertText[ALERT_MESSAGE_CAPACITY] = "";
static uint32_t lcdAlertUntilMs = 0;

static char serialLine[SERIAL_LINE_CAPACITY];
static uint16_t serialLineLength = 0;
static bool serialLineOverflow = false;
static bool serialOverflowWarned = false;

// ============================================================================
// Small fixed-memory helpers
// ============================================================================

static void copyBounded(char* destination, size_t capacity, const char* source) {
  if (capacity == 0) return;
  size_t index = 0;
  while (source && source[index] != '\0' && index + 1 < capacity) {
    destination[index] = source[index];
    ++index;
  }
  destination[index] = '\0';
}

static void sanitizeField(char* destination, size_t capacity, const char* source) {
  if (capacity == 0) return;
  size_t index = 0;
  while (source && source[index] != '\0' && index + 1 < capacity) {
    char value = source[index];
    if (value < 32 || value > 126 || value == '|' || value == '"' || value == '\\') {
      value = ' ';
    }
    destination[index++] = value;
  }
  destination[index] = '\0';
}

static float smoothValue(float previous, float current, float newWeight) {
  return isnan(previous) ? current : ((1.0F - newWeight) * previous) + (newWeight * current);
}

static bool updateFaultDebounce(FaultDebounceState* state, bool sampleFailed, uint32_t nowMs) {
  if (!state) return false;
  if (sampleFailed) {
    state->recoveryCount = 0;
    if (state->failureCount < 255) ++state->failureCount;
    if (!state->active && state->failureCount >= SENSOR_FAULT_CONFIRM_SAMPLES) {
      state->active = true;
      state->lastTransitionMs = nowMs;
    }
  } else {
    state->failureCount = 0;
    if (state->recoveryCount < 255) ++state->recoveryCount;
    if (state->active && state->recoveryCount >= SENSOR_FAULT_RECOVER_SAMPLES) {
      state->active = false;
      state->lastTransitionMs = nowMs;
    }
  }
  return state->active;
}

static void clearFaultDebounce(FaultDebounceState* state) {
  if (!state) return;
  state->active = false;
  state->failureCount = 0;
  state->recoveryCount = 0;
  state->lastTransitionMs = 0;
}

static void forceFaultDebounce(FaultDebounceState* state, uint32_t nowMs) {
  if (!state) return;
  state->active = true;
  state->failureCount = SENSOR_FAULT_CONFIRM_SAMPLES;
  state->recoveryCount = 0;
  state->lastTransitionMs = nowMs;
}

static bool parseUint32(const char* text, uint32_t minimum, uint32_t maximum,
                        uint32_t* result) {
  if (!text || !*text || !result) return false;
  char* end = nullptr;
  unsigned long value = strtoul(text, &end, 10);
  if (end == text || *end != '\0') return false;
  if (value < minimum || value > maximum) return false;
  *result = static_cast<uint32_t>(value);
  return true;
}

static uint8_t splitFields(char* text, char delimiter, char** fields, uint8_t maximumFields) {
  if (!text || !fields || maximumFields == 0) return 0;
  uint8_t count = 1;
  fields[0] = text;
  while (*text != '\0') {
    if (*text == delimiter) {
      *text = '\0';
      if (count >= maximumFields) return static_cast<uint8_t>(maximumFields + 1);
      fields[count++] = text + 1;
    }
    ++text;
  }
  return count;
}

static bool asciiCaseEqual(const char* left, const char* right) {
  while (*left && *right) {
    char a = *left++;
    char b = *right++;
    if (a >= 'a' && a <= 'z') a = static_cast<char>(a - ('a' - 'A'));
    if (b >= 'a' && b <= 'z') b = static_cast<char>(b - ('a' - 'A'));
    if (a != b) return false;
  }
  return *left == '\0' && *right == '\0';
}

static void trimLine(char* text) {
  if (!text) return;
  size_t length = strlen(text);
  while (length > 0) {
    char value = text[length - 1];
    if (value == '\r' || value == '\n' || value == ' ' || value == '\t') {
      text[--length] = '\0';
    } else {
      break;
    }
  }
  size_t start = 0;
  while (text[start] == ' ' || text[start] == '\t') ++start;
  if (start > 0) memmove(text, text + start, length - start + 1);
}

static bool configurationSelfCheck() {
  if (MQ_LOAD_OHMS == 0 || MQ_AIN0_SCALE <= 0.0F) {
    return false;
  }
  if (PCF8574_ADDRESS == LCD_ADDRESS || PCF8574_ADDRESS == BME280_I2C_ADDRESS ||
      PCF8574_ADDRESS == DS3231_ADDRESS || PCF8574_ADDRESS == ADS1115_ADDRESS) {
    return false;
  }
  if (PCF_OUTPUT_PORT_MASK != 0xFF ||
      (PCF_REED_LATCH_BIT & (1U << PCF_PIN_REED)) == 0 ||
      (PCF_REED_LATCH_BIT & PCF_CONTROL_PIN_MASK) != 0) {
    return false;
  }
  return PIN_I2C_SDA != PIN_I2C_SCL;
}

static const char* freshnessStatusText(FreshnessStatus status) {
  switch (status) {
    case FreshnessStatus::Fresh: return "Fresh/Normal";
    case FreshnessStatus::UseSoon: return "Use Soon";
    case FreshnessStatus::CheckFood: return "Check Food";
    case FreshnessStatus::SensorFault: return "Sensor Fault/Data Unavailable";
  }
  return "Sensor Fault/Data Unavailable";
}

static FreshnessStatus worstStatus(FreshnessStatus left, FreshnessStatus right) {
  return static_cast<uint8_t>(left) >= static_cast<uint8_t>(right) ? left : right;
}

// ============================================================================
// I2C probing and direct PCF8574 register access
// ============================================================================

static bool i2cDevicePresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission(true) == 0;
}

static bool i2cReadRegister8(uint8_t address, uint8_t reg, uint8_t* value) {
  if (!value) return false;
  Wire.beginTransmission(address);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;  // repeated START, no STOP
  // The 3-argument form. The 2-argument requestFrom(address, size) does NOT
  // send a STOP condition, which leaves the bus mid-transaction and can corrupt
  // the following operation - on the PCF8574 that showed up as the device
  // echoing the register pointer back instead of its contents.
  uint8_t received = Wire.requestFrom(address, static_cast<uint8_t>(1), static_cast<uint8_t>(1));
  if (received != 1) return false;
  *value = Wire.read();
  return true;
}

// I2C STOP-to-START recovery time, microseconds.
//
// The PCF8574 datasheet requires tSU;STO >= 4.0 us (typ 4.7 us) between the
// STOP that ends a write and the next START. Without it, a write immediately
// followed by a readback can return a stale byte, and the caller concludes the
// chip is faulty. 20 us is the value used here: comfortably over the limit at
// 100 kHz, and irrelevant against a 5 s sensor cadence. A shared helper, so it
// also protects the ADS1115 and BME280 write-then-read paths.
static constexpr uint8_t I2C_WRITE_RECOVERY_US = 20;

static bool i2cWriteRegister8(uint8_t address, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  Wire.write(value);
  bool ok = Wire.endTransmission(true) == 0;
  if (ok) delayMicroseconds(I2C_WRITE_RECOVERY_US);
  return ok;
}

// A floating or shorted bus has to be told apart from a misbehaving device,
// because a phantom ACK looks exactly like a device that answers at an address.
// With no pull-up, SDA idles LOW, the master's address register latches whatever
// byte was last on the wire, and reads return that stale byte - which is why a
// dead bus produces a "device" whose every register reads back its own index.
// Sampling the idle level separates these cases before any scan is trusted.
static bool i2cIdleLineHigh(uint8_t pin) {
  pinMode(pin, INPUT);
  delayMicroseconds(50);
  return digitalRead(pin) == HIGH;
}

static void i2cBusRecover() {
  // SDA and SCL are open-drain: this code may only ever PULL A LINE LOW, and
  // releasing it is done by handing it back to the pull-up. Driving either line
  // HIGH as a push-pull output fights the pull-up and any slave that is holding
  // the line, which is what jammed the bus and made every scan come back empty.
  // The latch is also set BEFORE switching to OUTPUT, because pinMode(OUTPUT)
  // alone leaves the previous latch value on the pin for a few cycles.
  pinMode(PIN_I2C_SDA, INPUT);
  pinMode(PIN_I2C_SCL, INPUT);
  delayMicroseconds(50);
  for (uint8_t i = 0; i < 9; ++i) {
    digitalWrite(PIN_I2C_SCL, LOW);
    pinMode(PIN_I2C_SCL, OUTPUT);
    delayMicroseconds(5);
    pinMode(PIN_I2C_SCL, INPUT);
    delayMicroseconds(5);
  }
  // STOP condition: hold SDA low, let SCL sit high on its pull-up, then release
  // SDA so the rising edge is seen as a STOP.
  digitalWrite(PIN_I2C_SDA, LOW);
  pinMode(PIN_I2C_SDA, OUTPUT);
  delayMicroseconds(5);
  pinMode(PIN_I2C_SDA, INPUT);
  delayMicroseconds(50);
}

static void logI2cBusHealth() {
  const bool sdaHigh = i2cIdleLineHigh(PIN_I2C_SDA);
  const bool sclHigh = i2cIdleLineHigh(PIN_I2C_SCL);
  Serial.printf("[I2C] Idle level: SDA=%s SCL=%s\n",
                sdaHigh ? "HIGH" : "LOW", sclHigh ? "HIGH" : "LOW");
  if (!sdaHigh || !sclHigh) {
    Serial.println(F("  A healthy idle bus sits HIGH on both lines. LOW means either"
                     " the pull-up"));
    Serial.println(F("  resistors are missing/failed, or the line is shorted to GND."
                     " Add 4.7k"));
    Serial.println(F("  from SDA to 3V3 and 4.7k from SCL to 3V3, nearest the ESP."
                     " Until this"));
    Serial.println(F("  reads HIGH, every address below is untrustworthy - a floating"
                     " bus fakes ACKs."));
  }
  i2cBusRecover();
  const bool sdaFree = i2cIdleLineHigh(PIN_I2C_SDA);
  const bool sclFree = i2cIdleLineHigh(PIN_I2C_SCL);
  if (sdaFree && sclFree) {
    Serial.println(F("[I2C] Bus released after 9-clock recovery"));
  } else {
    Serial.println(F("[I2C] Bus still held after recovery: a slave is driving a line"
                     " low. Disconnect"));
    Serial.println(F("  devices one at a time to find it."));
  }
  // Driving the pins by hand desynchronises the I2C peripheral from the state
  // Wire.begin() left it in, and a scan run against that stale state reports
  // nothing at all. Re-initialise before the peripheral is used again.
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(100000);
}

// A one-shot scan cannot tell "wrong address" from "not connected", because a
// device that is not answering is invisible either way. Watching the bus while
// hardware is plugged and unplugged settles it: an address that appears and
// disappears with the part is a real device at a discoverable address, and a
// part whose address never changes is not reaching the bus at all.
static const char* i2cAddressLabel(uint8_t address) {
  switch (address) {
    case BME280_I2C_ADDRESS: return "expected BME280";
    case DS3231_ADDRESS:     return "expected DS3231";
    case ADS1115_ADDRESS:    return "expected ADS1115";
    case PCF8574_ADDRESS:    return "expected separate expander";
    case LCD_ADDRESS:        return "expected LCD backpack";
    case 0x77:               return "BME280 with SDO tied high";
    case 0x3F:               return "common alternative LCD address";
    case 0x50: case 0x51: case 0x52: case 0x53:
    case 0x54: case 0x55: case 0x56: case 0x57: return "24Cxx EEPROM address range";
    default: return "";
  }
}

static void liveI2cScan() {
  static bool present[128];
  memset(present, 0, sizeof(present));
  Serial.println(F("[SCAN] Sweeping 0x01-0x7E once per second."));
  Serial.println(F("[SCAN] Plug or unplug a module now and watch for a change."));
  Serial.println(F("[SCAN] Send any character to stop. The sensor loop is paused"
                   " during this."));
  uint32_t lastReportMs = millis();
  for (;;) {
    uint8_t count = 0;
    bool changed = false;
    for (uint8_t address = 1; address < 127; ++address) {
      const bool now = i2cDevicePresent(address);
      if (now) ++count;
      if (now != present[address]) {
        present[address] = now;
        changed = true;
        Serial.printf("[SCAN] %s 0x%02X  %s\n", now ? "APPEARED  " : "DISAPPEARED",
                      static_cast<unsigned>(address), i2cAddressLabel(address));
      }
    }
    if (changed || millis() - lastReportMs >= 5000) {
      Serial.printf("[SCAN] %u device(s) responding now\n",
                    static_cast<unsigned>(count));
      lastReportMs = millis();
    }
    while (Serial.available() > 0) {
      Serial.read();
      Serial.println(F("[SCAN] Stopped."));
      return;
    }
    delay(500);
  }
}

// Raw channel readout, deliberately bypassing the plausibility gate.
//
// A baseline failure only says "the number did not look right". It cannot say
// what the number was, and the fix differs completely between a dead channel
// reading 0 mV and a working sensor reading a stable value the window was too
// short to accept. This reports the raw conversion so the two are separable.
static void reportMqRawReading() {
  if (!adsReady) {
    Serial.println(F("[MQRAW] ADS1115 not initialised"));
    return;
  }
  const int16_t code = ads1115.readADC_SingleEnded(0);
  const double millivolts =
      (static_cast<double>(code) * MQ_ADS_FULL_SCALE_MV) / 32767.0;
  Serial.printf("[MQRAW] AIN0 code=%d  %.1f mV  (full scale +/-%.0f mV)\n",
                static_cast<int>(code), millivolts, MQ_ADS_FULL_SCALE_MV);
  Serial.println(F("        0 mV means nothing is reaching A0. A value near full"
                   " scale means the divider"));
  Serial.println(F("        is wrong or the input is floating. A small stable value"
                   " means the load resistor"));
  Serial.println(F("        is present and the baseline window was simply too short."));
  Serial.println(F("        Take several readings: a value still moving is the sensor"
                   " warming up."));
}

/**
 * RFIDTEST: a read-only look at the reader's wiring and SPI path.
 *
 * DELIBERATELY SEPARATE FROM THE OPERATIONAL SCAN PATH
 * This is a diagnostic an engineer types while the reader is not yet trusted. It
 * pulses reset, reads registers and prints. It does not call serviceRc522(), does
 * not read a card serial, queues no event, sets no fault bit, changes no
 * freshness status and asks for no publish. Nothing in it reaches
 * publishRfidScanEvent(), so a diagnostic can never manufacture an
 * rfid_scanned event that no tag actually caused - which matters, because these
 * two paths were once easy to confuse and the difference is between "the reader
 * is wired correctly" and "this tag was presented".
 *
 * It also drives P5, which is why it is a command and not part of the poll loop.
 */
static void reportRc522Diagnosis() {
  if (!pcfInitialized) {
    Serial.println(F("[RFID] PCF8574 unavailable, so P5 cannot drive RST"));
    return;
  }
  uint8_t pins = 0;
  if (!pcfReadPort(&pins)) {
    Serial.println(F("[RFID] Could not read the expander pins"));
    return;
  }
  const bool rstHigh = (pins & (1U << PCF_PIN_RC522_RST)) != 0;
  Serial.printf("[RFID] P5 (RST) currently %s\n", rstHigh ? "HIGH" : "LOW");
  if (!rstHigh) {
    Serial.println(F("        RST is held LOW, so the reader is stuck in reset and"
                     " will never"));
    Serial.println(F("        report a version. Check the P5 wiring."));
    return;
  }
  if (!pulseRc522Reset()) {
    Serial.println(F("[RFID] Reset pulse reported failure"));
    return;
  }
  Serial.println(F("[RFID] Reset pulse sent; reading registers to confirm the SPI"
                   " path"));
  rc522.PCD_Init();
  // One odd value could be an odd part. Several registers all returning their
  // documented contents means the bus is shifting bits correctly, and a
  // misaligned or shorted SPI line would corrupt every one of them.
  struct Probe {
    MFRC522::PCD_Register reg;
    const char* name;
    const char* expected;
  };
  static const Probe probes[] = {
      {MFRC522::VersionReg,   "VersionReg",   "0x90/0x91/0x92 (0x88 on a clone)"},
      {MFRC522::CommandReg,   "CommandReg",   "0x00 when idle"},
      {MFRC522::ComIEnReg,    "ComIEnReg",    "0x7B after PCD_Init"},
      {MFRC522::DivIrqReg,    "DivIrqReg",    "0x00 when idle"},
      {MFRC522::FIFOLevelReg, "FIFOLevelReg", "0x00 with an empty FIFO"},
      {MFRC522::TxASKReg,     "TxASKReg",     "0x40 after PCD_Init"},
  };
  uint8_t sane = 0;
  for (const Probe& probe : probes) {
    const uint8_t value = rc522.PCD_ReadRegister(probe.reg);
    Serial.printf("[RFID]   %-14s 0x%02X   expect %s\n", probe.name,
                  static_cast<unsigned>(value), probe.expected);
    if (value != 0x00 && value != 0xFF) ++sane;
  }
  Serial.printf("[RFID] %u of %u registers returned real data\n",
                static_cast<unsigned>(sane),
                static_cast<unsigned>(sizeof(probes) / sizeof(probes[0])));
  if (sane == 0) {
    Serial.println(F("        Every register reads 0x00 or 0xFF: the bus is not"
                     " reaching the chip."));
  } else if (sane < 4) {
    Serial.println(F("        Some registers are blank, so the SPI path is"
                     " marginal. Check solder joints on the module headers"));
    Serial.println(F("        and keep the wires short."));
  } else {
    Serial.println(F("        The SPI path is sound. Hold a card to the antenna and"
                     " it should be detected."));
  }
}

static void logI2CBus() {
  Serial.println(F("[I2C] Scan at 100 kHz:"));
  uint8_t found = 0;
  for (uint8_t address = 1; address < 127; ++address) {
    if (i2cDevicePresent(address)) {
      Serial.printf("  0x%02X%s\n", static_cast<unsigned>(address),
                    address == BME280_I2C_ADDRESS ? " (expected BME280)" :
                    address == DS3231_ADDRESS ? " (expected DS3231)" :
                    address == ADS1115_ADDRESS ? " (expected ADS1115)" :
                    address == PCF8574_ADDRESS ? " (expected PCF8574)" :
                    address == LCD_ADDRESS ? " (expected LCD)" : "");
      ++found;
    }
  }
      if (found == 0) Serial.println(F("  no responding devices"));
      // A PCF8574's slave address is the three strapped pins A2/A1/A0, and the
      // register select travels in the first data byte AFTER the address - it is
      // not part of the address. So exactly one address in 0x20-0x27 responds,
      // and that is correct. (An MCP23017 behaves the opposite way: its register
      // pointer shares the low three address bits, so 0x20-0x27 all alias to one
      // device. If this board ever aliases, it is not a PCF8574.)
      if (i2cDevicePresent(PCF8574_ADDRESS) && !i2cDevicePresent(PCF8574_ADDRESS + 1)) {
        Serial.println(F("  note: one address only, which is correct for a PCF8574"));
      }
      // An address outside the five modules this build expects is worth naming,
      // but only for what it is: an address that answered. Saying it moved
      // between scans would require history this scan does not keep, and an
      // invented instability claim is worse than no claim at all.
      for (uint8_t address = 1; address < 127; ++address) {
        const bool expectedModule =
            address == BME280_I2C_ADDRESS || address == DS3231_ADDRESS ||
            address == ADS1115_ADDRESS || address == PCF8574_ADDRESS ||
            address == LCD_ADDRESS;
        const bool eepromRange = address >= 0x50 && address <= 0x57;
        if (!expectedModule && !eepromRange && i2cDevicePresent(address)) {
          Serial.printf("  NOTE: 0x%02X answered but is not a module this build"
                        " expects, and is not an\n        EEPROM address. It may be a"
                        " phantom from a marginal bus or a stray device.\n",
                        static_cast<unsigned>(address));
        }
      }
    }

// ---------------------------------------------------------------------------
// PCF8574 port access - one byte in, one byte out, no register pointer.
// ---------------------------------------------------------------------------

// Write the single data byte straight to the 8 pins.
static bool pcfWritePort(uint8_t value) {
  const uint32_t nowMs = millis();
  Wire.beginTransmission(PCF8574_ADDRESS);
  Wire.write(value);
  const bool ok = Wire.endTransmission(true) == 0;
  if (ok) delayMicroseconds(I2C_WRITE_RECOVERY_US);
  faults.pcf8574Write = updateFaultDebounce(&pcfWriteDebounce, !ok, nowMs);
  return ok;
}

// Read the live level of the 8 pins. No command byte is sent, so the part
// returns its input port directly. The stop flag matters: without an explicit
// STOP the ESP8266 core leaves the bus held, and the next transfer fails.
static bool pcfReadPort(uint8_t* value) {
  if (value == nullptr) return false;
  const uint32_t nowMs = millis();
  const uint8_t received =
      Wire.requestFrom(PCF8574_ADDRESS, static_cast<uint8_t>(1),
                       static_cast<uint8_t>(1));
  const bool ok = received == 1;
  if (ok) {
    *value = Wire.read();
    pcfReadReady = true;
    markSensorReady(SENSOR_FAULT_PCF8574_READ | SENSOR_FAULT_PCF8574_WRITE);
  }
  faults.pcf8574Read = updateFaultDebounce(&pcfReadDebounce, !ok, nowMs);
  return ok;
}

// Defined with the serial command interface, below, but needed here: a failed
// write dumps the device automatically rather than waiting for someone to type
// a command at the right moment.
static void dumpI2cRegisters(uint8_t address);

static void dumpAllI2cDevices();

static bool pcfWriteOutput(uint8_t value) {
  if (!pcfWritePort(value)) return false;

  // The port read returns the actual pin levels, so every controlled output
  // transition is verified after the bus write. A mismatch is a real bus or
  // load fault, not a cached-shadow success. The reed pin is excluded because
  // an external switch legitimately drives it to the opposite level of the
  // latch. Keep the old shadow until the readback succeeds so a later caller
  // retries the failed transition.
  uint8_t pins = 0;
  if (!pcfReadPort(&pins)) {
    faults.pcf8574Read = true;
    forceFaultDebounce(&pcfReadDebounce, millis());
    faults.pcf8574Write = true;
    forceFaultDebounce(&pcfWriteDebounce, millis());
    return false;
  }
  const uint8_t mask = PCF_CONTROL_PIN_MASK;
  if ((pins & mask) != (value & mask)) {
    faults.pcf8574Write = true;
    forceFaultDebounce(&pcfWriteDebounce, millis());
    Serial.printf("[PCF8574] Port readback mismatch: pins 0x%02X, wanted 0x%02X"
                  " (masked 0x%02X)\n",
                  static_cast<unsigned>(pins), static_cast<unsigned>(value),
                  static_cast<unsigned>(mask));
    return false;
  }
  pcfOutputShadow = value;
  return true;
}

static bool pcfSetRawBit(uint8_t pin, bool high) {
  if (pin > 7) return false;
  uint8_t mask = static_cast<uint8_t>(1U << pin);
  uint8_t desired = high ? static_cast<uint8_t>(pcfOutputShadow | mask)
                         : static_cast<uint8_t>(pcfOutputShadow & static_cast<uint8_t>(~mask));
  if (desired == pcfOutputShadow) return true;
  return pcfWriteOutput(desired);
}

static bool pcfSetOutputActive(uint8_t pin, bool active) {
  bool high = PCF_PIN_ACTIVE_HIGH(pin) ? active : !active;
  return pcfSetRawBit(pin, high);
}

static bool initializePcf8574() {
  pcfInitialized = false;
  // P0 must sit at 1 in the latch. On this chip a written 1 is a weak source,
  // so the reed switch can pull the pin to ground and the read will return 0
  // when the magnet is present. P0 is excluded from the latch-vs-pin
  // verification below for exactly that reason.
  const uint8_t initPattern =
      static_cast<uint8_t>(PCF_OUTPUTS_INACTIVE | (1U << PCF_PIN_REED));
  pcfOutputShadow = initPattern;

  if (!pcfWritePort(initPattern)) {
    Serial.println(F("[PCF8574] Port write failed at 0x20"));
    faults.pcf8574Write = true;
    forceFaultDebounce(&pcfWriteDebounce, millis());
    return false;
  }

  // Read the pin levels back. There is no configuration register to compare, so
  // this confirms the part is decoding and driving rather than a bus artefact.
  // Three attempts, because one corrupted frame in a fridge full of compressor
  // noise should not permanently disable door detection, the LEDs, the buzzer
  // and the RFID reader.
  uint8_t pins = 0;
  for (uint8_t attempt = 1; attempt <= 3; ++attempt) {
    if (!pcfReadPort(&pins)) {
      Serial.printf("[PCF8574] Port readback attempt %u: bus error\n",
                    static_cast<unsigned>(attempt));
    } else {
      break;
    }
    delay(10);
  }
  const uint8_t mask = PCF_CONTROL_PIN_MASK;
  if ((pins & mask) != (initPattern & mask)) {
    faults.pcf8574Read = true;
    forceFaultDebounce(&pcfReadDebounce, millis());
    Serial.printf("[PCF8574] Pins 0x%02X, expected 0x%02X on the controlled bits"
                  " after 3 attempts.\n"
                  "  The write was acknowledged, so the part is present. A driven"
                  " output that reads\n"
                  "  back differently points at a load fault: a missing gate"
                  " pull-down, an LED wired\n"
                  "  the wrong way round, or a pin already shorted.\n",
                  static_cast<unsigned>(pins), static_cast<unsigned>(initPattern));
    dumpAllI2cDevices();
    return false;
  }

  pcfOutputShadow = initPattern;
  pcfInitialized = true;
  Serial.printf("[PCF8574] OK at 0x20: P0 weak-high for the reed, P1-P5 driven,"
                " idle pattern 0x%02X, pins 0x%02X\n",
                static_cast<unsigned>(initPattern), static_cast<unsigned>(pins));
  return true;
}

// ============================================================================
// LCD helpers
// ============================================================================

static void lcdPrintRow(uint8_t row, const char* text) {
  if (!lcdReady || row >= LCD_ROWS) return;
  char line[LCD_COLUMNS + 1];
  copyBounded(line, sizeof(line), text ? text : "");
  lcd.setCursor(0, row);
  lcd.print(line);
  for (uint8_t column = strlen(line); column < LCD_COLUMNS; ++column) lcd.write(' ');
}

static void lcdPrintfRow(uint8_t row, const char* format, ...) {
  char line[LCD_COLUMNS + 1];
  va_list arguments;
  va_start(arguments, format);
  vsnprintf(line, sizeof(line), format, arguments);
  va_end(arguments);
  lcdPrintRow(row, line);
}

static void initializeLcd() {
  faults.lcd = !i2cDevicePresent(LCD_ADDRESS);
  if (faults.lcd) {
    lcdReady = false;
    Serial.printf("[LCD] No ACK at configured address 0x%02X\n",
                  static_cast<unsigned>(LCD_ADDRESS));
    return;
  }
  lcd.begin(LCD_COLUMNS, LCD_ROWS);
  lcdReady = true;
  if (lcdBacklightOn) lcd.backlight(); else lcd.noBacklight();
  lcdPrintRow(0, "FreshGuard ESP8266");
  lcdPrintRow(1, "Starting...");
  Serial.printf("[LCD] OK at 0x%02X (assume BSS138 verified)\n",
                static_cast<unsigned>(LCD_ADDRESS));
}

// ============================================================================
// Environmental sensors
// ============================================================================

static void initializeEnvironmentalSensors() {
  bmeDataReady = false;
  humidityReady = false;

  bmeReady = bme280.begin(BME280_I2C_ADDRESS);
  Serial.println(bmeReady ? F("[BME280] OK") : F("[BME280] No ACK; awaiting confirmed data"));

  // Humidity oversampling MUST be requested explicitly.
  //
  // Adafruit_BME280's default constructor is empty, so its ctrl_hum register
  // object is zero-initialised, and osrs_h = 0 means SAMPLING_NONE.
  // readHumidity() returns NAN in that case, silently. Without this call the
  // device would report humidity unavailable forever and latch a permanent
  // fault, which is the same class of bug as a wrong chip id.
  if (bmeReady) {
    bme280.setSampling(Adafruit_BME280::MODE_NORMAL,
                       Adafruit_BME280::SAMPLING_X16,   // temperature
                       Adafruit_BME280::SAMPLING_X16,   // pressure
                       Adafruit_BME280::SAMPLING_X16,   // humidity - the one that matters
                       Adafruit_BME280::FILTER_OFF,
                       Adafruit_BME280::STANDBY_MS_0_5);
  }

  lastAdsInitAttemptMs = millis();
  adsReady = ads1115.begin(ADS1115_ADDRESS, &Wire);
  if (adsReady) {
    ads1115.setGain(MQ_ADS_GAIN);
    ads1115.setDataRate(MQ_ADS_DATA_RATE);
    markSensorReady(SENSOR_FAULT_ADS1115);
    Serial.printf("[ADS1115] OK range=GAIN_ONE full-scale=+/-%.3f V rate=%u SPS\n",
                  static_cast<double>(MQ_ADS_FULL_SCALE_VOLTS),
                  static_cast<unsigned>(MQ_ADS_DATA_RATE_SPS));
  } else {
    Serial.println(F("[ADS1115] No ACK; will retry without raising a boot fault"));
  }
  mqState = MqState::WarmingUp;
  // Not a confirmed fault: shown as Data Unavailable until Ready, excluded
  // from the remote sensor-fault transition alert.
  faults.mq135 = false;
}

static void readBme280() {
  float newTemperature = NAN;
  float newPressure = NAN;
  bool valid = false;
  if (bmeReady) {
    newTemperature = bme280.readTemperature();
    newPressure = bme280.readPressure() / 100.0F;
    valid = !isnan(newTemperature) && !isinf(newTemperature) &&
            !isnan(newPressure) && !isinf(newPressure) &&
            newTemperature >= -40.0F && newTemperature <= 85.0F &&
            newPressure >= 300.0F && newPressure <= 1100.0F;
  }
  faults.bme280 = updateFaultDebounce(&bme280Debounce, !valid, millis());
  if (!valid) return;
  temperatureC = smoothValue(temperatureC, newTemperature, 0.20F);
  pressureHpa = smoothValue(pressureHpa, newPressure, 0.20F);
  bmeDataReady = true;
  markSensorReady(SENSOR_FAULT_BME280);
}

static void readBme280Humidity() {
  // Humidity now comes from the BME280, the same chip that supplies
  // temperature and pressure. readHumidity() returns NAN if humidity
  // oversampling was never requested, which initializeEnvironmentalSensors()
  // guarantees, so a NAN here means a genuine read failure and is debounced as
  // one rather than silently reported as 0 %RH.
  float newHumidity = bme280.readHumidity();
  bool valid = !isnan(newHumidity) && !isinf(newHumidity) &&
               newHumidity >= 0.0F && newHumidity <= 100.0F;
  faults.bme280Humidity = updateFaultDebounce(&bme280HumidityDebounce, !valid, millis());
  if (!valid) return;
  humidityPct = smoothValue(humidityPct, newHumidity, 0.20F);
  humidityReady = true;
  markSensorReady(SENSOR_FAULT_BME280_HUMIDITY);
}

static bool loadMqBaselineFromStorage();
static bool saveMqBaselineToStorage();

static const char* mqStateText(MqState state) {
  switch (state) {
    case MqState::WarmingUp: return "warming";
    case MqState::CapturingBaseline: return "capturing baseline";
    case MqState::Ready: return "ready";
    case MqState::Faulted: return "fault";
  }
  return "unknown";
}

static MqReadResult readMqAdsInput(float* millivolts, int16_t* code) {
  if (!adsReady || !millivolts || !code) return MqReadResult::AdcUnavailable;
  int16_t newCode = ads1115.readADC_SingleEnded(0);
  if (newCode == -32768 || newCode == 32767) return MqReadResult::AdcUnavailable;
  // Adafruit_ADS1115::computeVolts returns VOLTS, not millivolts. Comparing its
  // result directly against the millivolt bounds below put a healthy 252 mV
  // reading in as 0.252, which is below MQ_AIN0_MIN_PLAUSIBLE_MV (10), so every
  // single sample was classified Implausible. The MQ-135 reported a fault from
  // the moment it was first read, for as long as it was connected, and no
  // amount of warming or settling could ever satisfy the gate.
  //
  // It stayed hidden because the MQRAW command did its own conversion from the
  // raw code and reported 252 mV correctly - the diagnostic and the code path it
  // was diagnosing disagreed, and that disagreement is what exposed the bug.
  const float newMillivolts = ads1115.computeVolts(newCode) * 1000.0F;
  if (isnan(newMillivolts) || isinf(newMillivolts) ||
      newMillivolts < MQ_AIN0_MIN_PLAUSIBLE_MV ||
      newMillivolts > MQ_AIN0_HARD_LIMIT_MV) {
    return MqReadResult::Implausible;
  }
  *code = newCode;
  *millivolts = newMillivolts;
  return MqReadResult::Ok;
}

static void resetMqBaselineCapture() {
  mqBaselineReady = false;
  mqBaselineSum = 0.0F;
  mqBaselineCount = 0;
  mqInputMv = NAN;
  mqDeltaMv = NAN;
  mqAdcCode = 0;
  // The settling state must be cleared with everything else. Leaving it set
  // across a fault-and-recover cycle made the next pass compare against a
  // previousMv from before the fault, so the drift figure was meaningless and
  // the capture could wait indefinitely for a tolerance that was never real.
  mqSettling = false;
  mqSettlePasses = 0;
  mqSettlingPreviousMv = 0.0F;
}

static bool initializeAds1115() {
  adsReady = ads1115.begin(ADS1115_ADDRESS, &Wire);
  if (adsReady) {
    ads1115.setGain(MQ_ADS_GAIN);
    ads1115.setDataRate(MQ_ADS_DATA_RATE);
  }
  return adsReady;
}

static void serviceMq135(uint32_t nowMs) {
  if (mqState == MqState::WarmingUp) {
    if (static_cast<uint32_t>(nowMs - bootMs) < MQ_WARMUP_MS) return;
    mqState = mqBaselineReady ? MqState::Ready : MqState::CapturingBaseline;
  }

  if (!adsReady && static_cast<uint32_t>(nowMs - lastAdsInitAttemptMs) >= SENSOR_POLL_INTERVAL_MS) {
    lastAdsInitAttemptMs = nowMs;
    initializeAds1115();
  }

  uint32_t interval = (mqState == MqState::CapturingBaseline)
                          ? MQ_BASELINE_SAMPLE_INTERVAL_MS
                          : SENSOR_POLL_INTERVAL_MS;
  if (static_cast<uint32_t>(nowMs - lastMqReadMs) < interval) return;
  lastMqReadMs = nowMs;

  const uint8_t samplesThisPass = (mqState == MqState::CapturingBaseline)
                                      ? 1 : MQ_NORMAL_SAMPLE_COUNT;
  float sumMv = 0.0F;
  int32_t sumCode = 0;
  MqReadResult passResult = MqReadResult::Ok;
  for (uint8_t sample = 0; sample < samplesThisPass; ++sample) {
    float sampleMv = 0.0F;
    int16_t sampleCode = 0;
    MqReadResult result = readMqAdsInput(&sampleMv, &sampleCode);
    if (result != MqReadResult::Ok) {
      passResult = result;
      break;
    }
    sumMv += sampleMv;
    sumCode += sampleCode;
  }

  // Characterising the sensor is not the same as trusting it. During warm-up
  // and baseline capture the output is expected to be noisy: a cold MQ-135 reads
  // near 0 V, swings widely as the element heats, and can produce an occasional
  // outlier even once it is close to equilibrium.
  //
  // Treating one of those samples as a sensor fault was a livelock. The fault
  // handler resets the baseline capture, capture restarts, the next sample is
  // equally likely to be an outlier, and the baseline can therefore NEVER
  // complete on a noisy-but-healthy sensor. The console showed
  // "state=capturing baseline" alongside "Confirmed read/plausibility fault",
  // which is the signature of that loop.
  //
  // So during these two phases an implausible sample is discarded and the pass
  // retried on the next tick. The reading is not counted, no fault is raised,
  // and the capture is allowed to finish. A sensor that is genuinely dead keeps
  // returning bad samples and is caught the moment it has been proven once and
  // then regresses - which is the case that actually matters.
  const bool sensorIsBeingCharacterised =
      mqState == MqState::WarmingUp || mqState == MqState::CapturingBaseline;

  // One scheduled sample pass produces one failure/recovery observation for
  // each fault, so a single bad I2C transaction cannot raise a remote alert.
  // The ADS1115 itself is checked throughout: a converter that stops answering
  // is a real fault even during warm-up, and the MQ-135 is unpowered on the same
  // rail, so its absence is still meaningful.
  faults.ads1115 = updateFaultDebounce(&ads1115Debounce,
                                       passResult == MqReadResult::AdcUnavailable, nowMs);
  faults.mq135 = updateFaultDebounce(
      &mq135Debounce,
      !sensorIsBeingCharacterised && passResult == MqReadResult::Implausible, nowMs);

  // Discard the outlier and try again next tick instead of faulting and
  // restarting the whole capture. Without this, one noisy sample among hundreds
  // was enough to reset progress indefinitely.
  if (sensorIsBeingCharacterised && passResult == MqReadResult::Implausible) {
    static uint16_t discardedSamples = 0;
    if (++discardedSamples == 1 || discardedSamples % 60 == 0) {
      Serial.printf("[MQ135] Discarded %u out-of-range sample(s) while %s;"
                    " the sensor is being characterised, not faulted\n",
                    static_cast<unsigned>(discardedSamples), mqStateText(mqState));
    }
    return;
  }

  if (faults.ads1115 || faults.mq135) {
    if (mqState != MqState::Faulted) {
      Serial.printf("[MQ135] Confirmed read/plausibility fault; state=%s result=%u\n",
                    mqStateText(mqState), static_cast<unsigned>(passResult));
    }
    resetMqBaselineCapture();
    mqState = MqState::Faulted;
    return;
  }

  if (mqState == MqState::Faulted) {
    // Confirmed recovery now requires a new baseline before data is trusted.
    resetMqBaselineCapture();
    mqState = MqState::CapturingBaseline;
    return;
  }

  float averageMv = sumMv / static_cast<float>(samplesThisPass);
  int16_t averageCode = static_cast<int16_t>(sumCode / static_cast<int32_t>(samplesThisPass));
  if (mqState == MqState::CapturingBaseline) {
    // Averaging a still-climbing sensor produces a baseline that is wrong from
    // the moment it is stored: every later delta is measured against a number
    // the sensor had not actually reached. Measured drift on this build was
    // about 7 mV per pass during warm-up, so the capture waits for consecutive
    // passes to agree within MQ_BASELINE_MAX_DRIFT_MV before accepting anything.
    // The guard must test mqSettling, NOT mqBaselineCount. mqBaselineCount only
    // advances during the averaging phase, so it stays 0 for the whole settling
    // phase. Testing it here meant this branch fired on every pass, reset
    // mqSettlePasses to 1 and returned before the drift comparison below could
    // ever run. The settling check was unreachable, the pass counter was frozen
    // at 1, and the baseline could never complete on a healthy sensor.
    if (!mqSettling && mqBaselineCount == 0) {
      mqSettling = true;
      mqSettlePasses = 1;
      mqSettlingPreviousMv = averageMv;
      Serial.printf("[MQ135] Waiting for the reading to settle before averaging;"
                    " tolerance %.1f mV\n",
                    static_cast<double>(MQ_BASELINE_MAX_DRIFT_MV));
      return;
    }
    if (mqSettling) {
      const float drift = averageMv - mqSettlingPreviousMv;
      mqSettlingPreviousMv = averageMv;
      ++mqSettlePasses;
      if (mqSettlePasses % 10 == 0) {
        Serial.printf("[MQ135] Settling: %u passes, %.1f mV, drift %+.1f mV"
                      " (need |drift| < %.1f)\n",
                      static_cast<unsigned>(mqSettlePasses),
                      static_cast<double>(averageMv), static_cast<double>(drift),
                      static_cast<double>(MQ_BASELINE_MAX_DRIFT_MV));
      }
      if (drift < 0.0F ? -drift > MQ_BASELINE_MAX_DRIFT_MV
                        : drift > MQ_BASELINE_MAX_DRIFT_MV) {
        return;  // still moving; keep waiting
      }
      mqSettling = false;
      mqBaselineSum = 0.0F;
      mqBaselineCount = 0;
      Serial.printf("[MQ135] Settled at %.1f mV; averaging %u further passes\n",
                    static_cast<double>(averageMv),
                    static_cast<unsigned>(MQ_BASELINE_SAMPLE_COUNT));
    }
    mqBaselineSum += averageMv;
    ++mqBaselineCount;
    if (mqBaselineCount >= MQ_BASELINE_SAMPLE_COUNT) {
      mqBaselineMv = mqBaselineSum / static_cast<float>(mqBaselineCount);
      mqBaselineReady = true;
      markSensorReady(SENSOR_FAULT_MQ135);
      mqInputMv = mqBaselineMv;
      mqAdcCode = averageCode;
      mqDeltaMv = 0.0F;
      mqState = MqState::Ready;
      saveMqBaselineToStorage();
      Serial.printf("[MQ135] Relative baseline captured: AIN0 %.1f mV (ADS code %d)\n",
                    static_cast<double>(mqBaselineMv), static_cast<int>(averageCode));
      Serial.printf("[MQ135] Load resistor %lu ohm to GND, no divider; AIN0 scale"
                    " %.2f. Sensor is 3.3V powered, not the 5V datasheet case.\n",
                    static_cast<unsigned long>(MQ_LOAD_OHMS),
                    static_cast<double>(MQ_AIN0_SCALE));
      Serial.println(F("[MQ135] No ppm/calibration claim; tune delta using test evidence."));
    }
    return;
  }

  mqInputMv = smoothValue(mqInputMv, averageMv, 0.25F);
  mqAdcCode = averageCode;
  mqDeltaMv = mqInputMv > mqBaselineMv ? mqInputMv - mqBaselineMv : 0.0F;

  // Slow baseline tracking.
  //
  // The MQ-135 datasheet specifies 24-48 hours of preheat before the sensing
  // element is stable. MQ_WARMUP_MS above is only long enough to stop a cold
  // sensor raising a false alarm on the first samples; it is not long enough to
  // reach a settled resistance. Left alone, the remaining drift accumulates as
  // a rising delta over a shift and eventually reads as spoilage that is not
  // there. The datasheet's own temperature/humidity curves make this worse in a
  // hot, humid cabinet.
  //
  // The gate below is what makes this safe rather than a way to hide an alarm:
  // tracking only runs while the measured delta is already inside the *clear*
  // threshold, so it can never walk the baseline up into a real event. A genuine
  // gas event raises the delta far faster than this factor can absorb it, and
  // the moment the delta exceeds the clear threshold tracking stops for that
  // pass. 2% per pass is a ~4 minute time constant, fast enough to follow
  // multi-hour drift and far slower than any spoilage event.
  //
  // Deliberately RAM-only. Persisting a tracked baseline would mean thousands of
  // LittleFS writes per year for no benefit: the baseline is re-captured from
  // scratch on every cold boot anyway, and tracking converges within minutes.
  if (mqDeltaMv < limitGasClearMv()) {
    mqBaselineMv += (mqInputMv - mqBaselineMv) * MQ_BASELINE_TRACKING_FACTOR;
    mqDeltaMv = mqInputMv > mqBaselineMv ? mqInputMv - mqBaselineMv : 0.0F;
  }
}

// ============================================================================
// DS3231 RTC
// ============================================================================

// ============================================================================
// DS3231 RTC
// ============================================================================
//
// THE DEFECT THIS BLOCK EXISTS TO CATCH
//
// The DS3231 on this build reports 0x0F = 0x08: the oscillator is running and
// the backup cell is low. It answers the I2C bus correctly, returns a
// plausible calendar date, and never once set the oscillator-stopped flag. The
// old firmware read it every I2C_RTC_POLL_INTERVAL_MS, stored the value, and
// reported `time_valid: true` - without ever checking that the value had
// MOVED. Measured: about 7 minutes of clock time per 20 minutes of real time,
// and on one 18-second test, zero seconds. A frozen clock is the worst case
// because it is indistinguishable from a working one at every layer that only
// asks "did the read succeed?".
//
// So a successful read is no longer treated as proof of a running clock. Every
// successful read is measured against ELAPSED REAL TIME - see the design note
// on noteRtcEpochRead() - and two consecutive failures mark the clock untrusted
// immediately. The read path is deliberately NOT debounced for this: a dead
// clock is a known, cheap to detect condition and every extra minute of it is
// another minute of wrong shelf-life maths.
//
// What this test is and is not:
//   IS     - a stopped or wedged oscillator. The registers read back, the I2C
//            transaction succeeds, and the time fails to keep up with the
//            milliseconds that passed while the bus was talking. That is
//            detectable by comparison alone and is what fires here.
//   IS NOT - a clock that is running at the wrong RATE. The observed 7-in-20
//            minutes case is a ~0.35x oscillator and would sail past a liveness
//            test, because at a 60 s poll interval a 21 s advance against 60 s
//            of elapsed time is a 65% rate error, not a stall. Catching that is
//            a rate check, and it is deliberately NOT conflated with the two
//            conditions reported here: a device reporting a plausible-but-
//            drifting time is a different fault with a different fix, and
//            merging them would make the "is it running" answer stop meaning
//            what it says. (The ~5 h skew this firmware actually has is an
//            OFFSET, not a rate error, and is handled by the server sync.)
//
// STATUS REGISTER 0x0F, EXACTLY AS THE MAXIM/ANALOG DS3231 DATASHEET DEFINES IT.
//   bit 7  OSF      oscillator stop flag
//   bit 6  reserved, reads 0
//   bit 5  reserved, reads 0
//   bit 4  reserved, reads 0
//   bit 3  EN32kHz  32.768 kHz square-wave output enable
//   bit 2  BSY      temperature conversion in progress
//   bit 1  A2F      alarm 2 flag
//   bit 0  A1F      alarm 1 flag
//
// OSF IS BIT 7, SO 0x80. The previous firmware masked 0x20 - bit 5, a reserved
// bit that always reads 0. It was "unchanged from the previous firmware" in the
// sense that nobody had checked it. That is the worse half of being wrong: the
// fabricated battery bit could only produce a false warning, but the mis-placed
// OSF bit meant the one flag this firmware exists to act on was unreachable, so
// a genuinely stopped oscillator was invisible and only the independent
// elapsed-time liveness test could ever catch it. Now it can catch it directly.
//
// clearRtcOscillatorStoppedFlag() below does a read-modify-write of bit 7 only,
// so the other five writable bits are preserved across a manual RTCEPOCH.
static constexpr uint8_t DS3231_STATUS_OSF    = 0x80U;  // bit 7
static constexpr uint8_t DS3231_STATUS_EN32KHZ = 0x08U; // bit 3 - NOT a battery bit
static constexpr uint8_t DS3231_STATUS_BSY    = 0x04U;  // bit 2
static constexpr uint8_t DS3231_STATUS_A2F    = 0x02U;  // bit 1
static constexpr uint8_t DS3231_STATUS_A1F    = 0x01U;  // bit 0

// Only OSF reaches faults.ds3231. EN32kHz is a host-written configuration bit,
// BSY is a transient conversion flag, and A1F/A2F are alarm latches this
// firmware never arms and never clears. There is deliberately no aggregate mask
// constant: the previous revision had one concept too many here, and a spare
// "battery" constant is exactly how a fabricated bit got wired into a fault
// path in the first place. The DS3231 exposes no battery state at all, so there
// is nothing to aggregate. See the header note.

// Register addresses. Read-only in this file, all of them; see
// reportDs3231Registers() for why none of them is ever written.
//
// 0x07-0x0A is the ALARM 1 block and 0x0B-0x0D is the ALARM 2 block. The
// previous firmware read 0x07/0x08 as "temperature" and 0x0D as an
// "offset-seconds" register; both registers exist, and neither is what was
// claimed. There is no offset-seconds or offset-minutes register on this part.
static constexpr uint8_t DS3231_REG_STATUS          = 0x0FU;
static constexpr uint8_t DS3231_REG_ALARM2_DATE_DAY = 0x0DU; // Alarm 2, never written
static constexpr uint8_t DS3231_REG_AGING_OFFSET    = 0x10U; // the only offset reg
static constexpr uint8_t DS3231_REG_TEMPERATURE_MSB = 0x11U; // signed 8-bit whole C
static constexpr uint8_t DS3231_REG_TEMPERATURE_LSB = 0x12U; // bits 7-6 = quarters

// Consecutive failed liveness samples before the oscillator is declared stopped.
// Two, per the design above: the first failure is a single observation, and
// requiring two means an unlucky pair of reads in the same one-second bucket
// cannot take a healthy clock out of service.
static constexpr uint8_t RTC_LIVENESS_STALL_SAMPLES = 2;

// Liveness tolerance, in seconds, subtracted from the elapsed interval before
// the observed advance is compared against it.
//
// This exists for the DS3231's own one-second register granularity, not for a
// slow clock: a read taken just before a second boundary and the next one taken
// just after can legitimately report an advance one second short of the true
// elapsed time. Two seconds of slack covers that with room to spare, and is
// three percent of the 60 s poll interval - so at I2C_RTC_POLL_INTERVAL_MS a
// frozen clock misses by 58 s and fails by a wide margin, while a healthy clock
// passes by 58 s. A tight tolerance would only create false stalls; a loose one
// would let a chip crawling at 3% of real time pass. The test is a comparison
// against elapsed time, so it stays correct if the poll interval ever changes.
static constexpr uint32_t RTC_LIVENESS_TOLERANCE_SECONDS = 2UL;

// ---------------------------------------------------------------------------
// Server clock sync
// ---------------------------------------------------------------------------
//
// How many agreeing measurements before the server is believed.
//
// Not one. A single sample is a single unverified statement from a remote host:
// it could be a service with a skewed clock of its own, a proxy stamping a
// cached response, or a half-completed deployment. Committing the device's
// notion of the day to that is exactly the class of bug the clock-trust rule
// exists to catch, and it would be committed with the device's full confidence.
// Three agreeing samples - within RTC_LIVENESS_TOLERANCE_SECONDS of each other
// - is enough to establish a stable offset and cheap enough to happen inside the
// first few heartbeats of a connection. Until then the device reports `rtc`,
// which is honest: it has not yet learned anything.
//
// The offset is applied to the device's own clock rather than replacing it. The
// RTC therefore remains a genuinely independent witness, and a server that goes
// wrong later shows up as a DISAGREEMENT in the log instead of silently
// rewriting the day.
static constexpr uint8_t SERVER_SYNC_MIN_SAMPLES = 3;

// A new sample must land within this many seconds of the running correction to
// count toward SERVER_SYNC_MIN_SAMPLES. Guards against a service whose clock
// jumps: the first samples establish the offset, and one that disagrees wildly
// is rejected rather than averaged in.
static constexpr int32_t SERVER_SYNC_SAMPLE_TOLERANCE_S = 5;

// An offset outside this is not a clock error, it is a broken or hostile
// response, and adopting it would move the device's date by months. Rejected
// before it is measured, not after.
static constexpr int32_t SERVER_OFFSET_ABS_LIMIT_S = 86400;

// How often the device asks the server what time it is.
//
// Until a correction is established it asks every 20 s, so SERVER_SYNC_MIN_SAMPLES
// are collected inside the first minute of a working connection rather than
// spread across half an hour. After that it asks every 15 minutes, which is
// frequent enough to notice a server whose own clock has moved and rare enough
// that it is not a permanent second heartbeat. See serviceServerTimeSync() for
// why this exists separately from the snapshot publish at all.
static constexpr uint32_t SERVER_TIME_PROBE_FAST_MS = 20000UL;
static constexpr uint32_t SERVER_TIME_PROBE_SLOW_MS = 900000UL;

// ---------------------------------------------------------------------------
// DS3231 diagnostic registers: READ, DECODED CORRECTLY, NEVER WRITTEN
// ---------------------------------------------------------------------------
//
// 0x0D is the DATE/DAY byte of the ALARM 2 block, not an "offset-seconds"
// register. It reads invalid BCD on this module, and that is exactly what an
// unprogrammed register looks like: the datasheet states register state is
// undefined at power-on until the host writes it, and this firmware programs
// no alarms, so 0x0D has never been written by anything.
//
// 0x11/0x12 hold the temperature, not 0x07/0x08. 0x07-0x0A is the Alarm 1 block.
// The real pair reads a normal die temperature.
//
// 0x10 is the Aging Offset register - the only offset register this part has. It
// is a signed two's-complement value in 1/256 C steps, not BCD, and it is left
// strictly alone: the firmware takes its time from the server and performs no
// calibration, so an aging offset has nothing to correct here.
//
// All of them are read and reported so a human can judge them, and NONE of them
// is ever written. That is a deliberate decision rather than an oversight:
//
//   0x0D is a LIVE ALARM REGISTER. Writing a byte into it is programming an
//   alarm. A blind write on a guess is how a device acquires an interrupt it
//   never asked for, and this firmware never wants one.
//
//   0x11/0x12 are read-only in practice and there is nothing to gain by writing
//   them. The reported storage-zone temperature comes from the BME280; the
//   DS3231's own channel is a die reading shown as a device-health diagnostic.
//
//   0x10 changes oscillator calibration. The chip's timekeeping is demonstrably
//   working - verified by raw register dump, 00:34:54 -> 00:35:22 -> 00:35:50
//   over 20 s intervals with a valid BCD date - and the ~5 h skew is an offset,
//   corrected from the server clock. Writing a calibration register to chase an
//   offset is how a working clock is turned into a broken one.
//
// See reportDs3231Registers() for what is printed, and readDs3231TemperatureC()
// for the single place the temperature is decoded.

// Where the epoch in a snapshot came from. Reported verbatim in every snapshot
// as `time_source`, because the backend has a clock-trust rule and needs to be
// able to tell a real RTC reading from a corrected one before it applies it.
//
//   Rtc         the DS3231 was read, advanced, and is trusted - and no server
//               correction has been learned yet. The honest pre-sync state.
//   ServerSynced  the device's own clock, corrected by a measured server
//               offset and carried forward by millis(). THE NORMAL STATE once
//               the device has synced, and it keeps working offline: the anchor
//               is corrected, so losing the network costs accuracy in seconds,
//               never a frozen date.
//   RtcOffset   no server anchor, DS3231 not trusted, but a last-known-good
//               reading exists: that reading advanced by millis(). It moves,
//               but the anchor is only as good as the last good read.
//   None        no time at all. epoch 0, time_valid false.
enum class TimeSource : uint8_t {
  None = 0,
  Rtc = 1,
  ServerSynced = 2,
  RtcOffset = 3
};

// Liveness state.
static uint32_t rtcPreviousEpoch = 0;   // last successfully read epoch
static uint32_t rtcPreviousReadMs = 0;   // when that read was taken, for the
                                        // elapsed-time comparison below
static uint8_t rtcStallCount = 0;        // consecutive failed liveness samples
static bool rtcClockRunning = true;      // the oscillator verdict, liveness only
static bool rtcStallAnnounced = false;   // log the transition once, not per poll
static uint8_t rtcStatusRegister = 0;    // last raw 0x0F, for the STATUS line
static bool rtcStatusKnown = false;

// Monotonic-offset anchor. Set only from a read that both advanced and passed
// every trust test, so this is a genuine last-known-good RTC time and not a
// repeat of a value already known to be frozen.
static uint32_t lastGoodRtcEpoch = 0;
static uint32_t lastGoodRtcMs = 0;

// Server-time anchor, from the ingest response.
static uint32_t serverEpoch = 0;
static uint32_t serverEpochMs = 0;
static bool serverTimeKnown = false;

// The measured correction, in seconds, and the evidence behind it.
//
// serverOffsetSeconds is the SIGNED difference (server - device) observed on
// the most recent accepted sample. On this hardware it is about +17,946: the
// server is roughly 5 hours ahead of the DS3231. It is reported verbatim in
// every snapshot as `clock_offset_s`.
//
// serverSynced flips true only after SERVER_SYNC_MIN_SAMPLES agreeing
// measurements, and it is the gate on the whole server-authority path. Until it
// is set the device keeps reporting its raw RTC reading, because a device that
// believes one unverified remote number is worse than one that reports what it
// actually measured.
static int32_t serverOffsetSeconds = 0;
static uint8_t serverSyncSamples = 0;
static bool serverSynced = false;
static bool serverOffsetLogged = false;
static uint32_t lastServerTimeProbeMs = 0;

// How long ago the correction was last confirmed, for the STATUS line. A device
// that synced at boot and has been offline for a day should not present a
// day-old correction as current, and the age is the thing that says so.
static uint32_t serverOffsetAgeMs() {
  return serverTimeKnown ? (millis() - serverEpochMs) : 0;
}

static uint32_t currentRtcEpoch() {
  return (rtcReady && rtcClockTrusted && !faults.ds3231) ? rtcEpoch : 0;
}

static const char* timeSourceName(TimeSource source) {
  switch (source) {
    case TimeSource::Rtc: return "rtc";
    case TimeSource::ServerSynced: return "server_synced";
    case TimeSource::RtcOffset: return "rtc_offset";
    case TimeSource::None: return "none";
  }
  return "none";
}

static void rememberGoodRtcTime(uint32_t epoch, uint32_t nowMs) {
  lastGoodRtcEpoch = epoch;
  lastGoodRtcMs = nowMs;
}

/**
 * Measure the server's clock against the device's, and build the correction.
 *
 * Called with `server_time_epoch` out of every successful ingest response, which
 * is the only place the two clocks ever meet. An MQTT-delivered snapshot gets no
 * response at all, so this never runs on that path - which is why the anchor
 * below is kept and carried forward rather than re-measured per snapshot.
 *
 * The correction is a running average of agreeing samples, and it is applied to
 * the device's own clock rather than replacing it. That is deliberate:
 *
 *   - The DS3231 stays a genuinely independent witness. If the server later goes
 *     wrong, the next sample disagrees and the log says so. A design that simply
 *     adopted the server's epoch would have no way to notice, and would follow
 *     the server's mistake with the same confidence it currently follows the
 *     RTC's.
 *   - millis() then carries the corrected value forward for free. The device
 *     keeps time whether or not the network is there, which is the entire point
 *     of the fallback.
 *
 * Sub-second bias: the server stamps its own clock at the instant the snapshot
 * is recorded, and this runs one round trip later, so the anchor is anchored to
 * `nowMs` with a server value that is up to one RTT stale. The error is
 * therefore UNDER-reported by at most the round-trip time - a few hundred
 * milliseconds against a 900 s tolerance. Correcting for it would mean
 * guessing an RTT, and a guessed correction is worse than an honest
 * sub-second bias at this magnitude.
 */
static void rememberServerTime(uint32_t epoch, uint32_t nowMs) {
  // Same sanity floor as the RTC path. A server reporting year 1970 is a bug on
  // the server, and adopting it would make the device confidently wrong.
  if (epoch < MIN_VALID_RTC_EPOCH) return;

  // The device's own clock at the moment the response was read. Using the
  // snapshot's epoch field instead would fold the whole POST round trip into
  // the measurement, because the snapshot was built before the request left.
  const uint32_t deviceEpoch = currentRtcEpoch();
  if (deviceEpoch == 0) {
    // No device clock to compare against, so there is nothing to correct yet.
    // The anchor is still recorded, because the rtc_offset path below can use
    // it once the RTC produces a reading.
    serverEpoch = epoch;
    serverEpochMs = nowMs;
    serverTimeKnown = true;
    return;
  }

  // Signed, because the sign is the whole answer: positive means the server is
  // ahead. Unsigned arithmetic here would turn a device 5 hours FAST into an
  // apparent offset of ~4.29e9 seconds, which the limit below would then reject
  // as a bug - masking the one case the device most needs correcting.
  const int32_t offset = static_cast<int32_t>(epoch - deviceEpoch);
  if (offset > SERVER_OFFSET_ABS_LIMIT_S || offset < -SERVER_OFFSET_ABS_LIMIT_S) {
    Serial.printf("[Time] Server offset %ld s is implausible; rejected and the"
                  " existing correction kept\n", static_cast<long>(offset));
    return;
  }

  const int32_t previousOffset = serverOffsetSeconds;

  if (serverTimeKnown && !serverSynced &&
      (offset - previousOffset > SERVER_SYNC_SAMPLE_TOLERANCE_S ||
       previousOffset - offset > SERVER_SYNC_SAMPLE_TOLERANCE_S)) {
    // A disagreement before the correction is established means one of the two
    // clocks is unstable. Count it as a fresh start rather than averaging in a
    // number that disagrees with the samples around it.
    Serial.printf("[Time] Offset moved %+ld -> %+ld s between samples; restarting"
                  " the measurement\n", static_cast<long>(previousOffset),
                  static_cast<long>(offset));
    serverOffsetSeconds = offset;
    serverSyncSamples = 1;
  } else if (serverSyncSamples == 0) {
    serverOffsetSeconds = offset;
    serverSyncSamples = 1;
  } else {
    // Integer mean of the agreeing samples. It cannot overflow: both terms are
    // bounded by SERVER_OFFSET_ABS_LIMIT_S.
    serverOffsetSeconds = (previousOffset + offset) / 2;
    if (serverSyncSamples < 255) ++serverSyncSamples;
  }

  // Re-anchor unconditionally, including on a sample that disagreed. The anchor
  // is the corrected time itself, and a bad sample is a reason to distrust the
  // OFFSET measurement - not a reason to stop advancing the clock.
  serverEpoch = epoch;
  serverEpochMs = nowMs;
  serverTimeKnown = true;

  if (!serverSynced && serverSyncSamples >= SERVER_SYNC_MIN_SAMPLES) {
    serverSynced = true;
    Serial.printf("[Time] Server clock adopted after %u agreeing samples:"
                  " correction %+ld s (server was %s the device). Reported epoch"
                  " is now device clock + correction, carried by millis(), so it"
                  " keeps advancing offline\n",
                  static_cast<unsigned>(serverSyncSamples),
                  static_cast<long>(serverOffsetSeconds),
                  serverOffsetSeconds > 0 ? "ahead of" : "behind");
    requestBackendPost();
  } else if (!serverOffsetLogged) {
    // Log every sample until the correction is established. This is the window
    // an operator needs to see: it shows the offset being confirmed rather than
    // appearing from nowhere on the first snapshot.
    Serial.printf("[Time] Server offset sample %u/%u: %+ld s (device clock %lu,"
                  " server %lu)\n",
                  static_cast<unsigned>(serverSyncSamples),
                  static_cast<unsigned>(SERVER_SYNC_MIN_SAMPLES),
                  static_cast<long>(offset),
                  static_cast<unsigned long>(deviceEpoch),
                  static_cast<unsigned long>(epoch));
    serverOffsetLogged = true;
  } else if (serverSynced && offset != previousOffset) {
    // Once established, report a correction that has actually MOVED and nothing
    // else. A stable offset is the good case; a line every heartbeat would train
    // an operator to ignore the one line that matters. Comparing against the
    // previous raw sample rather than the running mean means a slow drift shows
    // up as a growing gap, which is the signal worth having.
    Serial.printf("[Time] Server offset changed %+ld -> %+ld s (correction now"
                  " %+ld s)\n", static_cast<long>(previousOffset),
                  static_cast<long>(offset),
                  static_cast<long>(serverOffsetSeconds));
  }
}

// Re-arm the liveness test from a known epoch. Used at boot, and after the
// operator's RTCEPOCH - without this, a manual clock set would be compared
// against the pre-set reading and immediately look like a stall.
static void resetRtcLiveness(uint32_t seedEpoch) {
  rtcPreviousEpoch = seedEpoch;
  rtcPreviousReadMs = millis();
  rtcStallCount = 0;
  rtcClockRunning = true;
  rtcStallAnnounced = false;
}

/**
 * Record one SUCCESSFUL read and report whether the oscillator is still running.
 *
 * THE TEST IS AGAINST ELAPSED TIME, NOT AGAINST "DID THE VALUE CHANGE".
 *
 * The obvious test - "is this the same number as last time?" - is wrong here for
 * a specific reason: it only means "the clock is dead" if real time actually
 * passed between the two reads, and the only thing that guarantees that is
 * knowing the elapsed interval. I2C_RTC_POLL_INTERVAL_MS is 60 s, so a healthy
 * read pair differs by ~60 and a frozen pair is identical - the coincidence is
 * what makes the naive test look like it works. It is one constant change away
 * from failing, and it cannot tell a chip running at 1% of real time from a
 * healthy one.
 *
 * So the comparison is: did the value advance by at least the elapsed real time,
 * less a small tolerance for the DS3231's one-second register granularity?
 *
 *   elapsed 60 s, healthy   -> advance 60 s, needs 58, passes by 2
 *   elapsed 60 s, frozen    -> advance  0 s, needs 58, FAILS by 58
 *   elapsed  0 s, any       -> no time passed, not a sample at all
 *
 * A failed I2C read must never reach this: the chip did not answer, so there is
 * no second value to compare, and counting it as a stall would make an
 * intermittent bus glitch indistinguishable from a dead oscillator.
 */
static bool noteRtcEpochRead(uint32_t epoch, uint32_t nowMs) {
  if (rtcPreviousEpoch == 0) {
    // First read of this boot. There is nothing to compare against yet, so it
    // is not evidence either way and must not count against the clock.
    rtcPreviousEpoch = epoch;
    rtcPreviousReadMs = nowMs;
    return true;
  }
  // Signed difference on purpose. A backwards jump (operator set the clock
  // elsewhere, or the cell died mid-read) wraps to a large POSITIVE value in
  // unsigned arithmetic, which would look like the clock leaping forward a
  // billion seconds and pass a naive unsigned liveness test.
  const int32_t delta = static_cast<int32_t>(epoch - rtcPreviousEpoch);
  const uint32_t elapsedSeconds = (nowMs - rtcPreviousReadMs) / 1000UL;
  rtcPreviousEpoch = epoch;
  rtcPreviousReadMs = nowMs;

  // No whole second of real time passed, so there is nothing to have missed.
  // Returning true here is not credence to the clock - it is declining to test
  // it, and the next sample will have a real interval to compare against.
  if (elapsedSeconds == 0) return true;

  // The clock is running if it kept up with the milliseconds that went by.
  // A backwards delta also fails this, and is at least as broken.
  if (delta >= static_cast<int32_t>(elapsedSeconds - RTC_LIVENESS_TOLERANCE_SECONDS)) {
    rtcStallCount = 0;
    return true;
  }
  if (rtcStallCount < 255) ++rtcStallCount;
  return false;
}

// NO updateRtcBatteryFlag() HERE, DELIBERATELY.
//
// The previous firmware had one, and it was the function that printed
//     "[DS3231] Backup battery LOW - replace the CR2032 (status register 0x08)"
// on every boot, because 0x0F bit 3 was believed to be a battery flag. It is
// not. The DS3231 has no battery-low status bit: 0x0F bit 3 is EN32kHz, the
// 32.768 kHz output enable, and the chip was measured with 0x0F = 0x08 - i.e.
// that bit set. So the "low battery" line was a hard-coded falsehood triggered
// by a configuration bit, telling the operator to replace a part whose state
// nothing had ever measured.
//
// There is nothing to put in its place. While the board is powered the DS3231
// runs from VCC and the backup cell is not even in circuit, and the datasheet
// provides no register that reports its charge state. An unobservable quantity
// is reported as unobservable: this firmware makes no claim about the CR2032 in
// either direction. The cell is periodic operator maintenance, discovered by
// testing it across a power cycle - which is how it worked before this function
// existed, and the only way to do it honestly.

/**
 * The best time this device can honestly offer, and where it came from.
 *
 * `sourceOut` is a parameter rather than a returned global on purpose: the
 * snapshot has to write `epoch` and `time_source` from the SAME decision. A
 * stored global would be correct until something else read the epoch in
 * between, and a snapshot whose `time_source` disagrees with its own `epoch` is
 * worse than one that says nothing, because the backend would apply the wrong
 * clock-trust decision to it with full confidence.
 *
 * THE CHAIN IS SERVER-FIRST, AND THAT IS THE WHOLE FIX.
 *
 * It used to be RTC-first with the server as a fallback for a dead clock. On
 * hardware where the RTC is dead that is correct and sufficient. On THIS
 * hardware it achieves nothing at all, because the RTC is not dead - it counts
 * correctly and is about 5 hours out. An RTC-first chain therefore never reaches
 * its own fallback: the backend sees a confident, plausible, 5-hour-wrong epoch,
 * raises device_clock_skew_exceeds_max, and withholds the date layer. The
 * fallback existed and was never used, which is worse than not having one,
 * because it looked handled.
 *
 * So once a correction has been measured from SERVER_SYNC_MIN_SAMPLES ingest
 * responses, the corrected time leads. After that the device reports server time
 * corrected by the device's own millis(), and:
 *
 *   - it is correct, so the skew rule passes and item verdicts work;
 *   - it keeps advancing with no network at all, because only the anchor came
 *     from the network. The brief's requirement that time must never freeze when
 *     the server is unreachable is satisfied by the SAME code path, not by a
 *     special case;
 *   - the raw DS3231 reading is still there underneath as `rtc_alive`,
 *     `clock_offset_s` and the STATUS line, so the hardware fault stays visible
 *     and fixable instead of being hidden by a working fallback.
 *
 * "No time at all" remains a real answer (epoch 0, source none). Nothing here
 * fabricates a time, and no sensor value is ever synthesised.
 */
static uint32_t currentReportEpoch(uint32_t nowMs, TimeSource* sourceOut) {
  // 1. Server-corrected. The anchor is the server's own clock, carried forward
  //    by millis(), so this branch is reached online AND offline.
  if (serverSynced && serverTimeKnown) {
    if (sourceOut) *sourceOut = TimeSource::ServerSynced;
    return serverEpoch + ((nowMs - serverEpochMs) / 1000UL);
  }
  // 2. Raw DS3231, before a correction has been established. Honest, and about
  //    5 hours out - which is why it is not the authority once step 1 exists.
  const uint32_t rtc = currentRtcEpoch();
  if (rtc != 0) {
    if (sourceOut) *sourceOut = TimeSource::Rtc;
    return rtc;
  }
  // 3. A server anchor with no device clock to correct: the server's own clock,
  //    still carried forward by millis(). Same guarantee, different provenance.
  if (serverTimeKnown) {
    if (sourceOut) *sourceOut = TimeSource::ServerSynced;
    return serverEpoch + ((nowMs - serverEpochMs) / 1000UL);
  }
  // 4. Last known-good RTC reading advanced by this device's monotonic millis().
  //    It moves, but the anchor is only as good as that last good read - and on
  //    this hardware that read is 5 hours out, which `clock_offset_s` says out
  //    loud.
  if (lastGoodRtcEpoch != 0) {
    if (sourceOut) *sourceOut = TimeSource::RtcOffset;
    return lastGoodRtcEpoch + ((nowMs - lastGoodRtcMs) / 1000UL);
  }
  if (sourceOut) *sourceOut = TimeSource::None;
  return 0;
}

/**
 * The authority's epoch, for the device's OWN date arithmetic.
 *
 * The item table has to be judged against the same clock the snapshot reports.
 * A device that stamps store_date_epoch from the 5-hour-wrong DS3231 and then
 * reports a server-corrected epoch is internally inconsistent, and the
 * inconsistency is invisible in the payload: `epoch` looks right while every
 * item's elapsed time is silently 5 hours long. One seam, so the two cannot
 * drift apart again.
 *
 * `sourceOut` is optional; callers that only need the number pass nothing.
 */
static uint32_t currentAuthorityEpoch(uint32_t nowMs, TimeSource* sourceOut = nullptr) {
  return currentReportEpoch(nowMs, sourceOut);
}

static bool clearRtcOscillatorStoppedFlag() {
  uint8_t statusRegister = 0;
  if (!i2cReadRegister8(DS3231_ADDRESS, 0x0F, &statusRegister)) return false;
  return i2cWriteRegister8(DS3231_ADDRESS, 0x0F,
                           static_cast<uint8_t>(statusRegister & static_cast<uint8_t>(~DS3231_STATUS_OSF)));
}

static void initializeRtc() {
  uint32_t nowMs = millis();
  rtcReady = rtc.begin(&Wire);
  if (!rtcReady) {
    Serial.println(F("[DS3231] No ACK at 0x68; awaiting confirmed data"));
    return;
  }

  bool lostPower = rtc.lostPower();
  if (lostPower && ALLOW_COMPILE_TIME_RTC_SET) {
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    clearRtcOscillatorStoppedFlag();
    rtcClockTrusted = true;
    Serial.println(F("[DS3231] Set once from sketch build time; verify it manually"));
  } else {
    rtcClockTrusted = !lostPower;
  }

  uint8_t statusRegister = 0;
  bool readOk = i2cReadRegister8(DS3231_ADDRESS, DS3231_REG_STATUS, &statusRegister);
  faults.ds3231 = updateFaultDebounce(&ds3231Debounce, !readOk, nowMs);
  if (readOk) {
    rtcStatusRegister = statusRegister;
    rtcStatusKnown = true;
    markSensorReady(SENSOR_FAULT_DS3231);
  }
  if (readOk && (statusRegister & DS3231_STATUS_OSF) != 0) {
    // OSF is bit 7 (0x80). A set oscillator-stopped flag is a deterministic
    // fault, so unlike every other bit in 0x0F it is acted on immediately.
    rtcClockTrusted = false;
    forceFaultDebounce(&ds3231Debounce, nowMs);
    faults.ds3231 = true;
  }
  // No battery decode happens here, because there is nothing to decode. See the
  // note where updateRtcBatteryFlag() used to be.

  rtcEpoch = rtc.now().unixtime();
  if (rtcEpoch < MIN_VALID_RTC_EPOCH) {
    rtcClockTrusted = false;
    forceFaultDebounce(&ds3231Debounce, nowMs);
    faults.ds3231 = true;
  }
  // Seed the liveness comparison with the boot reading, so the very first poll
  // has something to compare against and a frozen clock is caught within about
  // one poll interval rather than two.
  resetRtcLiveness(rtcEpoch);
  ds3231TimeReady = rtcClockTrusted;
  if (rtcClockTrusted) rememberGoodRtcTime(rtcEpoch, nowMs);
  Serial.println((faults.ds3231 || !ds3231TimeReady)
                     ? F("[DS3231] Clock unavailable/lost power")
                     : F("[DS3231] OK"));
  Serial.printf("[DS3231] Status register 0x%02X (OSF=%u EN32kHz=%u BSY=%u"
                " A2F=%u A1F=%u); liveness is"
                " unproven until a second read advances\n",
                static_cast<unsigned>(rtcStatusRegister),
                (rtcStatusRegister & DS3231_STATUS_OSF) ? 1U : 0U,
                (rtcStatusRegister & DS3231_STATUS_EN32KHZ) ? 1U : 0U,
                (rtcStatusRegister & DS3231_STATUS_BSY) ? 1U : 0U,
                (rtcStatusRegister & DS3231_STATUS_A2F) ? 1U : 0U,
                (rtcStatusRegister & DS3231_STATUS_A1F) ? 1U : 0U);
  // Printed once at boot so the diagnostic registers are on the record from the
  // first minute of a serial capture, without anyone having to attach a
  // debugger. Read-only; see reportDs3231Registers().
  reportDs3231Registers();
}

static void serviceRtc(uint32_t nowMs) {
  if (static_cast<uint32_t>(nowMs - lastRtcPollMs) < I2C_RTC_POLL_INTERVAL_MS) return;
  lastRtcPollMs = nowMs;

  if (!rtcReady) {
    rtcReady = rtc.begin(&Wire);
    if (!rtcReady) {
      faults.ds3231 = updateFaultDebounce(&ds3231Debounce, true, nowMs);
      return;
    }
    // The chip just came back. Its registers are unproven, so the next
    // successful read has to re-seed the comparison rather than be measured
    // against a reading taken before it was reachable.
    resetRtcLiveness(0);
  }

  uint8_t statusRegister = 0;
  if (!i2cReadRegister8(DS3231_ADDRESS, DS3231_REG_STATUS, &statusRegister)) {
    // No liveness sample from a failed read. See noteRtcEpochRead().
    faults.ds3231 = updateFaultDebounce(&ds3231Debounce, true, nowMs);
    return;
  }
  rtcStatusRegister = statusRegister;
  rtcStatusKnown = true;
  // Nothing else in 0x0F is acted on here: EN32kHz is a configuration bit, BSY
  // is transient, A1F/A2F are alarm latches this firmware never arms. Only OSF
  // reaches the trust decision, below.

  const uint32_t newEpoch = rtc.now().unixtime();
  // A successful read. This is the only point in the file where "the chip
  // answered" and "the clock is running" are decided separately - and the
  // decision is made against the milliseconds that elapsed since the previous
  // read, so a legitimate 60 s poll interval is never mistaken for a stall.
  const bool advanced = noteRtcEpochRead(newEpoch, nowMs);
  const bool stalled = rtcStallCount >= RTC_LIVENESS_STALL_SAMPLES;

  if (!advanced && stalled) {
    rtcClockRunning = false;
    if (!rtcStallAnnounced) {
      rtcStallAnnounced = true;
      Serial.printf("[DS3231] NOT RUNNING: read %u succeeded but the time fell"
                    " behind real time by more than %lu s over the %lu s poll"
                    " interval (epoch still %lu, status 0x%02X); the raw clock is"
                    " untrusted and the device reports its server-corrected time"
                    " instead\n",
                    static_cast<unsigned>(rtcStallCount),
                    static_cast<unsigned long>(RTC_LIVENESS_TOLERANCE_SECONDS),
                    static_cast<unsigned long>(I2C_RTC_POLL_INTERVAL_MS / 1000UL),
                    static_cast<unsigned long>(newEpoch),
                    static_cast<unsigned>(statusRegister));
      requestBackendPost();
    }
  } else if (advanced && !rtcClockRunning) {
    // Recovery, and it is automatic: a clock that starts moving again is
    // trusted again on the same sample that proves it, rather than needing an
    // RTCEPOCH the operator has no reason to think is required.
    rtcClockRunning = true;
    rtcStallAnnounced = false;
    Serial.println(F("[DS3231] Oscillator advancing again; time trusted"));
    requestBackendPost();
  }

  // Trust is the AND of the three independent conditions, re-evaluated on every
  // sample: the read succeeded, the oscillator is not flagged stopped, the
  // oscillator is actually advancing, and the date is past the sanity floor.
  rtcEpoch = newEpoch;
  const bool epochSane = (newEpoch >= MIN_VALID_RTC_EPOCH);
  const bool oscillatorOk =
      ((statusRegister & DS3231_STATUS_OSF) == 0) && rtcClockRunning;
  rtcClockTrusted = epochSane && oscillatorOk;
  ds3231TimeReady = rtcClockTrusted;
  if (!ds3231TimeReady) {
    forceFaultDebounce(&ds3231Debounce, nowMs);
    faults.ds3231 = true;
  } else {
    faults.ds3231 = updateFaultDebounce(&ds3231Debounce, false, nowMs);
  }
  // Anchor the monotonic fallback only on a read that is genuinely good. A
  // frozen read is not a last-known-good time and must never become one.
  if (rtcClockTrusted) rememberGoodRtcTime(newEpoch, nowMs);
}

/**
 * Read and decode the DS3231's own die temperature from 0x11/0x12.
 *
 * THE CORRECT REGISTER PAIR. The previous firmware read 0x07/0x08, which are the
 * first two bytes of the ALARM 1 block, and called the result "temperature". It
 * therefore reported a nonsense value and then diagnosed the temperature channel
 * as broken. 0x11 is the temperature MSB and 0x12 the LSB, per the datasheet.
 *
 * DECODE, per the datasheet:
 *   0x11  signed 8-bit WHOLE degrees, in two's complement. Bit 7 is the sign;
 *         bits 6-0 are the magnitude, so 0x1C is +28 C and 0xE3 is -29 C.
 *   0x12  bits 7-6 hold quarter-degree steps: 00 = 0.00, 01 = 0.25, 10 = 0.50,
 *         11 = 0.75. Bits 5-0 are undefined/reserved and are not used.
 *
 * There is no 1/256 C term on this part; the previous decoder added the whole
 * of 0x08 as if it were one, which is another reason its output was nonsense.
 *
 * Returned in THOUSANDTHS of a degree C so no floating point is involved.
 * dtostrf would pull printf's float path into IRAM, and IRAM is the tightest
 * budget on this part. `validOut` is set false on a bus error so the caller can
 * say "unreadable" rather than print a fabricated 0.00 C.
 */
static int32_t readDs3231TemperatureC(bool* validOut) {
  uint8_t msb = 0;
  uint8_t lsb = 0;
  if (!i2cReadRegister8(DS3231_ADDRESS, DS3231_REG_TEMPERATURE_MSB, &msb) ||
      !i2cReadRegister8(DS3231_ADDRESS, DS3231_REG_TEMPERATURE_LSB, &lsb)) {
    if (validOut) *validOut = false;
    return 0;
  }
  if (validOut) *validOut = true;
  // The explicit sign test rather than relying on implementation-defined
  // behaviour of casting uint8_t to int8_t: on a target where char is unsigned
  // that cast would promote instead of sign-extend, and 0xE3 would read as +227
  // degrees. Sign-extend by hand and the sign bit is honoured everywhere.
  const int32_t whole = ((msb & 0x80U) != 0)
                            ? -(static_cast<int32_t>(msb & 0x7FU))
                            : static_cast<int32_t>(msb);
  const int32_t quarters = static_cast<int32_t>((lsb >> 6) & 0x03U);
  return (whole * 1000) + (quarters * 250);
}

/**
 * The DS3231 diagnostic registers: READ, DECODED, REPORTED, NEVER WRITTEN.
 *
 * 0x0D  Alarm 2 DATE/DAY. Not an "offset-seconds register" - this part has no
 *       such register. It reads invalid BCD, and that is the expected content of
 *       a register the datasheet says is undefined at power-on until written:
 *       this firmware programs no alarms, so nothing has ever written it.
 * 0x10  Aging Offset. The one and only offset register on the DS3231. Signed
 *       two's complement in 1/256 C steps, not BCD. Left strictly alone.
 * 0x11  Temperature MSB, signed whole degrees. 0x12 the LSB, quarter steps.
 *
 * There is no i2cWriteRegister8() call anywhere in this function, and there must
 * never be one:
 *   0x0D is a LIVE ALARM REGISTER. Writing a byte into it is programming an
 *   alarm, on a device that has none and wants none, with a value derived from a
 *   guess. That is the single most destructive thing this firmware could do to
 *   a working clock.
 *   0x10 changes oscillator calibration, and the ~5 h skew is an offset corrected
 *   from the server clock, not a rate error this register could fix.
 *   0x11/0x12 are diagnostics; there is nothing to gain by writing them.
 *
 * Called from initializeRtc() once at boot and from the STATUS command, so the
 * evidence is visible without a debugger attached.
 */
static void reportDs3231Registers() {
  uint8_t alarm2DateDay = 0;
  if (!i2cReadRegister8(DS3231_ADDRESS, DS3231_REG_ALARM2_DATE_DAY, &alarm2DateDay)) {
    Serial.println(F("[DS3231] 0x0D (Alarm 2 date/day) unreadable"));
  } else {
    // Decoded as BCD because that is what the date and day-of-week fields are
    // specified to hold, so an unprogrammed register is visibly different from
    // a programmed one. Bit 7 of the date field is the century bit.
    const uint8_t bcdTens = (alarm2DateDay >> 4) & 0x0F;
    const uint8_t bcdUnits = alarm2DateDay & 0x0F;
    const bool bcdValid = (bcdTens <= 9) && (bcdUnits <= 9);
    // Meaningful only when the bytes really are BCD; printed so a programmed
    // alarm would be legible, and deliberately meaningless otherwise rather
    // than a plausible-looking wrong number.
    const uint8_t decoded = bcdValid
                                ? static_cast<uint8_t>((bcdTens * 10) + bcdUnits)
                                : 0;
    Serial.printf("[DS3231] 0x0D is the Alarm 2 DATE/DAY register, not an offset"
                  " register - this part has none. It reads 0x%02X = %s, and"
                  " %s because the datasheet leaves register state undefined at"
                  " power-on and this firmware programs no alarms."
                  " NOT WRITTEN: 0x0D is a live alarm register and a blind write"
                  " would program an alarm.\n",
                  static_cast<unsigned>(alarm2DateDay),
                  bcdValid ? "a legal BCD date/day byte" : "not valid BCD",
                  bcdValid ? "it is simply unprogrammed" : "that is the expected power-on state");
    if (bcdValid) {
      Serial.printf("[DS3231] 0x0D decoded BCD: day %u, date %u (Alarm 2 is not"
                    " programmed; the clock's own date is 0x03/0x04)\n",
                    static_cast<unsigned>(bcdUnits),
                    static_cast<unsigned>(decoded));
    }
  }

  uint8_t agingOffset = 0;
  if (i2cReadRegister8(DS3231_ADDRESS, DS3231_REG_AGING_OFFSET, &agingOffset)) {
    // Signed two's complement, 1/256 C steps. Printed raw as well, because the
    // raw byte is the evidence and a decoded value alone would hide a decoder
    // mistake. Reported only; never written.
    const int32_t agingCenti = (agingOffset & 0x80U)
                                   ? -(static_cast<int32_t>(~agingOffset & 0xFF))
                                   : static_cast<int32_t>(agingOffset);
    Serial.printf("[DS3231] 0x10 aging offset reads 0x%02X = %ld/256 C"
                  " (the only offset register on this part; not BCD, and NOT"
                  " WRITTEN - the ~5 h skew is an offset corrected from the"
                  " server clock, not a rate error).\n",
                  static_cast<unsigned>(agingOffset),
                  static_cast<long>(agingCenti));
  } else {
    Serial.println(F("[DS3231] 0x10 (aging offset) unreadable"));
  }

  bool temperatureValid = false;
  const int32_t milli = readDs3231TemperatureC(&temperatureValid);
  if (!temperatureValid) {
    Serial.println(F("[DS3231] 0x11/0x12 temperature registers unreadable"));
    return;
  }
  // Printed raw AND decoded, for the same reason as 0x0D above. A DS3231 updates
  // its internal temperature roughly every 64 s, so this can legitimately be up
  // to a minute old; it is the chip's DIE temperature, a device-health
  // diagnostic, and NOT the storage-zone air temperature - the BME280 remains
  // the measurement this product reports.
  Serial.printf("[DS3231] 0x11/0x12 temperature (MSB signed whole C, LSB bits 7-6"
                " quarter steps) = %+ld.%03ld C, refreshed by the chip about every"
                " 64 s, so up to a minute stale; this is the RTC die, not the zone."
                " NOT WRITTEN.\n",
                static_cast<long>(milli / 1000),
                static_cast<long>((milli < 0 ? -milli : milli) % 1000));
}

static bool setRtcEpoch(uint32_t epoch) {
  if (!rtcReady || epoch < MIN_VALID_RTC_EPOCH) return false;
  rtc.adjust(DateTime(static_cast<uint32_t>(epoch)));
  if (!clearRtcOscillatorStoppedFlag()) return false;
  rtcClockTrusted = true;
  rtcEpoch = epoch;
  ds3231TimeReady = true;
  clearFaultDebounce(&ds3231Debounce);
  faults.ds3231 = false;
  // The operator has just supplied the time by hand. The liveness test has to
  // restart from it, or the next poll compares the new value against the old
  // one and declares a stall for a clock that is perfectly fine.
  resetRtcLiveness(epoch);
  rememberGoodRtcTime(epoch, millis());
  return true;
}

// ============================================================================
// LittleFS bounded alert queue with CRC-protected fixed slots
// ============================================================================

static uint32_t crc32(const uint8_t* data, size_t length) {
  uint32_t crc = 0xFFFFFFFFUL;
  while (length--) {
    crc ^= *data++;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc >> 1) ^ (0xEDB88320UL & (0UL - (crc & 1UL)));
    }
  }
  return ~crc;
}

static bool loadMqBaselineFromStorage() {
  if (!storageReady || !LittleFS.exists(MQ_BASELINE_PATH)) return false;
  File file = LittleFS.open(MQ_BASELINE_PATH, "r");
  if (!file) {
    faults.littlefs = true;
    return false;
  }
  MqBaselineDisk baseline;
  bool ok = file.read(reinterpret_cast<uint8_t*>(&baseline), sizeof(baseline)) ==
            static_cast<int>(sizeof(baseline));
  file.close();
  if (!ok || baseline.crc != crc32(reinterpret_cast<const uint8_t*>(&baseline),
                                   offsetof(MqBaselineDisk, crc))) {
    faults.littlefs = true;
    Serial.println(F("[MQ135] Stored baseline failed CRC; recapturing"));
    return false;
  }
  // dividerTopOhms/divididerBottomOhms now record the fitted load resistor and
  // the AIN0 scale, rather than a 4.7k/2.2k divider that was never built. The
  // comparison below still does its job: it invalidates a stored baseline when
  // the analog conditioning changes, which is exactly when old numbers stop
  // meaning anything.
  if (baseline.magic != MQ_BASELINE_MAGIC || baseline.version != MQ_BASELINE_VERSION ||
      baseline.dividerTopOhms != static_cast<uint16_t>(MQ_LOAD_OHMS) ||
      baseline.fullScaleMv != static_cast<uint16_t>(MQ_ADS_FULL_SCALE_MV) ||
      baseline.sampleCount != MQ_BASELINE_SAMPLE_COUNT ||
      isnan(baseline.baselineMv) || isinf(baseline.baselineMv) ||
      baseline.baselineMv < MQ_AIN0_MIN_PLAUSIBLE_MV ||
      baseline.baselineMv > MQ_AIN0_HARD_LIMIT_MV) {
    Serial.println(F("[MQ135] Stored baseline does not match configuration; recapturing"));
    return false;
  }
  mqBaselineMv = baseline.baselineMv;
  mqBaselineReady = true;
  mqState = MqState::WarmingUp; // Warm the sensor, then use the persisted baseline.
  Serial.printf("[MQ135] Persisted baseline loaded: AIN0 %.3f mV\n", mqBaselineMv);
  return true;
}

static bool saveMqBaselineToStorage() {
  if (!storageReady) {
    faults.littlefs = true;
    return false;
  }
  MqBaselineDisk baseline;
  memset(&baseline, 0, sizeof(baseline));
  baseline.magic = MQ_BASELINE_MAGIC;
  baseline.version = MQ_BASELINE_VERSION;
  baseline.dividerTopOhms = static_cast<uint16_t>(MQ_LOAD_OHMS);
  baseline.dividerBottomOhms = 0;
  baseline.fullScaleMv = static_cast<uint16_t>(MQ_ADS_FULL_SCALE_MV);
  baseline.sampleCount = MQ_BASELINE_SAMPLE_COUNT;
  baseline.baselineMv = mqBaselineMv;
  baseline.crc = crc32(reinterpret_cast<const uint8_t*>(&baseline),
                       offsetof(MqBaselineDisk, crc));

  File file = LittleFS.open(MQ_BASELINE_PATH, "w");
  if (!file) {
    faults.littlefs = true;
    return false;
  }
  bool ok = file.write(reinterpret_cast<const uint8_t*>(&baseline), sizeof(baseline)) ==
            sizeof(baseline);
  file.close();
  if (!ok) {
    faults.littlefs = true;
    Serial.println(F("[MQ135] Baseline persistence failed; RAM baseline remains active"));
  }
  return ok;
}

static bool queueReadSlot(uint8_t index, QueueSlotDisk* slot) {
  if (!storageReady || !queueReady || !slot || index >= ALERT_QUEUE_CAPACITY) return false;
  File file = LittleFS.open(QUEUE_PATH, "r");
  if (!file) return false;
  uint32_t offset = sizeof(QueueHeaderDisk) + (static_cast<uint32_t>(index) * sizeof(QueueSlotDisk));
  bool ok = file.seek(offset, SeekSet) &&
            file.read(reinterpret_cast<uint8_t*>(slot), sizeof(*slot)) ==
                static_cast<int>(sizeof(*slot));
  file.close();
  return ok;
}

static bool queueWriteSlot(uint8_t index, const QueueSlotDisk* slot) {
  if (!storageReady || !queueReady || !slot || index >= ALERT_QUEUE_CAPACITY) return false;
  File file = LittleFS.open(QUEUE_PATH, "r+");
  if (!file) return false;
  uint32_t offset = sizeof(QueueHeaderDisk) + (static_cast<uint32_t>(index) * sizeof(QueueSlotDisk));
  bool ok = file.seek(offset, SeekSet) &&
            file.write(reinterpret_cast<const uint8_t*>(slot), sizeof(*slot)) == sizeof(*slot);
  file.close();
  if (!ok) faults.littlefs = true;
  return ok;
}

static bool queueWriteHeader(const QueueHeaderDisk* header) {
  if (!storageReady || !header) return false;
  File file = LittleFS.open(QUEUE_PATH, "r+");
  if (!file) return false;
  bool ok = file.seek(0, SeekSet) &&
            file.write(reinterpret_cast<const uint8_t*>(header), sizeof(*header)) == sizeof(*header);
  file.close();
  if (!ok) faults.littlefs = true;
  return ok;
}

static void refreshQueuedEventCount() {
  if (!queueReady) {
    queuedEventCount = 0;
    return;
  }
  uint8_t count = 0;
  for (uint8_t index = 0; index < ALERT_QUEUE_CAPACITY; ++index) {
    QueueSlotDisk slot;
    if (!queueReadSlot(index, &slot)) {
      faults.littlefs = true;
      break;
    }
    if (slot.syncState == 1) {
      uint32_t expectedCrc = crc32(reinterpret_cast<const uint8_t*>(&slot), offsetof(QueueSlotDisk, crc));
      if (slot.magic != QUEUE_SLOT_MAGIC || slot.crc != expectedCrc) {
        faults.littlefs = true;
      } else if (count < 255) {
        ++count;
      }
    }
  }
  queuedEventCount = count;
  faults.alertQueue = count >= ALERT_QUEUE_CAPACITY;
}

/**
 * Is the queue file on flash the version 1 layout?
 *
 * Size only, deliberately. A v1 file is exactly ALERT_QUEUE_CAPACITY v1 slots
 * long, and nothing else can be that size, so this distinguishes "written by an
 * older build" from "corrupt" without trusting the header of a file that may
 * itself be damaged. If a file's size is already the v2 one but its header
 * claims version 1, that file is corrupt - and it must be refused, not widened,
 * because widening a corrupt file is how you destroy the part of it that was
 * still readable.
 */
static bool queueHasVersion1Layout() {
  const uint32_t expectedV1Size = sizeof(QueueHeaderDisk) +
                                  (static_cast<uint32_t>(ALERT_QUEUE_CAPACITY) * sizeof(QueueSlotDiskV1));
  File file = LittleFS.open(QUEUE_PATH, "r");
  if (!file) return false;
  const bool v1Size = file.size() == expectedV1Size;
  file.close();
  return v1Size;
}

/**
 * Widen a version 1 queue file to the version 2 layout, keeping every event.
 *
 * WHY THIS HAS TO EXIST
 * Version 2 added a per-event `uid`, so the slot grew and so did the file.
 * initializeAlertQueue() below compares the file size and refuses a mismatch,
 * leaving the file on flash for the operator - correct for a file it cannot
 * read, and catastrophic here. A refused queue means queueReady stays false,
 * which means appendAlertEvent() returns false for EVERY condition: a warm
 * fridge, a dead sensor and a door left open would all be silently discarded,
 * and the operator would be looking at a dashboard that shows nothing is wrong.
 * Trading a working event queue for a field that is optional on eleven of the
 * twelve event types is not a trade worth making.
 *
 * HOW IT IS SAFE
 * Written to a separate path and renamed into place only once every byte is on
 * flash, so an interrupted migration (reset, power loss, a full filesystem)
 * leaves the original v1 file complete and the next boot simply retries. A
 * truncating rewrite in place would have a window in which the only copy of a
 * pending alert does not exist.
 *
 * WHAT IS CARRIED
 * id, time validity, timestamp, type and message, and the next event id, all
 * unchanged - so an event that was already sent and acknowledged is still a
 * duplicate and a still-pending one is still delivered. The uid is left EMPTY,
 * which is precisely what a v1 event means: it was raised before the field
 * existed and is not known to be about a tag. Empty is omitted on the wire and
 * stored as NULL, so it validates.
 *
 * EVERY PENDING SLOT IS CRC-CHECKED FIRST, and one failure aborts the whole
 * migration. This is not tidiness. A slot that fails its v1 check holds
 * unreadable bytes; re-CRCing them into a valid-looking v2 slot would promote
 * garbage into a pending event, and its `type` would then be published in
 * events[] - where the service validates against a closed enum, so one
 * corrupted slot would take down every reading, every item and the config block
 * in every snapshot from then on. Refusing to migrate leaves a file this build
 * can still read and says so, which is a far smaller problem.
 */
static bool migrateAlertQueueV1() {
  if (!storageReady) return false;
  File source = LittleFS.open(QUEUE_PATH, "r");
  if (!source) return false;

  QueueHeaderDisk header;
  bool ok = source.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) == sizeof(header);
  if (ok && (header.magic != QUEUE_MAGIC || header.version != QUEUE_VERSION_1 ||
             header.capacity != ALERT_QUEUE_CAPACITY || header.nextEventId == 0)) {
    Serial.println(F("[Queue] Version 1 size but a header this build cannot trust;"
                     " left untouched"));
    ok = false;
  }
  if (!ok) {
    source.close();
    return false;
  }

  File target = LittleFS.open(QUEUE_MIGRATE_PATH, "w");
  if (!target) {
    source.close();
    return false;
  }
  QueueHeaderDisk upgraded = header;
  upgraded.version = QUEUE_VERSION;
  ok = target.write(reinterpret_cast<const uint8_t*>(&upgraded), sizeof(upgraded)) ==
       sizeof(upgraded);

  // One slot in flight at a time, read straight through and written straight
  // out. Buffering all 24 would put 3.4 KB of queue slots on the stack, and the
  // loop task does not have that to spare; this peak is one v1 slot plus one v2
  // slot, and neither outlives the iteration.
  for (uint8_t index = 0; ok && index < ALERT_QUEUE_CAPACITY; ++index) {
    QueueSlotDiskV1 oldSlot;
    QueueSlotDisk newSlot;
    ok = source.read(reinterpret_cast<uint8_t*>(&oldSlot), sizeof(oldSlot)) == sizeof(oldSlot);
    if (!ok) break;
    memset(&newSlot, 0, sizeof(newSlot));

    // Only a slot the old build marked pending is a record that means something.
    // An empty slot's CRC covers padding, so it is not evidence of anything -
    // this matches exactly what refreshQueuedEventCount() validates today.
    if (oldSlot.syncState == 1) {
      const uint32_t expectedCrc = crc32(reinterpret_cast<const uint8_t*>(&oldSlot),
                                         offsetof(QueueSlotDiskV1, crc));
      if (oldSlot.magic != QUEUE_SLOT_MAGIC || oldSlot.crc != expectedCrc) {
        Serial.printf("[Queue] Slot %u failed its version 1 checksum; the whole"
                      " file was left untouched\n", static_cast<unsigned>(index));
        ok = false;
        break;
      }
    }

    // Field by field, not a memcpy of a byte range. These structs have padding,
    // and the v1 checksum covered three bytes of it; copying "everything up to
    // uid" would have picked those up. Assigning each field says what is carried
    // and cannot quietly change meaning if a field is ever reordered.
    newSlot.magic = oldSlot.magic;
    newSlot.syncState = oldSlot.syncState;
    newSlot.timeValid = oldSlot.timeValid;
    newSlot.eventId = oldSlot.eventId;
    newSlot.timestampEpoch = oldSlot.timestampEpoch;
    copyBounded(newSlot.type, sizeof(newSlot.type), oldSlot.type);
    copyBounded(newSlot.message, sizeof(newSlot.message), oldSlot.message);
    // Left as memset: empty, which is "not about a tag" and is omitted on the wire.
    newSlot.crc = crc32(reinterpret_cast<const uint8_t*>(&newSlot),
                        offsetof(QueueSlotDisk, crc));
    ok = target.write(reinterpret_cast<const uint8_t*>(&newSlot), sizeof(newSlot)) ==
         sizeof(newSlot);
  }
  source.close();
  target.close();
  if (!ok) {
    LittleFS.remove(QUEUE_MIGRATE_PATH);
    return false;
  }

  if (!LittleFS.remove(QUEUE_PATH) || !LittleFS.rename(QUEUE_MIGRATE_PATH, QUEUE_PATH)) {
    // The original is gone or the new file is not in place. Nothing else may
    // write to either path, so the safest end state is no queue file at all -
    // initializeAlertQueue() will then create a clean one rather than adopt a
    // half-written one.
    LittleFS.remove(QUEUE_MIGRATE_PATH);
    Serial.println(F("[Queue] Migration swap failed; the queue will be recreated empty"));
    return false;
  }
  return true;
}

// ============================================================================
// event_id allocation: why a fresh counter must never start at 1
// ============================================================================
//
// event_id is this device's half of the backend's dedupe key. The service
// inserts on (device_id, boot_generation, event_id) with INSERT OR IGNORE, so
// an id handed out twice inside what the server sees as one boot is swallowed
// without a sound: the POST returns 2xx, the slot is popped from the queue, the
// dashboard never sees the event, and every sign of the queue drain looks
// healthy. That is precisely how ~12,400 events were discarded - a reflash
// recreated the queue file, the counter restarted at 1, and ids 1, 2, 3, 4
// collided with pre-reflash rows of a different type.
//
// The server now scopes the key by boot_generation, incremented when uptime
// DECREASES, so a reboot or reflash is covered upstream. What it cannot see is
// a counter that restarts while uptime keeps counting - the backend stated
// that limit itself: a queue recreated without an uptime reset carries no boot
// signal to detect it. Those cases are handled here in two layers:
//
//   1. seedQueuedEventId() takes the id space from the wall clock, so a fresh
//      counter lands in a band the original 1, 2, 3, ... counter can never
//      reach again, and the id itself records the day it was minted.
//   2. lastIssuedQueuedEventId clamps every reseed above what this boot has
//      already issued, so within one boot - the one window the backend has no
//      signal for - restarting the counter is structurally impossible.

// The id after `consumed`, where the file's counter value is the highest id
// spoken for (see initializeAlertQueue for how that is decided).
//
// The wrap deliberately does NOT restart at 1. Wrapping to 1 would re-import
// the original failure mode through the one door still open: every id the
// device has ever published is eventually reachable from the bottom of the
// number line. It wraps to the 2024-01-01 sanity floor instead - below every
// clock-derived seed, above every legacy counter value - so even a wrapped
// counter stays inside the band that was reserved for seeded ids.
static uint32_t nextQueuedEventIdAfter(uint32_t consumed) {
  if (consumed != UINT32_MAX) return consumed + 1;
  // Unreachable in practice: it takes an unbroken ~136 years of one new alert
  // per second to spend the uint32_t id space. But a wrap that quietly
  // restarted at 1 would be the original bug wearing a hat, so it is as loud
  // as everything else in this file - silence is what let the last collision
  // run to ~12,400 discarded events before anyone noticed.
  Serial.printf("[Queue] event_id wrapped at %lu; ids restart at %lu inside a"
                " band long since used. ~136 years at one alert per second"
                " reaches this - suspect the clock, not the queue\n",
                static_cast<unsigned long>(consumed),
                static_cast<unsigned long>(MIN_VALID_RTC_EPOCH));
  return MIN_VALID_RTC_EPOCH;
}

/**
 * The id a brand-new queue file reserves, and the only place in the firmware
 * that invents an id from thin air.
 *
 * SEED IS THE WALL CLOCK, when there is one. An event id that is a real
 * timestamp is self-documenting in the database ("1759054321" says when, right
 * in the dedupe key), and it is structurally disjoint from the legacy counter
 * that began at 1: no fresh seed can ever land in the band a 1-based counter
 * reached, which is the band the ~12,400-event collision happened in. The same
 * clock source every snapshot reports (currentReportEpoch) is used rather than
 * the raw DS3231 reading, so the id's provenance matches the epoch beside it.
 *
 * FALLBACK, when time_valid is false at that moment: the 2024-01-01 sanity
 * floor plus this boot's uptime in seconds. Three properties the old "start at
 * 1" had none of - it is nowhere near any id a legacy counter could have
 * reached, it advances between two reseeds inside one boot so repeating one is
 * impossible, and it sits below every clock-derived seed, so the day the clock
 * comes back the ids jump forward instead of backwards.
 *
 * CLAMP, always: never return a value at or below an id this boot has already
 * reserved or issued. This is the layer the backend explicitly cannot provide,
 * and the reason is concrete on this hardware: early in a boot the reported
 * epoch is the raw DS3231 reading, which runs ~5 hours AHEAD until the first
 * ingest sync corrects it BACKWARDS. Seed a queue before the sync and reseed
 * it after, and the clock alone would happily hand out a lower id than the one
 * this boot already published.
 */
static uint32_t seedQueuedEventId() {
  TimeSource source = TimeSource::None;
  const uint32_t epoch = currentReportEpoch(millis(), &source);

  uint32_t seed;
  const char* provenance;
  if (epoch >= MIN_VALID_RTC_EPOCH) {
    seed = epoch;
    provenance = timeSourceName(source);
  } else {
    // No usable clock. millis()/1000 cannot overflow this: the floor plus the
    // largest possible uptime-in-seconds is still far below UINT32_MAX, so the
    // fallback can never wrap into the legacy band either.
    seed = MIN_VALID_RTC_EPOCH + (millis() / 1000UL);
    provenance = "no clock; 2024-01-01 floor + uptime s";
  }

  // The high-water clamp. Wider than uint32_t on purpose: lastIssued can be
  // UINT32_MAX, and one-past-UINT32_MAX does not exist in uint32_t - silently
  // wrapping there would produce exactly the low id this whole fix exists to
  // make unreachable.
  uint64_t candidate = seed;
  if (candidate <= lastIssuedQueuedEventId) {
    candidate = static_cast<uint64_t>(lastIssuedQueuedEventId) + 1;
  }

  if (candidate > UINT32_MAX) {
    // The id space is genuinely spent. Nothing reachable from the console can
    // fix that, but dropping alerts would be the worse failure on a food-safety
    // device, so the counter saturates and says so at the top of the number
    // line rather than refusing to queue anything.
    Serial.printf("[Queue] event_id space exhausted at %lu; every id issued"
                  " from here repeats one already used\n",
                  static_cast<unsigned long>(UINT32_MAX));
    candidate = UINT32_MAX;
  } else if (candidate != static_cast<uint64_t>(seed)) {
    Serial.printf("[Queue] event_id counter seeded at %lu from %s, raised past"
                  " %lu already issued this boot (the clock moved backwards)\n",
                  static_cast<unsigned long>(candidate), provenance,
                  static_cast<unsigned long>(lastIssuedQueuedEventId));
  } else {
    // The line the last incident needed and did not have: a counter starting
    // over used to be indistinguishable from a counter continuing.
    Serial.printf("[Queue] event_id counter seeded at %lu from %s\n",
                  static_cast<unsigned long>(seed), provenance);
  }
  return static_cast<uint32_t>(candidate);
}

static bool initializeAlertQueue() {
  queueReady = false;
  bool createdNow = false;
  const uint32_t expectedSize = sizeof(QueueHeaderDisk) +
                                (static_cast<uint32_t>(ALERT_QUEUE_CAPACITY) * sizeof(QueueSlotDisk));
  if (LittleFS.exists(QUEUE_PATH) && queueHasVersion1Layout()) {
    Serial.println(F("[Queue] Version 1 file found; widening it to carry a per-event uid"));
    if (migrateAlertQueueV1()) {
      Serial.println(F("[Queue] Widened; pending events kept, each with no uid"));
    } else {
      faults.littlefs = true;
      Serial.println(F("[Queue] Widening failed; the existing file was left untouched"));
      return false;
    }
  }
  if (!LittleFS.exists(QUEUE_PATH)) {
    File file = LittleFS.open(QUEUE_PATH, "w");
    if (!file) {
      faults.littlefs = true;
      return false;
    }
    // Seeded from the clock, never 1. This literal used to be 1, and that one
    // number is what let a reflash restart the id sequence underneath a
    // backend that dedupes on it - see seedQueuedEventId() for the full
    // failure and the fallback when the clock is not valid yet.
    const uint32_t seed = seedQueuedEventId();
    QueueHeaderDisk header = {QUEUE_MAGIC, QUEUE_VERSION, ALERT_QUEUE_CAPACITY, seed, 0};
    bool ok = file.write(reinterpret_cast<const uint8_t*>(&header), sizeof(header)) == sizeof(header);
    QueueSlotDisk emptySlot;
    memset(&emptySlot, 0, sizeof(emptySlot));
    for (uint8_t index = 0; ok && index < ALERT_QUEUE_CAPACITY; ++index) {
      ok = file.write(reinterpret_cast<const uint8_t*>(&emptySlot), sizeof(emptySlot)) == sizeof(emptySlot);
    }
    file.close();
    if (!ok) {
      faults.littlefs = true;
      return false;
    }
    // The seed above is a RESERVATION for this run's first append, not an id
    // anyone has issued yet - the flag is what tells the adoption below to
    // take it verbatim instead of stepping past it.
    createdNow = true;
  }

  File file = LittleFS.open(QUEUE_PATH, "r");
  if (!file || file.size() != expectedSize) {
    if (file) file.close();
    faults.littlefs = true;
    Serial.println(F("[Queue] Existing file is invalid; left untouched for recovery"));
    return false;
  }
  QueueHeaderDisk header;
  bool ok = file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) ==
                static_cast<int>(sizeof(header));
  file.close();
  if (!ok || header.magic != QUEUE_MAGIC || header.version != QUEUE_VERSION ||
      header.capacity != ALERT_QUEUE_CAPACITY || header.nextEventId == 0) {
    // Rejected, NOT silently re-primed: the file may still hold readable
    // slots, and rewriting a file this build cannot trust is how the readable
    // part of it gets destroyed. queueReady stays false, appendAlertEvent()
    // refuses every condition (faults.alertQueue and the [LOCAL-ONLY] lines
    // make that visible), and nothing here retries - this runs once per boot
    // and once per CLEARQ, so there is no loop. Recovery is the operator's
    // CLEARQ, which deletes the file and recreates it through the SEEDED
    // path below, so the fix for a rejected header is a queue that starts at
    // a timestamp instead of at 1. On the next boot, nothing has changed
    // about this file, so it is rejected again until that CLEARQ happens -
    // deliberately, because silently trading a possibly-recoverable queue for
    // an empty one is the same class of error as the collision this fix
    // closes.
    faults.littlefs = true;
    Serial.println(F("[Queue] Header invalid; existing events were not cleared"));
    return false;
  }
  // What the counter in the file MEANS depends on who wrote it, and reading it
  // the wrong way is a duplicate-id generator:
  //
  //   - Written by THIS call: the seed, reserved for the first append of this
  //     run. Adopted verbatim, so the value the seeder logged is exactly the
  //     first id this file will ever hand out.
  //   - Inherited from an earlier run: the id that run's last append ISSUED
  //     (appendAlertEvent writes the id it used, not the one after it), so this
  //     run resumes ONE PAST it. That is what makes a reset between the header
  //     write and the slot write safe - the id is skipped, never reissued - and
  //     it is also why a file written by an OLDER build needs no version bump
  //     to be safe: its counter value was issued too. Skipping one id costs
  //     nothing (ids are timestamps now, not dense counters); reissuing one
  //     costs an event on the backend, silently.
  nextQueuedEventId = createdNow ? header.nextEventId
                                  : nextQueuedEventIdAfter(header.nextEventId);
  // Whatever the file holds is spoken for - issued by an earlier run, or
  // reserved by this one - so a reseed later in this boot must clear it. This
  // is the value the seed clamp compares against.
  lastIssuedQueuedEventId = header.nextEventId;
  queueReady = true;
  refreshQueuedEventCount();
  // The next id on the same line as the queue's health, because "which id will
  // the next event get" is the first question anyone asks after a collision,
  // and it should be answerable from any boot log without a debugger.
  Serial.printf("[Queue] Ready: %u pending event(s), capacity %u; next event_id %lu\n",
                static_cast<unsigned>(queuedEventCount),
                static_cast<unsigned>(ALERT_QUEUE_CAPACITY),
                static_cast<unsigned long>(nextQueuedEventId));
  return true;
}

static bool appendAlertEvent(const AlertEvent& event) {
  if (!storageReady || !queueReady) {
    faults.littlefs = true;
    return false;
  }

  int8_t freeIndex = -1;
  for (uint8_t index = 0; index < ALERT_QUEUE_CAPACITY; ++index) {
    QueueSlotDisk slot;
    if (!queueReadSlot(index, &slot)) {
      faults.littlefs = true;
      return false;
    }
    if (slot.syncState == 1 && strcmp(slot.type, event.type) == 0 &&
        (slot.uid[0] == '\0' || event.uid[0] == '\0' ||
         strcmp(slot.uid, event.uid) == 0)) {
      // A condition that stays true - a fridge running warm, a door that keeps
      // being propped open - re-fires on every evaluation cycle. Appending each
      // one filled all 24 slots within minutes, and once full the queue refused
      // every NEW alert too, so a dead sensor or a temperature excursion arriving
      // later was silently dropped. For a food-safety device that is the worst
      // possible failure: the loudest condition is kept, the newest is lost.
      //
      // An alert already pending for the same thing is therefore refreshed in
      // place. One slot per distinct condition, holding the latest reading and
      // the time it was last seen, so the queue depth is bounded by the number
      // of things that are wrong rather than by how long they have been wrong.
      //
      // THE KEY IS (type, uid), NOT type ALONE - and for the eleven event types
      // that are not about a tag it degenerates to exactly the old behaviour,
      // because both uids are empty and the first clause is satisfied. An
      // identification event is a different kind of record: its identity is the
      // TAG, so two different tags presented while the first is still pending are
      // two facts, and collapsing the second into the first would report the
      // wrong uid against the item actually scanned. It would also be lost
      // outright: a refresh keeps the slot's original event_id, and the service
      // inserts on (device_id, event_id) with INSERT OR IGNORE, so a uid that only
      // ever changed inside an already-delivered id would never reach the
      // dashboard at all.
      slot.timestampEpoch = event.timestampEpoch;
      slot.timeValid = event.timeValid ? 1 : 0;
      copyBounded(slot.message, sizeof(slot.message), event.message);
      copyBounded(slot.uid, sizeof(slot.uid), event.uid);
      uint32_t refreshedCrc =
          crc32(reinterpret_cast<const uint8_t*>(&slot), offsetof(QueueSlotDisk, crc));
      if (refreshedCrc == slot.crc) {
        // Byte-identical repeat: nothing new happened, so do not rewrite flash
        // on every cycle.
        return true;
      }
      slot.crc = refreshedCrc;
      if (!queueWriteSlot(index, &slot)) return false;
      refreshQueuedEventCount();
      faults.alertQueue = false;
      Serial.printf("[Queue] Refreshed pending %s in slot %u; depth unchanged at %u\n",
                    event.type, static_cast<unsigned>(index),
                    static_cast<unsigned>(queuedEventCount));
      return true;
    }
    if (slot.syncState == 0 && freeIndex < 0) {
      freeIndex = static_cast<int8_t>(index);
    }
  }
  if (freeIndex < 0) {
    faults.alertQueue = true;
    Serial.printf("[Queue] Full at %u slots; %s was not queued. The oldest pending"
                  " alert must be synchronised or\n       removed before any new"
                  " condition can be recorded.\n",
                  static_cast<unsigned>(ALERT_QUEUE_CAPACITY), event.type);
    return false;
  }

  // queueReady implies the counter was established from a seeded header, but
  // the guard is not decoration: it is the last line of defence between an
  // unset counter and the bottom of the id space. The old fallback here was
  // `? 1 :` - literally "if we do not know the counter, start over at 1" - and
  // that is the behaviour that let a recreated queue silently collide with
  // every id this device had ever published. An unset counter now reseeds from
  // the clock and says so on the console.
  if (nextQueuedEventId == 0) nextQueuedEventId = seedQueuedEventId();

  const uint32_t issued = nextQueuedEventId;
  QueueHeaderDisk header = {QUEUE_MAGIC, QUEUE_VERSION, ALERT_QUEUE_CAPACITY, issued, 0};
  // The id goes into the header BEFORE the slot. A slot write that fails after
  // this lands merely skips an id - ids are timestamps now, not dense counters,
  // so a gap costs nothing while a duplicate costs an event - and a reset
  // between the two writes leaves the file claiming an id no slot holds, which
  // the next boot resumes PAST (initializeAlertQueue) instead of handing out
  // again. The header therefore records the id USED, not the id after it; that
  // is the meaning initializeAlertQueue()'s adoption step depends on.
  if (!queueWriteHeader(&header)) return false;
  nextQueuedEventId = nextQueuedEventIdAfter(issued);
  if (issued > lastIssuedQueuedEventId) lastIssuedQueuedEventId = issued;

  QueueSlotDisk slot;
  memset(&slot, 0, sizeof(slot));
  slot.magic = QUEUE_SLOT_MAGIC;
  slot.syncState = 1; // Pending; never cleared on a failed send.
  slot.timeValid = event.timeValid ? 1 : 0;
  slot.eventId = issued;
  slot.timestampEpoch = event.timestampEpoch;
  copyBounded(slot.type, sizeof(slot.type), event.type);
  copyBounded(slot.message, sizeof(slot.message), event.message);
  // Empty for every event that is not about a tag, and that is the point: the
  // slot then emits no `uid` key at all rather than an empty one.
  copyBounded(slot.uid, sizeof(slot.uid), event.uid);
  slot.crc = crc32(reinterpret_cast<const uint8_t*>(&slot), offsetof(QueueSlotDisk, crc));
  if (!queueWriteSlot(static_cast<uint8_t>(freeIndex), &slot)) return false;

  refreshQueuedEventCount();
  faults.alertQueue = false;
  return true;
}

/**
 * Copy out the `ordinal`-th pending event (0 = oldest unsynchronised).
 *
 * The Option B snapshot carries up to BACKEND_MAX_EVENTS events in one POST, so
 * it needs to walk past the first slot rather than only ever seeing the head.
 * A CRC failure stops the walk: a corrupt slot means the queue cannot be
 * trusted to enumerate, and reporting a short list is better than skipping a
 * record silently.
 */
static bool peekQueuedEventAt(uint8_t ordinal, AlertEvent* event) {
  if (!event || !queueReady) return false;
  uint8_t found = 0;
  for (uint8_t index = 0; index < ALERT_QUEUE_CAPACITY; ++index) {
    QueueSlotDisk slot;
    if (!queueReadSlot(index, &slot)) {
      faults.littlefs = true;
      return false;
    }
    if (slot.syncState != 1) continue;
    uint32_t expectedCrc = crc32(reinterpret_cast<const uint8_t*>(&slot), offsetof(QueueSlotDisk, crc));
    if (slot.magic != QUEUE_SLOT_MAGIC || slot.crc != expectedCrc) {
      faults.littlefs = true;
      Serial.printf("[Queue] CRC failure in slot %u; event retained\n",
                    static_cast<unsigned>(index));
      return false;
    }
    if (found < ordinal) {
      ++found;
      continue;
    }
    memset(event, 0, sizeof(*event));
    event->eventId = slot.eventId;
    event->timestampEpoch = slot.timestampEpoch;
    event->timeValid = slot.timeValid != 0;
    copyBounded(event->type, sizeof(event->type), slot.type);
    copyBounded(event->uid, sizeof(event->uid), slot.uid);
    copyBounded(event->message, sizeof(event->message), slot.message);
    return true;
  }
  return false;
}

static bool peekQueuedEvent(AlertEvent* event) {
  return peekQueuedEventAt(0, event);
}

static bool removeQueuedEvent(uint32_t eventId) {
  if (!queueReady || eventId == 0) return false;
  for (uint8_t index = 0; index < ALERT_QUEUE_CAPACITY; ++index) {
    QueueSlotDisk slot;
    if (!queueReadSlot(index, &slot)) return false;
    if (slot.syncState == 1 && slot.eventId == eventId) {
      uint32_t expectedCrc = crc32(reinterpret_cast<const uint8_t*>(&slot), offsetof(QueueSlotDisk, crc));
      if (slot.magic != QUEUE_SLOT_MAGIC || slot.crc != expectedCrc) {
        faults.littlefs = true;
        return false;
      }
      memset(&slot, 0, sizeof(slot));
      if (!queueWriteSlot(index, &slot)) return false;
      refreshQueuedEventCount();
      return true;
    }
  }
  return false;
}

// ============================================================================
// Bounded food inventory, persisted as validated text in LittleFS
// ============================================================================

static uint8_t hexNibble(char value) {
  if (value >= '0' && value <= '9') return static_cast<uint8_t>(value - '0');
  if (value >= 'a' && value <= 'f') return static_cast<uint8_t>(value - 'a' + 10);
  if (value >= 'A' && value <= 'F') return static_cast<uint8_t>(value - 'A' + 10);
  return 0xFF;
}

static bool parseUidHex(const char* text, uint8_t* uid, uint8_t* uidLength) {
  if (!text || !uid || !uidLength) return false;
  size_t length = strlen(text);
  if (length == 0 || length > 20 || (length & 1U) != 0) return false;
  for (size_t index = 0; index < length; index += 2) {
    uint8_t high = hexNibble(text[index]);
    uint8_t low = hexNibble(text[index + 1]);
    if (high == 0xFF || low == 0xFF) return false;
    uid[index / 2] = static_cast<uint8_t>((high << 4) | low);
  }
  *uidLength = static_cast<uint8_t>(length / 2);
  return true;
}

// THE ONE UID SPELLING ON THE WIRE.
//
// This produces uppercase hex with no separators and no "0x": "1778F106".
// appendUid() below writes the same string for items[] - both are two uppercase
// hex digits per byte with nothing between them - and that equality is load
// bearing rather than cosmetic. A scan publishes the UID it just read, and the
// service is told explicitly NOT to normalise case or separators
// (backend/src/read/item-registration.js: "Case is NOT normalised ... the device
// is the authority on identity"), so a scan of a registered tag only resolves to
// its inventory_item row if this and appendUid() agree character for character.
// Uppercase is also what the operator reads off the console and types into
// `REG`, so the round trip is legible.
//
// The input is matched on raw bytes (findInventoryByUid), so no case question
// arises inside the device: a tag registered as "1778f106" and a tag read as
// 17 78 F1 06 are the same row, and both are reported as "1778F106".
static void formatUid(const uint8_t* uid, uint8_t uidLength, char* output, size_t capacity) {
  if (!uid || !output || capacity == 0) return;
  size_t used = 0;
  for (uint8_t index = 0; index < uidLength && used + 2 < capacity; ++index) {
    int written = snprintf(output + used, capacity - used, "%02X",
                           static_cast<unsigned>(uid[index]));
    if (written < 0 || static_cast<size_t>(written) >= capacity - used) break;
    used += static_cast<size_t>(written);
  }
  output[used] = '\0';
}

static int8_t findInventoryByUid(const uint8_t* uid, uint8_t uidLength) {
  for (uint8_t index = 0; index < inventoryCount; ++index) {
    if (inventory[index].uidLength == uidLength &&
        memcmp(inventory[index].uid, uid, uidLength) == 0) {
      return static_cast<int8_t>(index);
    }
  }
  return -1;
}

static bool validInventoryRecord(const FoodItem& item) {
  if (item.uidLength == 0 || item.uidLength > 10 || item.name[0] == '\0' ||
      item.storeDateEpoch < MIN_VALID_RTC_EPOCH) {
    return false;
  }
  if (item.durationLimitDays == 0 && item.expiryEpoch == 0) return false;
  if (item.expiryEpoch != 0 && item.expiryEpoch < item.storeDateEpoch) return false;
  return true;
}

static bool readFileLine(File& file, char* output, size_t capacity) {
  if (!output || capacity == 0) return false;
  size_t used = 0;
  int value;
  while ((value = file.read()) >= 0) {
    if (value == '\n') {
      output[used] = '\0';
      if (used > 0 && output[used - 1] == '\r') output[used - 1] = '\0';
      return true;
    }
    if (used + 1 < capacity) output[used++] = static_cast<char>(value);
    else return false;
  }
  if (used > 0) {
    output[used] = '\0';
    return true;
  }
  return false;
}

static bool loadInventory() {
  inventoryCount = 0;
  faults.inventory = false;
  if (!storageReady || !inventoryStoreReady) return false;
  if (!LittleFS.exists(INVENTORY_PATH)) return true;

  File file = LittleFS.open(INVENTORY_PATH, "r");
  if (!file) {
    faults.littlefs = true;
    faults.inventory = true;
    return false;
  }
  char line[256];
  if (!readFileLine(file, line, sizeof(line))) {
    file.close();
    faults.inventory = true;
    return false;
  }
  // The third header field is lastAppliedCmdSeq, and it is OPTIONAL. Two fields
  // is the layout this firmware shipped with, and those files must keep loading:
  // refusing them would strand every registered item on every device in the
  // field behind a firmware update, which is a far worse outcome than the one
  // this field exists to prevent. INVENTORY_MAGIC is unchanged for the same
  // reason - the magic is the version gate, and the meaning of fields 1 and 2 and
  // of every record line is byte-for-byte identical. One extra header token, in
  // a position no record occupies, cannot be mistaken for a record field.
  //
  // A third field that is PRESENT but unparsable is still refused, rather than
  // defaulted: a corrupt sequence high-water mark would silently re-enable
  // replays, which is the one thing this must not do. Anything beyond three
  // fields is refused outright, exactly as before.
  char* headerFields[3];
  uint32_t storedCount = 0;
  const uint8_t headerFieldCount = splitFields(line, '|', headerFields, 3);
  uint32_t storedSeq = 0;
  if ((headerFieldCount != 2 && headerFieldCount != 3) ||
      !parseUint32(headerFields[1], 0, MAX_INVENTORY_ITEMS, &storedCount) ||
      (headerFieldCount == 3 && !parseUint32(headerFields[2], 0, UINT32_MAX, &storedSeq))) {
    file.close();
    faults.inventory = true;
    Serial.println(F("[Inventory] Invalid header; RAM inventory left empty"));
    return false;
  }
  // Checked before a single record is read, and deliberately not a "best effort"
  // parse. A file from another layout has the right kind of data in the wrong
  // places, and the ninth field of a version 1 record is the first token of the
  // next line - which parses as a number often enough to pass unnoticed. The
  // file is left on flash: it may be readable by other firmware, and this
  // device is not the one that gets to decide it is garbage.
  if (strcmp(headerFields[0], INVENTORY_MAGIC) != 0) {
    file.close();
    faults.inventory = true;
    Serial.printf("[Inventory] On-disk format '%s' is not version %u ('%s'); file left"
                  " untouched and RAM inventory left empty\n",
                  headerFields[0], static_cast<unsigned>(INVENTORY_VERSION), INVENTORY_MAGIC);
    return false;
  }
  // Assigned only once the format is known to be ours. Taken before the magic
  // check, a file belonging to some other layout could set the command
  // high-water mark from a field that means nothing here, and a device would
  // then refuse legitimately new commands as "stale".
  lastAppliedCmdSeq = storedSeq;

  for (uint32_t record = 0; record < storedCount; ++record) {
    if (!readFileLine(file, line, sizeof(line)) || inventoryCount >= MAX_INVENTORY_ITEMS) {
      file.close();
      inventoryCount = 0;
      faults.inventory = true;
      return false;
    }
    // Nine fields, matching the layout this firmware writes. A short line is
    // refused here rather than read with a stale field left over from the
    // previous record's FoodItem.
    char* fields[9];
    if (splitFields(line, '|', fields, 9) != 9) {
      file.close();
      inventoryCount = 0;
      faults.inventory = true;
      Serial.printf("[Inventory] Record %u is malformed; whole file refused\n",
                    static_cast<unsigned>(record));
      return false;
    }
    FoodItem item;
    memset(&item, 0, sizeof(item));
    uint32_t duration = 0;
    if (!parseUidHex(fields[0], item.uid, &item.uidLength) ||
        !parseUint32(fields[1], MIN_VALID_RTC_EPOCH, UINT32_MAX, &item.storeDateEpoch) ||
        !parseUint32(fields[2], 0, UINT32_MAX, &item.expiryEpoch) ||
        !parseUint32(fields[3], 0, 3650, &duration) ||
        !parseUint32(fields[8], 0, UINT32_MAX, &item.manufactureEpoch)) {
      file.close();
      inventoryCount = 0;
      faults.inventory = true;
      Serial.printf("[Inventory] Record %u has an unparsable field; whole file refused\n",
                    static_cast<unsigned>(record));
      return false;
    }
    item.durationLimitDays = static_cast<uint16_t>(duration);
    copyBounded(item.name, sizeof(item.name), fields[4]);
    copyBounded(item.category, sizeof(item.category), fields[5]);
    copyBounded(item.quantity, sizeof(item.quantity), fields[6]);
    copyBounded(item.location, sizeof(item.location), fields[7]);
    if (!validInventoryRecord(item)) {
      file.close();
      inventoryCount = 0;
      faults.inventory = true;
      return false;
    }
    inventory[inventoryCount++] = item;
    memset(&itemRuntime[inventoryCount - 1], 0, sizeof(itemRuntime[0]));
  }
  file.close();
  // The format is named on SUCCESS as well as on refusal. The refusal line above
  // says what was rejected; this one says what was accepted, which is the
  // evidence that a CLEARINV followed by a registration really did leave a
  // readable version 2 file on flash rather than merely an empty registry in
  // RAM. "Loaded 1 item(s)" alone is also consistent with a file this firmware
  // happened to accept for the wrong reason.
  Serial.printf("[Inventory] Loaded %u item(s) from %s|%u (format %s)\n",
                static_cast<unsigned>(inventoryCount), headerFields[0],
                static_cast<unsigned>(storedCount), INVENTORY_MAGIC);
  // A load replaces the whole registry, so it is a new revision by definition.
  ++inventoryRevision;
  return true;
}

// Mark the registry as changed for the Option B service. Called only after a
// mutation has been persisted, so the revision the service sees always
// corresponds to a list that exists in LittleFS.
static void touchInventory() {
  ++inventoryRevision;
}

static bool saveInventory() {
  if (!storageReady || !inventoryStoreReady) {
    faults.littlefs = true;
    return false;
  }
  File file = LittleFS.open(INVENTORY_PATH, "w");
  if (!file) {
    faults.littlefs = true;
    faults.inventory = true;
    return false;
  }
  bool ok = true;
  char header[40];
  // Always three fields, so a save normalises a registry file that was loaded
  // from the older two-field header. The record lines below are unchanged.
  int length = snprintf(header, sizeof(header), "%s|%u|%lu\n",
                        INVENTORY_MAGIC, static_cast<unsigned>(inventoryCount),
                        static_cast<unsigned long>(lastAppliedCmdSeq));
  ok = length > 0 && static_cast<size_t>(length) < sizeof(header) &&
       file.write(reinterpret_cast<const uint8_t*>(header), length) == static_cast<size_t>(length);

  for (uint8_t index = 0; ok && index < inventoryCount; ++index) {
    const FoodItem& item = inventory[index];
    char uid[24];
    formatUid(item.uid, item.uidLength, uid, sizeof(uid));
    char line[256];
    // manufacture_epoch is written LAST, after every field version 1 already
    // wrote, in the same order. That is what keeps the first eight fields at
    // the offsets the previous layout used. A version 1 file is not made
    // readable by this ordering - it is refused by the header check in
    // loadInventory(), which is the only thing standing between an old record
    // and a value read out of the middle of the next line.
    length = snprintf(line, sizeof(line), "%s|%lu|%lu|%u|%s|%s|%s|%s|%lu\n",
                      uid,
                      static_cast<unsigned long>(item.storeDateEpoch),
                      static_cast<unsigned long>(item.expiryEpoch),
                      static_cast<unsigned>(item.durationLimitDays),
                      item.name, item.category, item.quantity, item.location,
                      static_cast<unsigned long>(item.manufactureEpoch));
    ok = length > 0 && static_cast<size_t>(length) < sizeof(line) &&
         file.write(reinterpret_cast<const uint8_t*>(line), length) == static_cast<size_t>(length);
  }
  file.close();
  if (!ok) {
    faults.littlefs = true;
    faults.inventory = true;
    Serial.println(F("[Inventory] Save failed"));
  } else {
    faults.inventory = false;
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Operator-confirmed registry erase
// ---------------------------------------------------------------------------
// WHY THIS IS ASYMMETRIC WITH loadInventory(), AND WHY THAT IS CORRECT
//
// loadInventory() refuses an unrecognised on-disk format and leaves the file
// alone. That refusal is right and must not be relaxed: a version 1 record
// read with version 2 rules takes the FIRST TOKEN OF THE NEXT LINE as its
// manufacture epoch, and that parses as a number often enough to pass
// validation. Reading it would be this firmware guessing at another firmware's
// file and then reporting the guess as food metadata.
//
// This function is the other operation, and the difference is not a technicality:
//
//   loadInventory()          an UNAUTOMATED, UNAUTHORISED inference. Nobody
//                            asked for it, nothing on the wire requested it, and
//                            the only way to make the guess is to read bytes
//                            whose meaning this firmware does not know.
//   clearInventoryRegistry() an EXPLICIT, CONFIRMED operator decision to discard
//                            data. Someone typed a confirmation token, or an
//                            authenticated producer sent one, precisely because
//                            they accept the loss.
//
// Refusing to interpret a file is a safety rule. Honouring a deliberate
// instruction to destroy one is a contract. Applying the first to the second
// would leave a device permanently stuck with an empty, faulted registry and no
// way out except reflashing it - which is what a refusal that cannot be lifted
// actually amounts to in the field.
//
// The confirmation is mandatory on BOTH entry points. This is the one function
// in the file with no undo, and it is reachable over a network topic.
static bool clearInventoryRegistry(const char* origin) {
  if (!storageReady || !inventoryStoreReady) {
    Serial.printf("[Inventory] CLEAR refused from %s: LittleFS is unavailable;"
                  " nothing deleted\n", origin);
    return false;
  }

  const uint8_t discarded = inventoryCount;
  const bool existed = LittleFS.exists(INVENTORY_PATH);
  LittleFS.remove(INVENTORY_PATH);
  // remove() returning is not evidence that anything happened. The
  // authoritative check is whether the object is still on flash, because the
  // entire purpose of this command is that the NEXT registration writes a fresh
  // FG2 header - and it cannot do that while a file this firmware will refuse to
  // read is still sitting in the way. Verifying here turns a silent no-op into
  // an explicit failure, instead of leaving the device to rediscover the
  // problem on the next save.
  if (LittleFS.exists(INVENTORY_PATH)) {
    Serial.printf("[Inventory] CLEAR failed from %s: %s is still present;"
                  " registry left intact\n", origin, INVENTORY_PATH);
    faults.littlefs = true;
    return false;
  }

  inventoryCount = 0;
  // Per-item runtime goes with it. The use-soon / check-food latches are
  // positional and index the same array, so leaving them would let a future
  // item at index 0 inherit a latch raised by a different item that used to
  // live there.
  memset(itemRuntime, 0, sizeof(itemRuntime));
  // The records themselves are wiped too, not just the count. inventoryCount
  // is the only thing that makes them visible, but zeroing the array means a
  // future count bug cannot resurrect a record an operator was told was gone.
  memset(inventory, 0, sizeof(inventory));
  latestScannedItem = -1;
  // The fault this command exists to clear. saveInventory() also clears it on
  // the next successful write, but doing it here means the storage fault can
  // recover on this pass rather than waiting for the next registration - which
  // might be days away, or never.
  faults.inventory = false;
  // A new registry is a new revision by definition, and the snapshot is pushed
  // rather than left for the heartbeat: until the backend sees inv_revision
  // move with an empty items[] it will keep showing items this device no longer
  // has. serviceFaultTransitionAlert() prints the recovery on the same pass
  // from the same announced-mask bookkeeping it uses for every other fault.
  touchInventory();
  requestBackendPost();
  Serial.printf("[Inventory] CLEARED from %s: %s %s, %u item(s) discarded,"
                " inventoryCount=0, per-item runtime cleared, faults.inventory"
                " cleared (rev %lu)\n",
                origin, INVENTORY_PATH, existed ? "deleted" : "was not present",
                static_cast<unsigned>(discarded),
                static_cast<unsigned long>(inventoryRevision));
  return true;
}

// The one registration path. Both the serial REG command and the MQTT
// item.register command adapt their input into this field order and call it
// here, so there is a single set of rules about what a valid item is. A second
// parser would be a second opinion, and the two would drift the first time one
// of them gained a check.
//
//   fields[0] uid (hex)          fields[4] location
//   fields[1] name               fields[5] duration_days   0 = unset
//   fields[2] category           fields[6] expiry_epoch     0 = use duration
//   fields[3] quantity           fields[7] manufacture_epoch 0 = unknown
//
// fieldCount is 7 or 8. It is a parameter rather than assumed, because the
// serial path hands over a 7-element array: reading fields[7] from it would be
// a read past the end of a live stack frame to pick up a pointer as if it were
// a string.
static constexpr uint8_t FOOD_RECORD_MIN_FIELDS = 7;
static constexpr uint8_t FOOD_RECORD_MAX_FIELDS = 8;

static bool registerFoodRecord(char** fields, uint8_t fieldCount) {
  // The authority's clock, not the raw DS3231 reading. store_date_epoch has to
  // come from the same clock the snapshot reports, or the device judges its own
  // items against a different "now" than it publishes - and every item's elapsed
  // time is then silently 5 hours long while `epoch` in the payload looks
  // perfectly correct. A registration is also no longer refused just because the
  // DS3231 is dead: the server-corrected clock is a real time reference and is
  // the better one to stamp with.
  TimeSource storeDateSource = TimeSource::None;
  const uint32_t nowEpoch = currentAuthorityEpoch(millis(), &storeDateSource);
  if (!fields || fieldCount < FOOD_RECORD_MIN_FIELDS || nowEpoch == 0) {
    Serial.println(F("[Inventory] A usable clock is required (RTC, server-synced"
                     " or rtc-offset)"));
    return false;
  }

  char name[24], category[16], quantity[12], location[24];
  sanitizeField(name, sizeof(name), fields[1]);
  sanitizeField(category, sizeof(category), fields[2]);
  sanitizeField(quantity, sizeof(quantity), fields[3]);
  sanitizeField(location, sizeof(location), fields[4]);
  if (name[0] == '\0') {
    Serial.println(F("[Inventory] Name is required"));
    return false;
  }
  if (category[0] == '\0') copyBounded(category, sizeof(category), "Other");
  if (quantity[0] == '\0') copyBounded(quantity, sizeof(quantity), "1");
  if (location[0] == '\0') copyBounded(location, sizeof(location), "Storage zone");

  uint8_t uid[10];
  uint8_t uidLength = 0;
  uint32_t duration = 0;
  uint32_t expiry = 0;
  // Absent or empty is not the same as 0 here. 0 is a real, requested value -
  // "no absolute expiry", "manufacture date unknown" - and both are stored as
  // 0. An unreadable value is neither, and is refused rather than collapsed
  // into 0, because 0 is a decision the caller made deliberately.
  uint32_t manufacture = 0;
  if (!parseUidHex(fields[0], uid, &uidLength) ||
      !parseUint32(fields[5], 0, 3650, &duration) ||
      !parseUint32(fields[6], 0, UINT32_MAX, &expiry) ||
      (fieldCount >= FOOD_RECORD_MAX_FIELDS && fields[7] != nullptr &&
       fields[7][0] != '\0' && !parseUint32(fields[7], 0, UINT32_MAX, &manufacture)) ||
      (duration == 0 && expiry == 0) ||
      (expiry != 0 && expiry < nowEpoch)) {
    Serial.println(F("[Inventory] Invalid UID, duration, expiry or manufacture date"));
    return false;
  }

  int8_t existing = findInventoryByUid(uid, uidLength);
  bool isNew = existing < 0;
  if (isNew && inventoryCount >= MAX_INVENTORY_ITEMS) {
    Serial.printf("[Inventory] Full (%u); remove an item first\n",
                  static_cast<unsigned>(MAX_INVENTORY_ITEMS));
    return false;
  }
  if (isNew) existing = static_cast<int8_t>(inventoryCount++);

  FoodItem previous = inventory[existing];
  FoodItem updated;
  memset(&updated, 0, sizeof(updated));
  memcpy(updated.uid, uid, uidLength);
  updated.uidLength = uidLength;
  copyBounded(updated.name, sizeof(updated.name), name);
  copyBounded(updated.category, sizeof(updated.category), category);
  copyBounded(updated.quantity, sizeof(updated.quantity), quantity);
  copyBounded(updated.location, sizeof(updated.location), location);
  updated.durationLimitDays = static_cast<uint16_t>(duration);
  updated.expiryEpoch = expiry;
  // The stored date stays the device's own: taken from the authority's clock on
  // first registration and preserved on every later update, so re-registering an
  // existing UID never buys an item extra time. No field of this record, and no
  // field of any command, can write it. `storeDateSource` is logged below so the
  // stamp is traceable to the clock that produced it.
  updated.storeDateEpoch = isNew ? nowEpoch : previous.storeDateEpoch;
  updated.manufactureEpoch = manufacture;
  inventory[existing] = updated;
  if (isNew) memset(&itemRuntime[existing], 0, sizeof(itemRuntime[0]));

  if (!saveInventory()) {
    inventory[existing] = previous;
    if (isNew) --inventoryCount;
    return false;
  }

  char uidText[24];
  formatUid(updated.uid, updated.uidLength, uidText, sizeof(uidText));
  Serial.printf("[Inventory] %s %s \"%s\" %s %s | %s | stored day %lu | %s | mfg %s\n",
                isNew ? "Registered" : "Updated", uidText, updated.name, updated.quantity,
                updated.category, updated.location,
                static_cast<unsigned long>(updated.storeDateEpoch),
                updated.expiryEpoch != 0 ? "absolute expiry" : "duration from store date",
                updated.manufactureEpoch != 0
                    ? "supplied" : "unknown");
  if (isNew) {
    // Which clock stamped the stored date. Without it, a store date that looks
    // five hours off has no way to be explained from the log.
    Serial.printf("[Inventory] stored day stamped by time_source '%s'\n",
                  timeSourceName(storeDateSource));
  }
  touchInventory();
  return true;
}

// ---------------------------------------------------------------------------
// Decoding one inbound command payload
// ---------------------------------------------------------------------------
// Everything below exists to turn a JSON command into the field array
// registerFoodRecord() already accepts, and to do nothing else. There is no
// second copy of the registration rules here: the adapter's whole job is to
// hand over text in the same order the serial REG command produces, and let the
// one validator judge it.
//
// The two decisions that are genuinely the adapter's own, because they are
// about the wire rather than about food:
//
//   1. Absent is not zero. A key the producer left out falls back to the
//      documented default - no absolute expiry, unknown manufacture date, which
//      is what 0 means for those two keys. That is different from a key that is
//      present and unreadable: "duration_days":"seven" is a producer bug, and
//      defaulting it would register the item with no shelf life at all and look
//      like success. So the three states are kept apart and only the first one
//      gets a default.
//
//   2. A value that does not fit is refused, not truncated. A UID cut short is a
//      different item, and a name cut short misreports what was registered.

// Tri-state results for one field. Plain uint8_t rather than an enum on
// purpose: the Arduino build hoists generated prototypes above the type
// definitions (see the placement note near PCF_PIN_ACTIVE_HIGH), and a
// prototype naming a type declared below it does not compile.
static constexpr uint8_t JSON_FIELD_ABSENT = 0;  // key not in the document
static constexpr uint8_t JSON_FIELD_OK = 1;      // key present, value usable
static constexpr uint8_t JSON_FIELD_BAD = 2;     // key present, value unusable

// Scratch for a single decoded command. Static rather than automatic: the
// broker callback runs on the loop task, and registerFoodRecord() is already
// holding a couple of hundred bytes of FoodItem locals, so another 150-byte
// frame on top of it is stack depth spent for nothing. One command is decoded
// at a time and used immediately, so a shared buffer is safe.
struct ItemCommandFields {
  char op[20];
  char uid[24];
  char name[24];
  char category[16];
  char quantity[12];
  char location[24];
  char durationDays[8];
  char expiryEpoch[12];
  char manufactureEpoch[12];
  // The confirmation token for item.clear. Sized so that "YES" fits with room
  // to spare and anything longer is refused as JSON_FIELD_BAD by jsonReadString
  // rather than silently truncated into a valid-looking token.
  char confirm[8];
};
static ItemCommandFields commandFields;

// Find "key": and return the first character of its value, or nullptr if the
// key is not in the document. The pattern includes both quotes and the colon,
// so a longer key that merely begins with the same characters cannot match -
// "op" must not be found inside "operation".
static const char* jsonLocateKey(const char* json, const char* key) {
  if (!json || !key) return nullptr;
  char pattern[24];
  const int written = snprintf(pattern, sizeof(pattern), "\"%s\":", key);
  if (written < 0 || static_cast<size_t>(written) >= sizeof(pattern)) return nullptr;
  const char* at = strstr(json, pattern);
  if (!at) return nullptr;
  at += written;
  while (*at == ' ' || *at == '\t' || *at == '\n' || *at == '\r') ++at;
  return at;
}

/**
 * Read a whole-number JSON value exactly.
 *
 * Deliberately not jsonFindNumber(): that returns a float, and a float carries a
 * 24-bit mantissa, so 1774000000 comes back as 1773999872. Two minutes of error
 * on a date field is invisible in a snapshot and wrong in the stored record, and
 * strtoul would quietly saturate an overflowing value to UINT32_MAX rather than
 * report it. The digits are accumulated directly, so overflow, a leading '-',
 * a fraction and a trailing exponent are all refusable rather than rounded.
 */
static uint8_t jsonReadUint32(const char* json, const char* key, uint32_t* out) {
  const char* at = jsonLocateKey(json, key);
  if (at == nullptr) return JSON_FIELD_ABSENT;
  if (out == nullptr) return JSON_FIELD_BAD;
  uint64_t value = 0;
  uint8_t digits = 0;
  while (*at >= '0' && *at <= '9') {
    value = (value * 10ULL) + static_cast<uint64_t>(*at - '0');
    if (value > UINT32_MAX) return JSON_FIELD_BAD;
    ++digits;
    ++at;
  }
  if (digits == 0) return JSON_FIELD_BAD;
  // The value has to end here. Anything else means this was not the number the
  // key named: 7.5, 7e3, or a string that happened to start with a digit.
  if (*at != '\0' && *at != ' ' && *at != ',' && *at != '}' && *at != ']') {
    return JSON_FIELD_BAD;
  }
  *out = static_cast<uint32_t>(value);
  return JSON_FIELD_OK;
}

// Read a JSON string value, decoding the escapes JSON.stringify() emits.
// Returns JSON_FIELD_BAD for a value that is not a string, is not terminated,
// carries an unknown escape, or does not fit the destination.
static uint8_t jsonReadString(const char* json, const char* key,
                              char* destination, size_t capacity) {
  if (destination == nullptr || capacity == 0) return JSON_FIELD_BAD;
  destination[0] = '\0';
  const char* at = jsonLocateKey(json, key);
  if (at == nullptr) return JSON_FIELD_ABSENT;
  if (*at != '"') return JSON_FIELD_BAD;
  ++at;
  size_t used = 0;
  while (*at != '\0' && *at != '"') {
    char value = *at++;
    if (value == '\\') {
      const char escape = *at;
      if (escape == '\0') return JSON_FIELD_BAD;
      ++at;
      switch (escape) {
        case '"':  value = '"';  break;
        case '\\': value = '\\'; break;
        case '/':  value = '/';  break;
        case 'n':  value = '\n'; break;
        case 'r':  value = '\r'; break;
        case 't':  value = '\t'; break;
        case 'b':  value = '\b'; break;
        case 'f':  value = '\f'; break;
        case 'u': {
          // ASCII escapes are honoured, because JSON.stringify() emits them for
          // ordinary characters such as an apostrophe. A code point above the
          // printable ASCII range has no faithful representation in a
          // fixed-size field that is also written to a '|' delimited file, so it
          // degrades to a space rather than to mojibake. Either way the value
          // is stored, not silently dropped.
          uint16_t code = 0;
          for (uint8_t digit = 0; digit < 4; ++digit) {
            const uint8_t nibble = hexNibble(*at);
            if (nibble == 0xFF) return JSON_FIELD_BAD;
            code = static_cast<uint16_t>((code << 4) | nibble);
            ++at;
          }
          value = (code >= 0x20 && code <= 0x7E) ? static_cast<char>(code) : ' ';
          break;
        }
        default: return JSON_FIELD_BAD;
      }
    }
    if (used + 1 >= capacity) return JSON_FIELD_BAD;
    destination[used++] = value;
  }
  if (*at != '"') return JSON_FIELD_BAD;
  destination[used] = '\0';
  return JSON_FIELD_OK;
}

// Copy an optional integer into a decimal text field, because
// registerFoodRecord() takes the same decimal text the serial command types.
// Rendering it back to text rather than filling a FoodItem directly is the
// point of this function: the shared validator sees identical input on both
// paths, so it cannot pass on one and fail on the other.
//
// Absent becomes "0" - the documented meaning for both optional keys here. A
// present-but-unreadable value is passed back as JSON_FIELD_BAD and the caller
// refuses the whole command.
static uint8_t readUintField(const char* json, const char* key,
                             char* text, size_t capacity) {
  uint32_t value = 0;
  const uint8_t state = jsonReadUint32(json, key, &value);
  if (state == JSON_FIELD_ABSENT) {
    copyBounded(text, capacity, "0");
    return JSON_FIELD_ABSENT;
  }
  if (state == JSON_FIELD_OK) {
    snprintf(text, capacity, "%lu", static_cast<unsigned long>(value));
  }
  return state;
}

// item.clear: the network twin of CLEARINV YES.
//
// Same contract as item.register, deliberately:
//   - reached only through handleItemCommand(), so the op has already been
//     read, checked for presence, checked for being a string, and matched by
//     exact strcmp. An op this firmware does not implement still cannot get here.
//   - `confirm` uses the identical tri-state jsonReadString() rules. ABSENT is
//     NOT treated as consent. It is a refusal, because the difference between
//     "nobody confirmed" and "somebody confirmed wrongly" is exactly the
//     difference between keeping the records and losing them.
//   - The whole document is discarded on any unusable field, so a malformed
//     command cannot half-apply.
//   - There is no separate acknowledgement. The reply is the next snapshot,
//     which now carries an empty items[] and a moved inv_revision.
//
// The token is compared with strcmp against "YES" and nothing else - not
// case-insensitively, not by prefix, not by "any non-empty value". It is the
// only thing standing between a stray or replayed message and an empty
// registry, so it is matched exactly.
// Returns true only if the registry was actually mutated. A rejected command
// must NOT advance lastAppliedCmdSeq: marking an unapplied command as applied
// would let the real, corrected command be discarded as a replay.
static bool handleItemClearCommand(const char* json) {
  const uint8_t state = jsonReadString(json, "confirm", commandFields.confirm,
                                       sizeof(commandFields.confirm));
  if (state != JSON_FIELD_OK) {
    Serial.printf("[MQTT] item.clear rejected: 'confirm' must be the string"
                  " \"YES\" (%s)\n",
                  state == JSON_FIELD_ABSENT ? "key absent" : "unusable value");
    return false;
  }
  if (strcmp(commandFields.confirm, "YES") != 0) {
    Serial.printf("[MQTT] item.clear rejected: confirm is '%s', not \"YES\";"
                  " registry unchanged\n", commandFields.confirm);
    return false;
  }
  if (!clearInventoryRegistry("mqtt")) {
    Serial.println(F("[MQTT] item.clear failed; registry unchanged"));
    return false;
  }
  Serial.println(F("[MQTT] item.clear accepted; it appears in the next"
                   " snapshot's empty items[]"));
  requestBackendPost();
  return true;
}

// The single entry point for every document arriving on freshguard/<dev>/cmd.
//
// One function reads and validates `op` and then dispatches, rather than each
// op handler re-reading it. That matters: op validation is the only thing
// standing between this shared topic and a structure with no undo, and a
// second reader is a second opportunity to get the "unsupported op is
// discarded, not guessed at" rule wrong.
static bool handleItemCommand(const char* json) {
  const uint8_t opState = jsonReadString(json, "op", commandFields.op,
                                         sizeof(commandFields.op));
  if (opState == JSON_FIELD_ABSENT) {
    Serial.println(F("[MQTT] cmd rejected: no op field"));
    return false;
  }
  if (opState != JSON_FIELD_OK) {
    Serial.println(F("[MQTT] cmd rejected: op is not a usable string"));
    return false;
  }
  if (strcmp(commandFields.op, "item.register") == 0) {
    return handleItemRegisterCommand(json);
  }
  if (strcmp(commandFields.op, "item.clear") == 0) {
    return handleItemClearCommand(json);
  }
  // Discarded, not guessed at. This topic is shared with every future
  // command, and the item table is the one structure here with no undo, so an
  // op this firmware does not implement must not reach it - not even by
  // accident of field order.
  Serial.printf("[MQTT] cmd ignored: unsupported op '%s'\n", commandFields.op);
  return false;
}

static bool handleItemRegisterCommand(const char* json) {
  struct TextField { const char* key; char* value; size_t capacity; };
  const TextField textFields[] = {
    {"uid",      commandFields.uid,      sizeof(commandFields.uid)},
    {"name",     commandFields.name,     sizeof(commandFields.name)},
    {"category", commandFields.category, sizeof(commandFields.category)},
    {"quantity", commandFields.quantity, sizeof(commandFields.quantity)},
    {"location", commandFields.location, sizeof(commandFields.location)},
  };
  for (uint8_t index = 0; index < sizeof(textFields) / sizeof(textFields[0]); ++index) {
    const uint8_t state = jsonReadString(json, textFields[index].key,
                                         textFields[index].value, textFields[index].capacity);
    if (state == JSON_FIELD_BAD) {
      Serial.printf("[MQTT] item.register rejected: '%s' is not a usable string\n",
                    textFields[index].key);
      return false;
    }
    // Absent leaves the field empty, which is the same starting point as an
    // empty string in the serial command. What happens next is decided by
    // registerFoodRecord(): a missing name is refused, and a missing category,
    // quantity or location picks up the default it already applies.
  }

  struct NumberField { const char* key; char* text; size_t capacity; };
  const NumberField numberFields[] = {
    {"duration_days",    commandFields.durationDays,    sizeof(commandFields.durationDays)},
    {"expiry_epoch",     commandFields.expiryEpoch,     sizeof(commandFields.expiryEpoch)},
    {"manufacture_epoch", commandFields.manufactureEpoch, sizeof(commandFields.manufactureEpoch)},
  };
  for (uint8_t index = 0; index < sizeof(numberFields) / sizeof(numberFields[0]); ++index) {
    const uint8_t state = readUintField(json, numberFields[index].key,
                                        numberFields[index].text, numberFields[index].capacity);
    if (state == JSON_FIELD_BAD) {
      Serial.printf("[MQTT] item.register rejected: '%s' is not a whole number\n",
                    numberFields[index].key);
      return false;
    }
  }

  char* fields[FOOD_RECORD_MAX_FIELDS] = {
    commandFields.uid, commandFields.name, commandFields.category,
    commandFields.quantity, commandFields.location,
    commandFields.durationDays, commandFields.expiryEpoch,
    commandFields.manufactureEpoch,
  };
  if (!registerFoodRecord(fields, FOOD_RECORD_MAX_FIELDS)) {
    // The specific reason is already on the line above, printed by
    // registerFoodRecord() from the same check the serial command uses.
    Serial.println(F("[MQTT] item.register rejected; registry unchanged"));
    return false;
  }

  Serial.printf("[MQTT] item.register accepted for %s; it appears in the next"
                " snapshot's items[]\n", commandFields.uid);
  // No separate acknowledgement is sent. The reply is the snapshot, and this
  // only asks for it sooner than the heartbeat would. backendPostDue() still
  // applies BACKEND_MIN_POST_GAP_MS, so a burst of registrations cannot become
  // a request flood.
  requestBackendPost();
  return true;
}

static bool removeFoodRecord(const char* uidText) {
  uint8_t uid[10];
  uint8_t uidLength = 0;
  if (!parseUidHex(uidText, uid, &uidLength)) return false;
  int8_t index = findInventoryByUid(uid, uidLength);
  if (index < 0) return false;

  FoodItem removed = inventory[index];
  ItemRuntime removedRuntime = itemRuntime[index];
  size_t remaining = inventoryCount - static_cast<uint8_t>(index) - 1;
  if (remaining > 0) {
    memmove(&inventory[index], &inventory[index + 1], remaining * sizeof(FoodItem));
    memmove(&itemRuntime[index], &itemRuntime[index + 1], remaining * sizeof(ItemRuntime));
  }
  --inventoryCount;

  if (!saveInventory()) {
    ++inventoryCount;
    memmove(&inventory[index + 1], &inventory[index], remaining * sizeof(FoodItem));
    memmove(&itemRuntime[index + 1], &itemRuntime[index], remaining * sizeof(ItemRuntime));
    inventory[index] = removed;
    itemRuntime[index] = removedRuntime;
    return false;
  }

  if (latestScannedItem == index) latestScannedItem = -1;
  else if (latestScannedItem > index) --latestScannedItem;
  touchInventory();
  return true;
}

static FreshnessStatus analyseItemDuration(const FoodItem& item, uint32_t nowEpoch) {
  if (nowEpoch == 0 || item.storeDateEpoch == 0 || item.storeDateEpoch < MIN_VALID_RTC_EPOCH) {
    return FreshnessStatus::SensorFault;
  }
  if (nowEpoch < item.storeDateEpoch) return FreshnessStatus::CheckFood;

  uint64_t totalSeconds = 0;
  uint64_t deadline = 0;
  if (item.expiryEpoch != 0) {
    totalSeconds = static_cast<uint64_t>(item.expiryEpoch) - item.storeDateEpoch;
    deadline = item.expiryEpoch;
  } else {
    totalSeconds = static_cast<uint64_t>(item.durationLimitDays) * 86400ULL;
    deadline = static_cast<uint64_t>(item.storeDateEpoch) + totalSeconds;
  }
  if (totalSeconds == 0) return FreshnessStatus::SensorFault;
  if (nowEpoch >= deadline) return FreshnessStatus::CheckFood;

  uint64_t elapsedSeconds = static_cast<uint64_t>(nowEpoch) - item.storeDateEpoch;
  uint64_t useSoonPoint = (totalSeconds * limitUseSoonPct()) / 100ULL;
  return elapsedSeconds >= useSoonPoint ? FreshnessStatus::UseSoon : FreshnessStatus::Fresh;
}

static void listInventory() {
  Serial.printf("[Inventory] %u/%u active item(s)\n",
                static_cast<unsigned>(inventoryCount),
                static_cast<unsigned>(MAX_INVENTORY_ITEMS));
  uint32_t now = currentAuthorityEpoch(millis());
  for (uint8_t index = 0; index < inventoryCount; ++index) {
    char uid[24];
    formatUid(inventory[index].uid, inventory[index].uidLength, uid, sizeof(uid));
    uint32_t days = (now >= inventory[index].storeDateEpoch)
                      ? (now - inventory[index].storeDateEpoch) / 86400UL : 0;
    Serial.printf("  %u: %s | %s | %s %s | %s | stored %lu d | %s\n",
                  static_cast<unsigned>(index), uid, inventory[index].name, inventory[index].quantity,
                  inventory[index].category, inventory[index].location,
                  static_cast<unsigned long>(days),
                  freshnessStatusText(analyseItemDuration(inventory[index], now)));
  }
}

// ============================================================================
// Fault masks, freshness analysis and local/remote alert handling
// ============================================================================

static uint16_t currentStorageFaultMask() {
  uint16_t mask = 0;
  if (faults.littlefs) mask |= STORAGE_FAULT_LITTLEFS;
  if (faults.inventory) mask |= STORAGE_FAULT_INVENTORY;
  if (faults.alertQueue) mask |= STORAGE_FAULT_ALERT_QUEUE;
  if (faults.configuration) mask |= STORAGE_FAULT_CONFIGURATION;
  return mask;
}

// ---------------------------------------------------------------------------
// Not-ready versus faulted.
//
// A sensor that has never produced a valid reading is not broken - it is
// unproven. Raising "Sensor Fault/Data Unavailable" for it on every power-up is
// not how a production device behaves: a cold start pages the operator for a
// fault that resolves itself, and once alerts fire on every boot nobody trusts
// them.
//
// The distinction this tracks:
//   never ready      -> reported on the console as progress, no remote alert
//   ready, then lost -> a real fault, and it does raise an alert
//
// A sensor that stays unproven past SENSOR_READY_GRACE_MS is still surfaced, but
// as an explicit commissioning condition rather than a fault of a working
// device, so a permanently missing part cannot hide.
// ---------------------------------------------------------------------------
static uint16_t sensorEverReadyMask = 0;
static uint32_t firstSensorSeenMs = 0;

static constexpr uint32_t SENSOR_READY_GRACE_MS = 300000UL;  // 5 minutes

static void markSensorReady(uint16_t bit) {
  if ((sensorEverReadyMask & bit) == 0) {
    sensorEverReadyMask = static_cast<uint16_t>(sensorEverReadyMask | bit);
    Serial.printf("[Ready] Sensor 0x%04X produced valid data for the first time\n",
                  static_cast<unsigned>(bit));
  }
}

static uint16_t currentSensorFaultMask() {
  uint16_t mask = 0;
  if (faults.bme280) mask |= SENSOR_FAULT_BME280;
  if (faults.bme280Humidity) mask |= SENSOR_FAULT_BME280_HUMIDITY;
  if (faults.ads1115) mask |= SENSOR_FAULT_ADS1115;
  if (faults.mq135) mask |= SENSOR_FAULT_MQ135;
  if (faults.ds3231) mask |= SENSOR_FAULT_DS3231;
  if (faults.pcf8574Read) mask |= SENSOR_FAULT_PCF8574_READ;
  if (faults.pcf8574Write) mask |= SENSOR_FAULT_PCF8574_WRITE;
  if (faults.reed) mask |= SENSOR_FAULT_REED;
  return mask;
}

// The mask used to raise remote alerts: faults on sensors that have already
// proven themselves, plus anything that has been unproven past the grace period.
static uint16_t alertableSensorFaultMask(uint32_t nowMs) {
  const uint16_t all = currentSensorFaultMask();
  if (firstSensorSeenMs == 0) firstSensorSeenMs = nowMs;
  if (static_cast<uint32_t>(nowMs - firstSensorSeenMs) < SENSOR_READY_GRACE_MS) {
    return static_cast<uint16_t>(all & sensorEverReadyMask);
  }
  return all;
}

// Availability drives the freshness verdict and the LEDs, so it must use the
// same readiness rule as the alerts. Using the raw mask here was the reason a
// healthy unit showed a red "sensor unavailable" LED for the whole MQ-135 warm-up
// and baseline capture on every power-up: a sensor that had simply not produced
// data yet was reported as broken. A sensor that was proven and then stopped
// still returns SensorFault immediately.
static uint16_t currentSensorUnavailableMask(uint32_t nowMs) {
  uint16_t mask = alertableSensorFaultMask(nowMs);
  if (!bmeDataReady) mask |= SENSOR_FAULT_BME280;
  if (!humidityReady) mask |= SENSOR_FAULT_BME280_HUMIDITY;
  if (!adsReady) mask |= SENSOR_FAULT_ADS1115;
  if (!ds3231TimeReady || currentRtcEpoch() == 0) mask |= SENSOR_FAULT_DS3231;
  if (!pcfInitialized || !pcfReadReady) {
    mask |= SENSOR_FAULT_PCF8574_READ | SENSOR_FAULT_REED;
  }
  // The MQ-135 warms up for three minutes and then settles before it can hold a
  // baseline. Those are KNOWN states, not broken ones: the firmware is watching
  // the sensor do precisely what a cold MQ-135 is supposed to do, so neither
  // phase can be a fault no matter how long it takes. A 5-minute grace window
  // was the wrong instrument - it expired while the sensor was still legitimately
  // warming, which turned a healthy unit's LED red for being slow.
  //
  // Only a regression after the sensor has proven itself is a fault, and that
  // falls out of alertableSensorFaultMask above. A baseline that never captures
  // is reported through gas_state in the snapshot, where commissioning can see
  // it without the device crying wolf.
  if (mqState != MqState::Ready &&
      (sensorEverReadyMask & SENSOR_FAULT_MQ135) != 0) {
    mask |= SENSOR_FAULT_MQ135;
  }
  return mask;
}

static uint16_t currentAllFaultMask() {
  uint16_t mask = currentSensorFaultMask() | currentStorageFaultMask();
  if (faults.rc522) mask |= OPTIONAL_FAULT_RC522;
  if (faults.lcd) mask |= OPTIONAL_FAULT_LCD;
  return mask;
}

static void appendFaultName(char* output, size_t capacity, const char* name) {
  size_t used = strlen(output);
  if (used >= capacity - 1) return;
  int written = snprintf(output + used, capacity - used, "%s%s", used ? ", " : "", name);
  (void)written;
}

static void describeFaultMask(uint16_t mask, char* output, size_t capacity) {
  if (!output || capacity == 0) return;
  output[0] = '\0';
  if (mask & SENSOR_FAULT_BME280) appendFaultName(output, capacity, "BME280");
  if (mask & SENSOR_FAULT_BME280_HUMIDITY) appendFaultName(output, capacity, "BME280 humidity");
  if (mask & SENSOR_FAULT_ADS1115) appendFaultName(output, capacity, "ADS1115");
  if (mask & SENSOR_FAULT_MQ135) appendFaultName(output, capacity, "MQ135 reading");
  if (mask & SENSOR_FAULT_DS3231) appendFaultName(output, capacity, "DS3231/time");
  if (mask & SENSOR_FAULT_PCF8574_READ) appendFaultName(output, capacity, "PCF8574 read");
  if (mask & SENSOR_FAULT_PCF8574_WRITE) appendFaultName(output, capacity, "PCF8574 write");
  if (mask & SENSOR_FAULT_REED) appendFaultName(output, capacity, "reed input");
  if (mask & STORAGE_FAULT_LITTLEFS) appendFaultName(output, capacity, "LittleFS");
  if (mask & STORAGE_FAULT_INVENTORY) appendFaultName(output, capacity, "inventory");
  if (mask & STORAGE_FAULT_ALERT_QUEUE) appendFaultName(output, capacity, "alert queue full");
  if (mask & STORAGE_FAULT_CONFIGURATION) appendFaultName(output, capacity, "configuration");
  // There is deliberately no "DS3231 backup battery" entry here any more. It was
  // driven by a fabricated decode of 0x0F bit 3, which is EN32kHz and not a
  // battery flag; the DS3231 has no battery-low bit. There is nothing real to
  // name, and naming a part the operator cannot replace on this evidence is
  // worse than staying silent.
  if (mask & OPTIONAL_FAULT_RC522) appendFaultName(output, capacity, "RC522 optional");
  if (mask & OPTIONAL_FAULT_LCD) appendFaultName(output, capacity, "LCD optional");
  if (output[0] == '\0') copyBounded(output, capacity, "none");
}

static void resetEnvironmentalLatches() {
  temperatureHighLatch = {};
  temperatureLowLatch = {};
  humidityHighLatch = {};
  humidityLowLatch = {};
  gasHighLatch = {};
}

static bool updateConfirmedLatch(ConfirmedLatch* latch, bool violated, bool recovered,
                                 uint32_t nowMs) {
  if (!latch) return false;
  if (latch->active) {
    if (recovered && static_cast<uint32_t>(nowMs - latch->lastRaisedMs) >= ALERT_REARM_MS) {
      latch->active = false;
      latch->consecutive = 0;
    }
    return false;
  }
  if (!violated) {
    latch->consecutive = 0;
    return false;
  }
  if (latch->consecutive < 255) ++latch->consecutive;
  if (latch->consecutive < THRESHOLD_CONSECUTIVE_SAMPLES) return false;
  latch->active = true;
  latch->consecutive = 0;
  latch->lastRaisedMs = nowMs;
  return true;
}

static FreshnessStatus calculateZoneStatus() {
  if (currentSensorUnavailableMask(millis()) != 0) return FreshnessStatus::SensorFault;
  if (temperatureHighLatch.active || temperatureLowLatch.active ||
      humidityHighLatch.active || humidityLowLatch.active || gasHighLatch.active) {
    return FreshnessStatus::CheckFood;
  }
  return FreshnessStatus::Fresh;
}

static FreshnessStatus calculateOverallStatus() {
  FreshnessStatus overall = zoneStatus;
  // The authority's clock, so the LED agrees with the verdict the dashboard
  // shows for the same item. Reading the raw DS3231 here while the snapshot
  // reports a server-corrected epoch is how the cabinet and the item layer end
  // up describing the same item two different ways.
  uint32_t now = currentAuthorityEpoch(millis());
  for (uint8_t index = 0; index < inventoryCount; ++index) {
    overall = worstStatus(overall, analyseItemDuration(inventory[index], now));
  }
  return overall;
}

static void refreshFreshnessStatus() {
  zoneStatus = calculateZoneStatus();
}

static void finishBuzzerSequence() {
  // Terminal state invariant: OFF is attempted, remainingBeeps is zero, and no
  // deadline remains that could schedule another ON transition.
  pcfSetOutputActive(PCF_PIN_BUZZER, false);
  buzzerState = BuzzerState::Idle;
  buzzerRemainingBeeps = 0;
  buzzerNextTransitionMs = 0;
}

static void scheduleBuzzer(uint8_t times, uint16_t onMs, uint16_t offMs) {
  finishBuzzerSequence();
  if (!pcfInitialized || faults.pcf8574Write || times == 0) return;
  if (!pcfSetOutputActive(PCF_PIN_BUZZER, true)) return;
  buzzerOnMs = onMs;
  buzzerOffMs = offMs;
  buzzerRemainingBeeps = times;
  buzzerState = BuzzerState::On;
  buzzerNextTransitionMs = millis() + onMs;
}

static void serviceBuzzer(uint32_t nowMs) {
  if (buzzerState == BuzzerState::Idle) return;
  if (static_cast<int32_t>(nowMs - buzzerNextTransitionMs) < 0) return;

  // Regression state machine: On -> OffGap -> On ...; the final On transition
  // goes straight to Idle after a verified OFF write. Idle never sets a deadline.
  if (buzzerState == BuzzerState::On) {
    if (!pcfSetOutputActive(PCF_PIN_BUZZER, false)) {
      finishBuzzerSequence();
      return;
    }
    if (buzzerRemainingBeeps > 0) --buzzerRemainingBeeps;
    if (buzzerRemainingBeeps == 0) {
      finishBuzzerSequence();
    } else {
      buzzerState = BuzzerState::OffGap;
      buzzerNextTransitionMs = nowMs + buzzerOffMs;
    }
    return;
  }

  if (!pcfSetOutputActive(PCF_PIN_BUZZER, true)) {
    finishBuzzerSequence();
    return;
  }
  buzzerState = BuzzerState::On;
  buzzerNextTransitionMs = nowMs + buzzerOnMs;
}

static void presentLocalAlert(const char* type, const char* message, uint32_t nowMs,
                              bool localOnly) {
  char localMessage[ALERT_MESSAGE_CAPACITY];
  if (localOnly) {
    snprintf(localMessage, sizeof(localMessage), "LOCAL ONLY %s: %s", type, message);
  } else {
    copyBounded(localMessage, sizeof(localMessage), message);
  }
  copyBounded(lcdAlertText, sizeof(lcdAlertText), localMessage);
  lcdAlertUntilMs = nowMs + 10000UL;
  scheduleBuzzer(3, 200, 150);
  // An alert that is not on the dashboard yet is not an alert. Push immediately
  // so the operator sees the reason for the buzzer while it is still sounding.
  requestBackendPost();
}

static void raiseAlert(const char* type, const char* message, uint32_t nowMs) {
  if (!type || !message) return;

  AlertEvent event;
  memset(&event, 0, sizeof(event));
  // The authority's clock, not the raw DS3231. An alert is the one message a
  // human acts on, and the backend prints its timestamp as when the thing
  // happened. Stamping it 5 hours early makes a correct alert look like it
  // fired before the device was even in the room.
  event.timestampEpoch = currentAuthorityEpoch(millis());
  event.timeValid = event.timestampEpoch != 0;
  sanitizeField(event.type, sizeof(event.type), type);
  sanitizeField(event.message, sizeof(event.message), message);

  if (!appendAlertEvent(event)) {
    // Queue failure must not be presented as a normal stored/remote alert and
    // must not recursively enqueue a storage_fault alert. It is local-only.
    faults.alertQueue = true;
    Serial.printf("[LOCAL-ONLY] %s not queued: %s\n", type, message);
    presentLocalAlert(type, message, nowMs, true);
    return;
  }

  Serial.printf("[ALERT QUEUED] %s: %s\n", type, message);
  presentLocalAlert(type, message, nowMs, false);
}

static void evaluateAlertConditions(uint32_t nowMs) {
  uint16_t sensorFaultMask = currentSensorFaultMask();
  if (sensorFaultMask != 0) {
    resetEnvironmentalLatches();
  } else {
    bool raiseIt = false;
    char message[ALERT_MESSAGE_CAPACITY];

    raiseIt = updateConfirmedLatch(&temperatureHighLatch,
                                   temperatureC > limitTempMaxC(),
                                   temperatureC <= (limitTempMaxC() - SENSOR_HYSTERESIS_C),
                                   nowMs);
    if (raiseIt) {
      snprintf(message, sizeof(message), "Temperature high: %.1f C (prototype max %.1f C)",
               temperatureC, limitTempMaxC());
      raiseAlert("temperature_high", message, nowMs);
    }

    raiseIt = updateConfirmedLatch(&temperatureLowLatch,
                                   temperatureC < limitTempMinC(),
                                   temperatureC >= (limitTempMinC() + SENSOR_HYSTERESIS_C),
                                   nowMs);
    if (raiseIt) {
      snprintf(message, sizeof(message), "Temperature low: %.1f C (prototype min %.1f C)",
               temperatureC, limitTempMinC());
      raiseAlert("temperature_low", message, nowMs);
    }

    raiseIt = updateConfirmedLatch(&humidityHighLatch,
                                   humidityPct > limitHumidityMaxPct(),
                                   humidityPct <= (limitHumidityMaxPct() - HUMIDITY_HYSTERESIS_PCT),
                                   nowMs);
    if (raiseIt) {
      snprintf(message, sizeof(message), "Humidity high: %.1f%% (prototype max %.1f%%)",
               humidityPct, limitHumidityMaxPct());
      raiseAlert("humidity_high", message, nowMs);
    }

    raiseIt = updateConfirmedLatch(&humidityLowLatch,
                                   humidityPct < limitHumidityMinPct(),
                                   humidityPct >= (limitHumidityMinPct() + HUMIDITY_HYSTERESIS_PCT),
                                   nowMs);
    if (raiseIt) {
      snprintf(message, sizeof(message), "Humidity low: %.1f%% (prototype min %.1f%%)",
               humidityPct, limitHumidityMinPct());
      raiseAlert("humidity_low", message, nowMs);
    }

    raiseIt = updateConfirmedLatch(&gasHighLatch,
                                   mqDeltaMv > limitGasAbnormalMv(),
                                   mqDeltaMv <= limitGasClearMv(),
                                   nowMs);
    if (raiseIt) {
      snprintf(message, sizeof(message),
               "Relative MQ-135 delta %.1f mV exceeds prototype %.1f mV",
               mqDeltaMv, limitGasAbnormalMv());
      raiseAlert("gas_relative_high", message, nowMs);
    }
  }

  if ((currentSensorUnavailableMask(nowMs) & SENSOR_FAULT_REED) != 0) {
    doorAlertSentForOpenCycle = false;
  } else if (!doorOpen) {
    doorAlertSentForOpenCycle = false;
  } else if (!doorAlertSentForOpenCycle && doorOpenSinceMs != 0 &&
             static_cast<uint32_t>(nowMs - doorOpenSinceMs) >= limitDoorOpenMs()) {
    doorAlertSentForOpenCycle = true;
    raiseAlert("door_open", "Storage door remained open beyond the prototype timeout", nowMs);
  }

  // The authority's clock. `faults.ds3231` is deliberately NOT tested here any
  // more: it used to gate the whole item-alert pass, so a dead DS3231 silenced
  // use-soon and check-food alerts even when the device knew the time perfectly
  // well from the server. The only question this needs answered is "is there a
  // usable clock", and nowEpoch answers it.
  uint32_t nowEpoch = currentAuthorityEpoch(nowMs);
  if (nowEpoch == 0) return;
  for (uint8_t index = 0; index < inventoryCount; ++index) {
    FreshnessStatus durationStatus = analyseItemDuration(inventory[index], nowEpoch);
    bool raiseIt = updateConfirmedLatch(&itemRuntime[index].useSoon,
                                        durationStatus == FreshnessStatus::UseSoon,
                                        durationStatus == FreshnessStatus::Fresh,
                                        nowMs);
    if (raiseIt) {
      char message[ALERT_MESSAGE_CAPACITY];
      snprintf(message, sizeof(message), "%s is approaching its storage/expiry limit",
               inventory[index].name);
      raiseAlert("food_use_soon", message, nowMs);
    }

    raiseIt = updateConfirmedLatch(&itemRuntime[index].checkFood,
                                   durationStatus == FreshnessStatus::CheckFood,
                                   durationStatus == FreshnessStatus::UseSoon,
                                   nowMs);
    if (raiseIt) {
      char message[ALERT_MESSAGE_CAPACITY];
      snprintf(message, sizeof(message), "%s reached its storage/expiry limit; inspect it",
               inventory[index].name);
      raiseAlert("food_check", message, nowMs);
    }
  }
}

static void serviceFaultTransitionAlert(uint32_t nowMs) {
  uint16_t sensorMask = alertableSensorFaultMask(nowMs);
  // Unproven sensors inside the grace window are named on the console so the
  // state is visible, but they are not announced as faults.
  const uint16_t pendingMask =
      static_cast<uint16_t>(currentSensorFaultMask() & ~sensorMask);
  if (pendingMask != 0) {
    static uint16_t lastPendingMask = 0;
    if (pendingMask != lastPendingMask) {
      char pendingNames[40];
      describeFaultMask(pendingMask, pendingNames, sizeof(pendingNames));
      Serial.printf("[Warming] Not yet proven, not alerting: %s\n", pendingNames);
      lastPendingMask = pendingMask;
    }
  }
  uint16_t newSensorBits = static_cast<uint16_t>(sensorMask & ~announcedSensorFaultMask);
  if (newSensorBits != 0) {
    bool rearmed = lastSensorFaultAlertMs == 0 ||
                   static_cast<uint32_t>(nowMs - lastSensorFaultAlertMs) >= ALERT_REARM_MS;
    if (rearmed) {
      char names[40];
      char message[ALERT_MESSAGE_CAPACITY];
      describeFaultMask(newSensorBits, names, sizeof(names));
      snprintf(message, sizeof(message), "Sensor Fault/Data Unavailable: %s", names);
      raiseAlert("sensor_fault", message, nowMs);
      lastSensorFaultAlertMs = nowMs;
    } else {
      Serial.printf("[FAULT] Sensor alert rearm-suppressed: mask 0x%04X\n",
                    static_cast<unsigned>(newSensorBits));
    }
  } else if (sensorMask == 0 && announcedSensorFaultMask != 0) {
    Serial.println(F("[FAULT] Confirmed sensor faults recovered"));
  }
  announcedSensorFaultMask = sensorMask;

  uint16_t storageMask = currentStorageFaultMask();
  uint16_t newStorageBits = static_cast<uint16_t>(storageMask & ~announcedStorageFaultMask);
  if (newStorageBits != 0) {
    bool rearmed = lastStorageFaultAlertMs == 0 ||
                   static_cast<uint32_t>(nowMs - lastStorageFaultAlertMs) >= ALERT_REARM_MS;
    if (rearmed) {
      char names[40];
      char message[ALERT_MESSAGE_CAPACITY];
      describeFaultMask(newStorageBits, names, sizeof(names));
      snprintf(message, sizeof(message),
               "Storage/Admin Fault (freshness status unaffected): %s", names);
      raiseAlert("storage_fault", message, nowMs);
      lastStorageFaultAlertMs = nowMs;
    } else {
      Serial.printf("[STORAGE] Alert rearm-suppressed: mask 0x%04X\n",
                    static_cast<unsigned>(newStorageBits));
    }
  } else if (storageMask == 0 && announcedStorageFaultMask != 0) {
    Serial.println(F("[STORAGE] Storage/admin faults recovered"));
  }
  announcedStorageFaultMask = storageMask;
}

// ============================================================================
// Reed debounce, PCF-controlled LEDs and buzzer service
// ============================================================================

static void serviceReedInput(uint32_t nowMs) {
  if (static_cast<uint32_t>(nowMs - lastReedPollMs) < REED_POLL_INTERVAL_MS) return;
  lastReedPollMs = nowMs;

  uint8_t pinLevels = 0;
  if (!pcfReadPort(&pinLevels)) {
    faults.reed = faults.pcf8574Read;
    return;
  }
  faults.reed = faults.pcf8574Read;
  // P0 is held at 1 in the latch, so the chip supplies a weak source and the
  // read returns the pin level: HIGH when the contacts are open, LOW when the
  // magnet closes them to ground.
  uint8_t pinLevel = ((pinLevels & (1U << PCF_PIN_REED)) != 0) ? HIGH : LOW;
  // Contacts are wired to P0 and GND, so the quasi-bias pull-up reads HIGH
  // when open and LOW when closed.
  bool rawDoorOpen = (pinLevel != REED_CLOSED_LEVEL);

  if (!reedStableInitialized) {
    reedStableInitialized = true;
    reedCandidate = rawDoorOpen;
    reedCandidateSinceMs = nowMs;
    doorOpen = rawDoorOpen;
    doorOpenSinceMs = doorOpen ? nowMs : 0;
    return;
  }
  if (rawDoorOpen != reedCandidate) {
    reedCandidate = rawDoorOpen;
    reedCandidateSinceMs = nowMs;
    return;
  }
  if (doorOpen == rawDoorOpen ||
      static_cast<uint32_t>(nowMs - reedCandidateSinceMs) < REED_DEBOUNCE_MS) {
    return;
  }
  doorOpen = rawDoorOpen;
  // A door transition is the single most time-critical thing this device reports.
  // Push it now rather than leaving the operator looking at a stale dashboard
  // until the next heartbeat.
  requestBackendPost();
  if (doorOpen) {
    doorOpenSinceMs = nowMs;
    doorAlertSentForOpenCycle = false;
    Serial.println(F("[Reed] Door OPEN"));
  } else {
    doorOpenSinceMs = 0;
    doorAlertSentForOpenCycle = false;
    Serial.println(F("[Reed] Door CLOSED"));
  }
}

static void serviceStatusLeds(FreshnessStatus status, uint32_t nowMs) {
  // Keep attempting verified writes even after a confirmed write fault; three
  // successful verified transitions are required to clear PCF write health.
  if (!pcfInitialized) return;
  if (status == FreshnessStatus::SensorFault) {
    pcfSetOutputActive(PCF_PIN_LED_GREEN, false);
    pcfSetOutputActive(PCF_PIN_LED_YELLOW, false);
    if (static_cast<int32_t>(nowMs - redBlinkNextMs) >= 0) {
      redBlinkOn = !redBlinkOn;
      redBlinkNextMs = nowMs + 250UL;
    }
    pcfSetOutputActive(PCF_PIN_LED_RED, redBlinkOn);
    return;
  }

  redBlinkOn = false;
  pcfSetOutputActive(PCF_PIN_LED_GREEN, status == FreshnessStatus::Fresh);
  pcfSetOutputActive(PCF_PIN_LED_YELLOW, status == FreshnessStatus::UseSoon);
  pcfSetOutputActive(PCF_PIN_LED_RED, status == FreshnessStatus::CheckFood);
}

// ============================================================================
// RC522 RFID mapping
// ============================================================================

static bool pulseRc522Reset() {
  if (!pcfInitialized || faults.pcf8574Write) return false;
  // P5 is active-low, so "assert reset" is active=true and the polarity table
  // turns that into a driven LOW. Written this way rather than with
  // pcfSetRawBit() so a single convention governs every output pin and nobody
  // has to remember which way round a raw write goes.
  if (!pcfSetOutputActive(PCF_PIN_RC522_RST, true)) return false;
  delayMicroseconds(2000);
  if (!pcfSetOutputActive(PCF_PIN_RC522_RST, false)) return false;
  // Setup-only: MFRC522 oscillator start-up time is about 50 ms after
  // RST de-assertion. pulseRc522Reset() is never called from loop().
  delay(50);
  return true;
}

static void initializeRc522() {
  faults.rc522 = true;
  if (!pcfInitialized || faults.pcf8574Write) {
    Serial.println(F("[RC522] Optional; aborting because PCF8574 RST control is unavailable"));
    return;
  }
  pinMode(PIN_RC522_SS, OUTPUT);
  digitalWrite(PIN_RC522_SS, HIGH);
  SPI.begin(); // ESP8266 hardware SPI is fixed to GPIO12/13/14/15.
  if (!pulseRc522Reset()) {
    faults.pcf8574Write = true;
    forceFaultDebounce(&pcfWriteDebounce, millis());
    Serial.println(F("[RC522] Optional; aborting after PCF8574 reset write failure"));
    return;
  }
  rc522.PCD_Init();
  rc522.PCD_AntennaOn();
  const uint8_t version = rc522.PCD_ReadRegister(MFRC522::VersionReg);

  // A version byte is a label, not a capability. Known values are 0x90 (v0.0),
  // 0x91 (v1.0), 0x92 (v2.0), and 0x88 on the Fudan FM17522 clone - so
  // non-NXP silicon is real and documented. This build reads 0x82, which appears
  // in no reference list, and the previous code treated that as a hard fault and
  // disabled the reader. Rejecting a part over a cosmetic mismatch would be
  // wrong: a clone with an unrecognised version byte can still read cards
  // perfectly, because nothing in the read path depends on the version value.
  //
  // 0x00 and 0xFF are the values that mean the bus failed. Anything else means
  // the chip answered, so the reader is used and the version is reported as
  // information. The self-test below confirms the SPI path independently.
  if (version == 0x00 || version == 0xFF) {
    rc522Ready = false;
    Serial.printf("[RC522] No response on SPI (version 0x%02X). Reset, power and"
                  " the CS/MOSI/MISO/SCK\n          wiring are the only candidates;"
                  " the reader stays disabled.\n",
                  static_cast<unsigned>(version));
    return;
  }

  const bool knownVersion = (version == 0x90 || version == 0x91 ||
                             version == 0x92 || version == 0x88);
  Serial.printf("[RC522] Responding, version 0x%02X%s\n",
                static_cast<unsigned>(version),
                knownVersion ? "" : " (unrecognised, but the part is alive)");
  Serial.println(F("          Version is a label only. Continuing - card reads do not"
                   " depend on it."));

  rc522Ready = true;
  faults.rc522 = false;
}

// The identification event type, as one named constant.
//
// The service validates `type` against a CLOSED enum of twelve strings
// (backend/src/ingest/contract.js, EVENT_TYPES) inside a strictObject, so an
// unrecognised type is not a rejected event - it is a REJECTED SNAPSHOT, and the
// readings, the state block, every item and the whole config block go down with
// it. The risk is entirely a spelling slip: rfid_scanned vs rfid_scan vs
// rfid_scaned all read correctly to a human and all lose the whole snapshot.
//
// It is a constant rather than a literal at the call site so there is exactly
// one place in the firmware where the string exists, and the static_assert in
// publishRfidScanEvent() ties it to the width of the field that carries it.
static const char EVENT_TYPE_RFID_SCANNED[] = "rfid_scanned";

/**
 * Publish one tag presentation as an rfid_scanned event.
 *
 * THIS DELIBERATELY DOES NOT CALL raiseAlert()
 *
 * raiseAlert() is the food-safety path. Every caller of it is a condition a human
 * must act on, and it pays that off by driving the buzzer and pinning the LCD
 * ALERT banner for 10 s. A tag being presented is not one of those things:
 *
 *   - The operator caused it. They are standing at the fridge holding the item.
 *   - It is a statement about an ITEM, not about the cabinet. SRS L227 is
 *     explicit that the gas sensor must not be used to identify which food item
 *     caused a condition, and the same discipline runs the other way: a scan
 *     identifies an item and must never be read as a cause or a verdict. Nothing
 *     here consults a threshold, an expiry or a fault bit.
 *   - A buzzer for it would be actively harmful. Operators learn very quickly
 *     which sounds mean something, and the one sound this device makes for a
 *     condition is the last sound that should become noise.
 *
 * On severity: the event queue has no severity field and neither does the v1 wire
 * contract, so there is no "low" to select. The alerting side effects raiseAlert()
 * would apply - buzzer, LCD ALERT banner, alert-queue fault on failure - are
 * exactly what is being declined, and their absence is the lowest severity the
 * existing path can express. Adding a severity field would be a contract change
 * to express something the absence already says.
 *
 * The queue IS the shared one, deliberately. It is the only path in this firmware
 * that already survives a reboot, a full filesystem and an offline broker, and an
 * event in it rides in the next snapshot's events[] with no new transport, no new
 * topic and no new code on the service.
 *
 * A tag that is not registered is a normal outcome, not an error, and is not
 * treated as one: the device does not own the registry and has no business
 * deciding that a tag "should" exist. The server owns that list, and an
 * unregistered uid is exactly what a reader that has just been fitted meets on
 * its first sweep.
 */
static void publishRfidScanEvent(uint8_t uidLength, const char* uidText, uint32_t nowMs) {
  static_assert(sizeof(EVENT_TYPE_RFID_SCANNED) - 1 < sizeof(((AlertEvent*)nullptr)->type),
                "the event type must fit AlertEvent::type with its terminator;"
                " the service rejects the whole snapshot if this is truncated");

  if (uidLength == 0 || uidText[0] == '\0') {
    // The uid IS this event. A card whose serial came back empty - which the
    // RC522 can report - has nothing to identify, and publishing the type with no
    // uid would be a content-free row the dashboard could not act on. The length
    // bound itself is enforced at the reader boundary in serviceRc522().
    Serial.println(F("[RC522] Card reported no usable UID; nothing published"));
    return;
  }

  AlertEvent event;
  memset(&event, 0, sizeof(event));
  // The authority's clock, exactly as raiseAlert() stamps an alert, not the raw
  // DS3231: the backend prints this as when the tag was here, and it is the value
  // a dashboard will later answer "when was this tag last seen" from.
  event.timestampEpoch = currentAuthorityEpoch(nowMs);
  event.timeValid = event.timestampEpoch != 0;
  sanitizeField(event.type, sizeof(event.type), EVENT_TYPE_RFID_SCANNED);
  // formatUid() spelling - uppercase hex, no separators - so this matches
  // inventory_item.uid for a registered tag character for character. The service
  // deliberately does not normalise case, so the device's spelling is the
  // spelling; see formatUid().
  copyBounded(event.uid, sizeof(event.uid), uidText);
  // The message reports WHAT HAPPENED and nothing else. The identity is in the
  // `uid` field, which is structured precisely so no consumer has to parse prose
  // to answer "which tag was that"; and a registered-or-not judgement has no
  // place in this string, because it would put a verdict into an observation and
  // the device is not the party that can make it.
  snprintf(event.message, sizeof(event.message), "RFID tag %s presented", uidText);

  if (!appendAlertEvent(event)) {
    // Same rule raiseAlert() follows: a queue failure is reported locally, is not
    // dressed up as a stored event, and must not recursively enqueue a
    // storage_fault. faults.alertQueue is set inside appendAlertEvent() where the
    // queue state is known; no fault is attributed to the READER, which read the
    // card perfectly well.
    Serial.printf("[RC522] Scan of %s not queued (queue full or flash error);"
                  " not published\n", uidText);
    return;
  }
  Serial.printf("[RC522] Queued %s for UID %s\n", EVENT_TYPE_RFID_SCANNED, uidText);

  // A scan is a deliberate human action and the operator is standing there
  // waiting to see it, so it does not wait for the 10 s heartbeat.
  // requestBackendPost() only raises a flag; backendPostDue() still applies
  // BACKEND_MIN_POST_GAP_MS (2000 ms), so a burst of scans cannot become a
  // request flood. The event is on the dashboard at most one rate-limit window
  // after the scan, which is the same bound every other immediate push in this
  // firmware has and is well inside "about a second".
  requestBackendPost();
}

/**
 * Is this the same tag, inside the debounce window, and therefore not a new
 * presentation? See RFID_SCAN_DEBOUNCE_MS for why the window exists.
 *
 * A zero recorded length means nothing has been presented yet, so the very first
 * scan after boot can never be mistaken for a repeat - including a scan in the
 * first RFID_SCAN_DEBOUNCE_MS of uptime, which is exactly when a wrapped tag
 * would otherwise be dropped.
 */
static bool rfidScanIsDebounced(const uint8_t* uid, uint8_t uidLength, uint32_t nowMs) {
  if (rfidLastScanUidLength == 0 || rfidLastScanUidLength != uidLength) return false;
  if (memcmp(rfidLastScanUid, uid, uidLength) != 0) return false;
  if (static_cast<uint32_t>(nowMs - rfidLastScanMs) >= RFID_SCAN_DEBOUNCE_MS) return false;
  if (!rfidDebounceReported) {
    rfidDebounceReported = true;
    Serial.printf("[RC522] Same tag still presented inside the %lu ms window;"
                  " read again, no second event\n",
                  static_cast<unsigned long>(RFID_SCAN_DEBOUNCE_MS));
  }
  return true;
}

static void serviceRc522(uint32_t nowMs) {
  if (!rc522Ready) return;
  if (static_cast<uint32_t>(nowMs - lastRfidPollMs) < RFID_POLL_INTERVAL_MS) return;
  lastRfidPollMs = nowMs;
  if (!rc522.PICC_IsNewCardPresent() || !rc522.PICC_ReadCardSerial()) return;

  char uidText[24];
  formatUid(rc522.uid.uidByte, rc522.uid.size, uidText, sizeof(uidText));
  // Halt before anything else. rc522.uid survives it, and there is no reason to
  // leave the card answering the reader while flash is being written.
  rc522.PICC_HaltA();

  // Validated here, at the boundary where the reader's output enters the
  // firmware, because everything downstream sizes itself from this number: the
  // debounce key, event.uid and the registry lookup. A real MIFARE card reports
  // 4, 7 or 10 bytes, and the library's own buffer is 10, so anything outside
  // that is either a length that was never set or a part answering incorrectly -
  // and an unbounded memcpy into a 10-byte key is not worth the convenience.
  if (rc522.uid.size == 0 || rc522.uid.size > EVENT_UID_MAX_BYTES) {
    Serial.printf("[RC522] Card reported an implausible UID length (%u byte(s));"
                  " nothing published\n", static_cast<unsigned>(rc522.uid.size));
    return;
  }

  // Local selection of which item the LCD shows, and unchanged by this feature.
  // It reports; it decides nothing. The verdict it prints is calculated by
  // analyseItemDuration() from the stored dates and the clock, exactly as it was
  // before a tag was ever published, and nothing below can alter it.
  int8_t index = findInventoryByUid(rc522.uid.uidByte, rc522.uid.size);
  if (index >= 0) {
    latestScannedItem = index;
    FreshnessStatus itemStatus = worstStatus(zoneStatus,
                                             analyseItemDuration(inventory[index],
                                                                currentAuthorityEpoch(nowMs)));
    Serial.printf("[RC522] %s -> %s [%s]\n", inventory[index].name,
                  freshnessStatusText(itemStatus), uidText);
  } else {
    latestScannedItem = -1;
    Serial.printf("[RC522] UID %s is not registered\n", uidText);
    Serial.println(F("[RC522] Use: REG <UID>|<name>|<category>|<qty>|<location>|<days>|<expiry>"));
  }

  // From here the presentation is published, once, as an observation. No fault
  // bit is set, no buzzer sounds, no LCD ALERT banner is pinned and no freshness
  // status is recomputed.
  if (rfidScanIsDebounced(rc522.uid.uidByte, rc522.uid.size, nowMs)) return;
  memcpy(rfidLastScanUid, rc522.uid.uidByte, rc522.uid.size);
  rfidLastScanUidLength = rc522.uid.size;
  rfidLastScanMs = nowMs;
  rfidDebounceReported = false;
  publishRfidScanEvent(rc522.uid.size, uidText, nowMs);
}

// ============================================================================
// Wi-Fi, ThingSpeak telemetry and the notification transport seam
// ============================================================================

static bool configuredSecret(const char* value) {
  if (!value || value[0] == '\0') return false;
  return strncmp(value, "REPLACE_ME", 9) != 0 && strncmp(value, "YOUR_", 5) != 0;
}

static void initializeNetworkConfiguration() {
  wifiConfigured = configuredSecret(WIFI_SSID) && configuredSecret(WIFI_PASSWORD);
  thingspeakConfigured = configuredSecret(THINGSPEAK_API_KEY) && THINGSPEAK_TLS_FINGERPRINT_ENABLED;
  iftttConfigured = configuredSecret(IFTTT_WEBHOOK_KEY) && IFTTT_TLS_FINGERPRINT_ENABLED;
  // Plain HTTP to a LAN address needs no fingerprint; an https URL does, and
  // sendBackendSnapshot() re-checks that per request so a misconfigured build
  // cannot silently fall back to an unverified TLS connection.
  backendConfigured = configuredSecret(BACKEND_URL) && configuredSecret(BACKEND_INGEST_KEY);
  mqttConfigured = configuredSecret(MQTT_BROKER_HOST) && configuredSecret(MQTT_BASE_TOPIC);
  if (mqttConfigured) {
    buildMqttTopics();
    mqttClient.setKeepAlive(static_cast<uint16_t>(MQTT_KEEPALIVE_S));
    mqttClient.setBufferSize(MQTT_FG_MAX_PACKET_SIZE);
  }
  transportTls.setTimeout(HTTP_TIMEOUT_MS);
  if (!thingspeakConfigured) {
    thingspeakConfigWarned = true;
    Serial.println(F("[ThingSpeak] Disabled until API key + verified TLS fingerprint are set"));
  }
  if (!iftttConfigured) {
    iftttConfigWarned = true;
    Serial.println(F("[IFTTT] Disabled until webhook key + verified TLS fingerprint are set"));
  }
  if (!backendConfigured) {
    backendConfigWarned = true;
    Serial.println(F("[Backend] Disabled until BACKEND_URL + BACKEND_INGEST_KEY are set"));
  }
}

static void startWifiAttempt(uint32_t nowMs) {
  lastWifiBeginMs = nowMs;
  // Verified in ESP8266 core 3.1.2: begin() starts the connection and returns;
  // connection completion is polled through WiFi.status() in serviceWiFi().
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

static void serviceWiFi(uint32_t nowMs) {
  if (!wifiConfigured) {
    wifiConnected = false;
    if (!wifiCredentialsWarned) {
      wifiCredentialsWarned = true;
      Serial.println(F("[WiFi] Credentials are placeholders; offline mode remains active"));
    }
    return;
  }

  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && !wifiConnected) {
    IPAddress address = WiFi.localIP();
    Serial.printf("[WiFi] Connected: %u.%u.%u.%u\n",
                  static_cast<unsigned>(address[0]), static_cast<unsigned>(address[1]),
                  static_cast<unsigned>(address[2]), static_cast<unsigned>(address[3]));
  } else if (!connected && wifiConnected) {
    Serial.println(F("[WiFi] Disconnected; local monitoring/buffering continue"));
  }
  wifiConnected = connected;
  if (!connected && static_cast<uint32_t>(nowMs - lastWifiBeginMs) >= WIFI_RETRY_INTERVAL_MS) {
    startWifiAttempt(nowMs);
  }
}

static bool sendThingSpeakTelemetry() {
  if (!thingspeakConfigured) {
    if (!thingspeakConfigWarned) {
      thingspeakConfigWarned = true;
      Serial.println(F("[ThingSpeak] Disabled until API key + verified TLS fingerprint are set"));
    }
    return false;
  }
  if (!transportTls.setFingerprint(THINGSPEAK_TLS_FINGERPRINT)) return false;

  char url[640];
  int length = snprintf(url, sizeof(url),
                        "%s?api_key=%s&field1=%.2f&field2=%.2f&field3=%.2f"
                        "&field4=%.2f&field5=%u&field6=%u&field7=%.2f&field8=%u",
                        THINGSPEAK_URL, THINGSPEAK_API_KEY,
                        bmeDataReady ? temperatureC : -999.0F,
                        humidityReady ? humidityPct : -999.0F,
                        (mqState == MqState::Ready) ? mqInputMv : -999.0F,
                        (mqState == MqState::Ready) ? mqDeltaMv : -999.0F,
                        doorOpen ? 1U : 0U,
                        static_cast<unsigned>(calculateOverallStatus()),
                        bmeDataReady ? pressureHpa : -999.0F,
                        static_cast<unsigned>(currentAllFaultMask()));

  if (length < 0 || static_cast<size_t>(length) >= sizeof(url)) return false;

  HTTPClient http;
  if (!http.begin(transportTls, url)) return false;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  int code = http.GET();
  http.end();
  ESP.wdtFeed();
  Serial.printf("[ThingSpeak] HTTP %d\n", code);
  return code >= 200 && code < 300;
}

static size_t appendJsonString(char* output, size_t capacity, size_t used, const char* value) {
  if (!output || used >= capacity) return used;
  int written = snprintf(output + used, capacity - used, "\"");
  if (written < 0) return used;
  used += static_cast<size_t>(written);

  for (const char* cursor = value ? value : ""; *cursor && used + 7 < capacity; ++cursor) {
    unsigned char character = static_cast<unsigned char>(*cursor);
    const char* simpleEscape = nullptr;
    switch (character) {
      case '"': simpleEscape = "\\\""; break;
      case '\\': simpleEscape = "\\\\"; break;
      case '\b': simpleEscape = "\\b"; break;
      case '\f': simpleEscape = "\\f"; break;
      case '\n': simpleEscape = "\\n"; break;
      case '\r': simpleEscape = "\\r"; break;
      case '\t': simpleEscape = "\\t"; break;
      default: break;
    }

    if (simpleEscape) {
      size_t length = strlen(simpleEscape);
      if (used + length >= capacity) break;
      memcpy(output + used, simpleEscape, length);
      used += length;
    } else if (character < 0x20) {
      char encoded[7];
      int encodedLength = snprintf(encoded, sizeof(encoded), "\\u%04X",
                                  static_cast<unsigned>(character));
      if (encodedLength <= 0 || static_cast<size_t>(encodedLength) >= sizeof(encoded) ||
          used + static_cast<size_t>(encodedLength) >= capacity) {
        break;
      }
      memcpy(output + used, encoded, static_cast<size_t>(encodedLength));
      used += static_cast<size_t>(encodedLength);
    } else {
      output[used++] = static_cast<char>(character);
    }
  }
  if (used < capacity) output[used++] = '"';
  return used;
}

static bool sendIftttNotification(const AlertEvent& event) {
  if (!iftttConfigured) {
    if (!iftttConfigWarned) {
      iftttConfigWarned = true;
      Serial.println(F("[IFTTT] Disabled until webhook key + verified TLS fingerprint are set"));
    }
    return false;
  }
  if (!transportTls.setFingerprint(IFTTT_TLS_FINGERPRINT)) return false;

  char url[256];
  int length = snprintf(url, sizeof(url), "https://maker.ifttt.com/trigger/%s/with/key/%s",
                        IFTTT_EVENT, IFTTT_WEBHOOK_KEY);
  if (length < 0 || static_cast<size_t>(length) >= sizeof(url)) return false;

  char payload[384];
  size_t used = 0;
  int written = snprintf(payload, sizeof(payload), "{\"event_id\":%lu,\"value1\":\"FreshGuard\",\"value2\":",
                         static_cast<unsigned long>(event.eventId));
  if (written < 0 || static_cast<size_t>(written) >= sizeof(payload)) return false;
  used = static_cast<size_t>(written);
  used = appendJsonString(payload, sizeof(payload), used, event.type);
  written = snprintf(payload + used, sizeof(payload) - used, ",\"value3\":");
  if (written < 0 || static_cast<size_t>(written) >= sizeof(payload) - used) return false;
  used += static_cast<size_t>(written);
  used = appendJsonString(payload, sizeof(payload), used, event.message);
  written = snprintf(payload + used, sizeof(payload) - used, ",\"value4\":%lu,\"time_valid\":%s}",
                     static_cast<unsigned long>(event.timestampEpoch),
                     event.timeValid ? "true" : "false");
  if (written < 0 || static_cast<size_t>(written) >= sizeof(payload) - used) return false;

  HTTPClient http;
  if (!http.begin(transportTls, url)) return false;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(reinterpret_cast<const uint8_t*>(payload), strlen(payload));
  http.end();
  ESP.wdtFeed();
  Serial.printf("[IFTTT] Event %lu HTTP %d (slot retained on non-2xx)\n",
                static_cast<unsigned long>(event.eventId), code);
  return code >= 200 && code < 300;
}

struct NotificationTransport {
  const char* name;
  bool (*configured)();
  bool (*send)(const AlertEvent&);
};

static bool notificationTransportConfigured() { return iftttConfigured; }
static NotificationTransport notificationTransport = {
  "IFTTT HTTPS",
  notificationTransportConfigured,
  sendIftttNotification
};

// ============================================================================
// Option B: snapshot sync to the FreshGuard service
// ============================================================================
//
// One POST per interval carrying device state, the full RFID registry and any
// undelivered alert events. The service is strict: an unknown key is a 400 and
// a body over 4096 bytes is a 413, so this builder emits exactly the keys in
// the v1 contract and refuses to send a payload it could not finish rather
// than truncating it into malformed JSON.
//
// A non-2xx is *not* an error state: `seq` and `uptime` make re-sending safe,
// and the service treats a repeat as an idempotent replay. The device therefore
// simply tries again on the next tick.

static char backendPayload[BACKEND_PAYLOAD_CAPACITY];
static char backendUrl[256];

// Records what the backend has just been given, so the next poll compares
// against it. Called ONLY from a path the backend accepted.
//
// A rejected or failed snapshot is deliberately not recorded. The values in it
// were not stored, so they must still count as changed and be retried; recording
// them on a failed attempt would silently swallow a reading the dashboard never
// received.
static void notePublishedReadings() {
  lastPublishedReadings.temperatureC = temperatureC;
  lastPublishedReadings.humidityPct = humidityPct;
  lastPublishedReadings.pressureHpa = pressureHpa;
  lastPublishedReadings.mqInputMv = mqInputMv;
  lastPublishedReadings.mqDeltaMv = mqDeltaMv;
}

// Appends one "<label><delta>" fragment to the change log line. Returns the new
// length, clamped to capacity so a caller can keep appending without rechecking.
static size_t appendChangeFragment(char* out, size_t cap, size_t used,
                                   const char* label, float delta) {
  if (used >= cap) return cap;
  const int written = snprintf(out + used, cap - used, "%s%s%+.2f",
                               used ? " " : "", label, static_cast<double>(delta));
  if (written < 0 || static_cast<size_t>(written) >= cap - used) return cap;
  return used + static_cast<size_t>(written);
}

/**
 * Ask for a snapshot if any reading has moved past its per-sensor threshold
 * since the last published one.
 *
 * NAN-safe by construction: a channel that is unavailable on either side yields
 * a NAN delta, and every `NAN >= threshold` is false, so an absent reading can
 * never fake a change. No isnan() call is needed for that, and a sensor that
 * comes back does so through the normal fault/recovery alert path rather than
 * through this one.
 *
 * This only sets the request flag. It deliberately does NOT publish, and it does
 * NOT try to work around the cooldown: backendPostDue() applies
 * BACKEND_MIN_POST_GAP_MS, so a change seen inside the gap simply waits and is
 * carried by the pending heartbeat, which is the correct outcome - the newest
 * values go out either way, just not as a second request. The ceiling on a
 * drifting sensor is therefore one publish per SENSOR_POLL_INTERVAL_MS, not one
 * per BACKEND_MIN_POST_GAP_MS, because this runs once per poll and not once per
 * loop iteration.
 */
static void publishIfSensorChanged() {
  const float deltaTemperature = fabsf(temperatureC - lastPublishedReadings.temperatureC);
  const float deltaHumidity = fabsf(humidityPct - lastPublishedReadings.humidityPct);
  const float deltaPressure = fabsf(pressureHpa - lastPublishedReadings.pressureHpa);
  // Either MQ-135 figure counts. The delta is derived from the input and the
  // tracked baseline, so a baseline that walks under a perfectly still sensor
  // moves the delta without the input moving at all, and that is a real change
  // in what the snapshot would report.
  const float deltaMqInput = fabsf(mqInputMv - lastPublishedReadings.mqInputMv);
  const float deltaMqDelta = fabsf(mqDeltaMv - lastPublishedReadings.mqDeltaMv);
  const float deltaGas = (isnan(deltaMqDelta) || deltaMqInput > deltaMqDelta)
                             ? deltaMqInput
                             : deltaMqDelta;

  const bool temperatureMoved = deltaTemperature >= PUBLISH_CHANGE_TEMPERATURE_C;
  const bool humidityMoved = deltaHumidity >= PUBLISH_CHANGE_HUMIDITY_PCT;
  const bool pressureMoved = deltaPressure >= PUBLISH_CHANGE_PRESSURE_HPA;
  const bool gasMoved = deltaGas >= PUBLISH_CHANGE_MQ_MV;
  if (!temperatureMoved && !humidityMoved && !pressureMoved && !gasMoved) return;

  char detail[80];
  detail[0] = '\0';
  size_t used = 0;
  if (temperatureMoved) used = appendChangeFragment(detail, sizeof(detail), used, "T", deltaTemperature);
  if (humidityMoved) used = appendChangeFragment(detail, sizeof(detail), used, "RH", deltaHumidity);
  if (pressureMoved) used = appendChangeFragment(detail, sizeof(detail), used, "P", deltaPressure);
  if (gasMoved) used = appendChangeFragment(detail, sizeof(detail), used, "MQ", deltaGas);

  const uint32_t nowMs = millis();
  Serial.printf("[Publish] moved since last published: %s (>= %.2fC/%.2f%%RH/"
                "%.2fhPa/%.1fmV) at %lums, %lums since last post\n",
                detail, static_cast<double>(PUBLISH_CHANGE_TEMPERATURE_C),
                static_cast<double>(PUBLISH_CHANGE_HUMIDITY_PCT),
                static_cast<double>(PUBLISH_CHANGE_PRESSURE_HPA),
                static_cast<double>(PUBLISH_CHANGE_MQ_MV),
                static_cast<unsigned long>(nowMs),
                static_cast<unsigned long>(nowMs - lastBackendAttemptMs));
  requestBackendPost();
}

// Contract enum order for MqState is warming_up, capturing_baseline, ready,
// faulted - the same order the service validates against.
static const char* mqStateName(MqState state) {
  switch (state) {
    case MqState::WarmingUp: return "warming_up";
    case MqState::CapturingBaseline: return "capturing_baseline";
    case MqState::Ready: return "ready";
    case MqState::Faulted: return "faulted";
  }
  return "faulted";
}

// A reading is null, never a sentinel. The service treats -999 as a real value,
// so an unavailable sensor must be sent as JSON null. `%.2f` on NAN is avoided
// by branching, because NAN would serialise as "nan" and fail strict JSON.
static size_t appendKeyFloatOrNull(char* out, size_t cap, size_t used, bool first,
                                   const char* key, bool available, float value) {
  if (available && !isnan(value)) {
    return appendKeyValue(out, cap, used, first, key, "%.2f", static_cast<double>(value));
  }
  used = appendKey(out, cap, used, first, key);
  if (used >= cap) return used;
  int written = snprintf(out + used, cap - used, "null");
  if (written < 0 || static_cast<size_t>(written) >= cap - used) return used;
  return used + static_cast<size_t>(written);
}

// Append `,"key":` or `"key":` depending on whether anything precedes it.
static size_t appendKey(char* out, size_t cap, size_t used, bool first, const char* key) {
  int written = snprintf(out + used, cap - used, "%s\"%s\":", first ? "" : ",", key);
  if (written < 0 || static_cast<size_t>(written) >= cap - used) return used;
  return used + static_cast<size_t>(written);
}

static size_t appendKeyValue(char* out, size_t cap, size_t used, bool first,
                             const char* key, const char* format, ...) {
  used = appendKey(out, cap, used, first, key);
  if (used >= cap) return used;
  va_list args;
  va_start(args, format);
  int written = vsnprintf(out + used, cap - used, format, args);
  va_end(args);
  if (written < 0 || static_cast<size_t>(written) >= cap - used) return used;
  return used + static_cast<size_t>(written);
}

static size_t appendKeyString(char* out, size_t cap, size_t used, bool first,
                              const char* key, const char* value) {
  used = appendKey(out, cap, used, first, key);
  if (used >= cap) return used;
  return appendJsonString(out, cap, used, value);
}

static size_t appendUid(char* out, size_t cap, size_t used, const FoodItem& item) {
  if (used >= cap) return used;
  out[used++] = '"';
  for (uint8_t index = 0; index < item.uidLength && used + 3 < cap; ++index) {
    static const char kHex[] = "0123456789ABCDEF";
    out[used++] = kHex[(item.uid[index] >> 4) & 0x0F];
    out[used++] = kHex[item.uid[index] & 0x0F];
  }
  if (used < cap) out[used++] = '"';
  return used;
}

// Build the v1 snapshot. Returns the byte length, or 0 if the payload did not
// fit - in which case nothing is sent, because a truncated body would be
// rejected as malformed and would hide a real capacity problem.
static size_t buildBackendSnapshot(uint32_t nowMs) {
  size_t used = 0;
  backendPayload[0] = '{';
  used = 1;

  // One decision, reported twice. `epoch` and `time_source` come from the same
  // call, so a snapshot can never claim one source while carrying the other's
  // number - which would be worse than silence, because the backend would make
  // its clock-trust call with confident and wrong evidence.
  TimeSource source = TimeSource::None;
  const uint32_t epoch = currentReportEpoch(nowMs, &source);

  // time_valid MEANS "this snapshot carries a real, advancing, non-synthesised
  // time reference". It is true for rtc, server_synced and rtc_offset, and false
  // only for none.
  //
  // THIS IS A DELIBERATE CHANGE OF MEANING, and the previous meaning - "a real
  // reading from the device's own DS3231" - is the reason the device had no
  // verdicts. The backend's clock-trust rule withholds the whole date layer
  // unless time_valid is true (ingest/service.js stores a null reported_at
  // otherwise, and read/projections.js then refuses to compute any day count).
  // With the narrow meaning, a device whose clock is correct-but-5-hours-skewed
  // reports time_valid true with a 5-hour-wrong epoch and trips the skew rule,
  // and a device whose clock is dead reports time_valid false and trips the
  // invalid rule. Both land in the same place: every food item stuck at Sensor
  // Fault, indefinitely, with no way out. The narrow meaning had no reachable
  // state that produced a verdict.
  //
  // The distinction it used to draw is NOT discarded. It moves into the field
  // that can carry it honestly - time_source - so the backend can still tell a
  // raw DS3231 reading from a server-corrected one, and clock_offset_s gives it
  // the size and sign of the error. The trust DECISION stays on the server,
  // where it belongs; the device's job is to report honestly and to stop
  // presenting a stale day as current.
  //
  // The backup-battery field is deliberately gone, and no battery condition of
  // any kind replaces it. The DS3231 exposes no battery-low bit - the
  // rtc_battery_low key was fed by a fabricated decode of 0x0F bit 3, which is
  // EN32kHz - so the device had no evidence to report. The backend contract
  // keeps the key optional precisely so a build that stops sending it still
  // validates; nothing in the dashboard reads it.
  const bool timeValid = (source != TimeSource::None) && epoch > 0;

  used = appendKeyValue(backendPayload, sizeof(backendPayload), used, true, "v", "%d", 1);
  used = appendKeyValue(backendPayload, sizeof(backendPayload), used, false, "seq", "%lu",
                        static_cast<unsigned long>(backendSeq));
  used = appendKeyValue(backendPayload, sizeof(backendPayload), used, false, "uptime", "%lu",
                        static_cast<unsigned long>(nowMs / 1000UL));
  // An untrusted clock used to send epoch 0, which the service already treats as
  // "not trusted". Sending null instead would be a second way to say the same
  // thing. The value itself is no longer forced to 0: it is the best time the
  // device can honestly offer, and `time_source` below says where it came from,
  // so the backend is choosing what to trust rather than being handed a zero and
  // no explanation.
  used = appendKeyValue(backendPayload, sizeof(backendPayload), used, false, "epoch", "%lu",
                        static_cast<unsigned long>(epoch));
  used = appendKeyValue(backendPayload, sizeof(backendPayload), used, false, "time_valid", "%s",
                        timeValid ? "true" : "false");
  // A STRING, so appendKeyString. appendKeyValue would emit the token bare and
  // the entire snapshot would become invalid JSON, which the backend rejects
  // wholesale - every reading, every item and the whole config block lost over
  // one missing pair of quotes. That is the exact failure that shipped once
  // already, when the firmware version was emitted unquoted.
  used = appendKeyString(backendPayload, sizeof(backendPayload), used, false,
                         "time_source", timeSourceName(source));
  // How far the device's own clock is from the server's, in seconds, signed:
  // positive means the server is ahead. This is the measured size of the fault
  // the server-sync correction is built from, and it is what lets the backend's
  // clock-trust rule tell a corrected reading from a raw one, and judge how
  // wrong the underlying hardware is.
  //
  // It is 0 when no measurement has been taken yet - i.e. while time_source is
  // still "rtc" and SERVER_SYNC_MIN_SAMPLES responses have not arrived. That is
  // genuinely ambiguous between "no error" and "not measured", and time_source
  // disambiguates it: a "none" or "rtc" source with a 0 offset means not
  // measured, because an unmeasured correction is the only way that pairing can
  // occur once a correction exists.
  //
  // appendKeyValue, not appendKeyString - it is a number. A signed %ld, so a
  // device whose clock is FAST reports a negative offset instead of wrapping to
  // about 4.29e9.
  used = appendKeyValue(backendPayload, sizeof(backendPayload), used, false,
                        "clock_offset_s", "%ld", static_cast<long>(serverOffsetSeconds));
  // Why the clock is degraded, not just that it is. A device reporting
  // time_source "rtc_offset" and rtc_alive false has told the operator the
  // oscillator is stopped, which is the one clock failure this part can actually
  // report. Without these the snapshot said "not trusted" and nothing else,
  // which is how a dead clock stayed invisible for months. There is deliberately
  // no battery key beside it: the DS3231 has no battery-low status bit, so any
  // such field would be a guess, and a guess in a machine-readable payload is
  // worse than an omission.
  used = appendKeyValue(backendPayload, sizeof(backendPayload), used, false, "rtc_alive", "%s",
                        rtcClockRunning ? "true" : "false");
  used = appendKeyValue(backendPayload, sizeof(backendPayload), used, false, "inv_revision", "%lu",
                        static_cast<unsigned long>(inventoryRevision));
  used = appendKeyValue(backendPayload, sizeof(backendPayload), used, false, "pending_count", "%u",
                        static_cast<unsigned>(queuedEventCount));
  // Every snapshot carries the whole registry. A partial list would let the
  // service retire items the device still has.
  used = appendKeyValue(backendPayload, sizeof(backendPayload), used, false, "full", "true");

  // readings - all five nullable, no sentinels.
  used = appendKey(backendPayload, sizeof(backendPayload), used, false, "readings");
  if (used >= sizeof(backendPayload)) return 0;
  backendPayload[used++] = '{';
  {
    size_t inner = used;
    bool gasReady = (mqState == MqState::Ready);
    inner = appendKeyFloatOrNull(backendPayload, sizeof(backendPayload), inner, true,
                                 "temperature_c", bmeDataReady, temperatureC);
    inner = appendKeyFloatOrNull(backendPayload, sizeof(backendPayload), inner, false,
                                 "humidity_pct", humidityReady, humidityPct);
    inner = appendKeyFloatOrNull(backendPayload, sizeof(backendPayload), inner, false,
                                 "pressure_hpa", bmeDataReady, pressureHpa);
    inner = appendKeyFloatOrNull(backendPayload, sizeof(backendPayload), inner, false,
                                 "gas_input_mv", gasReady, mqInputMv);
    inner = appendKeyFloatOrNull(backendPayload, sizeof(backendPayload), inner, false,
                                 "gas_delta_mv", gasReady, mqDeltaMv);
    used = inner;
  }
  if (used >= sizeof(backendPayload)) return 0;
  backendPayload[used++] = '}';

  // state
  used = appendKey(backendPayload, sizeof(backendPayload), used, false, "state");
  if (used >= sizeof(backendPayload)) return 0;
  backendPayload[used++] = '{';
  {
    size_t inner = used;
    inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, true, "zone_status", "%u",
                           static_cast<unsigned>(zoneStatus));
    inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false, "overall_status", "%u",
                           static_cast<unsigned>(calculateOverallStatus()));
    inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false, "door_open", "%s",
                           doorOpen ? "true" : "false");
    // A door state is unknown when the expander could not be read; saying
    // "closed" there would be a fabricated reading.
    inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false, "door_stale", "%s",
                           (!pcfReadReady || faults.reed) ? "true" : "false");
    inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false,
                           "confirmed_fault_mask", "%u",
                           static_cast<unsigned>(currentAllFaultMask()));
    inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false,
                           "availability_mask", "%u",
                           static_cast<unsigned>(currentSensorUnavailableMask(millis())));
    used = appendKeyString(backendPayload, sizeof(backendPayload), inner, false,
                           "gas_state", mqStateName(mqState));
  }
  if (used >= sizeof(backendPayload)) return 0;
  backendPayload[used++] = '}';

  // items - the full registry.
  used = appendKey(backendPayload, sizeof(backendPayload), used, false, "items");
  if (used >= sizeof(backendPayload)) return 0;
  backendPayload[used++] = '[';
  {
    bool firstItem = true;
    for (uint8_t index = 0; index < inventoryCount; ++index) {
      const FoodItem& item = inventory[index];
      if (used + 2 >= sizeof(backendPayload)) return 0;
      // Comma BEFORE the brace, brace unconditionally. Writing a single
      // character that is '{' for the first element and ',' for the rest
      // silently omits the opening brace of every element after the first, so
      // the array is only valid JSON while it holds exactly one item. The same
      // defect existed in the events loop below, and together they meant the
      // device could never report two food items or two alerts - the payload
      // became malformed the moment a second one existed, and the backend
      // rejected the whole snapshot with HTTP 400.
      if (!firstItem) backendPayload[used++] = ',';
      backendPayload[used++] = '{';
      size_t inner = used;
      inner = appendKey(backendPayload, sizeof(backendPayload), inner, true, "uid");
      inner = appendUid(backendPayload, sizeof(backendPayload), inner, item);
      inner = appendKeyString(backendPayload, sizeof(backendPayload), inner, false, "name", item.name);
      inner = appendKeyString(backendPayload, sizeof(backendPayload), inner, false, "category", item.category);
      inner = appendKeyString(backendPayload, sizeof(backendPayload), inner, false, "quantity", item.quantity);
      inner = appendKeyString(backendPayload, sizeof(backendPayload), inner, false, "location", item.location);
      inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false,
                             "store_date_epoch", "%lu",
                             static_cast<unsigned long>(item.storeDateEpoch));
      inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false, "expiry_epoch", "%lu",
                             static_cast<unsigned long>(item.expiryEpoch));
      inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false,
                             "duration_limit_days", "%u",
                             static_cast<unsigned>(item.durationLimitDays));
      // Metadata supplied when the item was registered, so the dashboard can see
      // back what it sent. Always present, and always a number: 0 means the
      // manufacture date is unknown, which is a different statement from the key
      // being missing, and a reader should not have to tell those apart.
      // appendKeyValue, not appendKeyString - it is a number.
      inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false,
                             "manufacture_epoch", "%lu",
                             static_cast<unsigned long>(item.manufactureEpoch));
      inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false, "status", "%u",
                             // Scored against the epoch reported at the top of
                             // THIS snapshot, not against a second, independent
                             // read of the clock. A snapshot whose items were
                             // timed against a different instant than its own
                             // epoch is internally inconsistent, and the backend
                             // stores these statuses verbatim - it cannot
                             // reconstruct which time was used. epoch == 0 still
                             // yields Sensor Fault per item, exactly as before.
                             static_cast<unsigned>(analyseItemDuration(item, epoch)));
      used = inner;
      if (used >= sizeof(backendPayload)) return 0;
      backendPayload[used++] = '}';
      firstItem = false;
    }
  }
  if (used >= sizeof(backendPayload)) return 0;
  backendPayload[used++] = ']';

  // events - oldest-first from the local queue, capped by the service.
  used = appendKey(backendPayload, sizeof(backendPayload), used, false, "events");
  if (used >= sizeof(backendPayload)) return 0;
  backendPayload[used++] = '[';
  {
    bool firstEvent = true;
    uint8_t included = 0;
    // What THIS payload is about to claim, recorded as it is built so the
    // response can be checked against it id by id rather than against a hopeful
    // "the queue was non-empty when we started". Reset first: a builder that
    // returns 0 further down must not leave the previous build's ids looking
    // like the payload of a POST that then never happens.
    //
    // printSnapshot() runs this builder without sending anything. That is
    // harmless - every consumer reads these ids only between its own build and
    // its own parse, inside one call - but it is why the ids are copied here and
    // not read back later from anything the builder leaves lying around.
    inFlightEventCount = 0;
    while (included < BACKEND_MAX_EVENTS && included < queuedEventCount) {
      AlertEvent event;
      if (!peekQueuedEventAt(included, &event)) break;
      if (used + 2 >= sizeof(backendPayload)) return 0;
      // Comma before the brace, brace unconditionally. See the inventory loop:
      // a single '{' or ',' character makes the array valid only for one element.
      if (!firstEvent) backendPayload[used++] = ',';
      backendPayload[used++] = '{';
      {
        size_t inner = used;
        inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, true, "event_id", "%lu",
                               static_cast<unsigned long>(event.eventId));
        inner = appendKeyString(backendPayload, sizeof(backendPayload), inner, false, "type", event.type);
        // The tag, and ONLY when there is one. Two separate reasons, both of them
        // the difference between a working snapshot and a rejected one:
        //
        //   * appendKeyString, never appendKeyValue. A value writes the hex bare
        //     and the body stops being valid JSON, which the service rejects
        //     whole - the same failure `firmware` had further down, where one
        //     unquoted token cost every reading and every item.
        //   * omitted, not empty. `uid` is optional in the service schema but has
        //     a minimum length of 1, so `"uid":""` on the eleven event types
        //     that are not about a tag would be a validation error that took the
        //     readings down with it. An absent key is the honest encoding of "not
        //     about a tag" and is stored as NULL, never as a sentinel.
        if (event.uid[0] != '\0') {
          inner = appendKeyString(backendPayload, sizeof(backendPayload), inner, false, "uid", event.uid);
        }
        inner = appendKeyString(backendPayload, sizeof(backendPayload), inner, false, "message", event.message);
        inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false,
                               "timestamp_epoch", "%lu",
                               static_cast<unsigned long>(event.timestampEpoch));
        inner = appendKeyValue(backendPayload, sizeof(backendPayload), inner, false, "time_valid", "%s",
                               event.timeValid ? "true" : "false");
        used = inner;
      }
      if (used >= sizeof(backendPayload)) return 0;
      backendPayload[used++] = '}';
      firstEvent = false;
      // Recorded only once the event's bytes are actually in the payload: an id
      // counted here is an id the service will be asked about.
      if (inFlightEventCount < BACKEND_MAX_EVENTS) {
        inFlightEventIds[inFlightEventCount++] = event.eventId;
      }
      ++included;
    }
  }
  if (used >= sizeof(backendPayload)) return 0;
  backendPayload[used++] = ']';

  // config - the limits this device is ACTUALLY applying, plus the revision
  // they came from.
  //
  // This block was missing entirely. `config` is optional in the contract, so
  // every snapshot validated without it and nothing logged a warning: the
  // backend stored nulls and the dashboard showed whatever had been recorded
  // first. That is why the device-reported thresholds could not be trusted, and
  // it is the only way the backend can tell whether an administrator's saved
  // limits have actually reached the hardware. Without thresholds_rev there is
  // no way to distinguish "applied" from "saved but not yet fetched".
  //
  // The values written here are the same ones the verdict logic uses, read
  // through the same accessors, so what is reported cannot drift from what is
  // enforced.
  used = appendKey(backendPayload, sizeof(backendPayload), used, false, "config");
  if (used >= sizeof(backendPayload)) return 0;
  backendPayload[used++] = '{';
  {
    size_t cfg = used;
    // A string, so appendKeyString: appendKeyValue would emit the version bare
    // and make the whole snapshot invalid JSON, which the backend rejects
    // wholesale - the readings in it would be lost along with the config.
    cfg = appendKeyString(backendPayload, sizeof(backendPayload), cfg, true, "firmware",
                          "freshguard-0.2.0");
    cfg = appendKeyValue(backendPayload, sizeof(backendPayload), cfg, false, "thresholds_rev", "%lu",
                         static_cast<unsigned long>(activeThresholds.revision));
    cfg = appendKeyValue(backendPayload, sizeof(backendPayload), cfg, false, "door_timeout_ms", "%lu",
                         static_cast<unsigned long>(limitDoorOpenMs()));
    cfg = appendKeyValue(backendPayload, sizeof(backendPayload), cfg, false,
                         "consecutive_samples", "%u",
                         static_cast<unsigned>(THRESHOLD_CONSECUTIVE_SAMPLES));
    cfg = appendKey(backendPayload, sizeof(backendPayload), cfg, false, "thresholds");
    backendPayload[cfg++] = '{';
    size_t th = cfg;
    th = appendKeyFloatOrNull(backendPayload, sizeof(backendPayload), th, true,
                              "temperature_min_c", true, static_cast<double>(limitTempMinC()));
    th = appendKeyFloatOrNull(backendPayload, sizeof(backendPayload), th, false,
                              "temperature_max_c", true, static_cast<double>(limitTempMaxC()));
    th = appendKeyFloatOrNull(backendPayload, sizeof(backendPayload), th, false,
                              "humidity_min_pct", true, static_cast<double>(limitHumidityMinPct()));
    th = appendKeyFloatOrNull(backendPayload, sizeof(backendPayload), th, false,
                              "humidity_max_pct", true, static_cast<double>(limitHumidityMaxPct()));
    th = appendKeyFloatOrNull(backendPayload, sizeof(backendPayload), th, false,
                              "gas_delta_abnormal_mv", true, static_cast<double>(limitGasAbnormalMv()));
    th = appendKeyFloatOrNull(backendPayload, sizeof(backendPayload), th, false,
                              "gas_delta_clear_mv", true, static_cast<double>(limitGasClearMv()));
    th = appendKeyValue(backendPayload, sizeof(backendPayload), th, false, "use_soon_percent", "%u",
                        static_cast<unsigned>(limitUseSoonPct()));
    backendPayload[th++] = '}';
    cfg = th;
    cfg = appendKey(backendPayload, sizeof(backendPayload), cfg, false, "provenance");
    backendPayload[cfg++] = '{';
    size_t pr = cfg;
    // Reported per snapshot because whether these are sourced values or
    // prototype assumptions is the difference between a configured limit and a
    // guess, and it must travel with the numbers rather than sit in a comment.
    pr = appendKeyString(backendPayload, sizeof(backendPayload), pr, true, "source",
                         activeThresholds.configured ? "administrator_configured" : "prototype_assumption");
    pr = appendKeyString(backendPayload, sizeof(backendPayload), pr, false, "reference",
                         activeThresholds.configured ? "administrator configuration" : "");
    pr = appendKeyString(backendPayload, sizeof(backendPayload), pr, false, "note",
                         activeThresholds.configured
                             ? "configured at runtime by the administrator; not a certified food-safety limit"
                             : "compiled prototype band; not a certified food-safety limit");
    backendPayload[pr++] = '}';
    cfg = pr;
    used = cfg;
  }
  if (used >= sizeof(backendPayload)) return 0;
  backendPayload[used++] = '}';

  if (used + 2 >= sizeof(backendPayload)) return 0;
  backendPayload[used++] = '}';
  backendPayload[used] = '\0';
  return used;
}

// ============================================================================
// MQTT transport
// ============================================================================

static void buildMqttTopics() {
  snprintf(mqttStatusTopic, sizeof(mqttStatusTopic), "%s/%s/status",
           MQTT_BASE_TOPIC, BACKEND_DEVICE_ID);
  snprintf(mqttSnapshotTopic, sizeof(mqttSnapshotTopic), "%s/%s/snapshot",
           MQTT_BASE_TOPIC, BACKEND_DEVICE_ID);
  snprintf(mqttConfigTopic, sizeof(mqttConfigTopic), "%s/%s/config",
           MQTT_BASE_TOPIC, BACKEND_DEVICE_ID);
  snprintf(mqttCommandTopic, sizeof(mqttCommandTopic), "%s/%s/cmd",
           MQTT_BASE_TOPIC, BACKEND_DEVICE_ID);
}

// Longest command payload this firmware will look at. A register command is a
// flat object of short keys; the bound exists so a hostile or broken publisher
// cannot make the loop sit in a 1.5 KB memcpy, and so the scratch buffer below
// has a fixed, small, static cost. A name and a location made entirely of
// non-ASCII characters, escaped as \uXXXX, are the worst realistic case and fit
// comfortably.
static constexpr size_t MQTT_COMMAND_MAX_BYTES = 512;

// The broker callback. It runs from mqttClient.loop(), so it must be small, must
// not block, and must not call back into the MQTT client - doing that from
// inside a callback is a re-entrancy bug in the client, not just untidy.
// Applying the profile is pure arithmetic on a local buffer, so it is safe.
//
// This PubSubClient version fixes one callback at construction, so every topic
// this device subscribes to lands here and the topic decides what runs. The
// dispatch is exact-match on the full topic rather than a substring test: the
// config topic is ".../config" and the command topic is ".../cmd", and a
// misrouted message is either a threshold profile applied to an item or an item
// registration read as a profile.
//
// A push that arrives here is applied immediately, and requestBackendPost() then
// publishes a snapshot reporting the result, so the change is confirmed in
// the backend within one heartbeat rather than assumed.
// Replay and staleness gate for a command document. Runs BEFORE the op is
// dispatched, so a redelivered item.clear cannot reach the registry a second
// time and an item the operator abandoned cannot appear on the next power
// cycle.
//
// BOTH FIELDS ARE OPTIONAL, and that is the load-bearing part. The backend may
// not be sending either yet, and a command carrying neither must reach the
// dispatcher exactly as it did before this existed - no dedup, no expiry, and
// no write to flash. A gate that rejected fieldless commands would break the
// current backend the moment this firmware landed, so absence is treated as
// "no opinion" rather than as "expired" or "seq 0".
//
// A field that is PRESENT but unusable is refused rather than defaulted.
// Reading a malformed cmd_seq as 0 would quietly disable replay protection;
// reading it as valid would advance the high-water mark on a value nothing else
// agreed with. Both guesses are worse than saying no.
static bool commandIsFresh(const char* json) {
  uint32_t seq = 0;
  const uint8_t seqState = jsonReadUint32(json, "cmd_seq", &seq);
  if (seqState == JSON_FIELD_BAD) {
    Serial.println(F("[MQTT] cmd rejected: 'cmd_seq' is present but is not a"
                     " usable uint32; nothing applied"));
    return false;
  }
  uint32_t expiresAt = 0;
  const uint8_t expiryState = jsonReadUint32(json, "expires_at_epoch", &expiresAt);
  if (expiryState == JSON_FIELD_BAD) {
    Serial.println(F("[MQTT] cmd rejected: 'expires_at_epoch' is present but is"
                     " not a usable uint32; nothing applied"));
    return false;
  }

  const bool hasSeq = seqState == JSON_FIELD_OK;
  const bool hasExpiry = expiryState == JSON_FIELD_OK;
  const uint32_t now = currentReportEpoch(millis(), nullptr);

  if (hasSeq || hasExpiry) {
    Serial.printf("[Command] received cmd_seq=%s%lu expires_at_epoch=%s%lu"
                  " (now=%lu, lastAppliedCmdSeq=%lu)\n",
                  hasSeq ? "" : "absent:", hasSeq ? static_cast<unsigned long>(seq) : 0UL,
                  hasExpiry ? "" : "absent:", hasExpiry ? static_cast<unsigned long>(expiresAt) : 0UL,
                  static_cast<unsigned long>(now),
                  static_cast<unsigned long>(lastAppliedCmdSeq));
  }

  if (hasSeq && seq <= lastAppliedCmdSeq) {
    Serial.printf("[Command] duplicate/stale cmd_seq %lu ignored (already applied"
                  " or superseded by %lu); registry unchanged\n",
                  static_cast<unsigned long>(seq),
                  static_cast<unsigned long>(lastAppliedCmdSeq));
    return false;
  }
  // now == 0 means NO time source at all - no server anchor, no RTC, no last
  // good RTC read. A device in that state cannot know what time it is, and
  // treating epoch 0 as "everything is expired" would silently swallow every
  // expiring command on a device that has simply not synchronised yet. Unknown
  // time is not evidence of expiry, so the check is skipped.
  if (hasExpiry && now != 0 && now > expiresAt) {
    Serial.printf("[Command] expired cmd_seq %lu ignored (expiry %lu passed %lu s"
                  " ago); registry unchanged\n",
                  static_cast<unsigned long>(seq),
                  static_cast<unsigned long>(expiresAt),
                  static_cast<unsigned long>(now - expiresAt));
    return false;
  }
  return true;
}

static void onMqttMessage(char* topic, uint8_t* payload, unsigned int length) {
  if (topic == nullptr) return;

  if (strcmp(topic, mqttCommandTopic) == 0) {
    if (length == 0 || length >= MQTT_COMMAND_MAX_BYTES) {
      Serial.printf("[MQTT] cmd rejected: implausible length (%u bytes)\n",
                    static_cast<unsigned>(length));
      return;
    }
    static char command[MQTT_COMMAND_MAX_BYTES];
    memcpy(command, payload, length);
    command[length] = '\0';
    if (!commandIsFresh(command)) return;
    // One dispatcher for every op on this topic. See handleItemCommand().
    const bool applied = handleItemCommand(command);
    // The high-water mark advances only for a command that was really applied,
    // so a rejected command is still retryable and a redelivery of a CORRECTED
    // command is not mistaken for one already done.
    if (applied) {
      uint32_t seq = 0;
      if (jsonReadUint32(command, "cmd_seq", &seq) == JSON_FIELD_OK &&
          seq > lastAppliedCmdSeq) {
        lastAppliedCmdSeq = seq;
        // Persisted through the registry file, so a power cycle between here
        // and the next command cannot forget that this one was applied. That is
        // the window this exists for: the broker redelivers an unacked QoS 1
        // message, and without this the device re-applies it forever.
        //
        // After an item.clear this also RE-CREATES the file clearInventoryRegistry()
        // just deleted, now holding "FG2|0|<seq>" and no records. That is wanted,
        // not a mistake: a high-water mark that died with the registry would let a
        // redelivered item.clear arrive after the operator has since registered a
        // new item and erase it. The CLEAR log line above reports the deletion as
        // it happened; this line reports the file as it now stands.
        if (!saveInventory()) {
          Serial.printf("[Command] WARNING: cmd_seq %lu applied but could NOT be"
                        " persisted; a reboot will allow it to be replayed\n",
                        static_cast<unsigned long>(seq));
        } else {
          Serial.printf("[Command] applied and recorded; lastAppliedCmdSeq=%lu\n",
                        static_cast<unsigned long>(lastAppliedCmdSeq));
        }
      }
    }
    return;
  }

  if (strcmp(topic, mqttConfigTopic) != 0) {
    // A topic this device subscribed to for its own reasons. Not an error, and
    // not something to act on.
    return;
  }
  if (length == 0 || length >= 640) {
    Serial.println(F("[Limits] Config push rejected: implausible length"));
    return;
  }
  static char buffer[640];
  memcpy(buffer, payload, length);
  buffer[length] = '\0';
  const uint32_t applied = applyThresholdProfile(buffer);
  if (applied != 0) {
    Serial.printf("[Limits] Applied from broker, revision %lu\n",
                  static_cast<unsigned long>(applied));
    requestBackendPost();
  }
}

// ============================================================================
// Forcing the link down (Fix D)
// ============================================================================
//
// THE FAILURE THIS EXISTS TO END
//
// The device used to track one boolean, mqttConnected, set once on a successful
// connect() and never questioned again. serviceMqtt() saw it true, called
// loop() and returned. So if the broker connection died - silently dropped, NAT
// timeout, half-open socket - every publish returned false, every subscribe was
// already gone, and the device had no path back: it was connected, so it never
// reconnected, so it stayed broken until someone power-cycled it.
//
// The visible symptom was the worst kind. MQTT publishes failing is invisible by
// default, because the failure is indistinguishable from "no news". An item
// registration and a threshold revision were both sent to the broker and both
// were dropped, and the backend showed the dashboard happily receiving
// snapshots the whole time - because those were going out over HTTP once MQTT
// publish() started failing. Only a manual reset recovered it.
//
// The rule this function enforces: the device must never be able to believe it
// is connected while dropping everything. Three things can prove the link is
// gone - a rejected publish, a client that reports itself disconnected, and a
// run of failed loop() calls - and all three end here.
//
// The point is not the disconnect() call. It is that the next connect() path
// re-subscribes to BOTH topics and therefore re-receives the retained threshold
// profile and the command channel. A reconnect that skipped the subscribe would
// fix the publish path and leave the device deaf to the dashboard, which is
// half the bug.
//
// Logged once per TRANSITION, carrying the failure count. A device that is
// genuinely offline would otherwise print a line every loop iteration, and a
// log that scrolls past un-readable is the same as no log at all.
static void forceMqttReconnect(const char* reason) {
  const bool wasUp = mqttConnected || mqttClient.connected();
  const uint8_t state = mqttClient.state();
  const uint32_t failures = mqttPublishFailures;
  const uint8_t loopFailures = mqttLoopFailures;

  mqttConnected = false;
  mqttClient.disconnect();
  mqttPublishFailures = 0;
  mqttLoopFailures = 0;
  // Zeroed rather than set to now: the link is known bad, not cooling down, and
  // waiting a further 5 s to find that out again is exactly the latency this is
  // fixing. A broker that is genuinely down still cannot spin, because the
  // reconnect attempt below re-arms lastMqttAttemptMs on failure.
  lastMqttAttemptMs = 0;

  if (wasUp) {
    Serial.printf("[MQTT] Link lost: %s (%lu failed publish(es), %u failed"
                  " loop(s), state=%u). Forcing disconnect; the next connect"
                  " re-subscribes to config and cmd and re-reads the retained"
                  " config\n",
                  reason, static_cast<unsigned long>(failures),
                  static_cast<unsigned>(loopFailures), static_cast<unsigned>(state));
  }
}

/**
 * MQTTRECONNECT - operator-triggered diagnostic.
 *
 * Calls forceMqttReconnect() directly, so it exercises the EXACT teardown and
 * recovery path a real publish failure takes, on demand, without anybody having
 * to wait for a broker to drop or pull a cable. That matters because the Fix D
 * failure was invisible by construction: nothing on the device or the dashboard
 * said "I am connected and dropping everything", so the only way to be confident
 * the recovery works is to be able to trigger it deliberately and watch what
 * comes back.
 *
 * A diagnostic, not a behaviour change: it reaches no state that a real failure
 * does not already reach, and it takes no argument.
 */
static void reportMqttReconnectDiagnostic() {
  if (!mqttConfigured) {
    Serial.println(F("[MQTT] Not configured; nothing to reconnect"));
    return;
  }
  Serial.printf("[MQTT] Diagnostic: forcing the link down (was %s/%s, state=%u,"
                " buffer=%u B, %lu failed publish(es), %u failed loop(s))\n",
                mqttConnected ? "connected" : "disconnected",
                mqttClient.connected() ? "connected" : "disconnected",
                mqttClient.state(), mqttClient.getBufferSize(),
                static_cast<unsigned long>(mqttPublishFailures),
                static_cast<unsigned>(mqttLoopFailures));
  forceMqttReconnect("operator diagnostic");
  Serial.println(F("[MQTT] Diagnostic: link down. The next service pass should"
                   " reconnect, re-subscribe to config and cmd, and re-receive"
                   " the retained config."));
}

static void serviceMqtt(uint32_t nowMs) {
  if (!mqttConfigured) return;
  if (mqttConnected) {
    // PubSubClient needs keepalive pings driven from the loop, otherwise the
    // broker drops the session and every publish silently fails.
    const bool loopOk = mqttClient.loop();
    if (!loopOk) {
      if (mqttLoopFailures < 255) ++mqttLoopFailures;
      if (mqttLoopFailures >= MQTT_LOOP_FAILURE_LIMIT) {
        forceMqttReconnect("consecutive loop failures");
      }
      return;
    }
    // A client can report a healthy loop() while the underlying socket is gone;
    // connected() is the client's own view of the link and is checked every
    // pass, not only when a publish happens to fail.
    if (!mqttClient.connected()) {
      forceMqttReconnect("client reports the link is down");
      return;
    }
    mqttLoopFailures = 0;
    return;
  }
  if (static_cast<uint32_t>(nowMs - lastMqttAttemptMs) < MQTT_RECONNECT_INTERVAL_MS) return;
  lastMqttAttemptMs = nowMs;

  const bool useAuth = configuredSecret(MQTT_USER);
  // cleanSession = false, via PubSubClient's 8-argument overload. This is the
  // whole reason the command channel is durable.
  //
  // The 2- and 3-argument overloads hardcode cleanSession = TRUE. With a clean
  // session the broker keeps NO session for this client, so an admin command
  // published while the device is off has nowhere to queue and is destroyed at
  // publish time - the operator sees "Dispatched" and nothing ever happens, with
  // no error on either side. The broker counters said so: messages/dropped = 0
  // (nothing overflowed) and store/messages/bytes = 384 (store essentially
  // empty), with ~2000 publishes to zero subscribers. That is clean-session
  // discard, not queue overflow, so the fix belongs here and not in a buffer
  // size.
  //
  // clientID stays BACKEND_DEVICE_ID. It IS the session key the broker files the
  // queued messages under, so a "cleanup" of this argument would orphan the
  // queue instead of delivering it.
  //
  // user/pass are passed as nullptr, not "", when auth is unconfigured. PubSubClient
  // 2.8 sets the CONNECT username flag on `user != NULL` without testing the
  // length, so an empty string would put a zero-length username on the wire -
  // a different CONNECT packet from the connect(id) this replaces, and one some
  // brokers reject outright.
  const char* mqttUser = useAuth ? MQTT_USER : nullptr;
  const char* mqttPass = useAuth ? MQTT_PASSWORD : nullptr;
  const bool ok = mqttClient.connect(BACKEND_DEVICE_ID, mqttUser, mqttPass,
                                     mqttStatusTopic, MQTT_WILL_QOS, true,
                                     MQTT_WILL_OFFLINE, false);
  if (!ok) {
    // Log the first MQTT_RECONNECT_TRACE_ATTEMPTS attempts unconditionally, then
    // fall back to logging only a CHANGE of state.
    //
    // State-change-only alone is a real observability hole, and this is where it
    // bit: a device that was reconnecting every 5 s and failing on every one of
    // them printed nothing after the first, so "silent" was indistinguishable
    // from "not trying" - and the STATUS line could not tell them apart either.
    // The brief's rule is no per-attempt spam, and three lines at the start of a
    // reconnect episode is not spam: it establishes that attempts are happening
    // at all, and then the run is quiet until the state actually changes.
    static uint8_t attempts = 0;
    const uint8_t code = mqttClient.state();
    if (attempts < MQTT_RECONNECT_TRACE_ATTEMPTS) {
      ++attempts;
      Serial.printf("[MQTT] Reconnect attempt %u/%u failed, state=%u"
                    " (lastMqttAttemptMs=%lu, gate=%u ms); retrying every %u ms\n",
                    static_cast<unsigned>(attempts),
                    static_cast<unsigned>(MQTT_RECONNECT_TRACE_ATTEMPTS),
                    static_cast<unsigned>(code),
                    static_cast<unsigned long>(lastMqttAttemptMs),
                    static_cast<unsigned>(MQTT_RECONNECT_INTERVAL_MS),
                    static_cast<unsigned>(MQTT_RECONNECT_INTERVAL_MS));
    } else {
      static uint8_t reported = 0;
      if (reported != code) {
        reported = code;
        Serial.printf("[MQTT] connect failed, state=%u; HTTP fallback stays"
                      " available\n", static_cast<unsigned>(code));
      }
    }
    return;
  }
  mqttConnected = true;
  mqttPublishFailures = 0;
  mqttLoopFailures = 0;
  ++mqttConnects;
  Serial.printf("[MQTT] connected to %s:%u as %s (connection #%lu); session is"
                " PERSISTENT (cleanSession=false, LWT QoS %u retained on %s), so"
                " commands published while offline are queued and delivered on"
                " this reconnect\n",
                MQTT_BROKER_HOST, static_cast<unsigned>(MQTT_BROKER_PORT),
                BACKEND_DEVICE_ID, static_cast<unsigned long>(mqttConnects),
                static_cast<unsigned>(MQTT_WILL_QOS), mqttStatusTopic);
  // Subscribe to the administrator's threshold profile. The broker retains the
  // last one, so this delivers it on connect even if the device was powered off
  // when the change was saved - which is the case an HTTP poll would only
  // resolve on its next successful request, and not at all while the port is
  // unreachable.
  //
  // The broker callback is fixed at construction in this PubSubClient version -
  // there is no setCallback() - so the handler is declared before the client and
  // passed into the constructor, and it serves both subscriptions below by
  // dispatching on the topic. The only alternative is polling the config
  // topic, which reintroduces the delay and the unreachable-port problem the
  // push is meant to solve.
  mqttClient.subscribe(mqttConfigTopic, 1);
  // The dashboard's command channel, alongside the config channel and at the
  // same QoS 1. This is what lets an item be added from the dashboard instead of
  // over a serial cable.
  //
  // Its result is checked, unlike the config subscribe above: a failure here is
  // silent from the operator's point of view - the dashboard would simply never
  // register anything, with no error anywhere - and the fix is one reconnect
  // away, so it is worth a line to say so.
  if (!mqttClient.subscribe(mqttCommandTopic, 1)) {
    Serial.printf("[MQTT] subscribe to %s failed; dashboard registration is"
                  " unavailable until the next reconnect\n", mqttCommandTopic);
  }
  mqttClient.publish(mqttStatusTopic, "offline", true);
  mqttClient.publish(mqttStatusTopic, "online", true);
}

static bool mqttPublishSnapshot(const char* payload, size_t length) {
  if (!mqttConfigured) return false;
  // The exact "believed it was connected" state, caught at the one place that
  // acts on it. Without this the call would return false, the HTTP fallback
  // would carry the snapshot, and the device would keep believing a link that
  // was already gone.
  if (mqttConnected && !mqttClient.connected()) {
    forceMqttReconnect("client was gone before publish");
    return false;
  }
  if (!mqttConnected) return false;
  const bool published = mqttClient.publish(mqttSnapshotTopic, reinterpret_cast<const uint8_t*>(payload),
                                            static_cast<unsigned>(length), false);
  if (!published) {
    ++mqttPublishFailures;
    // A publish can fail without the socket being dead - the packet is larger
    // than the buffer, or the broker rejects the QoS - so the counter is kept
    // for the log line, but a single rejection is not by itself proof of a
    // dead link. The link is torn down regardless: the alternative is the exact
    // silent-drop behaviour this replaces, and one reconnect costs a TCP
    // handshake. HTTP carries the snapshot either way, so nothing is lost.
    forceMqttReconnect("publish rejected");
    return false;
  }
  mqttPublishFailures = 0;
  return true;
}

static uint32_t fetchAndApplyThresholds(uint32_t nowMs) {
  if (!backendConfigured) return activeThresholds.revision;
  // An explicit "never fetched" flag rather than relying on lastThresholdFetchMs
  // starting at 0. millis() also starts at 0, so a zero-initialised timestamp
  // makes nowMs - lastThresholdFetchMs look like a few seconds have passed -
  // which is under the interval, so the very first fetch was skipped and then
  // the timer restarted from there. The device booted, never asked, and printed
  // nothing, because the path that applies the administrator's limits simply
  // had not run yet.
  if (thresholdsFetched &&
      static_cast<uint32_t>(nowMs - lastThresholdFetchMs) < THRESHOLD_FETCH_INTERVAL_MS) {
    return activeThresholds.revision;
  }
  lastThresholdFetchMs = nowMs;
  thresholdsFetched = true;

  static char url[192];
  static char response[768];
  const int written = snprintf(url, sizeof(url),
                               "%s/api/v1/devices/%s/thresholds/apply",
                               BACKEND_URL, BACKEND_DEVICE_ID);
  if (written < 0 || static_cast<size_t>(written) >= sizeof(url)) return activeThresholds.revision;

  WiFiClient plainClient;
  HTTPClient http;
  if (!http.begin(plainClient, url)) return activeThresholds.revision;
  http.setTimeout(HTTP_TIMEOUT_MS);
  const int code = http.GET();
  size_t length = 0;
  if (code == 200) {
    // getStream() is the public body accessor in ESP8266 core 3.1.2; payload()
    // is private there. Reading the body through the stream also avoids the
    // whole-payload allocation, which matters on a device with ~30 KB free.
    WiFiClient& stream = http.getStream();
    while (stream.connected() && stream.available() && length < sizeof(response) - 1) {
      const int c = stream.read();
      if (c < 0) break;
      response[length++] = static_cast<char>(c);
    }
    response[length] = '\0';
  }
  http.end();
  ESP.wdtFeed();

  if (code != 200 || length == 0) {
    // The FIRST failure is always logged. The previous version only logged once
    // the 5-minute warning interval had elapsed, which at boot means
    // nowMs - lastThresholdWarnMs is small and nothing is printed at all - so a
    // fetch that never worked looked identical to a fetch that had nothing to
    // report. A silent failure in the one path that applies the administrator's
    // configuration is exactly the failure that must never be silent.
    if (lastThresholdWarnMs == 0 ||
        static_cast<uint32_t>(nowMs - lastThresholdWarnMs) >= 300000UL) {
      lastThresholdWarnMs = nowMs;
      Serial.printf("[Limits] Fetch failed (HTTP %d, %u bytes); compiled defaults"
                    " remain in force\n", code, static_cast<unsigned>(length));
    }
    return activeThresholds.revision;
  }
  lastThresholdWarnMs = 0;   // success clears the streak
  return applyThresholdProfile(response);
}

// ============================================================================
// Queue acknowledgement: what is allowed to free a slot
// ============================================================================
//
// A pending slot carries TWO obligations, and this file used to have only one.
//
//   A. BACKEND STORAGE. The service must hold a row for this event_id, or the
//      dashboard, the identify panel and the history simply do not contain the
//      event. This is the obligation the operator was staring at.
//   B. NOTIFICATION. The webhook, if this build has one configured, must have
//      been handed the event.
//
// They used to be the same condition: serviceTransport() freed a slot only after
// notificationTransport.send() returned a 2xx, and notificationTransport
// .configured() is false on any build where IFTTT_TLS_FINGERPRINT_ENABLED is
// still false (initializeNetworkConfiguration). On a build with no IFTTT key the
// queue could therefore NEVER drain: slots were never freed, every later
// presentation of the same tag hit the coalescing path in appendAlertEvent(), the
// same event_id was re-sent and re-de-duped, and a tag held to the reader for
// five seconds produced no new row, no SSE event and no identify panel.
// pending_count sat at 3 for hours.
//
// WHAT COUNTS AS ACCEPTED (obligation A)
//
// The snapshot response is the only place the service ever tells this device what
// it stored, so that - not the notification transport, which never sees the
// backend at all - is where the answer comes from. ALL of the following must hold
// for the response to the snapshot that carried the id:
//
//   1. HTTP 2xx.
//   2. outcome == "stored". A bare 2xx is NOT enough: routes.js answers 200 for a
//      snapshot the service declined to write, with outcome "stale" and
//      reason "replay", because a replay is a normal outcome of at-least-once
//      delivery and not something the device should back off hard over. So 2xx
//      only ever means "the request was understood". "stored" is the outcome
//      under which the service's own single db.transaction - device row, reading,
//      inventory AND events - is guaranteed to have committed every byte of this
//      payload. Deciding to pop on the strength of a side effect of a REJECTED
//      transaction is exactly the class of invisible loss this rule exists to
//      close, so the firmware does not lean on it one way or the other.
//   3. events.received == the number of event_ids this firmware actually put in
//      the payload, AND events.inserted + events.duplicates == events.received.
//      This is a conservation law over the service's own accounting: every id we
//      sent must come back as either a fresh row (inserted) or a row the service
//      already held for it (duplicates). A service that reported 4 sent and 2
//      accounted for would be caught here instead of believed.
//
// WHY IT CANNOT LOSE AN EVENT
//
// The pop is driven ONLY by a positive, id-specific statement. Every other
// outcome leaves the slot exactly where it was, and each one is logged:
//   - non-2xx, timeout, refused connection  -> nothing parsed, no pop.
//   - 2xx with an absent, truncated or unparseable body -> the fields come back
//     ABSENT/BAD, conditions 2 and 3 fail, no pop. (This is also why
//     INGEST_ACK_CAPACITY had to grow: a body cut short must read as "not
//     acknowledged", never as "acknowledged by accident".)
//   - 2xx with outcome "stale"/"replay"    -> condition 2 fails, no pop.
//   - 2xx, stored, counts that do not add up -> condition 3 fails, no pop.
// The failure direction is therefore always "the event stays on flash and is
// re-sent", which is at-least-once, and never "the slot is freed and the record
// is gone", which is at-most-once and invisible. Nothing here can pop an id the
// backend has not already seen at least once, because the only source of a pop is
// a body counting that id as inserted or as an existing duplicate.
//
// WHY A COALESCED SLOT IS SAFE TO POP
//
// While a slot is pending, re-presenting the same (type, uid) refreshes it in
// place and keeps its event_id (appendAlertEvent), and the service de-duplicates
// on (device_id, boot_generation, event_id) - so the ID is what a row is keyed by,
// not the text. Three consequences, all deliberate:
//   - The ids in the payload at build time are the ids still on flash at response
//     time: buildBackendSnapshot(), the POST and the parse all run inside one call
//     on the loop task with no other sketch code in between, so a refresh can
//     never tear a slot across its own acknowledgement. serviceQueue
//     Acknowledgement() re-peeks by id and removeQueuedEvent() re-checks the CRC
//     before it clears anything.
//   - A refresh landing inside that window cannot be rescued by withholding the
//     pop: the service would IGNORE it under the same event_id on every later
//     attempt too, so that text was unreachable either way. Freeing the slot is
//     what lets the NEXT presentation allocate a NEW event_id, which is the only
//     route refreshed content ever has to a new row.
//   - Every payload takes the queue from ordinal 0 upwards, so the oldest slot is
//     always in the batch: the drain can never run ahead of what has been sent.
//
// OBLIGATION B IS VACUOUS WHEN NO TRANSPORT IS CONFIGURED
//
// serviceQueueAcknowledgement() demands both A and B, and B is defined as
// satisfied when notificationTransport.configured() is false - there is no
// notification to deliver, so there is nothing outstanding. When a transport IS
// configured the slot waits for it too, and deliberately so: popping on the
// backend's word alone would leave the webhook nothing to retry, and an event
// dropped on the floor after a single failed POST is the same silent loss
// class as the one above, just on the other transport. The retry stays bounded
// by ALERT_RETRY_INTERVAL_MS, so an outage recovers; the cost of holding a slot
// is visible in queuedEventCount and in the [Queue] lines below.
static bool storageAcknowledged(uint32_t eventId) {
  if (eventId == 0) return false;
  for (uint8_t index = 0; index < storageAckedEventCount; ++index) {
    if (storageAckedEventIds[index] == eventId) return true;
  }
  return false;
}

// Copy the ids the payload just carried into the confirmed set.
//
// Replaced outright rather than appended. The set is only ever compared against
// ids that are on flash NOW, ids are never issued twice in one boot, and an
// append would let it grow without bound whenever obligation B was holding slots
// back - 96 bytes of RAM spent remembering ids that have already been popped.
static void recordStorageAcknowledgement() {
  storageAckedEventCount = 0;
  for (uint8_t index = 0; index < inFlightEventCount && index < BACKEND_MAX_EVENTS; ++index) {
    storageAckedEventIds[storageAckedEventCount++] = inFlightEventIds[index];
  }
}

/**
 * Does the queue still hold any slot the service has not confirmed a row for?
 *
 * Read by the MQTT/HTTP choice in sendBackendSnapshot(), so it has to be honest
 * in the conservative direction: an unreadable slot or an empty queue file
 * returns "yes, still waiting" only where that is the safe reading - an empty
 * queue returns false (nothing to confirm), a slot that cannot be CRC-checked
 * returns true (do not go quiet about it).
 *
 * Every slot is walked, not just the head. Head-only would be enough for forward
 * progress - the head is always the first id in every payload, so it confirms
 * first and the rest follow - but it would let a newer event sit unconfirmed
 * behind an older one that obligation B is still holding, and each of those
 * passes would publish over MQTT, which carries no response to confirm anything
 * with. Walking the whole queue costs one LittleFS read per slot and happens
 * once per snapshot at most.
 */
static bool queueAwaitingBackendAck() {
  if (!queueReady || queuedEventCount == 0) return false;
  for (uint8_t index = 0; index < ALERT_QUEUE_CAPACITY; ++index) {
    QueueSlotDisk slot;
    if (!queueReadSlot(index, &slot)) return true;   // unreadable: assume unconfirmed
    if (slot.syncState != 1) continue;
    if (!storageAcknowledged(slot.eventId)) return true;
  }
  return false;
}

/**
 * Could the HTTP leg of sendBackendSnapshot() actually run in this build?
 *
 * It is the fallback condition for the MQTT preference below. Skipping the MQTT
 * publish in favour of HTTP is right only while HTTP can still carry the
 * snapshot; against an https BACKEND_URL with no pinned fingerprint the POST
 * refuses before it starts, and giving up a healthy broker for a request that
 * cannot be made would trade "no acknowledgement" for "no delivery", which is
 * strictly worse. The events stay queued either way, but a snapshot skipped
 * while the broker was up is a reading the dashboard never gets.
 */
static bool backendHttpUsable() {
  if (!backendConfigured) return false;
  return strncmp(BACKEND_URL, "https", 5) != 0 || BACKEND_TLS_FINGERPRINT_ENABLED;
}

/**
 * Free every slot whose BOTH obligations have settled.
 *
 * Local work only - it opens no socket, blocks on nothing and spends no HTTP
 * budget - so it runs on every transport pass regardless of what else is due. A
 * slot that became eligible should leave on this pass, not on the next
 * notification retry; holding it for a timer would only widen the window in which
 * a re-presentation coalesces into a slot the backend already has.
 *
 * Walks by ordinal rather than by "the head", because the settled slots are not
 * necessarily a prefix: obligation B can only ever have been settled for the slot
 * the notification leg last offered, and a later append may have taken a lower
 * free slot and become the new ordinal 0. Ordinal is NOT advanced after a
 * successful removal - the next slot slides into the one just vacated - and is
 * advanced on anything that does not pop, so the loop always terminates inside
 * ALERT_QUEUE_CAPACITY iterations.
 */
static void serviceQueueAcknowledgement(uint32_t nowMs) {
  if (!queueReady || queuedEventCount == 0) return;
  const bool webhookObligation = notificationTransport.configured();
  uint8_t ordinal = 0;
  while (ordinal < queuedEventCount) {
    AlertEvent event;
    if (!peekQueuedEventAt(ordinal, &event)) return;
    if (!storageAcknowledged(event.eventId)) {
      // Obligation A outstanding. Nothing to do and nothing to complain about
      // HERE: sendBackendSnapshot() prints the [Queue] line that says the backend
      // did not acknowledge, on the response that failed to.
      ++ordinal;
      continue;
    }
    if (webhookObligation && webhookDeliveredEventId != event.eventId) {
      // Obligation B outstanding. The notification leg is what settles it, at
      // ALERT_RETRY_INTERVAL_MS, and only for the head of the queue.
      ++ordinal;
      continue;
    }
    if (!removeQueuedEvent(event.eventId)) {
      // Flash refused the write. Throttled because this runs on every loop
      // iteration, not on the 5 s transport cadence the old code did - an
      // unthrottled retry here would bury the serial console in a second.
      static uint32_t lastRemovalWarnMs = 0;
      if (lastRemovalWarnMs == 0 ||
          static_cast<uint32_t>(nowMs - lastRemovalWarnMs) >= 300000UL) {
        lastRemovalWarnMs = nowMs;
        Serial.printf("[Queue] Event %lu acknowledged by backend but its slot"
                      " could not be cleared; retained\n",
                      static_cast<unsigned long>(event.eventId));
      }
      return;
    }
    if (webhookDeliveredEventId == event.eventId) webhookDeliveredEventId = 0;
    Serial.printf("[Queue] Event %lu acknowledged by backend; slot freed\n",
                  static_cast<unsigned long>(event.eventId));
  }
}

/**
 * Send one snapshot to the backend.
 *
 * `replayProbe` turns this into a pure clock read. See
 * serviceServerTimeSync() for why that has to exist at all - the short version is
 * that when MQTT is healthy this function returns at the publish below and the
 * HTTP POST never runs, so the device would never see the server timestamp that
 * the entire time fix depends on. The probe re-sends the SAME sequence number,
 * which the service recognises as a replay: HTTP 200, `outcome: "stale"`, no
 * state write, no reading row, no alert - and a body that still carries
 * `server_time_epoch`.
 *
 * On the probe path the sequence is NOT advanced and notePublishedReadings() is
 * NOT called, so the device's own change detection and the backend's stored
 * state are both untouched. The probe can only ever read the server's clock.
 */
static bool sendBackendSnapshot(uint32_t nowMs, bool replayProbe = false) {
  if (!backendConfigured) {
    if (!backendConfigWarned) {
      backendConfigWarned = true;
      Serial.println(F("[Backend] Disabled until URL + ingest key are set"));
    }
    return false;
  }

  size_t length = buildBackendSnapshot(nowMs);
  if (length == 0) {
    Serial.println(F("[Backend] Snapshot exceeded the payload budget; not sent"));
    return false;
  }

  // MQTT first. The payload is byte-identical to the HTTP body, so the backend
  // runs one ingest pipeline for both and the snapshot contract does not fork.
  //
  // backendSeq MUST be advanced here, not only on the HTTP success path below.
  // Returning before the increment left the device publishing seq=0 forever:
  // the service correctly recognised every snapshot after the first as a replay
  // and did not refresh the transport timestamp, so the dashboard reported the
  // link as stale while snapshots were visibly arriving. The sequence is what
  // distinguishes a genuinely new reading from a redelivery, so it has to
  // advance whenever a snapshot is handed to a transport.
  //
  // The probe path skips this block entirely. It must reach the POST, and it must
  // not consume a sequence number to do so.
  //
  // THE PROBE PATH ALSO SKIPS IT, AND THE QUEUE SKIPS IT FOR A DIFFERENT REASON.
  //
  // MQTT has no response. A snapshot published here is ingested by the service,
  // but nothing comes back, so storageAckedEventIds never fills - and by the rule
  // above, an unfilled set means no slot may ever be freed. Gating the drain on
  // MQTT delivery would be worse than the bug it replaces (a publish only proves
  // the broker took the bytes, not that the service wrote the row), so while ANY
  // pending slot is unconfirmed this snapshot takes the HTTP leg instead: same
  // bytes, same ingest pipeline, no additional request - it was going to be sent
  // on this pass either way - and one response to read the acknowledgement from.
  //
  // The preference is dropped when HTTP could not carry it at all, see
  // backendHttpUsable(). It is dropped the moment the queue is fully confirmed,
  // so a healthy broker is only bypassed for the few passes it takes to drain.
  const bool preferHttpForAck = !replayProbe && queueAwaitingBackendAck() && backendHttpUsable();
  if (!replayProbe && !preferHttpForAck && mqttPublishSnapshot(backendPayload, length)) {
    ++backendSeq;
    notePublishedReadings();
    Serial.printf("[MQTT] seq %lu published (%u bytes)\n",
                  static_cast<unsigned long>(backendSeq),
                  static_cast<unsigned>(length));
    return true;
  }

  int urlLength = snprintf(backendUrl, sizeof(backendUrl),
                           "%s/api/v1/ingest/devices/%s/snapshots",
                           BACKEND_URL, BACKEND_DEVICE_ID);
  if (urlLength < 0 || static_cast<size_t>(urlLength) >= sizeof(backendUrl)) {
    Serial.println(F("[Backend] URL does not fit; check BACKEND_URL"));
    return false;
  }

  // HTTPS needs a pinned fingerprint; plain HTTP must not pretend to have one.
  if (backendUrl[0] == 'h' && backendUrl[1] == 't' && backendUrl[2] == 't' && backendUrl[3] == 'p' &&
      backendUrl[4] == 's') {
    if (!BACKEND_TLS_FINGERPRINT_ENABLED) {
      if (!backendConfigWarned) {
        backendConfigWarned = true;
        Serial.println(F("[Backend] https URL needs BACKEND_TLS_FINGERPRINT_ENABLED + a real fingerprint"));
      }
      return false;
    }
    if (!transportTls.setFingerprint(BACKEND_TLS_FINGERPRINT)) return false;
  }

  HTTPClient http;
  if (strncmp(backendUrl, "https", 5) == 0) {
    if (!http.begin(transportTls, backendUrl)) return false;
  } else {
    // ESP8266 core 3.1.2 removed the bare-URL overload; a plain client must be
    // passed explicitly. It is scoped to this call so the TLS handle is never
    // reused for cleartext.
    WiFiClient plainClient;
    if (!http.begin(plainClient, backendUrl)) return false;
  }
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-FreshGuard-Key", BACKEND_INGEST_KEY);

  int code = http.POST(reinterpret_cast<const uint8_t*>(backendPayload), length);

  // The acknowledgement this response carries, and the reason the buffer below
  // exists at all. Everything is decided here, between the POST and the end(),
  // because http.end() tears the connection down and the body goes with it.
  bool storageConfirmed = false;
  char outcomeText[16];
  char reasonText[24];
  outcomeText[0] = '\0';
  reasonText[0] = '\0';
  uint32_t eventsReceived = 0;
  uint32_t eventsInserted = 0;
  uint32_t eventsDuplicates = 0;
  bool eventsReported = false;
  size_t ackLength = 0;

  // The server's own clock comes out of the same body, and it is the only time
  // source that does not depend on the DS3231 at all. The body is read through
  // the stream for the same reason the threshold fetch does: getStream() is the
  // public accessor in ESP8266 core 3.1.2 and it avoids a whole-payload copy on
  // a device this size.
  //
  // Absent is a normal, expected case and not an error: a backend older than
  // this firmware has no such field, and the device then falls through to the
  // monotonic rtc_offset path and reports THAT as its source. The value is read
  // with the exact integer decoder rather than jsonFindNumber() - strtof's 24-bit
  // mantissa turns 1787900000 into 1787899904, and a 96-second error in a time
  // source is the same class of bug as the frozen clock it exists to replace.
  if (code >= 200 && code < 300) {
    static char ingestAck[INGEST_ACK_CAPACITY];
    WiFiClient& ackStream = http.getStream();
    // POST() returns on the response HEADERS, not on the last byte of the body,
    // and the loop below used to take whatever happened to be buffered at that
    // instant. On a LAN the body usually arrives with the headers and the read
    // looks reliable; it is still a coin flip, and now it is a coin flip with the
    // queue drain hanging off it - a SHORT read is indistinguishable from a
    // backend that never answered, and the acknowledgement fields sit near the
    // end of the body behind `note`. So the read is bounded but patient: drain
    // what is present, give the stack a tick to let lwIP deliver the rest, and
    // stop on the advertised length, a closed peer, a full buffer or a deadline -
    // never on an arbitrary "nothing was available yet".
    const int expectedLength = http.getSize();   // -1 when the server does not say
    const uint32_t ackDeadline = millis() + HTTP_TIMEOUT_MS;
    while (ackLength < sizeof(ingestAck) - 1) {
      bool progressed = false;
      while (ackStream.available() && ackLength < sizeof(ingestAck) - 1) {
        const int c = ackStream.read();
        if (c < 0) break;
        ingestAck[ackLength++] = static_cast<char>(c);
        progressed = true;
      }
      if (expectedLength >= 0 && ackLength >= static_cast<size_t>(expectedLength)) break;
      if (!ackStream.connected()) break;
      if (!progressed && static_cast<int32_t>(millis() - ackDeadline) >= 0) break;
      if (!progressed) delay(1);
    }
    ingestAck[ackLength] = '\0';
    if (ackLength > 0) {
      uint32_t serverSeconds = 0;
      if (jsonReadUint32(ingestAck, "server_time_epoch", &serverSeconds) == JSON_FIELD_OK) {
        rememberServerTime(serverSeconds, millis());
      }

      // The rule from above, evaluated against the ids THIS payload carried.
      // Every field is read with the tri-state decoders and every ABSENT counts
      // as a failure of the rule, never as a pass: a body that was cut short, a
      // backend that omitted `events`, or a field that was not the type expected
      // all leave the slot exactly where it is.
      //
      // Deliberately NOT gated on `reason`. `reason` explains WHY the outcome is
      // what it is (`seq_advanced`, `uptime_reset`, `first_contact`, `replay`) and
      // is printed on the failure line because that is what an operator needs to
      // tell "the backend is behind" from "the backend refused this"; it plays no
      // part in the decision, because `outcome` already carries the only
      // distinction that matters.
      jsonReadString(ingestAck, "outcome", outcomeText, sizeof(outcomeText));
      jsonReadString(ingestAck, "reason", reasonText, sizeof(reasonText));
      eventsReported =
          jsonReadUint32(ingestAck, "received", &eventsReceived) == JSON_FIELD_OK &&
          jsonReadUint32(ingestAck, "inserted", &eventsInserted) == JSON_FIELD_OK &&
          jsonReadUint32(ingestAck, "duplicates", &eventsDuplicates) == JSON_FIELD_OK;
      storageConfirmed =
          !replayProbe && inFlightEventCount > 0 &&
          strcmp(outcomeText, "stored") == 0 && eventsReported &&
          eventsReceived == static_cast<uint32_t>(inFlightEventCount) &&
          (eventsInserted + eventsDuplicates) == eventsReceived;
    }
  }
  http.end();
  ESP.wdtFeed();

  bool ok = (code >= 200 && code < 300);
  // The sequence advances only on acceptance. A rejected snapshot is re-sent
  // verbatim next tick, which is safe: the service ignores a seq it has seen.
  //
  // Never on the probe path. A probe that consumed a sequence number would
  // fabricate a reading out of a request whose entire purpose was to read a
  // clock, and would make the device's published sequence non-monotonic for no
  // reason. The probe's whole guarantee is that it changes nothing.
  if (ok && !replayProbe) {
    ++backendSeq;
    // Only on acceptance, for the same reason: the change detector compares
    // against what the backend actually holds, and a 4xx means it does not hold
    // this yet.
    notePublishedReadings();
  }

  if (replayProbe) {
    // Deliberately terse. This runs on a timer for the life of the device, and a
    // line per probe would bury the lines that mean something. Failures are not
    // silent, though: an unreachable server is exactly the condition the RTC
    // fallback exists for, and the operator has to be able to see it.
    static uint32_t lastProbeWarnMs = 0;
    if (!ok) {
      if (lastProbeWarnMs == 0 ||
          static_cast<uint32_t>(nowMs - lastProbeWarnMs) >= 300000UL) {
        lastProbeWarnMs = nowMs;
        TimeSource probeSource = TimeSource::None;
        currentAuthorityEpoch(nowMs, &probeSource);
        Serial.printf("[Time] Server clock probe failed (HTTP %d); the device"
                      " keeps time from %s\n", code, timeSourceName(probeSource));
      }
    } else {
      lastProbeWarnMs = 0;
    }
    return ok;
  }

  if (!ok || code == 400 || code == 413) {
    Serial.printf("[Backend] seq %lu HTTP %d (%u bytes)\n",
                  static_cast<unsigned long>(backendSeq), code, static_cast<unsigned>(length));
  } else {
    Serial.printf("[Backend] seq %lu accepted, %u items, %u pending (%u bytes)\n",
                  static_cast<unsigned long>(backendSeq),
                  static_cast<unsigned>(inventoryCount),
                  static_cast<unsigned>(queuedEventCount),
                  static_cast<unsigned>(length));
  }

  // The queue's own verdict on this response, printed BOTH ways and only when a
  // payload actually carried events. The failure line is the whole point: before
  // this existed, a queue that could not drain produced no line at all - the
  // [IFTTT] "Disabled" notice at boot was the only thing printed, and it said
  // nothing about the three events that were never going to move. Silence is what
  // let pending_count sit at 3 for hours, so "the backend did not acknowledge" is
  // now stated on every response that failed to, with the outcome and reason
  // that explain it.
  if (inFlightEventCount > 0) {
    if (storageConfirmed) {
      recordStorageAcknowledgement();
      Serial.printf("[Queue] Backend acknowledged %u event(s) in seq %lu"
                    " (inserted %lu, duplicates %lu)\n",
                    static_cast<unsigned>(inFlightEventCount),
                    static_cast<unsigned long>(backendSeq),
                    static_cast<unsigned long>(eventsInserted),
                    static_cast<unsigned long>(eventsDuplicates));
    } else if (ok) {
      Serial.printf("[Queue] Backend did NOT acknowledge %u event(s): HTTP %d,"
                    " outcome '%s', reason '%s'%s; their slots remain queued\n",
                    static_cast<unsigned>(inFlightEventCount), code, outcomeText, reasonText,
                    eventsReported ? "" : ", events field unreadable");
    } else {
      Serial.printf("[Queue] Backend did NOT acknowledge %u event(s): HTTP %d;"
                    " their slots remain queued\n",
                    static_cast<unsigned>(inFlightEventCount), code);
    }
  }
  return ok;
}

static void serviceTransport(uint32_t nowMs) {
  // First, and before the link check: freeing settled slots is local work with
  // no socket, no timer and no dependency on Wi-Fi. It used to live behind the
  // notification leg, behind configured(), behind a 5 s gate and behind a live
  // connection - four conditions that had nothing to do with whether the backend
  // had the event, and whose conjunction is why a build with no IFTTT key never
  // drained a single slot. See the rule block above sendBackendSnapshot().
  serviceQueueAcknowledgement(nowMs);

  if (!wifiConnected) return;

  // Obligation B only: the webhook, and nothing else. A 2xx here no longer frees
  // the slot - serviceQueueAcknowledgement() does that, and only once the
  // backend has separately confirmed the same event_id - so a build with no
  // transport configured never enters this leg at all and loses nothing by not
  // entering it. With a transport configured, delivery is still attempted on the
  // same ALERT_RETRY_INTERVAL_MS cadence and a non-2xx still leaves the event
  // queued, exactly as before; what changed is who is allowed to pop.
  if (queuedEventCount > 0 && notificationTransport.configured() &&
      static_cast<uint32_t>(nowMs - lastTransportAttemptMs) >= ALERT_RETRY_INTERVAL_MS) {
    lastTransportAttemptMs = nowMs;
    AlertEvent event;
    bool spentHttpOperation = false;
    if (peekQueuedEvent(&event)) {
      if (webhookDeliveredEventId == event.eventId) {
        // Already delivered on an earlier pass and still waiting on the backend.
        // Re-firing would notify the operator once per retry interval for a
        // single alert, which is the noise the IFTTT log line above already
        // warns about - and it would buy nothing, because the slot cannot leave
        // until obligation A is settled regardless of how many times B is
        // repeated.
      } else if (notificationTransport.send(event)) {
        spentHttpOperation = true;
        webhookDeliveredEventId = event.eventId;
        Serial.printf("[Queue] Webhook delivered for event %lu; the slot now waits"
                      " only for the backend\n",
                      static_cast<unsigned long>(event.eventId));
      } else {
        spentHttpOperation = true;
        Serial.println(F("[Queue] Webhook send failed; event and its event_id remain queued"));
      }
    }
    // Returned only when an HTTP operation actually ran. A pass that did nothing
    // but notice an already-delivered webhook must fall through, or the snapshot
    // leg below would be starved for as long as the backend was slow to confirm.
    if (spentHttpOperation) return; // At most one bounded HTTP operation per transport pass.
  }

  if (thingspeakConfigured &&
      static_cast<uint32_t>(nowMs - lastThingSpeakAttemptMs) >= THINGSPEAK_INTERVAL_MS) {
    lastThingSpeakAttemptMs = nowMs;
    sendThingSpeakTelemetry();
  }

  // Snapshot sync runs after the alert and telemetry legs so a queued alert is
  // never delayed behind a full snapshot POST, and so at most one bounded HTTP
  // operation happens per pass.
  serviceMqtt(nowMs);
  // Fetch configured limits before deciding whether this pass is due to post.
  // Ordering matters: publishing a snapshot that reports one revision while the
  // verdict logic is using another is how the operator ends up looking at
  // numbers that disagree with the behaviour they are watching.
  fetchAndApplyThresholds(nowMs);

  // The clock probe gets priority over the snapshot when both are due.
  //
  // The first version of this put the probe LAST, behind the snapshot post, on
  // the reasoning that a real snapshot is more important than reading a clock.
  // That starved it: snapshots are change-triggered, a flapping door reed or a
  // warming MQ-135 produces them continuously, and every pass that carried one
  // returned before the probe ran. The device would then report a stale
  // correction - or none - for as long as the readings kept changing, which on
  // this hardware is exactly the condition that made the clock wrong in the
  // first place.
  //
  // The trade is now made explicitly: a due probe may delay a snapshot by up to
  // HTTP_TIMEOUT_MS. A snapshot is a re-sendable observation and the service
  // deduplicates by seq, so a two-second delay costs nothing observable. A
  // missing clock correction costs every item verdict on the device. The
  // asymmetry is not close, and it is why the probe goes first.
  if (serverTimeProbeDue(nowMs)) {
    serviceServerTimeSync(nowMs);
    return;
  }

  if (backendPostDue(nowMs)) {
    lastBackendAttemptMs = nowMs;
    backendPostRequested = false;
    sendBackendSnapshot(nowMs);
  }
}

/**
 * Is a server-clock probe due? Split out from serviceServerTimeSync() so
 * serviceTransport() can decide on priority BEFORE committing to the request.
 */
static bool serverTimeProbeDue(uint32_t nowMs) {
  if (!backendConfigured) return false;
  const uint32_t interval = serverSynced ? SERVER_TIME_PROBE_SLOW_MS
                                         : SERVER_TIME_PROBE_FAST_MS;
  return static_cast<uint32_t>(nowMs - lastServerTimeProbeMs) >= interval;
}

/**
 * Read the server's clock on a timer, so the device can correct its own.
 *
 * WHY THIS IS SEPARATE FROM sendBackendSnapshot()
 *
 * sendBackendSnapshot() returns as soon as the MQTT publish succeeds, and on a
 * device with a healthy broker link that is EVERY time. So the HTTP POST - the
 * one request whose response carries server_time_epoch - never runs, and the
 * device never learns what time it is. That is not a hypothetical: it is what
 * the serial log showed, with MQTT connected, zero failed publishes, and
 * time_source stuck on "rtc" and the correction unmeasured.
 *
 * The fallback chain could not rescue it either, because that chain is entered
 * on RTC FAILURE, and this RTC is working perfectly - it is just 5 hours out.
 * So the device had a fully populated fallback that was unreachable, behind a
 * condition that never occurs on this hardware. That is a worse failure than
 * having no time handling at all, because the code reads as though the problem
 * were solved.
 *
 * So the clock is read on its own schedule instead of as a side effect of
 * publishing. The probe re-sends the current sequence number, which the service
 * answers with 200 / outcome "stale" and a body that still carries
 * server_time_epoch: no state write, no reading row, no alert, no sequence
 * consumed. It cannot perturb what the backend stores.
 *
 * CADENCE: fast until the correction is established, then slow. The brief asks
 * for the correction to be in place within a few samples of connecting, not on
 * the first one, so the first SERVER_SYNC_MIN_SAMPLES probes are 20 s apart and
 * the correction is adopted inside the first minute. After that it drops to a
 * 15-minute refresh - frequent enough to notice a server that has itself moved,
 * and rare enough that it is not a permanent second heartbeat.
 */
static void serviceServerTimeSync(uint32_t nowMs) {
  if (!serverTimeProbeDue(nowMs)) return;
  lastServerTimeProbeMs = nowMs;
  (void)sendBackendSnapshot(nowMs, /*replayProbe=*/true);
}

// ============================================================================
// LCD status pages
// ============================================================================

static void updateLcd(uint32_t nowMs, FreshnessStatus overallStatus) {
  if (!lcdReady || !lcdBacklightOn) return;
  if (static_cast<uint32_t>(nowMs - lastLcdPageMs) < LCD_PAGE_INTERVAL_MS) return;
  lastLcdPageMs = nowMs;

  if (lcdAlertText[0] != '\0' && static_cast<int32_t>(lcdAlertUntilMs - nowMs) > 0) {
    lcdPrintRow(0, "ALERT");
    lcdPrintRow(1, lcdAlertText);
    return;
  }

  switch (lcdPage % 5) {
    case 0:
      if (!bmeDataReady) lcdPrintRow(0, "BME280: FAULT");
      else lcdPrintfRow(0, "T:%.1fC P:%.0fhPa", temperatureC, pressureHpa);
      if (!humidityReady) lcdPrintRow(1, "BME280 RH: FAULT");
      else lcdPrintfRow(1, "Humidity:%.1f%%", humidityPct);
      break;

    case 1:
      lcdPrintRow(0, "FreshGuard status:");
      if (overallStatus == FreshnessStatus::SensorFault) {
        lcdPrintRow(0, "Sensor Fault/");
        lcdPrintRow(1, "Data Unavailable");
      } else {
        lcdPrintRow(1, freshnessStatusText(overallStatus));
      }
      break;

    case 2:
      if (latestScannedItem >= 0 && latestScannedItem < inventoryCount) {
        const FoodItem& item = inventory[latestScannedItem];
        lcdPrintRow(0, item.name);
        FreshnessStatus itemStatus = worstStatus(zoneStatus,
                                                analyseItemDuration(item, currentAuthorityEpoch(millis())));
        lcdPrintRow(1, freshnessStatusText(itemStatus));
      } else {
        lcdPrintRow(0, "No food selected");
        lcdPrintRow(1, "Scan registered UID");
      }
      break;

    case 3: {
      // The heading must describe the actual state. Printing "Sensor
      // unavailable:" over an empty fault list is worse than printing nothing:
      // on a healthy unit this page rotated past every LCD_PAGE_INTERVAL_MS
      // claiming a fault that did not exist, which is exactly what a diagnostic
      // page must never do.
      const uint16_t unavailable = currentSensorUnavailableMask(millis());
      if (unavailable == 0) {
        lcdPrintRow(0, "Sensors: all OK");
        lcdPrintfRow(1, "%u of %u reporting",
                     static_cast<unsigned>(__builtin_popcount(sensorEverReadyMask)),
                     static_cast<unsigned>(SENSOR_FAULT_COUNT));
      } else {
        char names[17];
        describeFaultMask(unavailable, names, sizeof(names));
        lcdPrintRow(0, "Sensor unavailable:");
        lcdPrintRow(1, names);
      }
      break;
    }

    default: {
      const uint16_t storageFaults = currentStorageFaultMask();
      if (storageFaults == 0) {
        lcdPrintRow(0, "Storage: OK");
        lcdPrintRow(1, "no admin faults");
      } else {
        char names[17];
        describeFaultMask(storageFaults, names, sizeof(names));
        lcdPrintRow(0, "Storage/Admin:");
        lcdPrintRow(1, names);
      }
      break;
    }
  }
  ++lcdPage;
}

// ============================================================================
// Non-blocking serial command interface
// ============================================================================

static void printHelp() {
  Serial.println(F("\n=== FreshGuard commands ==="));
  Serial.println(F("HELP | STATUS | LIST | QUEUECOUNT | BASELINE"));
  Serial.println(F("SNAPSHOT   print the exact payload the next snapshot would carry"));
  Serial.println(F("RTCEPOCH <unix_epoch>"));
  Serial.println(F("REMOVE <UID_HEX>"));
  Serial.println(F("LCD ON | LCD OFF"));
  Serial.println(F("SCAN      live I2C sweep; plug/unplug modules and watch for changes"));
  Serial.println(F("MQRAW     raw ADS1115 AIN0 reading in mV, bypassing the plausibility gate"));
  Serial.println(F("RFIDTEST  read-only: RC522 reset state and registers; no events queued"));
  Serial.println(F("MQTTRECONNECT  force the MQTT link down to exercise the reconnect"
                   " path"));
  Serial.println(F("I2CDUMP [addr_hex]   default 0x20 - read 0x00-0x12 of an I2C device"));
  Serial.println(F("CLEARQ   discard all queued alerts (bring-up use only)"));
  Serial.println(F("CLEARINV YES       erase the whole item registry (no undo)"));
  Serial.println(F("REG <UID>|<name>|<category>|<qty>|<location>|<days>|<expiryEpoch>"));
  Serial.println(F("REG <UID>|<name>|<category>|<qty>|<location>|<days>|<expiryEpoch>|<mfgEpoch>"));
  Serial.println(F("Example: REG A1B2C3D4|Milk|Dairy|1|Door shelf|5|0"));
  Serial.println(F("The 8th field is the manufacture epoch; omit it and 0 (unknown) is stored."));
  Serial.println(F("The same registration is available over MQTT on freshguard/<dev>/cmd"));
  Serial.println(F("as {\"op\":\"item.register\",...}; both paths share one validator."));
  Serial.println(F("CLEARINV is the recovery path for an unreadable /fg_inventory.txt:"));
  Serial.println(F("  an FG1 file is refused on load and left on flash on purpose, and"));
  Serial.println(F("  this is the only way to remove it. Over MQTT:"));
  Serial.println(F("  {\"op\":\"item.clear\",\"confirm\":\"YES\"}"));
  Serial.println(F("STATUS also reports MQTT link state, free heap, the DS3231"));
  Serial.println(F("liveness and the correctly decoded 0x0F status flags (OSF,"));
  Serial.println(F("EN32kHz, BSY, A2F, A1F), the time_source and clock_offset_s the"));
  Serial.println(F("snapshot carries, and the 0x0D / 0x10 / 0x11-0x12 register readings."));
  Serial.println(F("Time is taken from the server: after 3 agreeing ingest"));
  Serial.println(F("responses the reported epoch is server-corrected and carried"));
  Serial.println(F("forward by millis(), so it keeps advancing with no network."));
  Serial.println(F("No ppm/calibration claim; inspect the MQ-135 relative baseline."));
}

// Print the snapshot body exactly as the next publish would carry it, so what the
// dashboard receives can be checked against what the device believes without
// standing up a receiver. buildBackendSnapshot() only reads state - it advances
// no sequence, records no published reading and touches no file - so running it
// from a serial command cannot disturb the publish cadence.
static void printSnapshot() {
  const size_t length = buildBackendSnapshot(millis());
  if (length == 0) {
    Serial.println(F("[Snapshot] Does not fit the payload budget; not sent"));
    return;
  }
  Serial.println(F("[Snapshot] begin"));
  Serial.println(backendPayload);
  Serial.printf("[Snapshot] end (%u bytes)\n", static_cast<unsigned>(length));
}

static void printStatus() {
  char sensorNames[ALERT_MESSAGE_CAPACITY];
  char storageNames[ALERT_MESSAGE_CAPACITY];
  describeFaultMask(currentSensorFaultMask(), sensorNames, sizeof(sensorNames));
  describeFaultMask(currentStorageFaultMask(), storageNames, sizeof(storageNames));
  FreshnessStatus overall = calculateOverallStatus();
  Serial.printf("[STATUS] Zone=%s Overall=%s\n",
                freshnessStatusText(zoneStatus), freshnessStatusText(overall));
  Serial.printf("  Confirmed sensor faults: %s\n", sensorNames);
  Serial.printf("  Storage/admin faults: %s (do not change freshness status)\n", storageNames);
  Serial.printf("  BME280: %s", bmeDataReady ? "READY" : "UNAVAILABLE");
  if (bmeDataReady) Serial.printf(" T=%.2fC P=%.2fhPa", temperatureC, pressureHpa);
  Serial.printf(" | Humidity: %s", humidityReady ? "READY" : "UNAVAILABLE");
  if (humidityReady) Serial.printf(" H=%.2f%%", humidityPct);
  Serial.println();
  Serial.printf("  ADS1115: %s | MQ-135: %s | DS3231: %s | PCF read: %s write: %s | reed: %s\n",
                adsReady ? "READY" : "UNAVAILABLE", mqStateText(mqState),
                ds3231TimeReady ? "READY" : "UNAVAILABLE",
                faults.pcf8574Read ? "FAULT" : (pcfReadReady ? "OK" : "UNAVAILABLE"),
                faults.pcf8574Write ? "FAULT" : (pcfInitialized ? "OK" : "UNAVAILABLE"),
                faults.reed ? "FAULT" : "OK");
  if (mqState == MqState::Ready) {
    Serial.printf("  MQ relative values: baseline=%.3f mV input=%.3f mV delta=%.3f mV code=%d\n",
                  mqBaselineMv, mqInputMv, mqDeltaMv, mqAdcCode);
  } else if (mqState == MqState::CapturingBaseline) {
    // Report the settling phase as well as the averaging phase. The old line
    // only counted averaging passes, so a sensor stuck waiting for the reading
    // to stop moving showed "0/30" forever with no explanation of why.
    if (mqSettling) {
      Serial.printf("  MQ baseline: waiting for the reading to settle, %u passes so far\n",
                    static_cast<unsigned>(mqSettlePasses));
    } else {
      Serial.printf("  MQ baseline progress: %u/%u\n",
                    static_cast<unsigned>(mqBaselineCount),
                    static_cast<unsigned>(MQ_BASELINE_SAMPLE_COUNT));
    }
  }
  Serial.printf("  Door=%s | Optional RC522=%s LCD=%s\n",
                doorOpen ? "OPEN" : "CLOSED",
                faults.rc522 ? "FAULT" : "OK", faults.lcd ? "FAULT" : "OK");

  // The block this command was missing, and the reason the last investigation
  // took as long as it did. STATUS described the sensors beautifully and said
  // nothing at all about the two things that make a device's report
  // untrustworthy: whether it was still on the network, and what its clock was
  // actually doing. A device that was offline for a day and a device that was
  // perfect looked identical.
  TimeSource source = TimeSource::None;
  const uint32_t reportEpoch = currentReportEpoch(millis(), &source);
  Serial.printf("  MQTT: firmware-believes=%s client-says=%s state=%u | buffer=%u B"
                " | failed publishes=%lu | connections=%lu\n",
                mqttConnected ? "connected" : "disconnected",
                mqttClient.connected() ? "connected" : "disconnected",
                mqttClient.state(), mqttClient.getBufferSize(),
                static_cast<unsigned long>(mqttPublishFailures),
                static_cast<unsigned long>(mqttConnects));
  // The two values are printed separately and on purpose. When they disagree
  // the device thinks it is on the broker and the broker link is dead, which is
  // the Fix D failure; a single merged boolean is exactly what hid it.
  if (mqttConfigured && mqttConnected != mqttClient.connected()) {
    Serial.println(F("  MQTT: MISMATCH - the link is down and the device is about to"
                     " force a reconnect"));
  }
  // The reconnect gate, spelled out. "Disconnected" on its own does not say
  // whether the device is retrying every 5 s or has quietly stopped trying, and
  // that distinction is the whole of Fix D - so it is reported rather than
  // inferred.
  if (mqttConfigured && !mqttConnected) {
    const uint32_t sinceAttempt = millis() - lastMqttAttemptMs;
    Serial.printf("  MQTT: reconnecting - last attempt %lu ms ago, gate %u ms,"
                  " %s\n", static_cast<unsigned long>(sinceAttempt),
                  static_cast<unsigned>(MQTT_RECONNECT_INTERVAL_MS),
                  sinceAttempt >= MQTT_RECONNECT_INTERVAL_MS
                      ? "OPEN (an attempt is due this pass)" : "closed (waiting)");
  }
  // The status register is decoded by its datasheet bit names. There is no
  // battery term here, and there is no battery term anywhere: the DS3231 has no
  // battery-low bit. The previous firmware printed "BAT" for bit 3 and told the
  // operator to replace a CR2032 that nothing had ever measured.
  //
  // The temperature is read from 0x11/0x12 on the same line, so the DS3231's
  // real die reading is visible without a second command. It is the RTC's own
  // die, refreshed about every 64 s so up to a minute stale, and NOT the
  // storage-zone air temperature - the BME280 line above is.
  bool rtcTemperatureValid = false;
  const int32_t rtcTemperatureMilli = readDs3231TemperatureC(&rtcTemperatureValid);
  Serial.printf("  Heap free: %u B | DS3231 liveness: %s | 0x0F=%s"
                " OSF=%u EN32kHz=%u BSY=%u A2F=%u A1F=%u | RTC die 0x11/0x12: %s\n",
                static_cast<unsigned>(ESP.getFreeHeap()),
                rtcClockRunning ? "advancing" : "NOT ADVANCING (raw clock untrusted)",
                rtcStatusKnown ? bitPattern8(rtcStatusRegister) : "unknown",
                (rtcStatusRegister & DS3231_STATUS_OSF) ? 1U : 0U,
                (rtcStatusRegister & DS3231_STATUS_EN32KHZ) ? 1U : 0U,
                (rtcStatusRegister & DS3231_STATUS_BSY) ? 1U : 0U,
                (rtcStatusRegister & DS3231_STATUS_A2F) ? 1U : 0U,
                (rtcStatusRegister & DS3231_STATUS_A1F) ? 1U : 0U,
                rtcTemperatureValid ? "" : "unreadable");
  if (rtcTemperatureValid) {
    Serial.printf("    RTC die temperature %+ld.%03ld C (MSB 0x11 signed whole C,"
                  " LSB 0x12 bits 7-6 quarters; chip refreshes about every 64 s)\n",
                  static_cast<long>(rtcTemperatureMilli / 1000),
                  static_cast<long>((rtcTemperatureMilli < 0 ? -rtcTemperatureMilli
                                                            : rtcTemperatureMilli) % 1000));
  }
  // The clock block. The two epochs are printed separately and labelled, because
  // the whole point of the server sync is that they now differ by hours: the raw
  // DS3231 reading is what the hardware says, and the reported epoch is what the
  // device stands behind. Collapsing them into one number would hide the fault
  // this firmware works around.
  Serial.printf("  Time source: %s | reported epoch %lu | raw DS3231 %lu\n",
                timeSourceName(source), static_cast<unsigned long>(reportEpoch),
                static_cast<unsigned long>(currentRtcEpoch()));
  Serial.printf("  clock_offset_s: %+ld s (server %s device) | correction %s |"
                " samples %u/%u | last confirmed %lu s ago | liveness failures"
                " %u/%u\n",
                static_cast<long>(serverOffsetSeconds),
                serverOffsetSeconds > 0 ? "ahead of" : "behind",
                serverSynced ? "ADOPTED" : (serverTimeKnown ? "not yet established" : "not measured"),
                static_cast<unsigned>(serverSyncSamples),
                static_cast<unsigned>(SERVER_SYNC_MIN_SAMPLES),
                static_cast<unsigned long>(serverOffsetAgeMs() / 1000UL),
                static_cast<unsigned>(rtcStallCount),
                static_cast<unsigned>(RTC_LIVENESS_STALL_SAMPLES));
  // The diagnostic registers, re-read on demand. Read-only by design; see
  // reportDs3231Registers().
  reportDs3231Registers();
}

static void setLcdBacklight(bool enabled) {
  lcdBacklightOn = enabled;
  if (!lcdReady) return;
  if (enabled) lcd.backlight(); else lcd.noBacklight();
}

/**
 * Dump an I2C device's register block, read only.
 *
 * This exists because the PCF8574 config readback returned 0x06 - the same
 * value as the register ADDRESS - three times in a row. That is a fingerprint,
 * not a coincidence, and it does not match a PCF8574's register map. Rather
 * than keep guessing from a theory, read the device's whole register block and
 * look at what it actually is:
 *
 *   PCF8574   00 Input P0 · 01 Output P0 · 03 Output P1 · 06 CONFIG P0
 *   MCP23017  00 IODIRA   · 01 IODIRB   · 02 GPIOA   · 06 OLATA
 *   DS3231    00 Seconds · 01 Minutes · 02 Hours   · 03 Day    · 04 Date ·
 *             05 Month   · 06 Year    · 07-0A Alarm 1 · 0B-0D Alarm 2 ·
 *             0E Control · 0F Status  · 10 Aging offset ·
 *             11 Temp MSB · 12 Temp LSB
 *
 * The range ends at 0x12 because that is the end of the DS3231's register map
 * and the three registers above 0x0F are the ones a diagnostic actually needs:
 * the aging offset at 0x10 and the temperature pair at 0x11/0x12. Stopping at
 * 0x0F - as the previous version did - hid all three behind a range chosen for
 * a different chip.
 *
 * The write test is gone, deliberately and permanently. See the note above
 * dumpI2cRegisters().
 */
/**
 * Render a byte as 8 characters, bit 7 first, so a configuration register can
 * be read directly. On the PCF8574 a config bit of 1 means INPUT, so the string
 * reads left-to-right as P7..P0 and can be checked against the intended map.
 */
static const char* bitPattern8(uint8_t value) {
  static char pattern[9];
  for (uint8_t bit = 0; bit < 8; ++bit) {
    pattern[bit] = (value & (1U << (7 - bit))) ? '1' : '0';
  }
  pattern[8] = '\0';
  return pattern;
}

/**
 * Dump I2C_DUMP_FIRST..I2C_DUMP_LAST of every device that answers, not just one.
 *
 * This is the control test that separates a firmware fault from a hardware one.
 * A known-good device on the same bus - the ADS1115, whose register map is
 * defined and whose power-on values are non-zero - will return real contents.
 * If it returns its own address instead, the I2C read path in this firmware is
 * at fault. If it returns real data while the 0x20 device echoes its pointer,
 * the bus and the firmware are both fine and the 0x20 module is faulty.
 */
static void dumpAllI2cDevices() {
  uint8_t responders = 0;
  for (uint8_t address = 1; address < 128; ++address) {
    if (!i2cDevicePresent(address)) continue;
    ++responders;
    Serial.printf("\n--- responding device at 0x%02X ---\n", static_cast<unsigned>(address));
    dumpI2cRegisters(address);
  }
  if (responders == 0) Serial.println(F("[I2C] Nothing responded at all"));
}

// READ-ONLY BY DESIGN.
//
// An earlier version of this dump wrote a probe value to registers 0x01 and 0x06
// and restored them afterwards. That was safe only while nothing real was on the
// bus. Once the sensors were connected it wrote 0xA5 into the DS3231's month
// register and its seconds register. Probing a bus by writing to it is only
// acceptable on a chip you own, and the read path is already known good, so the
// write test is gone rather than made safer.
//
// THE DUMP RANGE IS I2C_DUMP_FIRST..I2C_DUMP_LAST, INCLUSIVE.
//
// 0x00-0x0F, the previous range, was chosen for a PCF8574 and stopped one byte
// short of everything a DS3231 diagnostic needs: 0x10 is the aging-offset
// register, 0x11/0x12 are the temperature pair, and 0x12 is the last register
// the part has at all. The range is a named constant pair rather than three
// separate hex literals in three places, so it cannot drift apart again.
//
// THE PCF8574 ANALYSIS BELOW IS ONLY MEANINGFUL AT 0x20, AND IS ONLY RUN THERE.
//
// A PCF8574 has an 8-register space and its register counter is three bits, so
// asking for register 0x08-0x0F must wrap back to 0x00-0x07. Every conclusion
// below is a statement about whether the device sitting at the PCF8574's own
// address really is one. Applied to 0x68 it is pure noise: the previous version
// told the operator that "a PCF8574 has eight registers and its counter is three
// bits, so it must wrap... this device does not, so it is not a PCF8574" about a
// DS3231, which is not a finding, it is a truism. A device at any other address
// is not a PCF8574 by definition of its address, so the question is not asked.
static void dumpI2cRegisters(uint8_t address) {
  static_assert(I2C_DUMP_LAST >= I2C_DUMP_FIRST, "I2C dump range must not be empty");
  static_assert(I2C_DUMP_LAST == 0x12U,
                "I2C dump must reach 0x12, the last DS3231 register, so 0x10/0x11/0x12"
                " are inspectable");
  Serial.printf("\n[I2C] Dumping 0x%02X registers 0x%02X-0x%02X (read only)\n",
                static_cast<unsigned>(address),
                static_cast<unsigned>(I2C_DUMP_FIRST),
                static_cast<unsigned>(I2C_DUMP_LAST));
  uint8_t values[I2C_DUMP_LAST + 1];
  uint8_t readable = 0;
  for (uint8_t reg = I2C_DUMP_FIRST; reg <= I2C_DUMP_LAST; ++reg) {
    if (i2cReadRegister8(address, reg, &values[reg])) {
      ++readable;
      Serial.printf("  0x%02X -> 0x%02X  %s\n", static_cast<unsigned>(reg),
                    static_cast<unsigned>(values[reg]), bitPattern8(values[reg]));
    } else {
      values[reg] = 0;
      Serial.printf("  0x%02X -> (bus error)\n", static_cast<unsigned>(reg));
    }
  }

  // Identity analysis. Only for the PCF8574's own address - see the note above
  // this function. For anything else, say what was asked for and stop.
  if (address != PCF8574_ADDRESS) {
    Serial.println(F("  Not 0x20, so the PCF8574 wrap/mirror analysis is skipped:"
                     " that test only means something"));
    Serial.println(F("  for a device that is supposed to be a PCF8574. A 3-bit register"
                     " counter wrapping at 0x08"));
    Serial.println(F("  says nothing about a part with a wider register file, so it is"
                     " not worth printing here."));
    if (address == DS3231_ADDRESS) {
      Serial.println(F("  0x68 is the DS3231: 0x07-0x0A is Alarm 1, 0x0B-0x0D is Alarm 2,"
                       " 0x0E control,"));
      Serial.println(F("  0x0F status (bit7 OSF, bit3 EN32kHz, bit2 BSY, bit1 A2F, bit0"
                       " A1F), 0x10 aging offset,"));
      Serial.println(F("  0x11 temperature MSB (signed whole C), 0x12 temperature LSB"
                       " (bits 7-6 = quarters)."));
      Serial.println(F("  The chip refreshes its own temperature about every 64 s, so a"
                       " reading can be up to a minute old."));
      Serial.println(F("  Run STATUS to see 0x0D, 0x10 and 0x11/0x12 decoded."));
    }
    return;
  }

  if (readable < 0x08) {
    Serial.println(F("  fewer than 8 registers readable; this is not a PCF8574-class"
                     " register file"));
    return;
  }

  // A device whose eight low registers are all the same value tells us nothing:
  // uniform data satisfies the mirror check trivially, because every byte is
  // equal to every other byte. Only a device that actually varies between its
  // low registers can distinguish a wrapping counter from a linear one.
  bool lowRegistersVary = false;
  for (uint8_t reg = 0x01; reg < 0x08; ++reg) {
    if (values[reg] != values[0x00]) {
      lowRegistersVary = true;
      break;
    }
  }
  if (!lowRegistersVary) {
    Serial.printf("  all of 0x00-0x07 read 0x%02X, so the mirror test is inconclusive"
                  " here.\n", static_cast<unsigned>(values[0x00]));
    Serial.println(F("  Uniform data cannot reveal whether the register counter wraps."));
    return;
  }

  // The defining signature: the device hands back the register number that was
  // just sent to it. That means it is echoing the command byte rather than
  // decoding it, whatever the address decoder is doing.
  bool echoesPointer = true;
  for (uint8_t reg = 0x00; reg < 0x10; ++reg) {
    if (values[reg] != reg) {
      echoesPointer = false;
      break;
    }
  }
  if (echoesPointer) {
    Serial.println(F("  every register returned its own index: the device is echoing the"
                     " register pointer"));
    Serial.println(F("  instead of decoding it. A PCF8574 cannot behave this way, because"
                     " writing 0xC1 to"));
    Serial.println(F("  its configuration register changes pin directions - it is not"
                     " stored in a location"));
    Serial.println(F("  that can be read back as the register number."));
    return;
  }

  bool mirrors = true;
  for (uint8_t reg = 0x08; reg < 0x10; ++reg) {
    if (values[reg] != values[reg - 0x08]) {
      mirrors = false;
      break;
    }
  }
  if (mirrors) {
    // A wrap at 0x08 rules OUT a 16-bit register pointer, but it does not prove
    // the part is a PCF8574: the ADS1115 aliases here too. Only the absence of
    // pointer echoing, combined with a successful configuration write, confirms
    // a PCF8574. So this reports what was measured, not what was hoped.
    Serial.println(F("  0x08-0x0F mirror 0x00-0x07: the register counter is 3 bits and"
                     " wraps."));
    Serial.println(F("  That is consistent with a PCF8574, but not proof of one - an"
                     " ADS1115 aliases the same way."));
    Serial.println(F("  Confirming a PCF8574 needs a configuration write to read back"
                     " correctly."));
  } else {
    Serial.println(F("  0x08-0x0F do not mirror 0x00-0x07. A PCF8574 has eight registers"
                     " and its counter is"));
    Serial.println(F("  three bits, so it must wrap. This device does not, so it is not"
                     " a PCF8574."));
  }
}

/**
 * Discard every queued alert and start a fresh queue.
 *
 * Needed during bring-up: a board with sensors disconnected raises a new
 * sensor_fault event every cycle, so a queue left alone fills to capacity and
 * then raises an alert_queue storage fault on top of the real problem. Draining
 * it is a deliberate operator action, so it is behind an explicit command and
 * says what it destroyed.
 */
static bool clearAlertQueue() {
  if (!storageReady) {
    Serial.println(F("[Queue] Cannot clear: LittleFS is unavailable"));
    return false;
  }
  LittleFS.remove(QUEUE_PATH);
  // The RAM-only acknowledgement state goes with the slots it described. Leaving
  // it behind would be harmless for ids (a reseed is clamped above every id this
  // boot has issued, so a stale entry can never match a new slot) but it would
  // keep claiming a confirmation for events that no longer exist, and the next
  // operator to read these lines deserves a queue whose state means what it says.
  storageAckedEventCount = 0;
  webhookDeliveredEventId = 0;
  return initializeAlertQueue();
}

static void processSerialCommand(char* line) {
  trimLine(line);
  if (line[0] == '\0') return;
  char* command = line;
  char* argument = strchr(line, ' ');
  if (argument) {
    *argument = '\0';
    argument++;
    while (*argument == ' ') ++argument;
  }

    if (asciiCaseEqual(command, "HELP")) {
      printHelp();
    } else if (asciiCaseEqual(command, "MQRAW")) {
      reportMqRawReading();
    } else if (asciiCaseEqual(command, "RFIDTEST")) {
      reportRc522Diagnosis();
    } else if (asciiCaseEqual(command, "SCAN")) {
      liveI2cScan();
    } else if (asciiCaseEqual(command, "CLEARQ")) {
      if (clearAlertQueue()) {
        refreshQueuedEventCount();
        Serial.printf("[Queue] Cleared. %u pending event(s)\n",
                      static_cast<unsigned>(queuedEventCount));
      }
    } else if (asciiCaseEqual(command, "CLEARINV")) {
      // The confirmation token is required, and it is required to be the exact
      // string. This is the only command in the file that destroys data, it has
      // no undo, and it is one typo away from being typed by someone who meant
      // to type something else. Bare CLEARINV prints what it would have done
      // and does nothing.
      if (argument == nullptr || argument[0] == '\0') {
        Serial.println(F("CLEARINV requires a confirmation token: CLEARINV YES"));
        Serial.printf("[Inventory] This would erase %s and discard every"
                      " registered item.\n", INVENTORY_PATH);
        Serial.println(F("Nothing was deleted."));
      } else if (strcmp(argument, "YES") != 0) {
        Serial.printf("CLEARINV refused: confirmation token is '%s', not \"YES\"."
                      " Nothing was deleted.\n", argument);
      } else if (clearInventoryRegistry("serial")) {
        Serial.println(F("Registry is empty. The next REG writes a fresh FG2 file."));
      } else {
        Serial.println(F("CLEARINV failed; registry unchanged"));
      }
    } else if (asciiCaseEqual(command, "MQTTRECONNECT")) {
      reportMqttReconnectDiagnostic();
    } else if (asciiCaseEqual(command, "I2CDUMP")) {
      uint8_t address = PCF8574_ADDRESS;
      if (argument && argument[0] != '\0') {
        // Addresses are habitually written in hex, so accept 0x20 as well as
        // 32. parseUint32 is decimal-only and would reject "0x20" outright.
        const char* digits = argument;
        if (digits[0] == '0' && (digits[1] == 'x' || digits[1] == 'X')) digits += 2;
        char* end = nullptr;
        unsigned long parsed = strtoul(digits, &end, 16);
        if (end == digits || *end != '\0' || parsed < 0x01 || parsed > 0x7F) {
          Serial.printf("[I2C] '%s' is not a valid 7-bit address\n", argument);
        } else {
          address = static_cast<uint8_t>(parsed);
        }
      }
      dumpI2cRegisters(address);
    } else if (asciiCaseEqual(command, "STATUS")) {
    printStatus();
  } else if (asciiCaseEqual(command, "LIST")) {
    listInventory();
  } else if (asciiCaseEqual(command, "QUEUECOUNT")) {
    refreshQueuedEventCount();
    // The next id alongside the depth: the queue's health and the id the next
    // event will carry are the two facts that diagnose a collision, and 0 here
    // means "no counter established" - which itself only happens when
    // queueReady is false.
    Serial.printf("[Queue] %u pending event(s), capacity %u, next event_id %lu\n",
                  static_cast<unsigned>(queuedEventCount),
                  static_cast<unsigned>(ALERT_QUEUE_CAPACITY),
                  static_cast<unsigned long>(nextQueuedEventId));
  } else if (asciiCaseEqual(command, "BASELINE")) {
    if (mqState == MqState::Ready) {
      Serial.printf("[MQ135] state=ready baseline=%.3f mV current=%.3f mV delta=%.3f mV\n",
                    mqBaselineMv, mqInputMv, mqDeltaMv);
    } else {
      Serial.printf("[MQ135] state=%s progress=%u/%u (Data Unavailable; no remote fault alert)\n",
                    mqStateText(mqState), static_cast<unsigned>(mqBaselineCount),
                    static_cast<unsigned>(MQ_BASELINE_SAMPLE_COUNT));
    }
  } else if (asciiCaseEqual(command, "RTCEPOCH") && argument) {
    uint32_t epoch = 0;
    if (parseUint32(argument, MIN_VALID_RTC_EPOCH, UINT32_MAX, &epoch) && setRtcEpoch(epoch)) {
      Serial.printf("[DS3231] Set to epoch %lu\n", static_cast<unsigned long>(epoch));
    } else {
      Serial.println(F("[DS3231] Invalid epoch or RTC unavailable"));
    }
  } else if (asciiCaseEqual(command, "REMOVE") && argument) {
    Serial.println(removeFoodRecord(argument) ? F("[Inventory] Removed and saved")
                                             : F("[Inventory] Remove failed/not found"));
  } else if (asciiCaseEqual(command, "LCD") && argument) {
    if (asciiCaseEqual(argument, "ON")) setLcdBacklight(true);
    else if (asciiCaseEqual(argument, "OFF")) setLcdBacklight(false);
    else Serial.println(F("Usage: LCD ON | LCD OFF"));
  } else if (asciiCaseEqual(command, "REG") && argument) {
    // Seven fields, as documented, or eight with a trailing manufacture epoch.
    // The array is sized for the maximum and the count is passed through, so the
    // optional eighth field is only read when it was actually supplied.
    char* fields[FOOD_RECORD_MAX_FIELDS];
    const uint8_t count = splitFields(argument, '|', fields, FOOD_RECORD_MAX_FIELDS);
    if (count == FOOD_RECORD_MIN_FIELDS || count == FOOD_RECORD_MAX_FIELDS) {
      registerFoodRecord(fields, count);
    } else {
      Serial.println(F("REG requires 7 fields, optionally 8; see HELP"));
    }
  } else if (asciiCaseEqual(command, "SNAPSHOT")) {
    printSnapshot();
  } else {
    Serial.println(F("Unknown/incomplete command; type HELP"));
  }
}

static void serviceSerial() {
  while (Serial.available() > 0) {
    int value = Serial.read();
    if (value < 0) break;
    if (value == '\r') continue;
    if (value == '\n') {
      if (serialLineOverflow) {
        if (!serialOverflowWarned) {
          Serial.println(F("[Serial] Input line too long; command discarded"));
          serialOverflowWarned = true;
        }
      } else {
        serialLine[serialLineLength] = '\0';
        processSerialCommand(serialLine);
      }
      serialLineLength = 0;
      serialLineOverflow = false;
      continue;
    }
    if (serialLineLength < static_cast<uint16_t>(SERIAL_LINE_CAPACITY - 1)) {
      serialLine[serialLineLength++] = static_cast<char>(value);
    } else {
      serialLineOverflow = true;
    }
  }
}

// ============================================================================
// Setup and cooperative main loop
// ============================================================================

void setup() {
  Serial.begin(115200);
  // Anything the host sent while the chip was resetting is not a command. Left
  // in the buffer it prepends itself to the first real command, which is why
  // CLEARQ was rejected as "unknown/incomplete" even when typed correctly.
  while (Serial.available() > 0) Serial.read();
  Serial.println();
  Serial.println(F("=== FreshGuard ESP8266 booting ==="));
  bool configurationOk = configurationSelfCheck();
  if (!configurationOk) Serial.println(F("[FATAL] Compile-time configuration self-check failed"));

  pinMode(PIN_RC522_SS, OUTPUT);
  digitalWrite(PIN_RC522_SS, HIGH);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(100000); // Conservative for breadboard wiring and level shifter.
  logI2cBusHealth();
  logI2CBus();

  initializePcf8574();
  initializeEnvironmentalSensors();
  initializeRtc();
  initializeRc522();
  initializeLcd();

  storageReady = LittleFS.begin();
  faults.littlefs = !storageReady;
  inventoryStoreReady = storageReady;
  if (storageReady) {
    initializeAlertQueue();
    loadInventory();
    loadMqBaselineFromStorage();
  } else {
    Serial.println(F("[LittleFS] Mount failed; existing data was not formatted/cleared"));
  }

  initializeNetworkConfiguration();
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (wifiConfigured) {
    uint32_t now = millis();
    startWifiAttempt(now);
  }

  bootMs = millis();
  lastSensorPollMs = bootMs - SENSOR_POLL_INTERVAL_MS;
  lastMqReadMs = bootMs - MQ_BASELINE_SAMPLE_INTERVAL_MS;
  lastRtcPollMs = bootMs - I2C_RTC_POLL_INTERVAL_MS;
  lastReedPollMs = bootMs - REED_POLL_INTERVAL_MS;
  lastRfidPollMs = bootMs;
  lastTransportAttemptMs = bootMs;
  lastThingSpeakAttemptMs = bootMs - THINGSPEAK_INTERVAL_MS;
  // Back-dated so the FIRST server-clock probe is due on the first transport
  // pass after the backend becomes reachable, rather than one interval later.
  // The correction still needs SERVER_SYNC_MIN_SAMPLES agreeing samples, so
  // starting early does not mean trusting the first one.
  lastServerTimeProbeMs = bootMs - SERVER_TIME_PROBE_FAST_MS;

  refreshFreshnessStatus();
  if (!configurationOk) faults.configuration = true;
  lcdPrintRow(0, configurationOk ? "FreshGuard ready" : "Configuration FAULT");
  lcdPrintRow(1, configurationOk ? "Offline-safe" : "Check wiring");
  printHelp();
  Serial.printf("[Memory] Free heap=%u bytes; inventory RAM approx=%u bytes\n",
                static_cast<unsigned>(ESP.getFreeHeap()),
                static_cast<unsigned>(sizeof(inventory) + sizeof(itemRuntime)));
  Serial.println(F("[Safety] No physical testing is implied by this firmware build."));
}

void loop() {
  uint32_t nowMs = millis();
  ESP.wdtFeed();

  serviceSerial();
  serviceWiFi(nowMs);
  serviceRtc(nowMs);
  serviceReedInput(nowMs);
  serviceMq135(nowMs);

  bool sensorPollDue = static_cast<uint32_t>(nowMs - lastSensorPollMs) >= SENSOR_POLL_INTERVAL_MS;
  if (sensorPollDue) {
    lastSensorPollMs = nowMs;
    readBme280();
    readBme280Humidity();
    refreshFreshnessStatus();
    evaluateAlertConditions(nowMs);
    // Once per poll, and against the LAST PUBLISHED values. Called here rather
    // than on every loop iteration so one change is one event, and placed
    // before serviceTransport() below so a detected change is published in this
    // same pass instead of a poll later. serviceMq135() has already run by now,
    // so the MQ-135 figures are included even on a pass where the BME280 is not
    // due; the two share a 5 s cadence and drift apart by milliseconds at most.
    publishIfSensorChanged();
  }

  serviceFaultTransitionAlert(nowMs);
  refreshFreshnessStatus();
  FreshnessStatus overallStatus = calculateOverallStatus();

  serviceBuzzer(nowMs);
  serviceStatusLeds(overallStatus, nowMs);
  serviceRc522(nowMs);
  updateLcd(nowMs, overallStatus);
  serviceTransport(nowMs);

  yield();
}
