// Island themes: the same terraced island re-dressed with its own stone, foliage, water, sky and
// drifting particles. Applied by mutating the shared terrain materials (characters are untouched).

import * as THREE from 'three';
import type { Island } from '../../../shared/cosmetics.ts';
import { materials } from './materials.ts';

export interface Theme {
  paving: string;
  slate: string;
  basalt: string;
  basaltDark: string;
  alabaster: string;
  moss: string;
  mossDark: string;
  leaf: string;
  leafLight: string;
  trunk: string;
  /** Water (or lava): deep colour per time of day is tinted toward this, sparkles glow in `glow`. */
  water: string;
  waterGlow: string;
  fall: string;
  lantern: string;
  conduit: string;
  /** Night and dusk sky (top, middle, bottom). */
  sky: [string, string, string];
  particles: { a: string; b: string; fall: number; rise: number; size: number; count: number };
}

export const THEMES: Record<Island, Theme> = {
  nocturne: {
    paving: '#9aa6c2', slate: '#6c7a99', basalt: '#526081', basaltDark: '#323c56', alabaster: '#ece4d4',
    moss: '#7cc47e', mossDark: '#4f9a66', leaf: '#3d8a5a', leafLight: '#5fae6e', trunk: '#3d2a22',
    water: '#06173a', waterGlow: '#38bdf8', fall: '#a5e8ff', lantern: '#ffc777', conduit: '#9be7ff',
    sky: ['#0c1533', '#070b1c', '#03050d'],
    particles: { a: '#8cd9ff', b: '#ffc766', fall: 0, rise: 0, size: 1, count: 180 },
  },
  sakura: {
    paving: '#d9c7b3', slate: '#a08a7c', basalt: '#7a6560', basaltDark: '#4a3a3a', alabaster: '#f5ece2',
    moss: '#9ccb78', mossDark: '#73a865', leaf: '#f472b6', leafLight: '#fbcfe8', trunk: '#4a2c2a',
    water: '#0b2f45', waterGlow: '#f9a8d4', fall: '#fde2ef', lantern: '#ffd2a8', conduit: '#fbcfe8',
    sky: ['#2a1640', '#140b24', '#07040e'],
    particles: { a: '#fbcfe8', b: '#f9a8d4', fall: 0.35, rise: 0, size: 1.6, count: 220 },
  },
  glacier: {
    paving: '#e2eaf3', slate: '#b6c4d6', basalt: '#8a9ab0', basaltDark: '#56657c', alabaster: '#f8fafc',
    moss: '#f1f5f9', mossDark: '#cbd5e1', leaf: '#3f7f7a', leafLight: '#e8f1f8', trunk: '#3b3330',
    water: '#0b3552', waterGlow: '#a5f3fc', fall: '#e0f7ff', lantern: '#cfe8ff', conduit: '#bae6fd',
    sky: ['#10264a', '#0a1730', '#040912'],
    particles: { a: '#ffffff', b: '#dbeafe', fall: 0.5, rise: 0, size: 1.3, count: 320 },
  },
  ember: {
    paving: '#c08a6a', slate: '#8a5a48', basalt: '#5e3a34', basaltDark: '#33201e', alabaster: '#f0d9c4',
    moss: '#b8935c', mossDark: '#8a6640', leaf: '#5d6b2a', leafLight: '#9aa83f', trunk: '#3a2218',
    water: '#5a1206', waterGlow: '#fb923c', fall: '#ffb36b', lantern: '#ff9f5a', conduit: '#fdba74',
    sky: ['#2a0e14', '#180608', '#070203'],
    particles: { a: '#fb923c', b: '#fde047', fall: 0, rise: 0.45, size: 1.1, count: 200 },
  },
  verdant: {
    paving: '#a4b8a2', slate: '#6f8a74', basalt: '#4f6a58', basaltDark: '#2d4034', alabaster: '#eef4e6',
    moss: '#62d070', mossDark: '#3a9e58', leaf: '#23935a', leafLight: '#6ee77a', trunk: '#3a2a1c',
    water: '#04404a', waterGlow: '#2dd4bf', fall: '#b6fff0', lantern: '#e9ff9a', conduit: '#99f6e4',
    sky: ['#0a2a2a', '#061818', '#020808'],
    particles: { a: '#d9f99d', b: '#fde68a', fall: 0, rise: 0, size: 1.2, count: 240 },
  },
};

/** Re-colours the shared terrain materials for an island. */
export function applyTheme(theme: Theme) {
  const { m } = materials();
  const set = (mat: THREE.MeshStandardMaterial, c: string) => mat.color.set(c);
  set(m.paving, theme.paving);
  set(m.slate, theme.slate);
  set(m.basalt, theme.basalt);
  set(m.basaltDark, theme.basaltDark);
  set(m.alabaster, theme.alabaster);
  set(m.moss, theme.moss);
  set(m.mossDark, theme.mossDark);
  set(m.leaf, theme.leaf);
  set(m.leafLight, theme.leafLight);
  set(m.trunk, theme.trunk);
}
