import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildCockpit, type CockpitShell } from './render/Cockpit';
import { buildWorld, WING, type WorldHandle } from './render/world';
import { ExteriorLights } from './render/ExteriorLights';
import { setupLighting, type SceneLighting } from './render/lighting';
import { PostFx, qualitySpec, type QualityLevel } from './render/postfx';
import { ControlRig } from './render/ControlRig';
import { InstrumentRig } from './render/InstrumentRig';
import { YokeDucking } from './render/YokeDucking';
import { SeatedCamera, VIEW_PRESETS } from './input/SeatedCamera';
import { Pointer } from './input/Pointer';
import { VrControls } from './input/VrControls';
import { detectVrSupport, requestVrSession } from './input/VrSession';
import { VrChecklistCard } from './ui/VrChecklistCard';
import { Simulation } from './sim/Simulation';
import { Challenge } from './sim/Challenge';
import { findAircraft, DEFAULT_AIRCRAFT_ID } from './aircraft/registry';
import { EYE } from './render/frame';
import { Hud } from './ui/Hud';
import { CockpitAudio } from './audio/CockpitAudio';
import { describeControl } from './ui/describeControl';

export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly view: SeatedCamera;
  readonly cockpit: CockpitShell;
  readonly audio = new CockpitAudio();
  readonly yokeDucking: YokeDucking;
  readonly exteriorLights: ExteriorLights;
  readonly world: WorldHandle;
  /**
   * Rig the camera and the VR controllers hang off. In flat mode it sits at
   * the origin and the seated camera drives itself in world coordinates; in
   * VR it is parked at the pilot's eye and the headset takes over.
   */
  readonly rig = new THREE.Group();
  readonly vrCard = new VrChecklistCard();
  readonly postfx: PostFx;
  /** Timed-run state, kept across aircraft loads. */
  readonly challenge = new Challenge();
  private readonly lighting: SceneLighting;
  private quality: QualityLevel = 'balanced';
  /** Rolling frame times, used to step the quality down if the GPU is struggling. */
  private readonly frameTimes: number[] = [];
  private autoTuned = false;
  private vrControls: VrControls | null = null;
  private vrSupport: 'unsupported' | 'available' | 'pending' = 'pending';

  /**
   * These are replaced wholesale when a different aircraft is loaded. The
   * cabin shell, camera, lighting and world are shared; everything that
   * comes from the aircraft definition is rebuilt.
   */
  sim!: Simulation;
  controlRig!: ControlRig;
  instrumentRig!: InstrumentRig;
  hud!: Hud;
  private pointer!: Pointer;

  private readonly timer = new THREE.Timer();
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLElement;
  private running = false;
  private elapsed = 0;
  private soundOn = false;
  private yokesVisible = true;
  /** Control the pilot is being pointed at, for the yoke to duck away from. */
  private guidedControlId: string | null = null;
  private hoveredControlId: string | null = null;
  private readonly focusPoint = new THREE.Vector3();

  /** Dev-only free camera for inspecting geometry from outside the cabin. */
  private inspectCamera: THREE.PerspectiveCamera | null = null;
  private inspectControls: OrbitControls | null = null;
  private inspecting = false;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.canvas = canvas;
    this.overlay = overlay;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.78;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');

    this.view = new SeatedCamera(window.innerWidth / window.innerHeight);
    this.rig.add(this.view.camera);
    this.rig.add(this.vrCard.object);
    this.scene.add(this.rig);

    this.lighting = setupLighting(this.scene, this.renderer);
    this.world = buildWorld(this.scene);
    this.exteriorLights = new ExteriorLights(
      this.scene,
      this.world.airframeMaterial,
      WING.tipX,
      WING.y,
      WING.z,
    );

    this.cockpit = buildCockpit();
    this.scene.add(this.cockpit.group);
    this.yokeDucking = new YokeDucking(this.cockpit);

    this.postfx = new PostFx(
      this.renderer,
      this.scene,
      this.view.camera,
      window.innerWidth,
      window.innerHeight,
    );

    this.setQuality('balanced');
    this.loadAircraft(DEFAULT_AIRCRAFT_ID);
    this.bindEvents();
    void this.initVr();
  }

  /**
   * Swaps in a different aircraft definition. Nothing in this method knows
   * anything about a particular aeroplane — that is the whole point of the
   * definition being data.
   */
  loadAircraft(id: string): void {
    const aircraft = findAircraft(id);

    this.pointer?.dispose();
    this.controlRig?.dispose();
    this.instrumentRig?.dispose();
    this.hud?.dispose();

    this.guidedControlId = null;
    this.hoveredControlId = null;
    this.sim = new Simulation(aircraft);
    this.controlRig = new ControlRig(aircraft, this.sim.controls, this.cockpit);
    this.instrumentRig = new InstrumentRig(aircraft, this.cockpit);

    this.hud = new Hud(this.overlay, aircraft, this.sim, this.challenge, {
      onSelectView: (i) => this.selectView(i),
      onReset: () => this.resetAircraft(),
      onFocusControl: (controlId) => this.focusControl(controlId),
      onGuideControl: (controlId) => {
        this.guidedControlId = controlId;
        this.controlRig.setGuided(controlId);
      },
      onToggleSound: (on) => this.setSound(on),
      onToggleYokes: (visible) => this.setYokesVisible(visible),
      onSelectAircraft: (nextId) => this.loadAircraft(nextId),
      onSetQuality: (level) => this.setQuality(level),
      onEnterVr: () => {
        void this.enterVr().catch((err: unknown) => {
          console.error('Could not start the VR session', err);
        });
      },
    });
    this.hud.setQuality(this.quality);
    this.hud.setSoundState(this.soundOn);
    this.hud.setYokeState(this.yokesVisible);
    if (this.vrSupport !== 'pending') this.hud.setVrSupport(this.vrSupport);
    if (this.renderer.xr.isPresenting) this.hud.setVrPresenting(true);

    // New geometry has just appeared, so the frozen shadow map needs one
    // more pass to pick it up.
    this.lighting.sun.shadow.needsUpdate = true;

    this.vrControls?.retarget(this.controlRig, this.sim.controls);

    this.pointer = new Pointer(
      this.canvas,
      this.view.camera,
      this.controlRig,
      this.sim.controls,
      this.view,
      {
        onHover: (control, x, y) => {
          this.hoveredControlId = control?.def.id ?? null;
          this.hud.showTooltip(
            control ? describeControl(control.def, this.sim) : null,
            x,
            y,
          );
        },
        onActuate: (controlId) => {
          this.hud.onActuate(controlId);
          this.audio.click(clickKindFor(this.sim.controls.def(controlId).kind));
          // The tooltip is showing this control's old state; update it in
          // place so the readout agrees with what just happened.
          if (controlId === this.hoveredControlId) {
            this.hud.refreshTooltip(
              describeControl(this.sim.controls.def(controlId), this.sim),
            );
          }
        },
      },
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer.connect(document);
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.pointer.dispose();
    this.controlRig.dispose();
    this.instrumentRig.dispose();
    this.audio.dispose();
  }

  resetAircraft(): void {
    this.sim.reset();
    this.controlRig.syncAll();
    this.hud.reset();
  }

  /**
   * Moves to a saved viewpoint. This always leaves the inspect camera,
   * because asking for a view and not getting it is indistinguishable from
   * the button being broken.
   */
  selectView(index: number): void {
    if (this.inspecting) this.toggleInspect(false);
    this.view.setPreset(index);
    this.hud.setActiveView(index);
  }

  /**
   * Sets the rendering quality. Resolution is the first thing to go,
   * because every screen-space pass costs in proportion to pixel count.
   */
  setQuality(level: QualityLevel): void {
    this.quality = level;
    const spec = qualitySpec(level);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, spec.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = spec.shadows;
    this.lighting.sun.castShadow = spec.shadows;
    this.lighting.sun.shadow.needsUpdate = true;
    this.postfx.applyQuality(spec);
    this.postfx.setSize(window.innerWidth, window.innerHeight);
    this.hud?.setQuality(level);
  }

  get qualityLevel(): QualityLevel {
    return this.quality;
  }

  /**
   * Drops a rung if the first couple of seconds are clearly too slow. Runs
   * once: after that the pilot is in charge of the setting.
   */
  private autoTune(dt: number): void {
    if (this.autoTuned || this.renderer.xr.isPresenting) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 120) return;

    this.autoTuned = true;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    if (median <= 1 / 45) return;

    const next = median > 1 / 22 ? 'minimal' : 'performance';
    this.setQuality(next);
    console.info(
      `Rendering at ${Math.round(1 / median)} fps, so quality dropped to "${next}". ` +
        'Override it in the top-left if you would rather have the fidelity.',
    );
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    if (on) this.audio.resume();
    this.audio.setMuted(!on);
  }

  setYokesVisible(visible: boolean): void {
    this.yokesVisible = visible;
    for (const yoke of this.cockpit.yokes) yoke.visible = visible;
  }

  private frame(time: number): void {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.elapsed += dt;

    const presenting = this.renderer.xr.isPresenting;

    this.autoTune(dt);
    this.sim.pilot.setHeadYaw(this.view.camera.rotation.y);
    this.sim.tick(dt);
    this.audio.update(this.sim);
    this.exteriorLights.update(dt, this.sim);
    this.world.update(dt, this.sim.engine.rpm);
    this.instrumentRig.update(this.sim, dt);
    this.controlRig.tick(this.elapsed);
    this.hud.update(dt);
    this.yokeDucking.update(dt, this.view.camera, this.focusWorldPoint());

    // Always stepped, even when another camera is being rendered, so the
    // seated view is never stale when control returns to it.
    this.view.update(dt);

    if (presenting) {
      // The composer knows nothing about the stereo XR framebuffer, so VR
      // renders straight through.
      this.vrControls?.update();
      this.vrCard.update(this.hud.checklist, this.sim.definition.name);
      this.renderer.render(this.scene, this.view.camera);
      return;
    }

    if (this.inspecting && this.inspectCamera && this.inspectControls) {
      this.inspectControls.update();
      this.renderer.render(this.scene, this.inspectCamera);
      return;
    }

    this.postfx.render(this.scene, this.view.camera);
  }

  /**
   * World position of whatever the pilot is currently being pointed at:
   * what they are hovering, or failing that what the checklist wants next.
   */
  private focusWorldPoint(): THREE.Vector3 | null {
    const id = this.hoveredControlId ?? this.guidedControlId;
    if (!id) return null;
    const obj = this.controlRig.objectFor(id);
    if (!obj) return null;
    obj.object.getWorldPosition(this.focusPoint);
    return this.focusPoint;
  }

  /* ------------------------------ VR ------------------------------ */

  private async initVr(): Promise<void> {
    const support = await detectVrSupport();
    this.vrSupport = support;
    this.hud.setVrSupport(support);
    if (support !== 'available') return;

    this.vrControls = new VrControls(
      this.renderer,
      this.rig,
      this.controlRig,
      this.sim.controls,
      {
        onActuate: (id) => {
          this.hud.onActuate(id);
          this.audio.click(clickKindFor(this.sim.controls.def(id).kind));
        },
      },
    );

    this.renderer.xr.addEventListener('sessionstart', () => this.onVrStart());
    this.renderer.xr.addEventListener('sessionend', () => this.onVrEnd());
  }

  /** Called from the HUD's VR button, which supplies the user gesture. */
  async enterVr(): Promise<void> {
    const session = await requestVrSession();
    await this.renderer.xr.setSession(session);
  }

  private onVrStart(): void {
    // Park the rig at the pilot's eye. With a `local` reference space the
    // headset's starting pose becomes the origin, so the pilot begins in
    // the seat wherever they happen to be sitting in the room.
    this.rig.position.set(EYE[0], EYE[1], EYE[2]);
    this.view.camera.position.set(0, 0, 0);
    this.view.camera.rotation.set(0, 0, 0);
    this.vrCard.object.visible = true;
    // Audio needs the session's user gesture to start, and in a headset the
    // engine note is most of the sense of presence.
    this.setSound(true);
    this.hud.setVrPresenting(true);
  }

  private onVrEnd(): void {
    this.rig.position.set(0, 0, 0);
    this.vrCard.object.visible = false;
    this.hud.setVrPresenting(false);
  }

  /** Aims the pilot's head at a control the checklist is asking for. */
  private focusControl(id: string): void {
    const obj = this.controlRig.objectFor(id);
    if (!obj) return;
    const world = new THREE.Vector3();
    obj.object.getWorldPosition(world);
    this.view.lookAtPoint(world);
  }

  /**
   * Toggles a free orbit camera. This exists purely so cabin geometry can be
   * checked from outside while it is being built; the trainer itself never
   * leaves the pilot's seat.
   */
  toggleInspect(on = !this.inspecting): void {
    this.inspecting = on;
    this.hud?.setInspecting(on);
    if (!on) {
      if (this.inspectControls) this.inspectControls.enabled = false;
      return;
    }
    let camera = this.inspectCamera;
    let controls = this.inspectControls;
    if (!camera || !controls) {
      camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.02, 20000);
      camera.position.set(1.3, 1.5, 1.4);
      controls = new OrbitControls(camera, this.canvas);
      controls.target.set(0, 0.65, -0.4);
      controls.enableDamping = true;
      this.inspectCamera = camera;
      this.inspectControls = controls;
    }
    controls.enabled = true;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.view.setAspect(window.innerWidth / window.innerHeight);
      this.postfx.setSize(window.innerWidth, window.innerHeight);
      this.lighting.sun.shadow.needsUpdate = true;
      if (this.inspectCamera) {
        this.inspectCamera.aspect = window.innerWidth / window.innerHeight;
        this.inspectCamera.updateProjectionMatrix();
      }
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.inspecting) return;
        e.preventDefault();
        this.view.zoom(e.deltaY);
      },
      { passive: false },
    );

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // An AudioContext cannot start without a gesture, so the first touch of
    // the cockpit is what wakes the sound up. It stays muted until asked for.
    this.canvas.addEventListener('pointerdown', () => {
      if (!this.audio.started) this.audio.resume();
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      // Shift is required: a bare letter is far too easy to hit by
      // accident, and being silently dropped into a camera the view buttons
      // do not control is deeply confusing.
      if (e.shiftKey && (e.key === 'O' || e.key === 'o')) {
        this.toggleInspect();
        return;
      }
      if (e.key === 'Escape' && this.inspecting) {
        this.toggleInspect(false);
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        this.setYokesVisible(!this.yokesVisible);
        this.hud.setYokeState(this.yokesVisible);
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= VIEW_PRESETS.length) {
        this.selectView(n - 1);
      }
    });
  }
}

/** Different control kinds make different noises when you move them. */
function clickKindFor(kind: string): 'switch' | 'detent' | 'knob' {
  if (kind === 'selector' || kind === 'key') return 'detent';
  if (kind === 'pushPull' || kind === 'wheel') return 'knob';
  return 'switch';
}
