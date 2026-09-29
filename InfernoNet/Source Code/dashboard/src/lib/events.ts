/**
 * Event vocabulary, and the one place an event is allowed to be related to a
 * condition.
 *
 * THE EVENT TYPES ARE THE SERVICE'S, NOT OURS
 * -----------------------------------------------------------------------------
 * `EVENT_TYPES` in `backend/src/ingest/contract.js` is a CLOSED enum: the
 * service stores whatever the device reports only if it is in that list, and a
 * snapshot carrying an unknown type is rejected outright. Eleven types — the ten
 * the firmware raises through `raiseAlert()`, and `rfid_scanned`, the tag
 * identification observation, which the firmware publishes by a path that
 * deliberately does not go through `raiseAlert()` because a scan is not a
 * condition. This file names all eleven for display and, crucially, does not use
 * a name to decide anything.
 *
 * THE LABEL MAP CANNOT DRIFT FROM THE ENUM
 * -----------------------------------------------------------------------------
 * `EVENT_TYPES` is mirrored in `api/types.ts` and typed as a literal, and
 * `EVENT_LABELS` below is typed `Record<EventType, string>` rather than
 * `Record<string, string>`. The two are therefore one type-checked unit: add a
 * type to the enum without adding a label here and `tsc -b` fails with a missing
 * property, and `npm run build` runs `tsc -b` first, so an event type with no
 * wording cannot reach a bundle. That is the whole point — the previous map was
 * `Record<string, string>`, which compiled happily while `rfid_scanned` (a type
 * the service had been accepting all along) rendered in the log as "type not in
 * this build". A type absent from a `Record<string, …>` is not a compile error
 * and not a runtime error; it is a sentence on a screen, which is the worst
 * place for a gap to live.
 *
 * A type that is still unknown at runtime — a service newer than this build —
 * is NOT given a guessed label. It keeps its raw token and is marked where it is
 * rendered, so what an operator sees is the service's own word plus an honest
 * note that this build has no wording for it. That is the difference between
 * "unlabelled here" and "not a real event", and only the first is true.
 *
 * WHY EVENTS HAVE NO SEVERITY
 * -----------------------------------------------------------------------------
 * Guide §20's table has a severity column. The event record has no severity
 * field — `DeviceEvent` is `{ id, event_id, type, message, timestamp,
 * time_valid, received_at, uid? }` — and the dashboard has none to borrow: an
 * event's severity is not the same question as a condition's, and a
 * `temperature_high` event and a `temperature_high` condition differ in the
 * ways that matter, because one is a transition and the other is a latched
 * state. So the column is absent, the reason is printed above the table, and
 * no severity is inferred from the type string. The same goes for `sensor` and
 * `user`, which §20 also lists and which the record does not carry.
 *
 * The two ids in that shape are not interchangeable either. `id` is the
 * service's row id and the only sequence that still increases after a reflash;
 * `event_id` is the device's own counter, unique within one boot and restarting
 * at 1 after a reflash. Nothing in this file orders by either — labels and
 * related-event matching are per TYPE — and nothing anywhere may order or
 * compare newness by `event_id`; see the note on `DeviceEvent.id` in
 * `api/types.ts` for the silent starvation that produces.
 *
 * RELATED EVENTS
 * -----------------------------------------------------------------------------
 * Guide §15 asks an alert detail to list related events. The service stores no
 * link between a condition and an event, so any "related" list is a correlation
 * and has to be labelled as one. The mapping below is built from the event types
 * that are transitions and from the condition keys the backend derives, and it
 * is deliberately conservative: a condition whose subject cannot be named
 * unambiguously gets an empty list and says why, rather than being handed a
 * subset that implies more certainty than exists.
 */
import { EVENT_TYPES, type Alert, type DeviceEvent, type EventType } from '../api/types';

/**
 * Display names, one per type in the service's enum.
 *
 * Typed as the WHOLE enum, which is the mechanism and not a formality: a missing
 * key is a missing-property error, so the map cannot fall behind the vocabulary.
 * See the note at the top of this file.
 *
 * The labels are the service's own kind of statement, restated in English, and
 * each one is a fact about the cabinet rather than a judgement about the food —
 * except the two the device itself places (`food_use_soon`, `food_check`), which
 * are its item verdicts and are named as such.
 */
const EVENT_LABELS: Readonly<Record<EventType, string>> = {
  temperature_high: 'Temperature high',
  temperature_low: 'Temperature low',
  humidity_high: 'Humidity high',
  humidity_low: 'Humidity low',
  gas_relative_high: 'Gas level raised',
  door_open: 'Door held open',
  food_use_soon: 'Item approaching its limit',
  food_check: 'Item reached its limit',
  sensor_fault: 'Sensor fault',
  storage_fault: 'Storage or configuration fault',
  /**
   * What the firmware means, in the contract's own words: "a tag was presented
   * to the reader and its uid read".
   *
   * The wording is deliberately about a LABEL, not about a fault, a threshold or
   * a food item, because that is all the event is. A reader is optional (SRS
   * L542) and the reader is not a measurement: SRS L227 is explicit that no
   * sensor here may be used to identify which item caused a condition, and a
   * scan names an id that was PRESENT — never a cause. So this type is also
   * absent from `TYPES_FOR_SUBJECT` below, which is how a scan would otherwise
   * end up in an alert's "related events" list and read as evidence for it.
   */
  rfid_scanned: 'Label presented to the reader',
};

/** The types this build has a label for. Same set as `EVENT_TYPES`, by type. */
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(EVENT_TYPES);

/**
 * The label for a type, or the raw token when this build has none.
 *
 * Never a blank and never an invented one: an operator reading the log must see
 * what the service actually recorded, and this build's vocabulary is an
 * embellishment of that rather than a substitute for it. Callers that need to
 * mark the difference pair this with `isKnownEventType`, which is how the log
 * and the timeline say "this build has no wording for this" out loud.
 */
export function eventLabel(type: string): string {
  return isKnownEventType(type) ? EVENT_LABELS[type] : type;
}

/**
 * Whether this build has a label for a type — and the narrowing to `EventType`.
 *
 * Set membership rather than a key lookup, so an inherited property name
 * (`constructor`, `toString`) is not a type this build claims to have wording
 * for. Every type in the service's enum is in the set by construction, so this
 * can only be false against a service whose enum has grown.
 */
export function isKnownEventType(type: string): type is EventType {
  return KNOWN_EVENT_TYPES.has(type);
}

export type EventSubject = 'door' | 'gas' | 'humidity' | 'sensor' | 'storage' | 'food';

/**
 * Transitions grouped by what they are about, for the "related events" list.
 *
 * `rfid_scanned` is deliberately in none of these lists. It is not a transition
 * and belongs to no subject: putting it under one would offer a scan as a
 * possible explanation for a condition, which is the attribution SRS L227 rules
 * out and which nothing in this design can support.
 */
const TYPES_FOR_SUBJECT: Readonly<Record<EventSubject, readonly string[]>> = {
  door: ['door_open'],
  gas: ['gas_relative_high'],
  humidity: ['humidity_high', 'humidity_low'],
  sensor: ['sensor_fault'],
  storage: ['storage_fault'],
  food: ['food_use_soon', 'food_check'],
};

const DOOR_KEYS = new Set(['door_open', 'door_stale']);

/**
 * The subject a condition is about, as far as its key honestly admits.
 *
 * Returns `null` for the five whole-zone and whole-inventory status conditions,
 * most importantly. The backend's own prose for `zone_check_food` says "which
 * specific threshold raised it is not transmitted", and this is the same
 * refusal: the condition knows it is wrong and does not know which measurement
 * said so, so the dashboard cannot match it to a trace.
 */
export function subjectFor(alert: Alert): EventSubject | null {
  const key = alert.condition_key;
  if (DOOR_KEYS.has(key) || alert.kind === 'door') return 'door';
  if (key === 'gas_warmup') return 'gas';
  if (key.startsWith('item_use_soon:') || key.startsWith('item_check:') || key.startsWith('item_unavailable:')) return 'food';
  if (key.startsWith('storage_fault:')) return 'storage';
  if (key.startsWith('optional_fault:')) return null;
  if (key === 'time_untrusted') return 'sensor';
  if (key.startsWith('unavailable:') || key.startsWith('sensor_fault:')) {
    return key.endsWith(':bme280_humidity') ? 'humidity' : 'sensor';
  }
  return null;
}

/**
 * Events that mention the same subject, in the order given.
 *
 * A correlation, and the caller has to say so. The window is the events the
 * page has loaded, which is a prefix of the log rather than the whole log, and
 * the component states both facts next to the list.
 */
export function relatedEvents(alert: Alert, events: readonly DeviceEvent[]): readonly DeviceEvent[] {
  const subject = subjectFor(alert);
  if (subject === null) return [];
  const types = new Set(TYPES_FOR_SUBJECT[subject]);
  return events.filter((event) => types.has(event.type));
}

/** The distinct event types present in a set of rows, for the filter control. */
export function eventTypesPresent(events: readonly DeviceEvent[]): readonly string[] {
  return [...new Set(events.map((event) => event.type))].sort((a, b) => a.localeCompare(b));
}
