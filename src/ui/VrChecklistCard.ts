import * as THREE from 'three';
import type { ChecklistRunner } from '../sim/Checklist';
import type { ChecklistItem } from '../aircraft/types';

/**
 * Texture resolution. Higher than the board strictly needs at arm's length,
 * because a headset's own resampling is unkind to text and the cost is one
 * texture.
 */
const PX_W = 768;
const PX_H = 960;

/** Board width in metres when strapped to the wrist, and on the kneeboard. */
const WRIST_WIDTH = 0.18;
const KNEEBOARD_WIDTH = 0.36;

/**
 * The help button, in canvas pixels: a strip across the board just above the
 * list.
 *
 * It is the only thing on the board you can press, so it is large — the
 * whole width, deep enough to hit with a controller ray at arm's length,
 * and nowhere near the edge where the frame is. It sits in the gap between
 * the caption and the icon strip, which is the one band of the board that
 * never has words in it.
 */
export const HELP_BUTTON = {
  x: 38,
  y: 516,
  w: PX_W - 76,
  h: 72,
} as const;

/**
 * Type sizes, in texture pixels.
 *
 * Almost all of the board goes on the picture: at six you recognise a glyph
 * across the cabin and read a sentence only once you have decided to. The
 * rest is deliberately large for the board's physical size, because it is
 * read at a glance, at a wrist's distance, through lenses. Fitting more on
 * the board is not worth a single squint — if something has to give, it is
 * the number of list rows, not the size of the words.
 */
const TYPE = {
  step: 32,
  glyph: 200,
  title: 52,
  titleLine: 60,
  detail: 34,
  detailLine: 42,
  /** Icons along the bottom, and how many of the list fit there. */
  stripIcon: 46,
  stripCurrent: 62,
  strip: 7,
} as const;

/**
 * Which way the palm faces in grip space: the hand's own left-right axis.
 *
 * WebXR defines grip space against a hand holding a rod — origin in the
 * fist, -Z along the rod away from the wrist, +Y out of the top of the fist
 * on the thumb side. Which leaves the palm facing **sideways**, along X, not
 * down along -Y: make a fist round a broom handle and your palm faces across
 * your body, not at the floor.
 *
 * Getting this wrong is not subtle but it is easy, and the tell is which
 * gesture summons the board. Pitching the hand (nodding it forward) rotates
 * about X, so it moves Y and Z and leaves X alone. Rolling it — supinating,
 * turning the palm up to look at it — rotates about Z, which moves X. Using
 * -Y therefore answered to pitch; X answers to roll, which is the gesture.
 *
 * The sign does not matter: the reveal compares an absolute alignment and
 * the board mounts itself on whichever face you turned toward you, so this
 * is the axis only, never the direction.
 */
const PALM_AXIS = new THREE.Vector3(1, 0, 0);
/** Along the rod, away from the fingers: back toward the wrist and elbow. */
const FOREARM_AXIS = new THREE.Vector3(0, 0, 1);

/** How far the board floats off the palm, and how far back along the arm. */
const PALM_LIFT = 0.03;
const FOREARM_BACK = 0.07;
/**
 * Lies the board back along the forearm rather than flat on the palm, so it
 * comes square to your eyes at a natural wrist angle instead of needing the
 * arm held out level.
 */
const PALM_TILT = 0.38;

/**
 * A quarter turn clockwise in the board's own plane, so it sits across the
 * hand the way a wrist display does rather than running along the forearm.
 *
 * Applied last, about the board's own normal, which that rotation leaves
 * untouched — so it turns what you actually see by exactly 90 degrees
 * without disturbing how the board is mounted or laid back. Negative because
 * the normal points at you: from in front, a positive turn about it reads as
 * anticlockwise.
 */
const PALM_SPIN = -Math.PI / 2;

/**
 * How squarely the hand has to be turned toward your face to count as
 * reading the board, and how far it has to turn away again before it stops.
 *
 * Deliberate, because this is presenting your hand rather than glancing at a
 * watch — it must not fire while reaching for the throttle. The gap between
 * the two is hysteresis, or a wrist held near the threshold flickers the
 * board on and off.
 */
const REVEAL_ANGLE = 0.62;
const HIDE_ANGLE = 1.3;

/**
 * Once you are reading, you are reading for at least this long however the
 * hand drifts. Without it the pointer flicks back mid-sentence.
 */
const HOLD_SECONDS = 1.6;

/** How visible the board is when you are not looking at it. */
const RESTING_OPACITY = 0.82;
const REVEAL_DOT = Math.cos(REVEAL_ANGLE);
const HIDE_DOT = Math.cos(HIDE_ANGLE);

/**
 * Whether the board is being read, given how squarely the hand is turned
 * toward the head (1 = dead on) and whether it was being read already.
 *
 * `squareness` is deliberately an absolute value: the two faces of a hand
 * are opposite, so aligning that axis with your face is the same gesture
 * whichever way round the runtime's grip space turns out to be. Getting the
 * convention wrong then costs a board mounted on the other side of the
 * hand — not a board that can never be summoned at all.
 *
 * Split out so the tuning can be tested without a canvas or a headset.
 */
export function shouldReveal(squareness: number, showing: boolean): boolean {
  return showing ? squareness > HIDE_DOT : squareness > REVEAL_DOT;
}

/** The plane's own axes, in its local frame. */
const BOARD_NORMAL = new THREE.Vector3(0, 0, 1);
const BOARD_UP = new THREE.Vector3(0, 1, 0);

export interface VrCardItem {
  text: string;
  /** Picture cue, drawn instead of the text on the board. */
  icon?: string;
  done: boolean;
  current: boolean;
}

/**
 * Everything the board draws, supplied by whichever overlay is driving.
 *
 * The card is deliberately a dumb renderer: the overlay hands it the words
 * and it draws them, so neither the card nor the simulation has to know what
 * is on the checklist.
 */
export interface VrCardContent {
  /**
   * The current step as a single picture. The kid board is built around
   * this: at six you recognise the picture long before you finish the
   * sentence, so the picture is the thing and the words are the caption.
   */
  glyph: string;
  /** The step, as a short line: what to do. */
  headline: string;
  /** A sentence under it, or empty. */
  detail: string;
  /**
   * Label for the board's own help button, or empty to leave it off.
   *
   * In a headset the board is the entire interface: there is no overlay to
   * put a "show me" button in, so it goes here. Without it the rule that
   * help must be asked for would mean help could not be asked for at all.
   */
  button: string;
  /** 0..1, drawn as the bar. */
  progress: number;
  /** Free text beside the bar, e.g. "12 / 25" or "Steg 12 av 25". */
  stepLabel: string;
  items: readonly VrCardItem[];
  finished: boolean;
}

/**
 * The board's palette: paper rather than instrument panel, so it reads as
 * the thing telling you what to do rather than as part of the aeroplane
 * telling you what it is doing.
 */
const THEME = {
  bg: '#fffdf7',
  frame: 0xffc531,
  muted: '#5b6b81',
  headline: '#16243a',
  body: '#33435a',
  bar: '#35b57a',
  barBed: '#e4e8ee',
} as const;

type Theme = typeof THEME;

export class VrChecklistCard {
  readonly object: THREE.Group;
  /**
   * What a controller ray has to hit to ask for help.
   *
   * Invisible, like every other hit proxy in the cockpit, and only in the
   * raycaster's way while the button is actually drawn — a board with no
   * button on it must not silently swallow a trigger pull.
   */
  readonly buttonTarget: THREE.Mesh;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly boardMat: THREE.MeshBasicMaterial;
  private readonly frameMat: THREE.MeshBasicMaterial;
  private lastKey = '';
  private mode: 'wrist' | 'kneeboard' = 'kneeboard';
  private revealed = false;
  /** Eased 0..1, so the board fades and grows rather than popping. */
  private reveal = 0;

  private readonly head = new THREE.Vector3();
  private readonly here = new THREE.Vector3();
  private readonly facing = new THREE.Vector3();
  private readonly toHead = new THREE.Vector3();
  private readonly worldQuat = new THREE.Quaternion();
  private readonly side = new THREE.Vector3();
  private readonly tiltQuat = new THREE.Quaternion();
  private readonly spinQuat = new THREE.Quaternion();
  /** Which face of the hand the board is currently sitting on. */
  private palmSign = 1;
  /** How long the board has been up, for the minimum-hold above. */
  private shownFor = 0;

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

    const height = (WRIST_WIDTH * PX_H) / PX_W;
    this.boardMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      toneMapped: false,
      transparent: true,
    });
    this.frameMat = new THREE.MeshBasicMaterial({
      color: THEME.frame,
      toneMapped: false,
      transparent: true,
    });

    const board = new THREE.Mesh(new THREE.PlaneGeometry(WRIST_WIDTH, height), this.boardMat);
    this.object.add(board);

    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(WRIST_WIDTH * 1.05, height * 1.04),
      this.frameMat,
    );
    frame.position.z = -0.002;
    this.object.add(frame);

    // A hit plane over the button, sized and placed from the same pixel
    // rectangle that draws it, so the two cannot drift apart.
    const metresPerPx = WRIST_WIDTH / PX_W;
    this.buttonTarget = new THREE.Mesh(
      new THREE.PlaneGeometry(HELP_BUTTON.w * metresPerPx, HELP_BUTTON.h * metresPerPx),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.buttonTarget.position.set(
      (HELP_BUTTON.x + HELP_BUTTON.w / 2) * metresPerPx - WRIST_WIDTH / 2,
      height / 2 - (HELP_BUTTON.y + HELP_BUTTON.h / 2) * metresPerPx,
      0.001,
    );
    this.buttonTarget.visible = false;
    this.object.add(this.buttonTarget);

    this.applyKneeboard();
    this.object.visible = false;
  }

  /**
   * True while the pilot has the board turned toward them, which is when the
   * hand holding it should get out of the way. The board itself is always
   * up; this is about where they are looking.
   */
  get beingRead(): boolean {
    return this.mode === 'wrist' && this.revealed;
  }

  /** True while the help button is drawn and can be pressed. */
  get buttonOffered(): boolean {
    return this.object.visible && this.buttonTarget.visible;
  }

  /**
   * Straps the board to the left hand. Called when a controller reports its
   * handedness, which can happen well after the session starts, and again
   * with `null` if that hand goes away.
   */
  attachToWrist(grip: THREE.Object3D | null, fallback: THREE.Object3D): void {
    if (grip) {
      grip.add(this.object);
      this.mode = 'wrist';

      // Sits just off the palm, back toward the wrist.
      this.object.position
        .copy(PALM_AXIS)
        .multiplyScalar(PALM_LIFT)
        .addScaledVector(FOREARM_AXIS, FOREARM_BACK);

      this.applyWristPose();
      this.object.scale.setScalar(1);
      return;
    }
    fallback.add(this.object);
    this.applyKneeboard();
  }

  /**
   * Sits the board just off whichever face of the hand is being presented,
   * back toward the wrist, lying along the forearm so it comes square to the
   * eyes at a natural wrist angle.
   */
  private applyWristPose(): void {
    this.side.copy(PALM_AXIS).multiplyScalar(this.palmSign);

    this.object.position
      .copy(this.side)
      .multiplyScalar(PALM_LIFT)
      .addScaledVector(FOREARM_AXIS, FOREARM_BACK);

    this.object.quaternion
      .setFromUnitVectors(BOARD_NORMAL, this.side)
      .multiply(this.tiltQuat.setFromAxisAngle(BOARD_UP, PALM_TILT * this.palmSign))
      .multiply(this.spinQuat.setFromAxisAngle(BOARD_NORMAL, PALM_SPIN * this.palmSign));
  }

  /**
   * Falls back to a board clipped beside the panel. Without a left hand —
   * hand tracking, one controller, a dead battery — a wrist display is no
   * display at all, and the checklist is not optional.
   */
  private applyKneeboard(): void {
    this.mode = 'kneeboard';
    this.object.position.set(0.52, 0.8, -0.36);
    this.object.rotation.set(-0.15, -0.65, 0, 'XYZ');
    this.object.scale.setScalar(KNEEBOARD_WIDTH / WRIST_WIDTH);
  }

  /**
   * @param content what to draw, or null when there is nothing to show —
   *   out of VR, or between aircraft.
   */
  update(dt: number, camera: THREE.Camera, content: VrCardContent | null): void {
    if (!content) {
      this.revealed = false;
      this.shownFor = 0;
      this.object.visible = false;
      return;
    }
    // Always up. It was on a wrist-turn gesture, but a checklist you have to
    // ask for is a checklist you forget to ask for — and the whole reason it
    // moved onto the wrist was to be where your eyes already go.
    this.object.visible = true;

    // What is on the board, as a string, so it is redrawn when it changes
    // and not sixty times a second when it has not. The help button belongs
    // in it: it appears and goes without the step moving, and leaving it out
    // meant asking for help repainted nothing. The icon strip needs no entry
    // of its own — it only ever changes when the step does.
    const key = `${content.glyph}|${content.headline}|${content.detail}|${content.button}|${
      content.stepLabel
    }|${Math.round(content.progress * 200)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.draw(content);
      this.texture.needsUpdate = true;
      this.frameMat.color.setHex(THEME.frame);
    }

    // The kneeboard is bolted to the cabin and always readable; only the
    // wrist board has anything to reveal.
    if (this.mode === 'wrist' && this.object.parent) {
      camera.getWorldPosition(this.head);
      this.object.getWorldPosition(this.here);
      this.toHead.copy(this.head).sub(this.here);

      if (this.toHead.lengthSq() > 1e-8) {
        this.toHead.normalize();

        // The hand's own palm axis, in the world.
        this.object.parent.getWorldQuaternion(this.worldQuat);
        this.facing.copy(PALM_AXIS).applyQuaternion(this.worldQuat);

        const alignment = Math.abs(this.facing.dot(this.toHead));
        if (!this.revealed) {
          if (shouldReveal(alignment, false)) {
            this.revealed = true;
            this.shownFor = 0;
          }
        } else {
          this.shownFor += dt;
          if (this.shownFor > HOLD_SECONDS && !shouldReveal(alignment, true)) {
            this.revealed = false;
          }
        }

        // Whichever face is toward you is the one the board sits on. Chosen
        // while it is still hidden and then held, so it never flips over
        // while you are reading it.
        // Which face it sits on is settled while you are not reading it, so
        // it never flips over mid-sentence.
        if (!this.revealed) {
          this.palmSign = this.facing.dot(this.toHead) >= 0 ? 1 : -1;
        }
        this.applyWristPose();
      }
    } else if (this.mode === 'kneeboard') {
      this.revealed = true;
    }

    // Brightens a little when you turn it toward you, rather than appearing.
    this.reveal += ((this.revealed ? 1 : 0) - this.reveal) * (1 - Math.exp(-dt * 10));
    this.boardMat.opacity = RESTING_OPACITY + (1 - RESTING_OPACITY) * this.reveal;
    this.frameMat.opacity = this.boardMat.opacity;
    this.object.scale.setScalar(this.mode === 'wrist' ? 1 : KNEEBOARD_WIDTH / WRIST_WIDTH);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.texture.dispose();
    this.boardMat.dispose();
    this.frameMat.dispose();
  }

  private draw(content: VrCardContent): void {
    const c = this.ctx;
    c.fillStyle = THEME.bg;
    c.fillRect(0, 0, PX_W, PX_H);
    c.textAlign = 'left';
    this.drawBoard(content, THEME);
    this.drawHelpButton(content, THEME);
  }

  /**
   * The board's one control: ask where the switch is.
   *
   * Drawn last so it sits over whatever the step text did with the space,
   * and hidden — along with its hit plane — the moment there is nothing to
   * ask for, which is how a pull of the trigger at an empty board goes
   * through to the cockpit behind it instead of being eaten.
   */
  private drawHelpButton(content: VrCardContent, t: Theme): void {
    this.buttonTarget.visible = content.button !== '';
    if (!content.button) return;

    const c = this.ctx;
    const { x, y, w, h } = HELP_BUTTON;
    c.fillStyle = t.barBed;
    c.fillRect(x, y, w, h);
    c.strokeStyle = t.bar;
    c.lineWidth = 3;
    c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);

    c.fillStyle = t.bar;
    c.textAlign = 'center';
    c.font = `700 ${TYPE.title}px ui-sans-serif, system-ui, sans-serif`;
    c.fillText(content.button, x + w / 2, y + h / 2 + TYPE.title * 0.36);
    c.textAlign = 'left';
  }

  /**
   * Mostly picture. One big glyph, the step in a few words, one short line
   * of what to do, and the rest of the list as pictures rather than a column
   * of Swedish a six-year-old has to read through to find their place.
   */
  private drawBoard(content: VrCardContent, t: Theme): void {
    const c = this.ctx;
    const mid = PX_W / 2;
    const pad = 38;
    const inner = PX_W - pad * 2;

    c.fillStyle = t.barBed;
    c.fillRect(pad, 40, inner, 16);
    c.fillStyle = t.bar;
    c.fillRect(pad, 40, inner * clamp01(content.progress), 16);

    c.textAlign = 'center';
    c.fillStyle = t.muted;
    c.font = `800 ${TYPE.step}px ui-sans-serif, system-ui, sans-serif`;
    c.fillText(content.stepLabel, mid, 104);

    // The picture, as big as the board will allow.
    c.font = `${TYPE.glyph}px ui-sans-serif, system-ui, sans-serif`;
    c.fillText(content.glyph || '\u2708\ufe0f', mid, 330);

    c.fillStyle = content.finished ? t.bar : t.headline;
    c.font = `800 ${TYPE.title}px ui-sans-serif, system-ui, sans-serif`;
    let y = wrap(c, content.headline, mid, 428, inner, TYPE.titleLine, 2);

    if (content.detail) {
      c.fillStyle = t.body;
      c.font = `600 ${TYPE.detail}px ui-sans-serif, system-ui, sans-serif`;
      wrap(c, content.detail, mid, y + 24, inner, TYPE.detailLine, 2);
    }

    // The list, as pictures. Ticked ones are faded and carry a check.
    const icons = content.items.slice(0, TYPE.strip);
    if (icons.length === 0) return;
    const step = inner / icons.length;
    const row = PX_H - 74;
    icons.forEach((item, i) => {
      const x = pad + step * (i + 0.5);
      c.globalAlpha = item.done ? 0.3 : item.current ? 1 : 0.65;
      c.font = `${item.current ? TYPE.stripCurrent : TYPE.stripIcon}px ui-sans-serif, system-ui, sans-serif`;
      c.fillStyle = t.headline;
      c.fillText(item.icon ?? '\u00b7', x, row);
      c.globalAlpha = 1;
      if (item.done) {
        c.fillStyle = t.bar;
        c.font = `800 34px ui-sans-serif, system-ui, sans-serif`;
        c.fillText('\u2713', x, row + 34);
      }
    });
  }

}

export function windowChecklist(
  checklist: ChecklistRunner,
  label: (item: ChecklistItem) => { text: string; icon?: string },
  before = 2,
  after = 5,
): VrCardItem[] {
  const flat = checklist.allSections.flatMap((s) => s.items as ChecklistItem[]);
  const currentId = checklist.position?.item.id ?? null;
  const index = currentId ? flat.findIndex((i) => i.id === currentId) : flat.length;
  const from = Math.max(0, index - before);
  const to = Math.min(flat.length, index + after + 1);

  return flat.slice(from, to).map((item) => ({
    ...label(item),
    done: checklist.isDone(item.id),
    current: item.id === currentId,
  }));
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Word-wraps text and returns the y of the line after the last one drawn. */
function wrap(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 99,
): number {
  let line = '';
  let cursor = y;
  let lines = 0;
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    const attempt = line ? `${line} ${words[i]}` : (words[i] ?? '');
    if (c.measureText(attempt).width > maxWidth && line) {
      // Last line we are allowed: say so rather than stopping mid-sentence
      // as though the text had ended there.
      if (lines + 1 >= maxLines) {
        c.fillText(ellipsise(c, `${line} ${words.slice(i).join(' ')}`, maxWidth), x, cursor);
        return cursor + lineHeight;
      }
      c.fillText(line, x, cursor);
      cursor += lineHeight;
      lines++;
      line = words[i] ?? '';
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

function ellipsise(c: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (c.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && c.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}
