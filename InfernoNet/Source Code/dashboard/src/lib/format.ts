/**
 * Formatting.
 *
 * Every function here is presentation only. None of them infers, adjusts or
 * second-guesses a value the backend sent, and none of them recomputes a
 * duration from the browser clock. Where the backend withheld a number, the
 * caller's `null` is carried through to the screen and the backend's own
 * `note` is shown instead.
 *
 * All dates and numbers go through `Intl`, so a volunteer's locale decides the
 * format. The dashboard forces a 24-hour clock because a monitoring instrument
 * that flips between AM/PM between two pages is hard to read at a glance.
 */

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

const DATE_TIME_SECONDS = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

const TIME_ONLY = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

const DAY_MONTH = new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit' });

/** Fixed-decimal number formatting, memoised per digit count. */
const numberFormats = new Map<number, Intl.NumberFormat>();
function fixed(digits: number): Intl.NumberFormat {
  let format = numberFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormats.set(digits, format);
  }
  return format;
}

/** Render a number at a fixed precision, or an explicit absence for `null`. */
export function number(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? '—' : fixed(digits).format(value);
}

/** ISO-8601 to "12 Mar 2026, 14:05". Returns an em dash for an absent stamp. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '—' : DATE_TIME.format(at);
}

/** ISO-8601 to "14:05:09", for places where the day is already established. */
export function timeWithSeconds(iso: string | null | undefined): string {
  if (!iso) return '—';
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '—' : DATE_TIME_SECONDS.format(at);
}

export function timeOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '—' : TIME_ONLY.format(at);
}

export function dayMonth(iso: string | null | undefined): string {
  if (!iso) return '—';
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '—' : DAY_MONTH.format(at);
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

/**
 * A duration as two significant units, e.g. "3 d 6 h" or "12 min 30 s".
 * Units below the leading one are dropped so a 90-second span reads "1 min
 * 30 s" rather than "0 d 0 h 1 min 30 s".
 */
export function span(totalSeconds: number): string {
  const s = Math.max(0, Math.round(Math.abs(totalSeconds)));
  if (s < MINUTE) return `${s} s`;
  if (s < HOUR) {
    const rest = s % MINUTE;
    return rest === 0 ? `${Math.floor(s / MINUTE)} min` : `${Math.floor(s / MINUTE)} min ${rest} s`;
  }
  if (s < DAY) {
    const rest = Math.floor((s % HOUR) / MINUTE);
    return rest === 0 ? `${Math.floor(s / HOUR)} h` : `${Math.floor(s / HOUR)} h ${rest} min`;
  }
  const rest = Math.floor((s % DAY) / HOUR);
  return rest === 0 ? `${Math.floor(s / DAY)} d` : `${Math.floor(s / DAY)} d ${rest} h`;
}

/** How long ago something was received, phrased for a person. */
export function ago(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'just now';
  if (seconds < 2) return 'just now';
  return `${span(seconds)} ago`;
}

/** Device uptime, always at day/hour/minute resolution so it does not jitter. */
export function uptime(seconds: number | null): string {
  return seconds === null ? '—' : span(seconds);
}

/**
 * Remaining time on a storage window, as the backend reported it.
 *
 * `null` in, `null` out: the caller must render the backend's `note` instead.
 * This function never falls back to `0`, because a withheld duration shown as
 * "0 s" reads as "expired now" — the exact opposite of what the device said.
 */
export function remaining(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds < 0) return `${span(seconds)} past the limit`;
  if (seconds === 0) return 'at the limit';
  return `${span(seconds)} left`;
}

/**
 * Turn a backend label into readable prose: `use_soon` becomes "Use soon".
 *
 * This is a spelling change and nothing else. The device owns the verdict, so
 * the label is never substituted or reinterpreted - and the raw token is shown
 * alongside it in the interface, so a volunteer can see the exact word the
 * service used.
 */
export function humaniseLabel(label: string): string {
  const words = label.replace(/_/g, ' ').trim();
  if (words === '') return label;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Pluralise a count without hand-rolled string surgery. */
export function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${new Intl.NumberFormat().format(value)} ${value === 1 ? singular : plural}`;
}
