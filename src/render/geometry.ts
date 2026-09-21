import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Small geometry helpers shared by the cockpit builders. */

export function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  pos?: readonly [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function cylinder(
  rTop: number,
  rBottom: number,
  h: number,
  mat: THREE.Material,
  segments = 24,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A rectangle with rounded corners, as a THREE.Shape for extrusion. */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const x = w / 2;
  const y = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y);
  s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r);
  s.quadraticCurveTo(x, y, x - r, y);
  s.lineTo(-x + r, y);
  s.quadraticCurveTo(-x, y, -x, y - r);
  s.lineTo(-x, -y + r);
  s.quadraticCurveTo(-x, -y, -x + r, -y);
  return s;
}

/**
 * Extrudes a shape along -Z so that its *front* surface lands exactly on
 * local z = 0. Everything mounted on the panel is positioned against that
 * plane, so the bevel has to be accounted for — an extruded shape spans
 * -bevel..depth+bevel, not 0..depth.
 */
export function faceExtrude(
  shape: THREE.Shape,
  depth: number,
  mat: THREE.Material,
  bevel = 0.002,
): THREE.Mesh {
  const bevelled = bevel > 0;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevelled,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geo.translate(0, 0, -(depth + (bevelled ? bevel : 0)));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A tube swept through a smooth curve; used for yoke horns and tubing. */
export function tube(
  points: readonly (readonly [number, number, number])[],
  radius: number,
  mat: THREE.Material,
  segments = 48,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
  );
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 12, false), mat);
  mesh.castShadow = true;
  return mesh;
}

/** Disposes every geometry under a subtree. Materials are pooled elsewhere. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
  });
}

/**
 * Bakes a pile of static meshes that share a material into one mesh.
 *
 * A cockpit is made of hundreds of small rigid parts — fasteners, trim
 * strips, placards, runway markings — and at this scale the renderer is
 * limited by draw calls rather than triangles. Merging anything that never
 * moves is by far the cheapest performance win available.
 */
export function mergeStatic(
  meshes: readonly THREE.Mesh[],
  material: THREE.Material,
  name: string,
): THREE.Mesh | null {
  if (meshes.length === 0) return null;

  const geometries = meshes.map((mesh) => {
    mesh.updateMatrix();
    return mesh.geometry.clone().applyMatrix4(mesh.matrix);
  });

  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) return null;

  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}
