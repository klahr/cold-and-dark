import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectVrSupport } from '../src/input/VrSession';

/**
 * The three ways VR can be off the table look identical from script unless
 * they are told apart deliberately, and the one that actually happens — a
 * headset browser on a plain-http page — is the one that used to report
 * "no headset detected" while the headset was on the user's face.
 */
function withEnvironment(opts: { secure: boolean; xr?: { immersive: boolean } | null }): void {
  vi.stubGlobal('isSecureContext', opts.secure);
  vi.stubGlobal(
    'navigator',
    opts.xr
      ? { xr: { isSessionSupported: () => Promise.resolve(opts.xr!.immersive) } }
      : {},
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('detectVrSupport', () => {
  it('blames the scheme when the page is not a secure context', async () => {
    // navigator.xr is [SecureContext]: over plain http it is not merely
    // unusable, it is absent.
    withEnvironment({ secure: false, xr: null });
    await expect(detectVrSupport()).resolves.toBe('insecure-context');
  });

  it('blames the browser when it is secure but has no WebXR', async () => {
    withEnvironment({ secure: true, xr: null });
    await expect(detectVrSupport()).resolves.toBe('no-webxr');
  });

  it('blames the hardware when WebXR cannot offer an immersive session', async () => {
    withEnvironment({ secure: true, xr: { immersive: false } });
    await expect(detectVrSupport()).resolves.toBe('no-headset');
  });

  it('offers VR when a headset is actually there', async () => {
    withEnvironment({ secure: true, xr: { immersive: true } });
    await expect(detectVrSupport()).resolves.toBe('available');
  });

  it('treats a throwing isSessionSupported as no headset, not as a crash', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {
      xr: {
        isSessionSupported: () => Promise.reject(new Error('nope')),
      },
    });
    await expect(detectVrSupport()).resolves.toBe('no-headset');
  });
});
