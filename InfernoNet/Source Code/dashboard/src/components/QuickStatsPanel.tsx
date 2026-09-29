/**
 * Quick stats (guide §11).
 *
 * §11 lists four: compressor, energy, door, fan. This cabinet has exactly one
 * of them.
 *
 *   Door          REAL. A reed switch on the cabinet, reported by the device as
 *                 `open` plus a `stale` flag, with a configured open-timeout and
 *                 a latched `door_open` condition when the timeout passes. All
 *                 four of §11's states are therefore derivable, and each one is
 *                 derived from the device's own fields — including "open too
 *                 long", which is the presence of the device's `door_open`
 *                 condition rather than a duration this page counts itself.
 *
 *   Compressor    NOT INSTALLED. There is no compressor in this product.
 *   Fan           NOT INSTALLED. There is no evaporator and no fan.
 *   Energy        NOT INSTALLED. There is no energy meter.
 *
 * The three absences are rendered as three `AbsenceBlock`s rather than as three
 * tiles reading "Not installed", because a tile is a shape a reader fills in
 * with whatever they expected, and the questions "what would this measure, and
 * why is it not here?" deserve a sentence each.
 *
 * WHY "SINCE" IS NOT SHOWN FOR THE DOOR
 * -----------------------------------------------------------------------------
 * §11 wants "Since 2h 14m" under the door state. There is no honest source for
 * it. The device raises one `door_open` event per open cycle and does not raise
 * a matching "door closed" event, so the log cannot say when the door last shut;
 * and the snapshot is a state, not a history, so it cannot say when the door
 * opened either. The two things that ARE known — how long the device has been up,
 * and how long since it last reported — are shown instead, each labelled as what
 * it is. Counting the elapsed time in this browser would produce a number that
 * resets on every refresh and means nothing about the cabinet.
 */
import { memo } from 'react';
import type { DeviceBlock, Transport } from '../api/types';
import { number, span } from '../lib/format';
import { useFreshness } from '../lib/freshness';
import { AbsenceRow } from './AbsenceBlock';
import { Mark } from './Mark';

type DoorState = 'closed' | 'open' | 'open-too-long' | 'fault';

interface DoorPresentation {
  readonly state: DoorState;
  readonly word: string;
  readonly tone: 'ok' | 'warn' | 'unknown';
  readonly shape: 'circle' | 'triangle' | 'hatched-diamond';
  readonly why: string;
}

function presentDoor(device: DeviceBlock, doorOpenCondition: boolean): DoorPresentation {
  if (device.door.stale) {
    return {
      state: 'fault',
      word: 'Sensor fault',
      tone: 'unknown',
      shape: 'hatched-diamond',
      why: 'The reed input is not reporting, so the door state is unknown (R-12). Freshness status is unchanged by this: the device says so in its own condition text.',
    };
  }
  if (device.door.open) {
    if (doorOpenCondition) {
      return {
        state: 'open-too-long',
        word: 'Open too long',
        tone: 'warn',
        shape: 'triangle',
        why: 'The door is open and the device has raised its own door-open condition, which it does only after the configured limit passes.',
      };
    }
    return {
      state: 'open',
      word: 'Open',
      tone: 'warn',
      shape: 'triangle',
      why:
        device.door_timeout_ms === null
          ? 'The device reports the door open and has raised no door-open condition. It reported no open-timeout, so how long is too long is not configured.'
          : `The device reports the door open and has raised no door-open condition. Its limit is ${number(device.door_timeout_ms / 1000, 0)} s, so it is still inside it.`,
    };
  }
  return {
    state: 'closed',
    word: 'Closed',
    tone: 'ok',
    shape: 'circle',
    why: 'The reed input reports closed. The device raises no door condition, and its freshness verdict is unchanged by the door either way (R-12).',
  };
}

export interface QuickStatsPanelProps {
  readonly device: DeviceBlock;
  readonly transport: Transport;
  /** True when the device's own door-open condition is active. */
  readonly doorOpenCondition: boolean;
}

export const QuickStatsPanel = memo(function QuickStatsPanel({ device, transport, doorOpenCondition }: QuickStatsPanelProps) {
  const door = presentDoor(device, doorOpenCondition);
  // Measured, not the service's frozen verdict. See lib/freshness.ts.
  const freshness = useFreshness(transport);

  return (
    <div className="quick-stats">
      {/*
        The one real block. The door is the only actuator-adjacent signal the
        device reports, and it is the only one of §11's four that exists here.
      */}
      <section className="panel" aria-labelledby="quick-door-title">
        <div className="panel__head">
          <h2 className="panel__title" id="quick-door-title">
            Door
          </h2>
          <p className="panel__sub">Reed switch inside the cabinet · reported by the device</p>
        </div>
        <div className="panel__body">
          <p className="quick-stat" data-tone={door.tone}>
            <span className="quick-stat__mark">
              <Mark shape={door.shape} className="mark--lg" />
            </span>
            <span className="quick-stat__body">
              <span className="quick-stat__word">{door.word}</span>
              <span className="quick-stat__why">{door.why}</span>
            </span>
          </p>

          <div className="facts">
            <div className="fact">
              <span className="fact__label">Configured limit</span>
              <span className="fact__value">
                {device.door_timeout_ms === null ? 'not reported' : `${number(device.door_timeout_ms / 1000, 0)} s`}
              </span>
            </div>
            <div className="fact">
              <span className="fact__label">Device uptime</span>
              <span className="fact__value">{span(device.uptime_s)}</span>
            </div>
            <div className="fact">
              <span className="fact__label">Last accepted snapshot</span>
              <span className="fact__value">
                {freshness.since ?? 'unknown'} {freshness.stale ? '· stale, so the door state below is historical' : ''}
              </span>
            </div>
            <div className="fact">
              <span className="fact__label">Open for</span>
              <span className="fact__value">
                not reported
                <span className="withheld__note">
                  The device raises one event per open cycle and no matching close event, and a snapshot is a state
                  rather than a history. The service cannot say when the door last moved.
                </span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/*
        The three absences, in the compact form. Each still says what it would
        measure and why nothing is reported — a `not installed` tile with no
        sentence behind it invites the reader to supply their own assumption —
        but in three lines rather than twelve, so the rail's order still runs
        door → environment → health → conditions, with diagnostics at the bottom
        where §39 wants them.
      */}
      <div className="panel" aria-labelledby="quick-absent-title">
        <div className="panel__head">
          <h2 className="panel__title" id="quick-absent-title">
            Also in §11
          </h2>
          <p className="panel__sub">Three of the guide&apos;s four quick stats have no hardware behind them</p>
        </div>
        <div className="panel__body panel__body--flush">
          <AbsenceRow
            kind="not-installed"
            subject="Compressor"
            why="Would be measured: a running/stopped state, a runtime total, and a fault or lockout reason. This cabinet is a passive cold box — the board has no relay, no contactor and no current sensor, so there is no state to report and none is being withheld."
          />
          <AbsenceRow
            kind="not-installed"
            subject="Energy"
            why="Would be measured: instant power, voltage, current and kWh. There is no energy meter and no metering hardware, so a kWh figure would be arithmetic rather than a measurement."
          />
          <AbsenceRow
            kind="not-installed"
            subject="Evaporator fan"
            why="Would be measured: on, off or fault. There is no evaporator in this cabinet and no fan to drive; the device reports a fault for one, not a state for it."
          />
        </div>
      </div>
    </div>
  );
});
