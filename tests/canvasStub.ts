/**
 * Just enough of a 2D canvas for the cockpit to build in node.
 *
 * Every instrument face, placard and silkscreen is drawn into a canvas at
 * construction, so none of the renderer can be exercised outside a browser
 * without one. Nothing here draws anything: the point is to find out whether
 * the geometry assembles, not what it looks like.
 */
class StubContext {
  canvas: { width: number; height: number };
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  textAlign = '';
  textBaseline = '';
  lineCap = '';
  lineJoin = '';
  globalAlpha = 1;
  shadowBlur = 0;
  shadowColor = '';

  constructor(canvas: { width: number; height: number }) {
    this.canvas = canvas;
  }

  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  ellipse(): void {}
  rect(): void {}
  quadraticCurveTo(): void {}
  bezierCurveTo(): void {}
  fill(): void {}
  stroke(): void {}
  clip(): void {}
  fillRect(): void {}
  clearRect(): void {}
  strokeRect(): void {}
  fillText(): void {}
  strokeText(): void {}
  drawImage(): void {}
  setLineDash(): void {}
  createLinearGradient() {
    return { addColorStop() {} };
  }
  createRadialGradient() {
    return { addColorStop() {} };
  }
  createPattern() {
    return null;
  }
  createImageData(width: number, height: number) {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }
  getImageData(_x = 0, _y = 0, width = 1, height = 1) {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }
  putImageData(): void {}
  measureText(text: string) {
    // Roughly the width a 600-weight sans face gives, which is all the
    // layout code does with it.
    const size = Number.parseFloat(this.font.replace(/^\D*/, '')) || 10;
    return { width: text.length * size * 0.55 };
  }
}

export function installCanvasStub(): void {
  const global = globalThis as { document?: unknown };
  if (global.document) return;

  global.document = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`No stub for <${tag}>`);
      const canvas = {
        width: 1,
        height: 1,
        style: {},
        getContext: () => new StubContext(canvas),
      };
      return canvas;
    },
  };
}
