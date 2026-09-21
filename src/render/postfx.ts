import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';

/**
 * The post chain.
 *
 * Three things do most of the work of making this look like a simulator
 * rather than a diagram:
 *
 *  - **Ground-truth ambient occlusion.** A cockpit is a box full of tight
 *    corners, recessed instruments and overlapping panels. Without contact
 *    shadows everything appears to float a millimetre off everything else.
 *    This is by far the biggest single improvement.
 *  - **A vignette**, which is what a real cockpit photograph looks like and
 *    quietly pulls the eye to the panel.
 *  - **SMAA**, because a cockpit is mostly long thin edges — bezels, placard
 *    text, switch stalks — and they crawl badly without it.
 *
 * There is deliberately no bloom. A daylight cabin is lit through windows
 * showing a physical sky whose linear radiance is orders of magnitude above
 * the interior, so any threshold low enough to catch a lit radio display
 * also catches the windscreen and veils the whole panel in white haze. The
 * effect cost far more than it bought.
 *
 * The composer is bypassed entirely in VR: EffectComposer renders to its own
 * target with a single camera and has no concept of the stereo XR framebuffer.
 */
export type QualityLevel = 'high' | 'balanced' | 'performance' | 'minimal';

export interface QualitySpec {
  id: QualityLevel;
  label: string;
  /** Upper bound on the device pixel ratio the 3D view is rendered at. */
  maxPixelRatio: number;
  ambientOcclusion: boolean;
  /**
   * Resolution the AO is computed at, as a fraction of the output. Ambient
   * occlusion is low-frequency, so half resolution is nearly indis-
   * tinguishable and costs a quarter as much.
   */
  aoScale: number;
  aoSamples: number;
  antialiasing: boolean;
  shadows: boolean;
  /** Whether to run the composer at all. */
  postProcessing: boolean;
}

/**
 * Four rungs, in the order things are worth giving up. Resolution goes
 * first because every screen-space pass costs in proportion to it, then
 * ambient occlusion, which is the most expensive single effect.
 */
export const QUALITY_LEVELS: readonly QualitySpec[] = [
  {
    id: 'high',
    label: 'High',
    maxPixelRatio: 2,
    ambientOcclusion: true,
    aoScale: 1,
    aoSamples: 16,
    antialiasing: true,
    shadows: true,
    postProcessing: true,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    maxPixelRatio: 1.5,
    ambientOcclusion: true,
    aoScale: 0.5,
    aoSamples: 8,
    antialiasing: true,
    shadows: true,
    postProcessing: true,
  },
  {
    id: 'performance',
    label: 'Performance',
    maxPixelRatio: 1,
    ambientOcclusion: false,
    aoScale: 0.5,
    aoSamples: 8,
    antialiasing: true,
    shadows: true,
    postProcessing: true,
  },
  {
    id: 'minimal',
    label: 'Minimal',
    maxPixelRatio: 1,
    ambientOcclusion: false,
    aoScale: 0.5,
    aoSamples: 8,
    antialiasing: false,
    shadows: false,
    postProcessing: false,
  },
];

export function qualitySpec(id: QualityLevel): QualitySpec {
  return QUALITY_LEVELS.find((q) => q.id === id) ?? QUALITY_LEVELS[1]!;
}

export class PostFx {
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly vignette: ShaderPass;
  private readonly smaa: SMAAPass;
  private enabled = true;
  private aoScale = 0.5;
  private width: number;
  private height: number;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    // A half-float target keeps the sky's radiance intact through the chain
    // so tone mapping has something to work with. No MSAA: hardware
    // multisampling on an HDR target is expensive, and SMAA at the end of
    // the chain is doing the antialiasing anyway.
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: 0,
    });
    this.composer = new EffectComposer(renderer, target);

    this.composer.addPass(new RenderPass(scene, camera));

    this.gtao = new GTAOPass(scene, camera, width, height);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    // Tuned for cockpit scale: the interesting occlusion is in gaps of a few
    // centimetres, not the metres a GTAO default assumes.
    this.gtao.updateGtaoMaterial({
      radius: 0.12,
      distanceExponent: 1.0,
      thickness: 0.35,
      scale: 1.1,
      samples: 16,
      screenSpaceRadius: false,
    });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
    this.composer.addPass(this.gtao);

    this.vignette = new ShaderPass(VignetteShader);
    const vig = this.vignette.uniforms as Record<string, { value: number }>;
    if (vig['offset']) vig['offset'].value = 0.92;
    if (vig['darkness']) vig['darkness'].value = 1.15;
    this.composer.addPass(this.vignette);

    this.composer.addPass(new OutputPass());
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);

    this.width = width;
    this.height = height;
    this.setSize(width, height);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const pixelRatio = this.renderer.getPixelRatio();
    this.composer.setSize(width, height);
    this.composer.setPixelRatio(pixelRatio);
    // Must come after the composer, which resizes every pass to full size.
    this.resizeAo();
  }

  private resizeAo(): void {
    const pixelRatio = this.renderer.getPixelRatio();
    this.gtao.setSize(
      Math.max(64, Math.round(this.width * pixelRatio * this.aoScale)),
      Math.max(64, Math.round(this.height * pixelRatio * this.aoScale)),
    );
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Applies a quality rung to the chain. */
  applyQuality(spec: QualitySpec): void {
    this.enabled = spec.postProcessing;
    this.gtao.enabled = spec.ambientOcclusion;
    this.smaa.enabled = spec.antialiasing;
    this.vignette.enabled = spec.postProcessing;
    this.aoScale = spec.aoScale;
    this.gtao.updateGtaoMaterial({ samples: spec.aoSamples });
    this.resizeAo();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Swaps the camera the chain renders with, after a view change. */
  setCamera(camera: THREE.Camera): void {
    for (const pass of this.composer.passes) {
      const withCamera = pass as { camera?: THREE.Camera };
      if (withCamera.camera) withCamera.camera = camera;
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.enabled) {
      this.renderer.render(scene, camera);
      return;
    }
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
