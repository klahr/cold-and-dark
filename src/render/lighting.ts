import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export interface SceneLighting {
  sun: THREE.DirectionalLight;
  sky: Sky;
  /** Direction the sun sits in, for anything that needs to agree with it. */
  sunDirection: THREE.Vector3;
}

/**
 * Daylight, from a physical sky model.
 *
 * A Rayleigh/Mie sky gives a horizon gradient and a sun disc for free, and —
 * more importantly — is rendered into an environment map so every metal
 * bezel, knob and painted surface reflects a believable sky above and ground
 * below. An arbitrary studio cube map is the other giveaway that a scene is
 * a tech demo rather than a simulator.
 */
export function setupLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer): SceneLighting {
  // Mid-morning: high enough for a bright ramp, low enough for long shadows
  // and some warmth on the cowl.
  const elevation = THREE.MathUtils.degToRad(34);
  const azimuth = THREE.MathUtils.degToRad(-128);
  const sunDirection = new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  );

  const sky = new Sky();
  sky.scale.setScalar(20000);
  const uniform = (name: string): { value: never } => {
    const u = sky.material.uniforms[name];
    if (!u) throw new Error(`Sky shader has no uniform "${name}"`);
    return u as { value: never };
  };
  uniform('turbidity').value = 2.4 as never;
  uniform('rayleigh').value = 2.4 as never;
  uniform('mieCoefficient').value = 0.004 as never;
  uniform('mieDirectionalG').value = 0.8 as never;
  (uniform('sunPosition').value as THREE.Vector3).copy(sunDirection);

  // The sky is baked once into a cube map and never drawn again.
  //
  // The atmospheric model is a heavy fragment shader over a 20 km box, so
  // leaving it in the scene means paying for a full-screen procedural
  // evaluation every frame to draw something that never changes. Capturing
  // it to a cube map gives an identical image — sun disc and all — for the
  // cost of a background blit, and the same render feeds the environment
  // map used for reflections. No image files needed.
  const skyScene = new THREE.Scene();
  skyScene.add(sky);

  const cubeTarget = new THREE.WebGLCubeRenderTarget(1024, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeTarget);
  cubeCamera.update(renderer, skyScene);
  scene.background = cubeTarget.texture;
  // The atmospheric model is physically bright; at the exposure the cabin
  // needs, an untamed sky clips to white and the whole windscreen reads as
  // a blank sheet.
  scene.backgroundIntensity = 0.42;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();
  const env = pmrem.fromCubemap(cubeTarget.texture);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.22;
  pmrem.dispose();

  const sun = new THREE.DirectionalLight(0xfff4e2, 2.0);
  sun.position.copy(sunDirection).multiplyScalar(12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 26;
  sun.shadow.camera.left = -4.5;
  sun.shadow.camera.right = 4.5;
  sun.shadow.camera.top = 4.5;
  sun.shadow.camera.bottom = -4.5;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 3;
  // Nothing that casts a shadow ever moves, so the map is rendered once at
  // start-up and then frozen. App re-arms it for a single frame if it ever
  // needs to change.
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.set(0, 0.6, -0.6);

  // Skylight from above and warm bounce off the ramp below. The environment
  // map supplies most of this, so both are gentle.
  // Weighted warm: under a high wing, most of the light reaching the cabin
  // has bounced off the ramp, not come straight down from a blue sky.
  const hemi = new THREE.HemisphereLight(0xb4cfec, 0xb09468, 0.55);
  scene.add(hemi);

  // The panel lives under the wing and behind the glareshield all day. Real
  // cockpits are readable there because of light bouncing off the pilot, the
  // side windows and the cabin walls; a soft fill stands in for all of that.
  const panelFill = new THREE.DirectionalLight(0xffe3c2, 0.85);
  panelFill.position.set(-0.25, 1.5, 1.8);
  panelFill.target.position.set(0, 0.64, -0.62);
  scene.add(panelFill);
  scene.add(panelFill.target);

  return { sun, sky, sunDirection };
}
