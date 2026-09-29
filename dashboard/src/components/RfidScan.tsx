/**
 * The cabinet's own reader (guide §18) — and what is left of it.
 *
 * ===========================================================================
 * WHAT THIS COMPONENT USED TO BE, AND WHY IT IS NOT THAT ANY MORE
 * ===========================================================================
 *
 * This panel used to be a second, parallel way to identify an item: a text box
 * that matched a typed uid against the `items` array the page already had in the
 * browser, and reported the result itself. It carried a "Register Item" button
 * that was rendered deliberately disabled, on the stated grounds that "the
 * service has no route that adds an item". That was false — `POST
 * /api/v1/devices/:dev/items` exists, and `AddItemForm` has been driving it —
 * but the dead control was a symptom rather than the disease. The disease was
 * that this was a SECOND IDENTIFICATION FLOW, and a second flow is a second copy
 * of every decision about what a uid means.
 *
 * It could not tell a retired id from an unknown one. Both are simply absent
 * from the active inventory list the page was matching against, so both came out
 * as "no item carries this tag" — and the answer offered to register it, which
 * for a retired id means telling a volunteer to add a second record of an item
 * already on the shelf. Only a request to the service can tell those apart, via
 * the 404/409 split, and that request is now made once, in one place, for all
 * three sources of a uid.
 *
 * So the lookup is gone from this file. What remains is the one thing that is
 * genuinely about the reader and about nothing else: whether the optional
 * hardware is fitted, reporting, or faulted, and what the dashboard does when it
 * sees a label observation. The observations themselves are handed to
 * `IdentifyPanel`'s single action by the page; this component only reports the
 * state of the peripheral.
 *
 * RFID IS OPTIONAL AND THAT IS THE POINT
 * -----------------------------------------------------------------------------
 * SRS L105-108 / L157 / L305-308 make identification mandatory, through a unique
 * identification id on a label. SRS L542 lists "QR or RFID tracking" among things
 * the system "may include". So this reader is the optional half and the camera
 * and the manual box are not, and the wording below is careful to say so in every
 * state — including the state where the reader has never reported anything,
 * which is the normal state on a build without the hardware and must not read as
 * a fault.
 *
 * SRS L227 IS WORTH RESTATING HERE, BECAUSE THIS IS THE PANEL WHERE IT WOULD BE
 * EASIEST TO BREAK. A reader event says a label was PRESENT. It is not a
 * measurement, it is not attributed to any item, and nothing in this design can
 * say which item caused a condition — the gas sensor is a single MQ-135 reading
 * the air of a cabinet shared by everything in it, and no arrangement of events
 * makes it attributable. The backend asserts this too: a scan creates nothing,
 * faults nothing and raises no condition.
 */
import { Mark } from './Mark';
import { READER_OBSERVATION_EVENT } from '../app/inventory/identify';
import type { DeviceEvent } from '../api/types';

/** An observation event that actually carries an id, narrowed for the caller. */
export function isReaderObservation(event: DeviceEvent): event is DeviceEvent & { readonly uid: string } {
  return event.type === READER_OBSERVATION_EVENT && typeof event.uid === 'string' && event.uid !== '';
}

export interface RfidScanProps {
  readonly dev: string;
  /** The device's stored events, newest first. Read for the reader state only. */
  readonly events: readonly DeviceEvent[];
  /** The device has flagged the reader as an optional-hardware fault. */
  readonly readerFault: boolean;
}

export function RfidScan({ dev, events, readerFault }: RfidScanProps) {
  const reporting = events.some(isReaderObservation);

  return (
    <div className="identify__reader">
      <p className="identify__reader-head">
        <Mark shape="diamond" className="mark--sm" />
        The cabinet&apos;s own reader
      </p>

      {readerFault ? (
        <p className="field__hint">
          <strong>Not reporting.</strong> {dev} has raised an optional-hardware fault for the reader, so a label held
          against it will not be noticed. Nothing else on this panel depends on it — the camera and the manual box identify
          items without it — and food monitoring is unaffected.
        </p>
      ) : reporting ? (
        <p className="field__hint">
          <strong>Reporting.</strong> When {dev} records a label being presented, this page looks it up exactly as the
          camera and the manual box do, from the event the live feed already carries. There is no separate scan channel and
          nothing polls: the snapshot the service already publishes is the trigger, and only ids that are new since the
          previous read are looked up. An observation is a record of a label being present — it is never a claim that the
          item caused anything (SRS L227), and the service treats it the same way: a scan creates nothing and faults
          nothing.
        </p>
      ) : (
        <p className="field__hint">
          <strong>No label observation has been reported by {dev} yet.</strong> It is optional hardware (SRS L542), so
          its silence is not a fault and not something to wait for: the camera and the manual box above identify items
          without it. If the reader is fitted and is being used, and nothing appears here after a label is presented
          against it, then the optional-hardware fault above is what the device has to say about it.
        </p>
      )}
    </div>
  );
}
