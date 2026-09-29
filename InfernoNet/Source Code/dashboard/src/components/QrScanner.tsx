/**
 * The camera. A primary path for reading a QR label, and one that must fail
 * honestly.
 *
 * ===========================================================================
 * WHAT THIS COMPONENT OWES THE OPERATOR
 * ===========================================================================
 *
 *   1. IT CHECKS BEFORE IT CALLS. `navigator.mediaDevices` is only exposed to a
 *      secure context, so on a plain-`http` LAN address there is no API to call
 *      and a scanner that opens with a permission prompt and then fails is a
 *      scanner that lies about what happened. The capability check runs first,
 *      and the reason is named by `app/inventory/cameraAccess.ts` — which is
 *      also where the wording lives, because that wording is the deliverable.
 *   2. IT SHUTS THE CAMERA OFF. A stream left running after the panel closes is
 *      a privacy bug, not a resource leak: the indicator light stays on, and an
 *      operator who closed the dialog reasonably believes it stopped. Stopped on
 *      unmount, on close, on a successful read, on an error, and on a device
 *      switch — the last one because the panel is keyed on `dev` by its parent.
 *   3. IT READS ONCE. A label sitting in frame decodes on every frame it is
 *      visible. One read, one identification.
 *   4. IT SENDS NOTHING. See `qrDecode.worker.ts` for why, at length. The frames
 *      are decoded in a worker on this device; the only thing that reaches the
 *      network is the id string, as a path segment on the service the operator
 *      already runs.
 *
 * THE MIRRORED-PREVIEW QUESTION, ANSWERED HERE SO IT IS NOT REOPENED
 * -----------------------------------------------------------------------------
 * A camera preview is conventionally mirrored so it feels like a mirror, and
 * this one is not. Mirroring the PREVIEW would be harmless, because the canvas
 * is drawn from the untransformed `HTMLVideoElement` — but a mirrored QR code is
 * a QR code that does not decode, so any mirroring that ever reached the decode
 * path would break reading while looking like a cosmetic choice. The rule this
 * component follows is that the preview is a decoration and the canvas is the
 * truth, and the preview is left alone so the two cannot be confused.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import QrDecodeWorker from './qrDecode.worker?worker';
import {
  cameraBlockFrom,
  classifyCameraError,
  describeCameraBlock,
  readCameraCapability,
  type CameraBlock,
} from '../app/inventory/cameraAccess';
import { Mark } from './Mark';

/**
 * The long edge, in pixels, of the image handed to the decoder.
 *
 * A printed QR label is physically small, so the resolution that matters is the
 * label's share of the frame, not the frame's own size. 480 keeps a label filling
 * a third of the frame readable — roughly 20+ pixels per module for a version-3
 * code — while cutting a 12 MP phone frame down by a factor of about fifty, which
 * is the difference between a few milliseconds of decoding and a visible stall.
 */
const MAX_EDGE = 480;

/**
 * How long the same text is ignored after it has been read once.
 *
 * A debounce rather than a latch, because a latch would be wrong in the other
 * direction: if the operator's first frame decoded only partially and they nudge
 * the camera, the same text appearing again seconds later is new information
 * about intent, not a duplicate. Two seconds is long enough to cover a full
 * second of frames at any plausible rate and short enough that a deliberate
 * second scan is honoured.
 */
const REPEAT_WINDOW_MS = 2000;

export interface QrScannerProps {
  readonly open: boolean;
  /** Called once per distinct label, with the decoded text. */
  readonly onRead: (text: string) => void;
  readonly onClose: () => void;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'running' }
  | { readonly kind: 'blocked'; readonly block: CameraBlock };

export function QrScanner({ open, onRead, onClose }: QrScannerProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * The `getUserMedia` promise is asynchronous, so a session can be torn down
   * while it is still in flight — StrictMode does exactly this in development,
   * and closing the dialog does it in production. Without this latch the late
   * stream would arrive, be attached to a video element nobody is looking at,
   * and keep the camera light on forever. Any stream that arrives after its
   * session is over is stopped immediately and dropped.
   */
  const sessionRef = useRef(0);
  /** Set once a read has been reported, so one label cannot fire twice. */
  const firedRef = useRef(false);
  const lastReadRef = useRef<{ readonly text: string; readonly at: number } | null>(null);
  /** One decode in flight at a time. Queuing frames would decode stale ones. */
  const busyRef = useRef(false);
  /**
   * The live stream, held here rather than read back off the `<video>` element.
   *
   * This is a correctness fix, not tidiness. React detaches refs as part of the
   * commit, and a passive effect's cleanup runs AFTER the commit — so by the time
   * an unmount's cleanup runs, `videoRef.current` can already be null, and a
   * `stop()` that found the stream through the element would find nothing and walk
   * away with the camera still running. The stream is the thing that has to be
   * stopped and it is kept somewhere that outlives the element.
   */
  const streamRef = useRef<MediaStream | null>(null);

  /**
   * Everything the camera owns, torn down in one place.
   *
   * Written as a function rather than a `useEffect` cleanup so that all four exit
   * routes — unmount, close, successful read, error — go through the same code and
   * there is no path that can forget the tracks.
   */
  const stop = useCallback(() => {
    const stream = streamRef.current;
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video !== null) video.srcObject = null;
  }, []);

  // The camera runs for exactly as long as the panel is open.
  useEffect(() => {
    if (!open) {
      stop();
      setPhase({ kind: 'idle' });
      return undefined;
    }

    // Every fact about this attempt is on the session ref, so a new attempt can
    // never be cleaned up by an older one's teardown.
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    firedRef.current = false;
    busyRef.current = false;
    lastReadRef.current = null;
    const alive = (): boolean => sessionRef.current === session;

    // THE CHECK, BEFORE ANY API IS TOUCHED.
    const capability = readCameraCapability();
    const blocked = cameraBlockFrom(capability, window.location.origin);
    if (blocked !== null) {
      setPhase({ kind: 'blocked', block: blocked });
      return () => {
        // Bump the session so anything still in flight is orphaned.
        sessionRef.current += 1;
        stop();
      };
    }

    setPhase({ kind: 'starting' });

    /**
     * The rear camera first, because a label is held at arm's length and the
     * front camera points at the operator. `ideal` rather than `exact` so a
     * device with one camera is not rejected over a preference; if the constraint
     * is refused outright, fall back to whatever camera exists.
     */
    const askFor = (constraints: MediaStreamConstraints): Promise<MediaStream> =>
      navigator.mediaDevices.getUserMedia(constraints);

    const constraints: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false },
    ];

    let attempt = 0;
    const requestStream = (): void => {
      if (!alive()) return;
      const constraintsForThisAttempt = constraints[attempt];
      if (constraintsForThisAttempt === undefined) return;
      attempt += 1;

      askFor(constraintsForThisAttempt).then(
        (stream) => {
          // Orphaned: the panel closed while the permission prompt was up. The
          // camera light must not stay on because of a dialog that is gone.
          if (!alive()) {
            for (const track of stream.getTracks()) track.stop();
            return;
          }
          const video = videoRef.current;
          if (video === null) {
            for (const track of stream.getTracks()) track.stop();
            return;
          }
          streamRef.current = stream;
          video.srcObject = stream;
          setPhase({ kind: 'running' });
          void video.play().catch(() => {
            // Autoplay can be refused even for a muted, inline element. The
            // frames simply will not advance, and the operator can still read the
            // camera error below and use the manual path.
            if (alive()) setPhase({ kind: 'blocked', block: { kind: 'camera-unreadable' } });
          });
        },
        (cause: unknown) => {
          if (!alive()) return;
          // A rejected *preference* is worth one retry without it. A refusal of
          // permission, or a device with no camera, will fail identically twice
          // and retrying would only make the operator wait longer for the same
          // answer.
          if (constraintsForThisAttempt.video !== true && (cause as { name?: string } | null)?.name === 'OverconstrainedError') {
            requestStream();
            return;
          }
          setPhase({ kind: 'blocked', block: classifyCameraError(cause) });
        },
      );
    };
    requestStream();

    return () => {
      sessionRef.current += 1;
      stop();
    };
  }, [open, stop]);

  /**
   * The decode loop.
   *
   * Separate effect because it is about the frames rather than the stream, and
   * because it must not re-run when the phase changes — a loop that restarted on
   * every state change would be a loop that never got to run a second frame. It
   * is driven by `requestAnimationFrame` so it is throttled to the display, and
   * it checks `readyState` so it never reads a frame that has not arrived.
   */
  useEffect(() => {
    if (phase.kind !== 'running') return undefined;

    const worker = new QrDecodeWorker();
    let frame = 0;
    let sequence = 0;
    let stopped = false;

    const onMessage = (event: MessageEvent<{ readonly seq: number; readonly text: string | null }>): void => {
      busyRef.current = false;
      const text = event.data.text;
      if (text === null || text === '' || stopped) return;

      const previous = lastReadRef.current;
      const at = Date.now();
      if (previous !== null && previous.text === text && at - previous.at < REPEAT_WINDOW_MS) return;

      lastReadRef.current = { text, at };
      if (firedRef.current) return;
      firedRef.current = true;

      stopped = true;
      cancelAnimationFrame(frame);
      // Stop the camera BEFORE handing the text on, so the light goes out at the
      // moment the label is read rather than whenever React next commits.
      stop();
      onRead(text);
    };

    worker.addEventListener('message', onMessage);

    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      if (stopped || busyRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video === null || canvas === null) return;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return;
      context.drawImage(video, 0, 0, width, height);

      // The one pixel read in this feature. It goes to a worker on this device
      // and is not retained, transmitted or logged.
      const image = context.getImageData(0, 0, width, height);
      const pixels = image.data.buffer as ArrayBuffer;
      sequence += 1;
      busyRef.current = true;
      worker.postMessage({ pixels, width, height, seq: sequence }, [pixels]);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      worker.removeEventListener('message', onMessage);
      worker.terminate();
    };
  }, [phase.kind, onRead, stop]);

  const titleId = useId();
  const hintId = useId();

  if (!open) return null;

  const blocked = phase.kind === 'blocked' ? describeCameraBlock(phase.block) : null;

  return (
    <div className="scanner">
      <div className="scanner__head">
        <h3 className="scanner__title" id={titleId}>
          Point the camera at the label
        </h3>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Stop the camera
        </button>
      </div>

      <div className="scanner__viewport">
        <video
          ref={videoRef}
          className="scanner__video"
          // Muted + inline so the browser will start a camera-only stream without
          // a user gesture on a phone, and playsInline so iOS does not hijack it
          // into its own full-screen player.
          muted
          playsInline
          aria-describedby={hintId}
          aria-label="Live camera preview. Nothing you point it at leaves this device."
        />
        {/* Decorative reticle: the finder patterns a QR code has, as four corners,
            so the operator knows what "framed" means without a word. */}
        <span className="scanner__reticle" aria-hidden="true" data-phase={phase.kind} />
        <p className="scanner__hint" id={hintId}>
          Frames are decoded on this device and are not uploaded, logged or sent anywhere. Only the id printed on the label
          is sent, to this dashboard&apos;s own service.
        </p>
      </div>

      <p className="visually-hidden" role="status">
        {phase.kind === 'running' ? 'The camera is running and looking for a label.' : null}
        {phase.kind === 'starting' ? 'Starting the camera.' : null}
        {phase.kind === 'blocked' && blocked !== null ? blocked.live : null}
      </p>

      {blocked !== null ? (
        <div className="notice" data-kind="service" role="group" aria-label="The camera cannot be used">
          <Mark shape="diamond" className="mark--lg" />
          <div>
            <p className="notice__kind">{blocked.kind}</p>
            <p className="notice__title">{blocked.title}</p>
            <div className="notice__body">
              {blocked.body.map((paragraph) => (
                <p key={paragraph.text} data-emphasis={paragraph.emphasis === true ? 'true' : undefined}>
                  {paragraph.text}
                </p>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
