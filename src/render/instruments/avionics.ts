import * as THREE from 'three';
import type { InstrumentContext, InstrumentHandle } from '../../aircraft/types';
import type { Simulation } from '../../sim/Simulation';
import { MAT } from '../materials';
import { customPlate } from './dialFace';

/**
 * Radio stack faces.
 *
 * These are indication only: the displays light up with the avionics master
 * and go dark without it, which is the part that matters when you are
 * learning why the avionics switch is off for the start. Tuning them would
 * add nothing to that lesson.
 */

const DISPLAY_ON = '#ffb347';
const DISPLAY_OFF = '#2a2018';

export interface RadioSpec {
  /** Model text along the left of the face, e.g. "KX 155". */
  model: string;
  /** Row labels and the frequency shown against each. */
  rows: readonly { label: string; active: string; standby?: string }[];
  /** Height of the unit relative to its width. */
  aspect: number;
  /** Knobs along the bottom right of the face. */
  knobs?: number;
}

export function radioUnit(spec: RadioSpec) {
  return (ctx: InstrumentContext): InstrumentHandle => {
    const w = ctx.size;
    const h = ctx.size * spec.aspect;
    const PX = 420;
    const pxH = Math.round(PX * spec.aspect);

    const draw = (lit: boolean) =>
      customPlate(PX, pxH, (c, cw, ch) => {
        c.fillStyle = '#17181b';
        c.fillRect(0, 0, cw, ch);
        c.strokeStyle = '#33363b';
        c.lineWidth = 3;
        c.strokeRect(1.5, 1.5, cw - 3, ch - 3);

        c.fillStyle = '#7d838c';
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.font = `700 ${Math.round(ch * 0.1)}px ui-sans-serif, system-ui, sans-serif`;
        c.fillText(spec.model, cw * 0.035, ch * 0.13);

        const rowH = (ch * 0.72) / spec.rows.length;
        spec.rows.forEach((row, i) => {
          const y = ch * 0.26 + rowH * (i + 0.5);

          c.fillStyle = '#7d838c';
          c.font = `700 ${Math.round(rowH * 0.3)}px ui-sans-serif, system-ui, sans-serif`;
          c.fillText(row.label, cw * 0.035, y);

          // Two separate recessed windows — active on the left, standby on
          // the right — so the frequencies cannot run into each other.
          const winX = cw * 0.24;
          const winW = cw * 0.72;
          const gap = cw * 0.02;
          const activeW = row.standby ? (winW - gap) * 0.5 : winW;
          const standbyW = winW - gap - activeW;
          const top = y - rowH * 0.34;
          const boxH = rowH * 0.68;

          c.fillStyle = '#100d0a';
          c.fillRect(winX, top, activeW, boxH);
          if (row.standby) c.fillRect(winX + activeW + gap, top, standbyW, boxH);

          c.font = `600 ${Math.round(rowH * 0.42)}px ui-monospace, monospace`;
          c.textAlign = 'center';
          c.fillStyle = lit ? DISPLAY_ON : DISPLAY_OFF;
          c.fillText(row.active, winX + activeW / 2, y);
          if (row.standby) {
            c.fillStyle = lit ? '#c07f2a' : DISPLAY_OFF;
            c.fillText(row.standby, winX + activeW + gap + standbyW / 2, y);
          }
          c.textAlign = 'left';
        });

        // Tuning knobs along the bottom edge.
        const knobs = spec.knobs ?? 2;
        for (let k = 0; k < knobs; k++) {
          const kx = cw * (0.76 + k * 0.12);
          const ky = ch * 0.88;
          const kr = ch * 0.085;
          c.fillStyle = '#3a3d42';
          c.beginPath();
          c.arc(kx, ky, kr, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = '#55595f';
          c.lineWidth = 2;
          c.stroke();
        }
      });

    const litTex = draw(true);
    const darkTex = draw(false);

    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), MAT.bezel()).translateZ(0.01));

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.98, h * 0.96),
      new THREE.MeshBasicMaterial({ map: darkTex, toneMapped: false }),
    );
    plate.position.z = 0.0205;
    group.add(plate);

    const material = plate.material as THREE.MeshBasicMaterial;
    let lit = false;

    return {
      object: group,
      update(sim: Simulation) {
        const powered =
          sim.controls.bool('avionicsMaster') &&
          sim.electrical.busPowered &&
          sim.electrical.busVolts > 9;
        if (powered !== lit) {
          lit = powered;
          material.map = powered ? litTex : darkTex;
          material.needsUpdate = true;
        }
      },
      dispose() {
        litTex.dispose();
        darkTex.dispose();
      },
    };
  };
}

/**
 * A proper VOR head rather than another compass rose: an omni-bearing card,
 * a course deviation bar and a TO/FROM flag. Inert, like the radios.
 */
export function vorIndicator(label: string, course: number) {
  return (ctx: InstrumentContext): InstrumentHandle => {
    const r = ctx.size / 2;

    const faceTex = customPlate(512, 512, (c, size) => {
      const h = size / 2;
      c.fillStyle = '#0e0f11';
      c.beginPath();
      c.arc(h, h, h, 0, Math.PI * 2);
      c.fill();

      // Omni-bearing card.
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (let deg = 0; deg < 360; deg += 5) {
        const a = ((deg - course) * Math.PI) / 180 - Math.PI / 2;
        const major = deg % 30 === 0;
        c.strokeStyle = '#c9ccd1';
        c.lineWidth = size * (major ? 0.012 : 0.006);
        c.beginPath();
        c.moveTo(h + Math.cos(a) * h * (major ? 0.8 : 0.85), h + Math.sin(a) * h * (major ? 0.8 : 0.85));
        c.lineTo(h + Math.cos(a) * h * 0.92, h + Math.sin(a) * h * 0.92);
        c.stroke();
        if (major) {
          const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg];
          c.fillStyle = '#e8eaed';
          c.font = `700 ${Math.round(size * (cardinal ? 0.085 : 0.065))}px ui-sans-serif, system-ui, sans-serif`;
          c.fillText(cardinal ?? String(deg / 10), h + Math.cos(a) * h * 0.69, h + Math.sin(a) * h * 0.69);
        }
      }

      // Deviation dots either side of centre.
      c.fillStyle = '#9aa0a8';
      for (const d of [-2, -1, 1, 2]) {
        c.beginPath();
        c.arc(h + d * size * 0.075, h, size * 0.016, 0, Math.PI * 2);
        c.fill();
      }

      // Course pointer, fixed to the card.
      c.strokeStyle = '#f5c518';
      c.lineWidth = size * 0.022;
      c.beginPath();
      c.moveTo(h, h * 0.22);
      c.lineTo(h, h * 0.62);
      c.moveTo(h, h * 1.38);
      c.lineTo(h, h * 1.78);
      c.stroke();

      c.fillStyle = '#7d838c';
      c.font = `700 ${Math.round(size * 0.055)}px ui-sans-serif, system-ui, sans-serif`;
      c.fillText(label, h, h * 1.62);
    });

    const group = new THREE.Group();
    const back = new THREE.Mesh(new THREE.CircleGeometry(r * 1.06, 40), MAT.bezel());
    back.position.z = 0.0028;
    group.add(back);

    const face = new THREE.Mesh(
      new THREE.CircleGeometry(r, 48),
      new THREE.MeshBasicMaterial({ map: faceTex, toneMapped: false }),
    );
    face.position.z = 0.0042;
    group.add(face);

    // Course deviation bar, parked at full scale with no signal.
    const cdi = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 0.05, r * 1.1),
      new THREE.MeshBasicMaterial({ color: 0xf5c518, toneMapped: false }),
    );
    cdi.position.set(r * 0.42, 0, 0.004);
    group.add(cdi);

    // Red NAV flag, out because nothing is tuned.
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 0.3, r * 0.22),
      new THREE.MeshBasicMaterial({
        map: customPlate(128, 96, (c, cw, ch) => {
          c.fillStyle = '#b5322c';
          c.fillRect(0, 0, cw, ch);
          c.fillStyle = '#ffffff';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.font = `800 ${Math.round(ch * 0.5)}px ui-sans-serif, system-ui, sans-serif`;
          c.fillText('NAV', cw / 2, ch / 2);
        }),
        toneMapped: false,
      }),
    );
    flag.position.set(-r * 0.42, r * 0.4, 0.005);
    group.add(flag);

    const glass = new THREE.Mesh(new THREE.CircleGeometry(r * 1.02, 40), MAT.instrumentGlass());
    glass.position.z = 0.0125;
    group.add(glass);
    const bezel = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.012, 40, 1, true),
      MAT.bezel(),
    );
    bezel.rotation.x = Math.PI / 2;
    bezel.position.z = 0.006;
    group.add(bezel);

    return {
      object: group,
      update() {
        /* Inert: no navigation receiver is modelled. */
      },
    };
  };
}
