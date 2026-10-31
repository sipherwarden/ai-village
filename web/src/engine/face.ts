// Character faces are drawn on a canvas and mapped onto the visor as an emissive texture, so
// expressions are crisp, cheap to change and glow under bloom. Four drawing styles give each
// character family its own look: ring eyes (Gemini), solid discs (Claude, OpenCode), an OLED
// dot-matrix (ChatGPT) and a transparent decal (faces printed directly on the body).

import * as THREE from 'three';
import { squirclePoints } from './util.ts';

export type Expr = 'neutral' | 'idle' | 'focus' | 'think' | 'happy' | 'calm' | 'alarm' | 'sleep' | 'unknown';

export interface FaceStyle {
  kind: 'ring' | 'disc' | 'dots';
  eye: string;
  alarm: string;
  /** Screen background, or null for a transparent decal printed on the body. */
  bg: string | null;
  /** Mouth drawn as glowing light (screens) or dark ink (decals). */
  mouth: 'glow' | 'ink';
  ink?: string;
  /** Pupil colour for disc eyes. */
  pupil?: string;
  /** Layout, as fractions of the canvas: eye offset from centre, eye radii, eye line, mouth line. */
  eyeX?: number;
  eyeR?: number;
  eyeRy?: number;
  eyeY?: number;
  mouthY?: number;
  /** When set, the background fills a squircle of this exponent and the corners stay transparent. */
  squircle?: number;
  /** Dot pitch for the dot-matrix style, in canvas pixels. */
  dotStep?: number;
}

export class Face {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private key = '';

  constructor(
    private style: FaceStyle,
    readonly w = 256,
    readonly h = 160,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.layer = document.createElement('canvas');
    this.layer.width = w;
    this.layer.height = h;
    this.lctx = this.layer.getContext('2d', { willReadFrequently: style.kind === 'dots' })!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.anisotropy = 4;
  }

  /** Redraws only when something visible changed. blink: 0 open … 1 closed; look shifts the eyes. */
  draw(expr: Expr, blink = 0, dim = 1, lookX = 0, lookY = 0) {
    const key = `${expr}|${blink.toFixed(2)}|${dim.toFixed(2)}|${lookX.toFixed(3)}|${lookY.toFixed(3)}`;
    if (key === this.key) return;
    this.key = key;
    const { w, h, style } = this;
    const c = this.ctx;
    const l = this.lctx;
    c.clearRect(0, 0, w, h);
    if (style.bg) {
      c.fillStyle = style.bg;
      if (style.squircle) {
        c.beginPath();
        squirclePoints(w / 2 - 1, h / 2 - 1, style.squircle).forEach(([x, y], i) => (i ? c.lineTo(w / 2 + x, h / 2 + y) : c.moveTo(w / 2 + x, h / 2 + y)));
        c.closePath();
        c.fill();
      } else {
        c.fillRect(0, 0, w, h);
      }
    }
    l.clearRect(0, 0, w, h);
    const color = expr === 'alarm' ? style.alarm : style.eye;
    l.fillStyle = color;
    l.strokeStyle = color;
    l.lineCap = 'round';
    l.lineJoin = 'round';

    const gx = lookX * w;
    const gy = lookY * h;
    const off = (style.eyeX ?? 0.17) * w;
    const ex = [w / 2 - off + gx, w / 2 + off + gx];
    const ey = (style.eyeY ?? 0.46) * h + gy;
    const rx = (style.eyeR ?? 0.11) * w;
    const ry = (style.eyeRy ?? 0.21) * h;
    const open = expr === 'happy' || expr === 'sleep' ? 1 : Math.max(0.08, 1 - blink);
    const thick = Math.max(rx * 0.42, 0.04 * w);

    const ellipse = (x: number, y: number, a: number, b: number) => {
      l.beginPath();
      l.ellipse(x, y, a, Math.max(1.5, b), 0, 0, Math.PI * 2);
      l.fill();
    };
    const cut = (draw: () => void) => {
      l.save();
      l.globalCompositeOperation = 'destination-out';
      draw();
      l.restore();
    };

    // ---- eyes
    if (expr === 'happy') {
      l.lineWidth = thick;
      for (const x of ex) {
        l.beginPath();
        l.arc(x, ey + ry * 0.45, rx * 0.85, Math.PI * 1.15, Math.PI * 1.85);
        l.stroke();
      }
    } else if (expr === 'sleep') {
      l.lineWidth = thick * 0.75;
      for (const x of ex) {
        l.beginPath();
        l.arc(x, ey - ry * 0.3, rx * 0.75, Math.PI * 0.18, Math.PI * 0.82);
        l.stroke();
      }
    } else if (expr === 'unknown') {
      l.lineWidth = thick * 0.8;
      for (const x of ex) {
        l.beginPath();
        l.moveTo(x - rx * 0.55, ey);
        l.lineTo(x + rx * 0.55, ey);
        l.stroke();
      }
    } else {
      const dy = expr === 'think' ? -0.06 * h : 0;
      const dx = expr === 'think' ? 0.025 * w : 0;
      const scale = expr === 'alarm' ? 1.08 : expr === 'idle' ? 0.9 : expr === 'calm' ? 0.94 : 1;
      const a = rx * scale;
      const b = ry * scale * open;
      for (const x of ex) ellipse(x + dx, ey + dy, a, b);

      if (style.kind === 'ring' && open > 0.3) {
        cut(() => {
          for (const x of ex) {
            l.beginPath();
            l.ellipse(x + dx, ey + dy, a * 0.52, b * 0.52, 0, 0, Math.PI * 2);
            l.fill();
          }
        });
        for (const x of ex) {
          l.beginPath();
          l.arc(x + dx + a * 0.14, ey + dy - b * 0.14, a * 0.2, 0, Math.PI * 2);
          l.fill();
        }
      }
      if (style.kind === 'disc' && open > 0.3) {
        l.save();
        for (const x of ex) {
          const px = x + dx + (expr === 'think' ? a * 0.22 : 0);
          const py = ey + dy + (expr === 'think' ? -b * 0.22 : b * 0.06);
          l.fillStyle = style.pupil ?? '#2a1404';
          l.beginPath();
          l.ellipse(px, py, a * 0.5, b * 0.52, 0, 0, Math.PI * 2);
          l.fill();
          l.fillStyle = '#fffaf0';
          l.beginPath();
          l.arc(px + a * 0.2, py - b * 0.24, a * 0.18, 0, Math.PI * 2);
          l.fill();
          l.beginPath();
          l.arc(px - a * 0.16, py + b * 0.2, a * 0.07, 0, Math.PI * 2);
          l.fill();
        }
        l.restore();
      }

      // lids and brows shape the mood
      if (expr === 'focus') {
        cut(() => {
          for (const [i, x] of ex.entries()) {
            const s = i === 0 ? 1 : -1;
            l.beginPath();
            l.moveTo(x - rx * 1.5, 0);
            l.lineTo(x + rx * 1.5, 0);
            l.lineTo(x + rx * 1.5, ey - ry * (s > 0 ? 0.05 : 0.55));
            l.lineTo(x - rx * 1.5, ey - ry * (s > 0 ? 0.55 : 0.05));
            l.closePath();
            l.fill();
          }
        });
      } else if (expr === 'alarm') {
        l.lineWidth = thick * 0.5;
        l.beginPath();
        l.moveTo(ex[0] - rx, ey - ry * 1.5);
        l.lineTo(ex[0] + rx * 0.7, ey - ry * 1.2);
        l.moveTo(ex[1] + rx, ey - ry * 1.5);
        l.lineTo(ex[1] - rx * 0.7, ey - ry * 1.2);
        l.stroke();
      }
    }

    // ---- mouth
    const mx = 0.5 * w + gx * 0.6;
    const my = (style.mouthY ?? 0.8) * h + gy * 0.6;
    const mw = Math.max(0.05 * w, rx * (style.kind === 'dots' ? 0.8 : 0.62));
    const mouthOnLayer = style.mouth === 'glow';
    const m = mouthOnLayer ? l : c;
    m.save();
    if (!mouthOnLayer) {
      m.strokeStyle = style.ink ?? '#22102e';
      m.fillStyle = style.ink ?? '#22102e';
      m.lineCap = 'round';
    }
    m.lineWidth = Math.max(3, thick * (style.kind === 'dots' ? 0.85 : 0.55));
    switch (expr) {
      case 'happy':
        m.beginPath();
        m.arc(mx, my - mw * 0.55, mw * 1.25, Math.PI * 0.12, Math.PI * 0.88);
        m.closePath();
        m.fill();
        break;
      case 'idle':
      case 'neutral':
      case 'calm':
        m.beginPath();
        m.arc(mx, my - mw * 0.9, mw, Math.PI * 0.22, Math.PI * 0.78);
        m.stroke();
        break;
      case 'focus':
      case 'unknown':
        m.beginPath();
        m.moveTo(mx - mw * 0.5, my);
        m.lineTo(mx + mw * 0.5, my);
        m.stroke();
        break;
      case 'think':
        m.beginPath();
        m.ellipse(mx + mw * 0.4, my, mw * 0.32, mw * 0.4, 0, 0, Math.PI * 2);
        m.stroke();
        break;
      case 'alarm':
        m.beginPath();
        m.moveTo(mx - mw * 0.75, my + mw * 0.12);
        m.quadraticCurveTo(mx - mw * 0.38, my - mw * 0.4, mx, my);
        m.quadraticCurveTo(mx + mw * 0.38, my + mw * 0.4, mx + mw * 0.75, my - mw * 0.06);
        m.stroke();
        break;
      default:
        break;
    }
    m.restore();

    // ---- composite the light layer
    c.save();
    c.globalAlpha = dim;
    if (style.kind === 'dots') {
      const data = l.getImageData(0, 0, w, h).data;
      c.fillStyle = color;
      const step = style.dotStep ?? 6;
      const r = step * 0.38;
      for (let y = step / 2; y < h; y += step) {
        for (let x = step / 2; x < w; x += step) {
          if (data[(Math.floor(y) * w + Math.floor(x)) * 4 + 3] > 90) {
            c.beginPath();
            c.arc(x, y, r, 0, Math.PI * 2);
            c.fill();
          }
        }
      }
    } else {
      c.drawImage(this.layer, 0, 0);
    }
    c.restore();
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}

/** A text sprite texture (Z, ?, …) for floating state glyphs. */
export function glyphTexture(text: string, color: string, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.font = `800 ${size * 0.72}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, size / 2, size / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
