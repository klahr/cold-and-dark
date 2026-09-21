import * as THREE from 'three';
import type { AircraftDefinition, MountFrame } from '../aircraft/types';
import type { ControlState } from '../sim/ControlState';
import { createControlObject, type ControlObject, type HighlightMode } from './ControlObject';
import type { CockpitShell } from './Cockpit';
import { disposeTree, mergeStatic } from './geometry';
import { buildSilkscreen, type Placard } from './PanelSilkscreen';
import { MAT } from './materials';
import { makeLabel } from './text';

/**
 * Instantiates every control in an aircraft definition, parents it to the
 * right cockpit frame, and keeps the meshes in step with `ControlState`.
 */
export class ControlRig {
  private readonly objects = new Map<string, ControlObject>();
  private readonly byHitMesh = new Map<THREE.Object3D, ControlObject>();
  private readonly hitTargets: THREE.Object3D[] = [];
  private readonly unsubscribe: () => void;
  private readonly roots: THREE.Object3D[] = [];
  private hovered: string | null = null;
  private guided: string | null = null;

  constructor(
    definition: AircraftDefinition,
    private readonly controls: ControlState,
    shell: CockpitShell,
  ) {
    const frames: Record<MountFrame, THREE.Object3D> = {
      panel: shell.panel,
      console: consoleFrame(shell),
      pedestal: pedestalFrame(shell),
      cabin: shell.group,
    };

    const placards: Placard[] = (definition.placards ?? []).map((p) => ({
      text: p.text,
      x: p.x,
      y: p.y,
      size: p.size ?? 0.0048,
    }));
    const staticDecor: THREE.Mesh[] = [];

    for (const def of definition.controls) {
      const obj = createControlObject(def);
      const frame = def.mount.frame ?? 'panel';
      this.objects.set(def.id, obj);
      frames[frame].add(obj.object);
      this.roots.push(obj.object);
      for (const target of obj.hitTargets) {
        target.userData['controlId'] = def.id;
        this.byHitMesh.set(target, obj);
        this.hitTargets.push(target);
      }

      // Lift the control's static furniture into one shared pile, baked
      // into panel coordinates. Only panel-mounted controls can be baked
      // this way; the handful on the console, pedestal and cabin walls live
      // in their own frames and keep their own parts.
      if (frame === 'panel') {
        obj.object.updateMatrix();
        for (const part of obj.staticParts) {
          part.updateMatrix();
          part.applyMatrix4(obj.object.matrix);
          staticDecor.push(part);
        }
      } else {
        for (const part of obj.staticParts) obj.object.add(part);
      }

      if (obj.placard) {
        if (frame === 'panel') {
          placards.push({
            text: obj.placard.text,
            x: def.mount.x + obj.placard.x,
            y: def.mount.y + obj.placard.y,
            size: obj.placard.size,
          });
        } else {
          // Off-panel controls are few, so they keep an individual label.
          const label = makeLabel(obj.placard.text, { size: obj.placard.size });
          label.position.set(obj.placard.x, obj.placard.y, 0.0012);
          obj.object.add(label);
        }
      }

      obj.apply(this.controls.num(def.id));
    }

    const decor = mergeStatic(staticDecor, MAT.bezel(), 'control-furniture');
    if (decor) {
      shell.panel.add(decor);
      this.roots.push(decor);
    }

    const silkscreen = buildSilkscreen(placards);
    if (silkscreen) {
      shell.panel.add(silkscreen);
      this.roots.push(silkscreen);
    }

    this.unsubscribe = this.controls.onChange((id, value) => {
      this.objects.get(id)?.apply(value);
    });
  }

  get pickTargets(): readonly THREE.Object3D[] {
    return this.hitTargets;
  }

  objectFor(id: string): ControlObject | undefined {
    return this.objects.get(id);
  }

  objectForMesh(mesh: THREE.Object3D): ControlObject | undefined {
    return this.byHitMesh.get(mesh);
  }

  /** Re-poses every control; used after a reset to cold and dark. */
  syncAll(): void {
    for (const [id, obj] of this.objects) obj.apply(this.controls.num(id));
  }

  setHovered(id: string | null): void {
    if (this.hovered === id) return;
    if (this.hovered && this.hovered !== this.guided) {
      this.objects.get(this.hovered)?.setHighlight('none');
    }
    this.hovered = id;
    if (id && id !== this.guided) this.objects.get(id)?.setHighlight('hover');
  }

  /** Marks the control the current checklist item is asking for. */
  setGuided(id: string | null): void {
    if (this.guided === id) return;
    if (this.guided) {
      const mode: HighlightMode = this.guided === this.hovered ? 'hover' : 'none';
      this.objects.get(this.guided)?.setHighlight(mode);
    }
    this.guided = id;
    if (id) this.objects.get(id)?.setHighlight('guide');
  }

  tick(elapsed: number): void {
    for (const obj of this.objects.values()) obj.tick(elapsed);
  }

  dispose(): void {
    this.unsubscribe();
    for (const root of this.roots) {
      root.removeFromParent();
      disposeTree(root);
    }
    this.roots.length = 0;
    this.objects.clear();
    this.byHitMesh.clear();
    this.hitTargets.length = 0;
  }
}

/**
 * Controls mounted on the floor console face upward, so the frame is rotated
 * to keep authoring in the same flat (x, y) convention as the panel.
 */
function consoleFrame(shell: CockpitShell): THREE.Object3D {
  const existing = shell.console.getObjectByName('console-face');
  if (existing) return existing;
  const face = new THREE.Group();
  face.name = 'console-face';
  face.position.set(0, 0.14, -0.12);
  face.rotation.x = -Math.PI / 2;
  shell.console.add(face);
  return face;
}

/** The trim wheel hangs off the aft face of the centre pedestal. */
function pedestalFrame(shell: CockpitShell): THREE.Object3D {
  const existing = shell.pedestal.getObjectByName('pedestal-face');
  if (existing) return existing;
  const face = new THREE.Group();
  face.name = 'pedestal-face';
  face.position.set(0, 0.22, -0.53);
  shell.pedestal.add(face);
  return face;
}
