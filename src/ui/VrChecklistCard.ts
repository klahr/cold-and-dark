import * as THREE from 'three';
import type { ChecklistRunner } from '../sim/Checklist';

const PX_W = 768;
const PX_H = 512;
const WIDTH = 0.34;

/**
 * The checklist, as a board clipped to the cabin.
 *
 * In a headset the DOM overlay does not exist, so the guided-mode coaching
 * has to live in the world. This is the same current callout, reasoning and
 * progress the flat UI shows, drawn onto a kneeboard-sized panel mounted
 * where a pilot would clip one: to the right, angled back toward the seat.
 */
export class VrChecklistCard {
  readonly object: THREE.Group;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastKey = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = PX_W;
    this.canvas.height = PX_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    this.object = new THREE.Group();
    this.object.name = 'vr-checklist';

    const height = (WIDTH * PX_H) / PX_W;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH, height),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }),
    );
    this.object.add(board);

    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH * 1.04, height * 1.06),
      new THREE.MeshBasicMaterial({ color: 0x15171b, toneMapped: false }),
    );
    frame.position.z = -0.002;
    this.object.add(frame);

    // Clipped to the right of the panel, canted toward the left seat.
    this.object.position.set(0.52, 0.80, -0.36);
    this.object.rotation.set(-0.15, -0.65, 0);
    this.object.visible = false;
  }

  update(checklist: ChecklistRunner, aircraftName: string): void {
    const pos = checklist.position;
    const key = `${aircraftName}|${pos?.item.id ?? 'done'}|${Math.round(checklist.progress * 100)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.draw(checklist, aircraftName);
    this.texture.needsUpdate = true;
  }

  private draw(checklist: ChecklistRunner, aircraftName: string): void {
    const c = this.ctx;
    c.fillStyle = '#0f1216';
    c.fillRect(0, 0, PX_W, PX_H);

    c.fillStyle = '#7c848f';
    c.font = '600 26px ui-sans-serif, system-ui, sans-serif';
    c.fillText(aircraftName.toUpperCase(), 34, 52);

    // Progress bar.
    c.fillStyle = '#23272d';
    c.fillRect(34, 72, PX_W - 68, 8);
    c.fillStyle = '#57c07a';
    c.fillRect(34, 72, (PX_W - 68) * checklist.progress, 8);

    const pos = checklist.position;
    if (!pos) {
      c.fillStyle = '#57c07a';
      c.font = '700 40px ui-sans-serif, system-ui, sans-serif';
      c.fillText('Checklist complete', 34, 160);
      c.fillStyle = '#aeb6c0';
      c.font = '400 28px ui-sans-serif, system-ui, sans-serif';
      wrap(c, 'The engine is running and the alternator is charging.', 34, 214, PX_W - 68, 38);
      return;
    }

    c.fillStyle = '#7c848f';
    c.font = '600 22px ui-sans-serif, system-ui, sans-serif';
    c.fillText(pos.section.title.toUpperCase(), 34, 118);

    c.fillStyle = '#56b2f0';
    c.font = '700 34px ui-sans-serif, system-ui, sans-serif';
    const afterCallout = wrap(c, pos.item.callout, 34, 166, PX_W - 68, 42);

    c.fillStyle = '#c6cbd2';
    c.font = '400 26px ui-sans-serif, system-ui, sans-serif';
    const afterWhy = wrap(c, pos.item.why, 34, afterCallout + 30, PX_W - 68, 34);

    c.fillStyle = '#e0a83c';
    c.font = '400 24px ui-sans-serif, system-ui, sans-serif';
    wrap(c, pos.item.hint, 34, Math.min(afterWhy + 30, PX_H - 48), PX_W - 68, 32);
  }
}

/** Word-wraps text and returns the y of the line after the last one drawn. */
function wrap(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  let line = '';
  let cursor = y;
  for (const word of text.split(' ')) {
    const attempt = line ? `${line} ${word}` : word;
    if (c.measureText(attempt).width > maxWidth && line) {
      c.fillText(line, x, cursor);
      cursor += lineHeight;
      line = word;
    } else {
      line = attempt;
    }
  }
  if (line) {
    c.fillText(line, x, cursor);
    cursor += lineHeight;
  }
  return cursor;
}
