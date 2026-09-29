/**
 * The device selector (guide 5, and a named component in guide 41).
 *
 * The ONLY device control in the product. It drives `selectDevice` from the
 * dashboard store and nothing else, so choosing a device here changes every
 * panel on the page exactly once, through the one place that owns it.
 *
 * WHY THERE IS NO "All Devices" OPTION
 * -----------------------------------------------------------------------------
 * The guide's list starts with one, and it is not offered, because the store has
 * no state for it. `selectDevice(dev)` takes one device id; the snapshot, the
 * events page and the thresholds panel are all fetched per device, and there is
 * no aggregate endpoint. An "All Devices" option would have to either select a
 * literal string that no device has (and then render a device-not-found error
 * page) or quietly select the first device while the label claims otherwise.
 *
 * The second one is the dangerous version: a control that says "All Devices" and
 * shows you cabinet 1 is a false statement about what is on screen, in a product
 * whose entire argument is that it does not make those. When a real
 * multi-device aggregate exists, this is where it goes.
 *
 * WHY THE PICKER IS HIDDEN FOR A SINGLE DEVICE
 * -----------------------------------------------------------------------------
 * A `<select>` with one option is a control that cannot be used, and the
 * identity beside it already names the one device that exists. The store's
 * existing masthead made the same call, and this reuses that judgement rather
 * than re-deriving it.
 *
 * STALE DEVICES ARE LABELLED IN THE OPTION, NOT ONLY COLOURED
 * -----------------------------------------------------------------------------
 * A device whose link has gone quiet is marked "(no new data)" in its own option
 * text. A `<select>`'s options cannot carry tone classes reliably, and the
 * alternative - a green dot beside a name - is a colour-only signal inside a
 * native control that every platform renders differently. The word is the signal
 * and it is the one that survives.
 */
import { memo, useId } from 'react';
import { useDashboard, useDashboardActions } from '../../store/DashboardProvider';

export const DeviceSelector = memo(function DeviceSelector() {
  const { devices, dev } = useDashboard();
  const { selectDevice } = useDashboardActions();
  const id = useId();

  // One device: the identity block in the header already names it.
  if (devices.length < 2) return null;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        Device
      </label>
      <select
        id={id}
        className="field__input"
        value={dev ?? ''}
        onChange={(event) => selectDevice(event.target.value)}
        autoComplete="off"
      >
        {devices.map((entry) => (
          <option key={entry.dev} value={entry.dev}>
            {entry.dev}
            {entry.transport.stale ? ' (no new data)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
});
