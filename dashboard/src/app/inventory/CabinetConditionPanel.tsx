/**
 * The cabinet condition: the measured half of the verdict.
 *
 * ===========================================================================
 * WHY EVERY NUMBER IN HERE SAYS "CABINET AIR"
 * ===========================================================================
 *
 * This is the only place in the freshness surface where a sensor reading appears,
 * and it is the only place that is safe. A per-item card gets screenshotted and
 * cropped; a panel headed "the storage cabinet, one cabinet for the whole zone"
 * does not travel the same way, and every cell inside it repeats the subject.
 *
 * The three numbers a reader is most likely to mis-attribute — temperature,
 * humidity and gas — are the three whose labels here begin with "cabinet air" or
 * "MQ-135, cabinet air", and the MQ-135's cell carries the SRS 1.6 (x) note
 * inline, next to the value, every time.
 *
 * ===========================================================================
 * WHAT IS SHOWN, AND WHAT IS DELIBERATELY NOT
 * ===========================================================================
 *
 * Shown, because each is a distinct piece of evidence the engine computed and a
 * reader deciding whether to trust a verdict needs all of them:
 *
 *   per-measurement  min / max / avg, samples, out-of-band count, minutes out of
 *                    range, worst deviation, the reason in words
 *   door             open count and total minutes, and the reed's own state
 *   gas              mV only, with its cabinet-air note, its state and whether the
 *                    channel was judged at all
 *   the window       its length, its bounds, its sample count and its time base
 *   coverage         `complete` / `partial` / `none`, and what it blocks
 *   the gaps         missing inputs, inactive channels, unobserved tail
 *
 * Not shown, because the backend did not send it: anything interpolated,
 * forward-filled or smoothed. A channel that was not graded has no statistics
 * here — it says so — rather than showing zeros, because `minutes_out_of_range: 0`
 * for a channel that never measured is the single most dangerous number this
 * panel could print.
 */
import { memo, type ReactNode } from 'react';
import type { CabinetEvidence, CabinetVerdict, ChannelEvidence } from '../../api/types';
import { dateTime, number, span } from '../../lib/format';
import { Mark } from '../../components/Mark';
import { cabinetConditionPresentation, severityRuleLabel } from './verdictPresentation';

/** `degC`, `pct_rh`, `mV`, `hPa`. The wire unit, echoed — never a substituted one. */
const UNIT_TEXT: Readonly<Record<string, string>> = {
  degC: '°C',
  pct_rh: '% RH',
  mV: 'mV',
  hPa: 'hPa',
};

/** A unit label the dashboard has not seen is shown verbatim rather than guessed. */
const unitText = (unit: string): string => UNIT_TEXT[unit] ?? unit;

/**
 * The condition chip for a channel. `excluded` and `not_evaluated` are NOT
 * verdicts about the air — one is a sensor that is not ready yet, the other is a
 * limit nobody asked about — so both take the plain diamond and the neutral
 * administrative slate, never a status colour. A channel that was skipped must
 * not be painted like a channel that breached.
 */
const CHANNEL_TONE: Readonly<Record<string, { tone: 'ok' | 'warn' | 'crit' | 'unknown' | 'neutral'; flagged: boolean }>> = {
  in_range: { tone: 'ok', flagged: false },
  warning: { tone: 'warn', flagged: true },
  critical: { tone: 'crit', flagged: true },
  no_data: { tone: 'unknown', flagged: false },
  excluded: { tone: 'neutral', flagged: false },
  not_evaluated: { tone: 'neutral', flagged: false },
};

/**
 * One channel, as a `.reading` cell from the existing vocabulary.
 *
 * The optional statistics are rendered as explicit absences. `undefined` and
 * `0` are different states here and the difference is the whole point: `0` means
 * "measured, and never out of range"; `undefined` means "not graded at all".
 */
const ChannelCell = memo(function ChannelCell({ channel }: { readonly channel: ChannelEvidence }) {
  const treatment = CHANNEL_TONE[channel.severity] ?? { tone: 'neutral' as const, flagged: false };
  const graded = channel.samples !== undefined;
  // `undefined` (the backend did not grade this channel) becomes an explicit
  // absence, never a zero. `number()` renders that as an em dash, so a skipped
  // channel can never print "0.00 °C avg · 0 min out of range".
  const min = channel.min ?? null;
  const max = channel.max ?? null;
  const avg = channel.avg ?? null;
  const samples = channel.samples ?? null;
  const footParts: string[] = [];

  if (graded) {
    footParts.push(`${number(min, 1)} – ${number(max, 1)} ${unitText(channel.unit)}`);
    footParts.push(`${number(samples, 0)} samples`);
  }
  if (channel.minutes_out_of_range !== undefined) {
    footParts.push(`${number(channel.minutes_out_of_range, 1)} min out of range`);
  }
  if (channel.out_of_band_samples !== undefined && channel.out_of_band_samples > 0) {
    footParts.push(`${number(channel.out_of_band_samples, 0)} of them outside the limit`);
  }
  if (!graded) footParts.push('not graded, so no statistics are shown');

  return (
    <div className={`reading${treatment.flagged ? ' reading--flag' : ''}`} data-tone={treatment.tone}>
      <span className="reading__label">
        {treatment.flagged ? <Mark shape={channel.severity === 'critical' ? 'square' : 'triangle'} className="mark--sm" /> : null}
        {channel.label}
      </span>
      <span className="reading__value">
        {graded ? (
          <>
            <span className="reading__number">{number(avg, 2)}</span>
            <span className="reading__unit">{unitText(channel.unit)} avg</span>
          </>
        ) : (
          <span className="reading__number reading__number--absent">—</span>
        )}
      </span>
      <span className="reading__foot">{footParts.join(' · ')}</span>
      <p className="cabinet-cell__reason">{channel.reason}</p>
      <p className="cabinet-cell__limit">
        Configured limit:{' '}
        {channel.limits.min === null && channel.limits.max === null
          ? 'none'
          : `${channel.limits.min === null ? 'no minimum' : `${number(channel.limits.min, 1)} ${unitText(channel.unit)} min`}, ${
              channel.limits.max === null ? 'no maximum' : `${number(channel.limits.max, 1)} ${unitText(channel.unit)} max`
            }`}
      </p>
    </div>
  );
});

/** A labelled list of facts, using `.status-band__stat` for the value/label pairs. */
function Stat({ label, value, title }: { readonly label: string; readonly value: string; readonly title: string | null }) {
  return (
    <div className="status-band__stat" title={title ?? undefined}>
      <span className="status-band__stat-value">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

/** A row of plain text facts, for things that are words rather than numbers. */
function Note({
  children,
  tone,
}: {
  readonly children: ReactNode;
  readonly tone: 'ok' | 'warn' | 'crit' | 'unknown' | 'admin' | 'neutral';
}) {
  return (
    <p className="cabinet-note" data-tone={tone}>
      <Mark shape="diamond" className="mark--sm" />
      {children}
    </p>
  );
}

/**
 * What the coverage figure means in practice, because `partial` is a word a
 * volunteer has no intuition for and it BLOCKS the one good verdict that matters.
 */
const COVERAGE_EXPLAINER: Readonly<Record<string, string>> = {
  complete:
    'Every configured channel produced usable measurements in the window, so the cabinet can be reported as within its limits.',
  partial:
    'Some configured channel produced no usable measurement, so the cabinet CANNOT be reported as within its limits. Missing data blocks the good verdict; it never hides a bad one.',
  none: 'No configured channel produced a usable measurement, so there is no cabinet condition to report at all.',
};

export const CabinetConditionPanel = memo(function CabinetConditionPanel({
  cabinet,
}: {
  readonly cabinet: CabinetVerdict;
}) {
  const evidence: CabinetEvidence = cabinet.evidence;
  const presentation = cabinetConditionPresentation(cabinet.condition);
  const window = evidence.window;
  const gas = evidence.gas;
  const door = evidence.door;
  const rules = evidence.severity_rules;
  const channels = Object.values(evidence.per_measurement);
  const observed = Object.entries(evidence.observed_only);

  return (
    <>
      <div className="readings">
        <div className="reading" data-tone={presentation.tone}>
          <span className="reading__label">
            <Mark shape={presentation.shape} className="mark--sm" />
            Cabinet condition
          </span>
          <span className="reading__value">
            <span className="reading__number">{presentation.label}</span>
          </span>
          <span className="reading__foot">
            {evidence.coverage} coverage · {number(channels.length, 0)} configured channels
          </span>
        </div>

        {channels.map((channel) => (
          <ChannelCell key={channel.channel} channel={channel} />
        ))}
      </div>

      <p className="note cabinet-conditions__reason">
        <strong>What the service said:</strong> {cabinet.reason}
      </p>

      {/* --- The window ------------------------------------------------------ */}
      <h4 className="cabinet-subhead">The window this was measured over</h4>
      <div className="cabinet-stats">
        <Stat label="requested window" value={window.minutes === null ? 'not set' : span(window.minutes * 60)} title={null} />
        <Stat label="samples in window" value={number(window.samples, 0)} title={null} />
        <Stat label="first reading seen" value={dateTime(window.from)} title={null} />
        <Stat label="last reading seen" value={dateTime(window.to)} title={null} />
        <Stat label="judged at" value={dateTime(window.requested_to)} title={null} />
        <Stat
          label="unobserved since the last sample"
          value={evidence.unobserved_after_seconds === null ? 'no samples at all' : span(evidence.unobserved_after_seconds)}
          title="Counted separately from exposure, and never added to it: no measurement brackets this gap, so counting it would invent time."
        />
        <Stat
          label="total minutes out of range"
          value={evidence.minutes_out_of_range === null ? 'withheld' : `${number(evidence.minutes_out_of_range, 1)} min`}
          title="Summed over observed intervals only, zero-order hold."
        />
      </div>
      <p className="hint">{window.time_base}</p>

      {/* --- The door -------------------------------------------------------- */}
      {/*
        WHAT THE SERVICE SENDS, AND WHAT IT DOES NOT
        -----------------------------------------------------------------------------
        The freshness document carries a door *state* — `open`, `stale`,
        `timeout_ms` — and no open count and no total open minutes. It cannot
        carry them: the reed switch reports a transition, the engine grades
        cabinet AIR, and the backend's own note says an open door "is not itself
        a cabinet condition: it changes the cabinet air, and the air readings
        already show that".

        So the count and the duration are rendered as an EXPLICIT ABSENCE naming
        what is missing, rather than as a zero, rather than as a browser-side sum
        over a page of events, and rather than quietly omitted. A sum computed
        here from a paginated event list would be a number the service never sent
        and would change with the page size, which is the confidently-wrong shape
        this whole feature exists to avoid.
      */}
      <h4 className="cabinet-subhead">The cabinet door</h4>
      <div className="cabinet-stats">
        <Stat
          label="door state right now"
          value={door.stale || door.open === null ? 'unknown' : door.open ? 'open' : 'closed'}
          title={door.stale ? 'The reed switch is not reporting, so the state is unknown. It is never reported as closed.' : null}
        />
        <Stat label="reed switch" value={door.stale ? 'not reporting' : 'reporting'} title={null} />
        <Stat
          label="open count in the window"
          value="not provided"
          title="The freshness engine measures cabinet air. It does not count door cycles, so this number is not in the response and this page does not invent one."
        />
        <Stat
          label="total open minutes in the window"
          value="not provided"
          title="Same reason. Open and close transitions are in the event log, where the service records them."
        />
        <Stat
          label="reed timeout"
          value={door.timeout_ms === null ? 'not configured' : `${number(door.timeout_ms, 0)} ms`}
          title={null}
        />
      </div>
      <p className="hint">{door.note}</p>

      {/* --- The gas --------------------------------------------------------- */}
      <h4 className="cabinet-subhead">The MQ-135 gas channel</h4>
      <div className="readings">
        {/*
          The `gas_delta_mv` figures — min, max, avg, minutes out of range, the
          reason — are already above, because that channel is one of the judged
          ones and is rendered by the same `ChannelCell` as temperature and
          humidity. This cell is the part that is not a number: what the sensor
          was doing, whether its channel was judged, and the SRS 1.6 (x) sentence
          that explains why the unit is millivolts and never ppm.
        */}
        <div className="reading" data-tone={gas.judged ? (gas.at_or_above_abnormal ? 'crit' : 'ok') : 'neutral'}>
          <span className="reading__label">
            <Mark shape={gas.judged ? (gas.at_or_above_abnormal ? 'square' : 'circle') : 'diamond'} className="mark--sm" />
            MQ-135, cabinet air
          </span>
          <span className="reading__value">
            <span className="reading__number reading__number--absent">{gas.judged ? 'judged' : 'not judged'}</span>
            <span className="reading__unit">mV only</span>
          </span>
          <span className="reading__foot">
            sensor state: {gas.state ?? 'not reported'} · abnormal at or above{' '}
            {gas.abnormal_threshold_mv === null ? 'no configured threshold' : `${number(gas.abnormal_threshold_mv, 1)} mV`} ·{' '}
            {gas.at_or_above_abnormal ? 'the abnormal level was reached in this window' : 'below the abnormal level in this window'}
          </span>
          <p className="cabinet-cell__reason">{gas.note}</p>
        </div>

        {observed.map(([key, stats]) => (
          <div className="reading" key={key}>
            <span className="reading__label">{stats.label}</span>
            <span className="reading__value">
              <span className="reading__number">{stats.samples === 0 ? '—' : number(stats.avg, 1)}</span>
              <span className="reading__unit">{unitText(stats.unit)} avg</span>
            </span>
            <span className="reading__foot">
              {stats.samples === 0
                ? 'no samples in the window'
                : `${number(stats.min, 1)} – ${number(stats.max, 1)} ${unitText(stats.unit)} · ${number(stats.samples, 0)} samples`}
            </span>
            <p className="cabinet-cell__reason">
              Reported and aggregated, never judged: no configured limit exists for this channel.
            </p>
          </div>
        ))}
      </div>

      {/* --- What was missing, and what was not asked about -------------------- */}
      <h4 className="cabinet-subhead">Coverage, gaps and limits</h4>
      <p className="note">{COVERAGE_EXPLAINER[evidence.coverage] ?? `The service reported coverage as "${evidence.coverage}".`}</p>

      {evidence.missing_inputs.length === 0 ? (
        <Note tone="ok">Every configured channel produced a usable measurement in the window.</Note>
      ) : (
        evidence.missing_inputs.map((entry) => (
          <Note key={entry.channel} tone="unknown">
            Missing input — {entry.channel}: {entry.reason}. A channel that could not be measured blocks the good
            verdict; it is never shown as within limits, and it never hides a detected problem.
          </Note>
        ))
      )}

      {evidence.inactive_channels.length === 0 ? null : (
        <Note tone="neutral">
          Not judged, by configuration rather than by fault:{' '}
          {evidence.inactive_channels.map((entry) => `${entry.channel} (${entry.reason})`).join(', ')}. These are
          reported and observed; nobody asked for a limit on them, so their absence does not block anything.
        </Note>
      )}

      {/* --- The warning band, and what it is not ----------------------------- */}
      <h4 className="cabinet-subhead">The warning band</h4>
      {/*
        `severity_rules` is typed as a `built_in_assumption` literal, so the label
        below cannot be built on anything else. It is shown HERE, next to the
        minutes-out-of-range figures it produces, because that is the only place a
        reader can connect "warning" to "1.5 degrees past the limit" and learn
        that the second number is the backend's own choice.
      */}
      <Note tone="admin">{severityRuleLabel(rules.margins)}</Note>
      <p className="hint">{rules.note}</p>
      <p className="hint">{rules.gas_crossing}</p>
    </>
  );
});
