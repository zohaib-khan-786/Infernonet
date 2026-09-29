/**
 * Refrigeration (guide §21, §22, §23, §24).
 *
 * Four guide sections, and this cabinet answers none of them, because it is a
 * passive cold box with a thermometer in it. The page is built anyway, because
 * §36 says an absence is a designed state and a missing page is not a designed
 * anything — a reader who followed "Refrigeration" in the sidebar and found
 * nothing would conclude the product was broken rather than that the feature
 * needs hardware.
 *
 * What is here:
 *
 *   §21  the cooling system and its schematic          not installed
 *   §22  Pi cooling, dew point, condensation risk      not installed
 *   §23  cooling controls                             not installed, twice over
 *   §24  energy                                       not installed
 *
 * plus one panel of real data: what this board DOES measure, so the reader is
 * oriented rather than only told what is missing. §39 is the reason the absences
 * come before it and the real panel last — this page has no operational status to
 * show, and the honest summary of it is "none of this exists", but the readings
 * below are real and a reader deciding whether to trust the product wants them.
 *
 * §22 IS THE INTERESTING ONE, and the note in that block is worth reading. A dew
 * point CAN be computed from the BME280's temperature and humidity — the formula
 * is a hundred years old and needs no hardware. It is not shown, and the reason
 * is that §22's condensation risk is not a property of the air. It is a
 * comparison between the air's dew point and the temperature of a cold surface,
 * and there is no cold surface in this cabinet to compare against. Printing a
 * condensation risk with nothing to condense on would be the exact failure guide
 * §22's own critical-safety banner is about.
 */
import { DeviceGate, PageHeader } from '../PageFrame';
import { AbsenceBlock } from '../../components/AbsenceBlock';
import { EnvironmentalGrid } from '../../components/EnvironmentalGrid';
import { number } from '../../lib/format';

export default function RefrigerationPage() {
  return (
    <DeviceGate>
      {({ dev, snapshot }) => (
        <>
          <PageHeader
            title="Refrigeration"
            lede={
              <>
                {dev} is a passive cold box. It measures the air inside itself and nothing about the machine that
                cools it, because there is no machine. Each block below says what would be measured, what is absent and
                why.
              </>
            }
          />

          <AbsenceBlock
            kind="not-installed"
            subject="Cooling system"
            wouldBe="Compressor state and runtime, evaporator, condenser and coolant temperatures, suction and discharge pressures, and a flow diagram of the loop with the current value on each stage."
            missing={[
              'a compressor, and any output the device uses to command one',
              'evaporator, condenser and coolant probes',
              'suction and discharge pressure transducers',
              'any of §7 card 3’s "configurable suction/discharge pressure" mode',
            ]}
            why={
              <>
                Nothing in the payload describes a cooling plant. The BME280&apos;s pressure is barometric pressure
                measured inside the cabinet — it is what the air is doing, not what a refrigerant is doing — and the
                firmware reports no pressure transducer at all. §21&apos;s schematic is not drawn, because a diagram
                whose four stages all read &quot;not installed&quot; is a picture of a feature rather than of a system.
              </>
            }
          />

          <AbsenceBlock
            kind="not-installed"
            subject="Pi cooling, dew point and condensation risk"
            wouldBe="Host CPU temperature, cold-plate temperature, coolant temperature, ambient temperature, the calculated dew point, and a high-priority condensation-risk state when a cold surface sits at or below it."
            missing={[
              'the host computer the whole page is about — there is no Raspberry Pi in this build',
              'a cold plate, and a thermocouple on it',
              'a coolant loop with its own temperature probe',
              'an ambient probe outside the cabinet',
              'a surface whose temperature could be compared with a dew point',
            ]}
            why={
              <>
                <strong>The dew point itself is computable and is deliberately not shown.</strong> It needs only
                temperature and relative humidity, and this cabinet reports both, so a number could be put on screen in
                about a line of arithmetic. But the thing §22 calls a safety condition is not a property of the air: it
                is a comparison between the air&apos;s dew point and the temperature of a cold surface, and{' '}
                <em>there is no cold surface here</em>. A condensation-risk reading with nothing to condense on is a
                warning about a hazard that cannot occur, and §22 asks for it to be high-priority — which is exactly why
                it must not be shown without the surface that would make it true.
              </>
            }
          />

          <AbsenceBlock
            kind="not-installed"
            subject="Cooling controls"
            wouldBe="§23’s controls — cooling mode, compressor, evaporator fan, pump, Pi cooling — each behind a confirmation and a permission check."
            missing={[
              'an actuator for each control, so there is nothing to command',
              'a permission system to check before commanding one (§46.9)',
              'a confirmation flow, because there is no action to confirm',
            ]}
            why={
              <>
                Two independent reasons, and both matter. There is no compressor, fan or pump in this cabinet, so a
                control would be a switch for nothing. And there is no identity system at all — no session, no user, no
                role — so &quot;permission-protected&quot; would be a checkbox that always passes. Guide §23 is explicit
                that a dangerous hardware control must never be reachable through an accidental single click, and
                rendering controls for hardware that does not exist would be the larger half of that failure.
              </>
            }
          />

          <AbsenceBlock
            kind="not-installed"
            subject="Energy"
            wouldBe="Instant power, voltage, current, kWh today / this week / this month, compressor energy, and §24’s five charts."
            missing={[
              'an energy meter or a current transformer',
              'a calibrated voltage and current measurement',
              'any power, voltage or current field in the device payload',
              'a compressor to attribute energy to',
            ]}
            why={
              <>
                A kWh figure without a meter is arithmetic, not measurement, and an energy chart drawn on top of it
                would be a decorative chart in the sense guide §2 forbids. The ESP8266 measures temperature, humidity,
                pressure, gas, the door and its own inventory; that is the complete list of what it knows about the world.
              </>
            }
          />

          <section className="panel" aria-labelledby="refr-real-title">
            <div className="panel__head">
              <h2 className="panel__title" id="refr-real-title">
                What this cabinet does measure
              </h2>
              <p className="panel__sub">
                Real readings, from the last accepted snapshot
                {snapshot.readings === null ? ' — none stored yet' : ` · ${snapshot.readings.seq} reading sequence`}
              </p>
            </div>
            <EnvironmentalGrid
              readings={snapshot.readings}
              thresholds={snapshot.device.thresholds}
              zoneStatus={snapshot.device.zone_status}
              transport={snapshot.transport}
              gasWarming={snapshot.device.gas.warming_or_baselining}
              gasState={String(snapshot.device.gas.state)}
            />
            <div className="panel__foot">
              <p className="hint">
                {number(snapshot.device.uptime_s, 0)} s of uptime · {number(snapshot.device.boot_count, 0)} boots · firmware{' '}
                {snapshot.device.firmware ?? 'not reported'} ·{' '}
                {snapshot.device.unavailable.length === 0
                  ? 'no fault bit set'
                  : `${snapshot.device.unavailable.length} availability bit${snapshot.device.unavailable.length === 1 ? '' : 's'} set`}
                . The cabinet is doing its one job: reporting the air inside itself every few seconds.
              </p>
            </div>
          </section>
        </>
      )}
    </DeviceGate>
  );
}
