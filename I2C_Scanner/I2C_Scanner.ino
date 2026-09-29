/*
 * ============================================================================
 *  I2C Address Scanner  -  minimal bus detector
 * ============================================================================
 *
 *  PURPOSE
 *    Reports every address that ACKs on the I2C bus. Nothing else.
 *    No sensor libraries, no expected-address table, no device logic, so a
 *    result here reflects the wiring and the hardware only - never the
 *    firmware that normally drives those devices.
 *
 *  WIRING  (NodeMCU / D1 mini labels in brackets)
 *    D2  [GPIO4]  SDA  ---  SDA on every module
 *    D1  [GPIO5]  SCL  ---  SCL on every module
 *    3V3            ---  VCC / VIN on every module
 *    GND            ---  GND on every module, all sharing ONE common ground
 *
 *  SDA goes to SDA and SCL goes to SCL. Do not cross them. A crossed pair
 *  makes every device invisible at every address, which looks identical to
 *  having nothing connected.
 *
 *  ADDRESS RANGE
 *    7-bit addresses run 0x08 to 0x77. Below 0x08 and above 0x77 are reserved,
 *    so they are skipped. No address is assumed or expected - whatever
 *    answers is reported, including addresses that are not I2C sensors at all.
 *
 *  READING THE OUTPUT
 *    FOUND 0x3F   a device ACKed at 7-bit address 0x3F
 *    FOUND 0x76   a device ACKed at 7-bit address 0x76
 *    Count        total devices currently responding
 *
 *    An address is reported even if it is the wrong one for the module you
 *    plugged in. That is the point: a module at an unexpected address is a
 *    solvable problem, whereas a module at NO address is a wiring problem,
 *    and the two need completely different fixes.
 *
 *  CONNECTING DEVICES WHILE IT RUNS
 *    Plug or unplug a module and watch. The address is reported the moment it
 *    appears or disappears, which identifies which wire completed the circuit.
 * ============================================================================
 */

#include <Wire.h>

// D1 = GPIO5 is the clock, D2 = GPIO4 is the data. These are fixed by the
// ESP8266 hardware and are not configurable.
static constexpr uint8_t PIN_SDA = 4;   // D2
static constexpr uint8_t PIN_SCL = 5;   // D1

// 100 kHz is deliberately slow. Breadboard jumpers and a level shifter have
// enough capacitance to break a 400 kHz bus, and a marginal bus produces
// phantom ACKs that look like real devices. Slow is the honest setting.
static constexpr uint32_t I2C_FREQUENCY = 100000;

static constexpr uint8_t I2C_ADDR_MIN = 0x08;
static constexpr uint8_t I2C_ADDR_MAX = 0x77;

static constexpr uint32_t SCAN_INTERVAL_MS = 2000;
static constexpr uint8_t SCANS_BETWEEN_FULL_LISTING = 5;

// Tracks the previous sweep so only real changes are announced.
static bool previouslyPresent[128];
static uint8_t addressCount = 0;

static bool deviceAcks(uint8_t address) {
  Wire.beginTransmission(address);
  Wire.write(0x00);  // content is irrelevant; only the address ACK matters
  return Wire.endTransmission() == 0;
}

static void announceChanges() {
  uint8_t count = 0;
  for (uint8_t address = I2C_ADDR_MIN; address <= I2C_ADDR_MAX; ++address) {
    const bool responding = deviceAcks(address);
    if (responding) {
      ++count;
      if (!previouslyPresent[address]) {
        Serial.printf("  FOUND  0x%02X\n", static_cast<unsigned>(address));
      }
    } else if (previouslyPresent[address]) {
      Serial.printf("  LOST   0x%02X\n", static_cast<unsigned>(address));
    }
    previouslyPresent[address] = responding;
  }
  addressCount = count;
}

static void printFullListing() {
  Serial.println(F("  Devices currently on the bus:"));
  if (addressCount == 0) {
    Serial.println(F("    (none)"));
    return;
  }
  for (uint8_t address = I2C_ADDR_MIN; address <= I2C_ADDR_MAX; ++address) {
    if (previouslyPresent[address]) {
      Serial.printf("    0x%02X\n", static_cast<unsigned>(address));
    }
  }
}

void setup() {
  Serial.begin(115200);
  // Discard anything buffered while the chip was resetting, so stray bytes
  // cannot be mistaken for output.
  while (Serial.available() > 0) {
    Serial.read();
  }

  Serial.println();
  Serial.println(F("=== I2C Scanner ==="));
  Serial.printf("SDA=GPIO4 (D2)  SCL=GPIO5 (D1)  %lu Hz\n",
                static_cast<unsigned long>(I2C_FREQUENCY));
  Serial.printf("Scanning 0x%02X to 0x%02X every %lu ms\n",
                I2C_ADDR_MIN, I2C_ADDR_MAX,
                static_cast<unsigned long>(SCAN_INTERVAL_MS));
  Serial.println(F("Plug or unplug modules now and watch for FOUND/LOST lines."));
  Serial.println();

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(I2C_FREQUENCY);

  // Take a first snapshot so the opening sweep prints a plain list rather than
  // reporting every address as newly discovered.
  for (uint8_t address = I2C_ADDR_MIN; address <= I2C_ADDR_MAX; ++address) {
    previouslyPresent[address] = deviceAcks(address);
    if (previouslyPresent[address]) {
      ++addressCount;
    }
  }
  printFullListing();
}

void loop() {
  static uint32_t nextScanMs = 0;
  static uint8_t sweepsSinceListing = SCANS_BETWEEN_FULL_LISTING;

  const uint32_t now = millis();
  if (static_cast<int32_t>(now - nextScanMs) < 0) {
    return;
  }
  nextScanMs = now + SCAN_INTERVAL_MS;

  announceChanges();
  Serial.printf("  %u device(s) responding\n", static_cast<unsigned>(addressCount));

  if (sweepsSinceListing == 0) {
    printFullListing();
    sweepsSinceListing = SCANS_BETWEEN_FULL_LISTING;
  } else {
    --sweepsSinceListing;
  }
  Serial.println();
}
