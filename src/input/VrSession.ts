/**
 * Minimal WebXR session plumbing.
 *
 * three.js ships a `VRButton`, but it injects its own fixed styling; this
 * does the same job against the trainer's own button so the control bar
 * stays consistent, and reports support so the button can explain itself
 * when a headset is not available.
 */
export type VrSupport = 'unsupported' | 'available';

export async function detectVrSupport(): Promise<VrSupport> {
  const xr = navigator.xr;
  if (!xr) return 'unsupported';
  try {
    return (await xr.isSessionSupported('immersive-vr')) ? 'available' : 'unsupported';
  } catch {
    return 'unsupported';
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
