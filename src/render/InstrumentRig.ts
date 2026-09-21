import * as THREE from 'three';
import type { AircraftDefinition, InstrumentHandle, MountFrame } from '../aircraft/types';
import type { Simulation } from '../sim/Simulation';
import type { CockpitShell } from './Cockpit';
import { disposeTree } from './geometry';

/**
 * Instantiates the aircraft's instruments and drives them every frame.
 * Faces are baked to textures at construction; the per-frame work is just
 * moving needles.
 */
export class InstrumentRig {
  private readonly handles: InstrumentHandle[] = [];

  constructor(definition: AircraftDefinition, shell: CockpitShell) {
    const frames: Record<MountFrame, THREE.Object3D> = {
      panel: shell.panel,
      console: shell.console,
      pedestal: shell.pedestal,
      cabin: shell.group,
    };

    for (const def of definition.instruments) {
      const handle = def.build({ size: def.size });
      const root = handle.object;
      root.name = `instrument:${def.id}`;
      const m = def.mount;
      root.position.set(m.x, m.y, m.z ?? 0);
      if (m.roll) root.rotation.z = m.roll;
      frames[m.frame ?? 'panel'].add(root);
      this.handles.push(handle);
    }
  }

  update(sim: Simulation, dt: number): void {
    for (const handle of this.handles) handle.update(sim, dt);
  }

  dispose(): void {
    for (const handle of this.handles) {
      handle.dispose?.();
      handle.object.removeFromParent();
      disposeTree(handle.object);
    }
    this.handles.length = 0;
  }
}
