// Shared materials and procedural textures. Surfaces get painted canvas textures (flagstones, moss,
// basalt grain, cedar) so nothing reads as flat CG, and all of it is generated locally at startup.

import * as THREE from 'three';
import { fbm, rng } from './util.ts';

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, opts: { repeat?: number; srgb?: boolean } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(opts.repeat ?? 1, opts.repeat ?? 1);
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function noiseFill(ctx: CanvasRenderingContext2D, s: number, base: [number, number, number], spread: number, scale: number, seed = 0) {
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const n = fbm((x + seed) / scale, (y + seed * 1.7) / scale, 4);
      const i = (y * s + x) * 4;
      img.data[i] = base[0] + n * spread;
      img.data[i + 1] = base[1] + n * spread;
      img.data[i + 2] = base[2] + n * spread * 1.1;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Irregular flagstone paving with dark grout, from a jittered Voronoi diagram. Tiles seamlessly. */
function flagstones(ctx: CanvasRenderingContext2D, s: number) {
  const r = rng(77);
  const cells = 7;
  const pts: { x: number; y: number; shade: number }[] = [];
  for (let gy = 0; gy < cells; gy++)
    for (let gx = 0; gx < cells; gx++) pts.push({ x: gx + 0.15 + r() * 0.7, y: gy + 0.15 + r() * 0.7, shade: r() });
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      // cell space; only the 3x3 neighbourhood can hold the nearest seeds (wrapping for seamless tiling)
      const u = (x / s) * cells;
      const v = (y / s) * cells;
      const cx = Math.floor(u);
      const cy = Math.floor(v);
      let d1 = 99;
      let d2 = 99;
      let best = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const idx = (((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells);
          const p = pts[idx];
          const dx = p.x - (((gx % cells) + cells) % cells) + gx - u;
          const dy = p.y - (((gy % cells) + cells) % cells) + gy - v;
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = idx;
          } else if (d < d2) d2 = d;
        }
      const edge = (Math.sqrt(d2) - Math.sqrt(d1)) / cells;
      const grout = edge < 0.012 ? 1 : edge < 0.02 ? 0.5 : 0;
      const n = fbm(x / 22, y / 22, 3) * 10;
      const base = 104 + pts[best].shade * 38 + n * 1.6;
      const i = (y * s + x) * 4;
      img.data[i] = base * (1 - grout * 0.72);
      img.data[i + 1] = base * (1 - grout * 0.72);
      img.data[i + 2] = (base + 4) * (1 - grout * 0.7);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

let cache: ReturnType<typeof createMaterials> | null = null;

export function materials() {
  if (!cache) cache = createMaterials();
  return cache;
}

function createMaterials() {
  const tex = {
    flagstone: canvasTexture(512, flagstones, { repeat: 1 }),
    moss: canvasTexture(256, (c, s) => noiseFill(c, s, [150, 150, 150], 80, 18, 3)),
    basalt: canvasTexture(256, (c, s) => {
      noiseFill(c, s, [122, 122, 126], 70, 30, 9);
      // horizontal strata streaks
      c.globalAlpha = 0.18;
      const r = rng(5);
      for (let i = 0; i < 40; i++) {
        c.fillStyle = r() > 0.5 ? '#0b0f1a' : '#5b6578';
        c.fillRect(0, r() * s, s, 1 + r() * 2);
      }
      c.globalAlpha = 1;
    }),
    cedar: canvasTexture(256, (c, s) => {
      c.fillStyle = '#6b4127';
      c.fillRect(0, 0, s, s);
      const r = rng(11);
      for (let x = 0; x < s; x += 16) {
        c.fillStyle = `rgb(${100 + r() * 40},${60 + r() * 25},${36 + r() * 15})`;
        c.fillRect(x + 1, 0, 14, s);
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(x, 0, 1, s);
        c.globalAlpha = 0.15;
        for (let k = 0; k < 6; k++) {
          c.fillStyle = '#2e1a0e';
          c.fillRect(x + 2 + r() * 10, 0, 1, s);
        }
        c.globalAlpha = 1;
      }
    }),
    glow: canvasTexture(128, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    }),
    holo: canvasTexture(256, (c, s) => {
      c.clearRect(0, 0, s, s);
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 3;
      c.strokeRect(6, 6, s - 12, s - 12);
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(6, 6, s - 12, s - 12);
      const r = rng(21);
      for (let i = 0; i < 9; i++) {
        c.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.5})`;
        c.fillRect(22, 26 + i * 22, 40 + r() * 150, 6);
      }
      c.strokeStyle = 'rgba(255,255,255,0.8)';
      c.beginPath();
      c.moveTo(150, 220);
      for (let i = 0; i < 8; i++) c.lineTo(150 + i * 12, 220 - r() * 60);
      c.stroke();
    }, { srgb: true }),
  };
  tex.moss.repeat.set(3, 3);
  tex.basalt.repeat.set(2, 1);

  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const m = {
    basalt: std({ color: '#5a6580', map: tex.basalt, roughness: 0.9, metalness: 0.02 }),
    basaltDark: std({ color: '#363e54', map: tex.basalt, roughness: 0.95, flatShading: true }),
    paving: std({ color: '#a9b2c6', map: tex.flagstone, roughness: 0.8 }),
    slate: std({ color: '#76829c', map: tex.basalt, roughness: 0.85 }),
    moss: std({ color: '#9fd49a', map: tex.moss, roughness: 1 }),
    mossDark: std({ color: '#6aa878', map: tex.moss, roughness: 1 }),
    leaf: std({ color: '#3d8a5a', roughness: 0.85, flatShading: true }),
    leafLight: std({ color: '#5fae6e', roughness: 0.85, flatShading: true }),
    trunk: std({ color: '#3d2a22', roughness: 0.9 }),
    cedar: std({ color: '#ffffff', map: tex.cedar, roughness: 0.7 }),
    walnut: std({ color: '#4a2f1f', roughness: 0.6 }),
    brass: std({ color: '#c9a24a', metalness: 0.9, roughness: 0.32 }),
    titanium: std({ color: '#c9cfda', metalness: 0.85, roughness: 0.3 }),
    alabaster: std({ color: '#ece4d4', roughness: 0.55 }),
    gunmetal: std({ color: '#3b4352', metalness: 0.75, roughness: 0.38 }),
    steel: std({ color: '#7d8798', metalness: 0.8, roughness: 0.35 }),
    darkGlass: new THREE.MeshPhysicalMaterial({ color: '#0d1422', roughness: 0.08, metalness: 0.1, clearcoat: 1 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#b9d3e6', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false }),
    cushion: std({ color: '#2a3040', roughness: 0.75, metalness: 0.15 }),
  };
  return { tex, m };
}

/**
 * Adds a grazing Fresnel rim in the agent's glow colour to a material, so characters separate from
 * the dark night background the way the reference renders do.
 */
export function withRim<T extends THREE.MeshStandardMaterial>(material: T, color: THREE.ColorRepresentation, strength = 0.45, power = 2.6): T {
  const rimColor = new THREE.Color(color);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRimStrength = { value: strength };
    shader.uniforms.uRimPower = { value: power };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n float rimF = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), uRimPower);\n totalEmissiveRadiance += uRimColor * rimF * uRimStrength;',
      );
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => `rim-${rimColor.getHexString()}-${strength}-${power}`;
  return material;
}
