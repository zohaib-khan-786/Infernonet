/**
 * The QR decoder, in a worker.
 *
 * ===========================================================================
 * WHY THERE IS NO NETWORK PATH, IN ONE PARAGRAPH
 * ===========================================================================
 *
 * This decodes camera frames ON THIS DEVICE and nowhere else. Not "by default",
 * not "we did not configure one" — there is no code in this file, in `jsqr`, or
 * in the module graph either one pulls in that can open a socket. `jsqr` is a
 * single self-contained file: it takes a pixel buffer and returns a string, and
 * the only URL anywhere in the shipped 250 KB is a Wikipedia link in a comment
 * about Bresenham's line algorithm.
 *
 * The alternative designs were all rejected for the same reason. A hosted
 * "scan this QR code" endpoint would put a live camera feed — a storeroom, its
 * shelves, and whatever is in frame — through a server the operator does not
 * control and cannot audit, on a connection they were told is local. A CDN-hosted
 * decoder bundle means the code decoding the frames is whatever the CDN served
 * that minute, and an air-gapped storeroom would have no decoder at all. Native
 * `BarcodeDetector` is hardware-accelerated and would be the right first choice
 * where it exists, but it is absent from Firefox and from Safari on the desktop,
 * so it cannot be the only path in a feature the SRS calls mandatory.
 *
 * The payload being decoded is a printed id, and the id is the only thing that
 * ever leaves this device: not the frame, not the pixels, not a hash of them.
 * What crosses the network afterwards is the uid string, as a path segment on the
 * FreshGuard service the operator already runs — which is also the only request
 * this feature makes.
 *
 * ===========================================================================
 * WHY A WORKER AND NOT THE MAIN THREAD
 * ===========================================================================
 *
 * Decoding is a few tens of milliseconds of tight numeric loops over every pixel.
 * On the main thread that is a dropped frame every time the loop runs, which in a
 * panel that is also showing a live dashboard means the whole page judders while
 * somebody is trying to line a label up in the camera. Off-thread, the main
 * thread only does `drawImage` + `getImageData` and the panel stays responsive
 * while a decode is in progress.
 *
 * The pixel buffer is TRANSFERRED rather than copied, so each frame costs no
 * allocation on either side: the buffer is handed over and the worker's copy is
 * neutered, and the main thread gets a fresh one from `getImageData` on the next
 * frame. Frames are downscaled to `MAX_EDGE` before they ever get here, which is
 * what keeps that cheap — a 4K phone camera frame would be 33 MB of pixels per
 * read and there is no reason to decode at that size for a printed label.
 */
import jsQR from 'jsqr';

/**
 * The worker's own view of its global.
 *
 * Hand-written rather than reached for via a `WebWorker` lib: `tsconfig.app.json`
 * compiles this project against `DOM`, not `DOM` + `WebWorker`, and adding a lib
 * to satisfy one small file would be a wider change than the file is. The two
 * members used here are the only two a dedicated worker has.
 */
interface DecodeScope {
  postMessage(message: DecodeReply, transfer?: readonly Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<DecodeFrame>) => void,
  ): void;
}

const scope = self as unknown as DecodeScope;

export interface DecodeFrame {
  /** RGBA pixels, exactly `width * height * 4` long. */
  readonly pixels: ArrayBuffer;
  readonly width: number;
  readonly height: number;
  /** Echoed back so a reply can be matched to the frame that caused it. */
  readonly seq: number;
}

export interface DecodeReply {
  readonly seq: number;
  /** The decoded text, or null when this frame held no readable code. */
  readonly text: string | null;
}

/**
 * `attemptBoth` — the default, and the reason a label printed on a dark
 * freezer door still reads.
 *
 * A white-on-dark QR code is a legitimate, common thing to print, and jsQR's
 * binariser handles it only by inverting the image and trying again. That costs
 * one extra pass on frames that contain no code at all, which is the common case
 * while somebody is finding the label; it is the right trade for reading a label
 * that has to work in a cold, badly-lit storeroom.
 */
const OPTIONS = { inversionAttempts: 'attemptBoth' } as const;

scope.addEventListener('message', (event) => {
  const { pixels, width, height, seq } = event.data;
  const result = jsQR(new Uint8ClampedArray(pixels), width, height, OPTIONS);
  scope.postMessage({ seq, text: result === null ? null : result.data });
});
