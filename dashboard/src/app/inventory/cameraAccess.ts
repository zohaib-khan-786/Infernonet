/**
 * Whether the camera can run at all, and what to say when it cannot.
 *
 * ===========================================================================
 * THE ONE FAILURE THAT SHIPS THIS FEATURE BROKEN IF IT IS GOT WRONG
 * ===========================================================================
 *
 * `navigator.mediaDevices` does not exist unless the page was served from a
 * SECURE CONTEXT. Not "is restricted", not "asks for permission" — the object
 * itself is `undefined` on an insecure origin, so there is no API to call and no
 * amount of handling, retrying or a better camera will change it.
 *
 * A secure context is `https://`, or `http://` on `localhost` (and the other
 * names a browser treats as loopback). This project's dev server binds all
 * interfaces so a phone can reach it, and that is exactly how it is used in a
 * storeroom: at an address like `http://192.168.100.81:5173`. That address is
 * NOT a secure context, so on the LAN address that this dashboard is most likely
 * to be opened at, the camera cannot start, and a scanner that only says
 * "camera error" has told a volunteer standing in a cold room nothing at all.
 *
 * So the check happens BEFORE `getUserMedia` is called, the CAUSE is named rather
 * than the symptom, and the fallback is pointed at by name. Two properties of
 * the implementation are deliberate and worth not undoing:
 *
 *   1. The cause is tested before the symptom. On an insecure origin the symptom
 *      is also present — `navigator.mediaDevices` is missing — so a check written
 *      as "is the API missing?" would pass here and report "this browser has no
 *      camera support", which is a false statement about the user's browser and
 *      sends them off to debug the wrong thing. `isSecureContext` is asked FIRST,
 *      and the answer names the page's origin, which is the thing that can be
 *      changed.
 *   2. Nothing here silently degrades. There is no code path that reports a
 *      camera problem as a blank panel, a "try again", or a success. Either the
 *      camera runs, or one of these blocks is on screen saying why and pointing
 *      at the manual path that always works.
 *
 * WHY IT IS A MODULE WITH NO REACT IN IT
 * -----------------------------------------------------------------------------
 * The globals are read in one tiny function at the bottom of this file and
 * injected as a plain object; everything else — the precedence, the wording, the
 * classification of a `getUserMedia` rejection — is a function of its arguments.
 * The wording in particular is the deliverable. It is prose an operator reads
 * while holding a phone, in a storeroom, and it is prose that has to be right,
 * so it lives somewhere it can be read on its own and checked against the
 * security model rather than inside a JSX branch.
 */

// ---------------------------------------------------------------------------
// The capability facts, as a plain object
// ---------------------------------------------------------------------------

export interface CameraCapability {
  /** `window.isSecureContext`. False on plain `http://` at a LAN address. */
  readonly secureContext: boolean;
  /** `navigator.mediaDevices` exists at all. */
  readonly hasMediaDevices: boolean;
  /** `navigator.mediaDevices.getUserMedia` is a function. */
  readonly hasGetUserMedia: boolean;
}

/** Read the three facts. The only function in this file that touches a global. */
export function readCameraCapability(): CameraCapability {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  return {
    secureContext: typeof window !== 'undefined' && window.isSecureContext === true,
    hasMediaDevices: devices !== undefined && devices !== null,
    hasGetUserMedia: typeof devices?.getUserMedia === 'function',
  };
}

/**
 * Why the camera cannot run, or `null` when it can.
 *
 * The cause comes before the symptom on purpose — see the header. An insecure
 * origin produces BOTH an insecure context and a missing API, and reporting the
 * missing API there would blame the browser for something the page's own address
 * caused.
 */
export type CameraBlockKind =
  | 'insecure-context'
  | 'no-camera-api'
  | 'permission-refused'
  | 'no-camera'
  | 'camera-unreadable'
  | 'failed';

export type CameraBlock =
  | { readonly kind: 'insecure-context'; readonly origin: string }
  | { readonly kind: 'no-camera-api' }
  | { readonly kind: 'permission-refused' }
  | { readonly kind: 'no-camera' }
  | { readonly kind: 'camera-unreadable' }
  | { readonly kind: 'failed'; readonly detail: string };

/**
 * Decide, from the capability facts alone, whether the camera may be opened.
 *
 * Returns `null` when it may. It does NOT call `getUserMedia`: a page can be a
 * secure context with a working API and still have no camera, or a permission
 * already refused, and those only surface from the call itself. This is the
 * pre-flight; `classifyCameraError` handles what comes back.
 */
export function cameraBlockFrom(capability: CameraCapability, origin: string): CameraBlock | null {
  if (!capability.secureContext) return { kind: 'insecure-context', origin };
  if (!capability.hasMediaDevices || !capability.hasGetUserMedia) return { kind: 'no-camera-api' };
  return null;
}

/**
 * Name a `getUserMedia` rejection.
 *
 * A DOMException's `name` is the only stable part of it across browsers — the
 * message text is not specified, and a laptop and a phone word the same refusal
 * differently. So the branch is on `name`, and the name is kept for the panel to
 * print, because "the browser refused the camera" and "this device has no camera"
 * are entirely different problems for whoever has to fix it.
 */
export function classifyCameraError(cause: unknown): CameraBlock {
  const name = cause instanceof DOMException || cause instanceof Error ? cause.name : '';
  const detail = cause instanceof Error && cause.message !== '' ? cause.message : 'the browser gave no reason';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return { kind: 'permission-refused' };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { kind: 'no-camera' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return { kind: 'camera-unreadable' };
  }
  return { kind: 'failed', detail };
}

// ---------------------------------------------------------------------------
// What the operator is told
// ---------------------------------------------------------------------------

export interface CameraParagraph {
  readonly text: string;
  /**
   * Rendered in the interface's strong weight.
   *
   * Structural rather than a `**` marker inside the string, so the emphasis an
   * author wrote is emphasis the screen actually gets. Exactly one paragraph per
   * message carries it — the one naming the way forward — so a reader skimming
   * sees the fallback before they read the explanation.
   */
  readonly emphasis?: boolean;
}

export interface CameraBlockMessage {
  /** The eyebrow. Names the class of problem without blaming anything. */
  readonly kind: string;
  readonly title: string;
  /** Short paragraphs, in the order they should be read. */
  readonly body: readonly CameraParagraph[];
  /** The one sentence for the live region. */
  readonly live: string;
}

type Headline = Omit<CameraBlockMessage, 'body'>;

const MESSAGES: Readonly<Record<Exclude<CameraBlockKind, 'insecure-context' | 'failed'>, Headline>> = {
  'no-camera-api': {
    kind: 'No camera API in this browser',
    title: 'This browser does not offer a camera API on this page',
    live: 'The camera cannot be used here. This browser offers no camera API. Type the id below instead.',
  },
  'permission-refused': {
    kind: 'Camera permission refused',
    title: 'The camera was not permitted',
    live: 'The camera was not permitted. Type the id below instead.',
  },
  'no-camera': {
    kind: 'No camera found',
    title: 'No camera is available on this device',
    live: 'No camera was found. Type the id below instead.',
  },
  'camera-unreadable': {
    kind: 'Camera in use',
    title: 'The camera could not be started',
    live: 'The camera could not be started. Type the id below instead.',
  },
};

/**
 * The wording, for every block.
 *
 * Every one of these ends by pointing at the manual path, because the manual path
 * is not a degraded alternative: it is the same lookup against the same service
 * and it works on every origin, on every browser, and from a keyboard. A message
 * that left the operator at a dead end would be a message that made a working
 * feature look broken.
 */
export function describeCameraBlock(block: CameraBlock): CameraBlockMessage {
  switch (block.kind) {
    case 'insecure-context':
      return {
        kind: 'Blocked by the browser: this page is not a secure context',
        title: 'The camera cannot run on this page',
        live:
          'The camera cannot run on this page, because the page is not served over a secure origin. Type the id below instead.',
        body: [
          {
            text:
              'This page was not served over a secure origin, and a browser only exposes `navigator.mediaDevices` to pages that were. ' +
              'On plain `http://` at a network address, `navigator.mediaDevices` is not merely locked — it does not exist at all, so ' +
              'there is no camera API here to call and nothing this page can do about it.',
          },
          {
            text:
              `The address you are on is ${block.origin}. A browser treats a page as secure when it is served over ` +
              '`https://`, or over `http://` on `localhost`. Both of those work with the camera; a LAN address like this one does not. ' +
              'To use the camera on a phone, open the dashboard over `https://` instead.',
          },
          {
            text:
              'This is a rule the browser applies to the page, not a fault in the camera, the cabinet or this dashboard — nothing needs ' +
              'repairing, and nothing about the food or the device is affected.',
          },
          {
            emphasis: true,
            text:
              'Use the box below instead. Type or paste the unique id printed on the label. It is the same lookup against the same ' +
              'service, it works over plain HTTP, and it is the route anyone using a keyboard or a screen reader will take anyway.',
          },
        ],
      };

    case 'no-camera-api':
      return {
        ...MESSAGES['no-camera-api'],
        body: [
          {
            text:
              'This page is a secure context, so the browser is not withholding the camera — but ' +
              '`navigator.mediaDevices.getUserMedia` is not available in this browser, so there is no API to call.',
          },
          { text: 'It is not a fault in the camera, the cabinet or the service.' },
          {
            emphasis: true,
            text:
              'Use the box below instead. Type or paste the unique id printed on the label: the same lookup, the same service, and it ' +
              'works in every browser.',
          },
        ],
      };

    case 'permission-refused':
      return {
        ...MESSAGES['permission-refused'],
        body: [
          {
            text:
              'The browser refused to open the camera because this page is not allowed to use it. That is a permission you, or whoever ' +
              'set this device up, chose at some point — the site settings for this address will say whether it was blocked outright ' +
              'or dismissed by accident.',
          },
          { text: 'Nothing is wrong with the camera or the cabinet.' },
          {
            emphasis: true,
            text: 'Use the box below instead, or allow the camera for this address in the browser and press the button again.',
          },
        ],
      };

    case 'no-camera':
      return {
        ...MESSAGES['no-camera'],
        body: [
          {
            text:
              'The browser opened the camera API and then reported that this device has no camera it can use. On a laptop that usually ' +
              'means the built-in camera is disabled or in use by another application; on a phone it means the camera is unavailable ' +
              'or the requested rear-facing camera does not exist.',
          },
          { text: 'Nothing is wrong with the cabinet or the service.' },
          {
            emphasis: true,
            text: 'Use the box below instead. Type or paste the unique id printed on the label.',
          },
        ],
      };

    case 'camera-unreadable':
      return {
        ...MESSAGES['camera-unreadable'],
        body: [
          {
            text:
              'The camera was found but could not be read. Another application almost certainly has it open — a video call, or a ' +
              'second copy of this page — and the browser will not share it.',
          },
          { text: 'Nothing is wrong with the cabinet or the service.' },
          {
            emphasis: true,
            text:
              'Close whatever is using the camera and press the button again, or use the box below: type or paste the unique id ' +
              'printed on the label.',
          },
        ],
      };

    case 'failed':
      return {
        kind: 'The camera did not start',
        title: 'The browser could not start the camera',
        live: 'The camera could not be started. Type the id below instead.',
        body: [
          {
            text:
              'The camera API exists on this page and was called, and it failed for a reason this dashboard does not recognise. The ' +
              `browser reported: ${block.detail}`,
          },
          { text: 'Nothing is wrong with the cabinet or the service, and no conclusion about the label has been drawn.' },
          {
            emphasis: true,
            text: 'Use the box below instead. Type or paste the unique id printed on the label.',
          },
        ],
      };
  }
}
