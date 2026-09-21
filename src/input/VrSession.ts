/**
 * Minimal WebXR session plumbing.
 *
 * three.js ships a `VRButton`, but it injects its own fixed styling; this
 * does the same job against the trainer's own button so the control bar
 * stays consistent, and reports support so the button can explain itself
 * when a headset is not available.
 */

/**
 * Why VR is or is not on offer.
 *
 * These are kept apart rather than collapsed into a single "unsupported"
 * because they have completely different fixes, and the one that bites in
 * practice is the one that looks least like itself: `navigator.xr` is
 * `[SecureContext]`, so over plain http it is not missing-and-explained, it
 * is simply absent — identical, from script, to a browser that has never
 * heard of WebXR. Sitting in a headset being told "no headset detected" is
 * a bad way to find out the page needed https.
 */
export type VrSupport =
  | 'available'
  /** Page is not a secure context, so the WebXR API is hidden entirely. */
  | 'insecure-context'
  /** Secure, but this browser has no WebXR at all. */
  | 'no-webxr'
  /** WebXR is present; it just cannot offer an immersive session. */
  | 'no-headset';

export async function detectVrSupport(): Promise<VrSupport> {
  const xr = navigator.xr;
  if (!xr) return globalThis.isSecureContext ? 'no-webxr' : 'insecure-context';
  try {
    return (await xr.isSessionSupported('immersive-vr')) ? 'available' : 'no-headset';
  } catch {
    return 'no-headset';
  }
}

export async function requestVrSession(): Promise<XRSession> {
  const xr = navigator.xr;
  if (!xr) throw new Error('WebXR is not available in this browser');
  return xr.requestSession('immersive-vr', {
    // `local` puts the origin wherever the headset is when the session
    // starts, which lets a seated pilot begin already in the seat without
    // any floor calibration.
    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
  });
}
