import { useEffect, useState } from 'react';
import type { Preferences } from '../../../shared/types.ts';

export type Period = 'dawn' | 'day' | 'dusk' | 'night';

function clockPeriod(): Period {
  const h = new Date().getHours();
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

/** The world's time of day: fixed by the user, or following the clock. */
export function usePeriod(prefs: Preferences, theme: 'dark' | 'light'): Period {
  const mode = prefs.lighting ?? (prefs.dayNight ? 'auto' : theme === 'light' ? 'day' : 'night');
  const [clock, setClock] = useState<Period>(clockPeriod);
  useEffect(() => {
    if (mode !== 'auto') return;
    const t = setInterval(() => setClock(clockPeriod()), 60_000);
    return () => clearInterval(t);
  }, [mode]);
  return mode === 'auto' ? clock : mode;
}

type Palette = Record<string, string | number>;

export const LIGHTING: Record<Period, Palette> = {
  night: {
    '--wall-0': '#11141c', '--wall-1': '#0b0d13', '--floor-0': '#1a1d26', '--floor-1': '#090a0e', '--frame': '#07080b', '--hill-far': '#1b2148', '--hill-near': '#121633', '--town': '#ffd28a', '--sun': '#eef0ff',
    '--sky-0': '#060a1d', '--sky-1': '#131b44', '--sky-2': '#2c2d69', '--sky-glow': '#6a5acd', '--star': 1,
    '--cloud': '#2a336e', '--cloud-shade': '#1a2051', '--cloud-light': '#4a5594',
    '--grass-0': '#4fc29a', '--grass-1': '#2b8e77', '--grass-2': '#17574f', '--grass-edge': '#0f3b3a',
    '--cliff-0': '#8d5f7a', '--cliff-1': '#583c64', '--cliff-2': '#271c3d',
    '--path': '#8f9acf', '--path-edge': '#5f6aa0', '--crystal': '#7ef3ff', '--rim': '#9fd0ff', '--water': '#8fd8ff',
    '--fog': '#1a2050', '--lamp': 1, '--zzz': '#dfe4ff', '--leaf-0': '#3fae86', '--leaf-1': '#1f6f5f', '--trunk': '#5b3d4f',
  },
  dusk: {
    '--wall-0': '#1a1820', '--wall-1': '#100f15', '--floor-0': '#221e25', '--floor-1': '#0b0a0e', '--frame': '#09080b', '--hill-far': '#5a3a63', '--hill-near': '#33233f', '--town': '#ffd28a', '--sun': '#ffc08a',
    '--sky-0': '#1b1a4a', '--sky-1': '#6b3e7e', '--sky-2': '#f2956d', '--sky-glow': '#ffc08a', '--star': 0.35,
    '--cloud': '#b96e8c', '--cloud-shade': '#7b4876', '--cloud-light': '#ffc9a8',
    '--grass-0': '#7bd9a0', '--grass-1': '#3ea07d', '--grass-2': '#1f6b5e', '--grass-edge': '#174a45',
    '--cliff-0': '#d28768', '--cliff-1': '#95515b', '--cliff-2': '#4a2a48',
    '--path': '#f0d2c0', '--path-edge': '#c09690', '--crystal': '#9ef0ff', '--rim': '#ffc9a3', '--water': '#a6e4ff',
    '--fog': '#6a3d6d', '--lamp': 1, '--zzz': '#fff3ea', '--leaf-0': '#5cc790', '--leaf-1': '#2b7f68', '--trunk': '#6e4450',
  },
  dawn: {
    '--wall-0': '#1e1f27', '--wall-1': '#131419', '--floor-0': '#26262d', '--floor-1': '#0e0f13', '--frame': '#0a0b0e', '--hill-far': '#8a7cb0', '--hill-near': '#5c5584', '--town': '#ffe2b8', '--sun': '#fff0d6',
    '--sky-0': '#2d3d82', '--sky-1': '#9b8fcf', '--sky-2': '#ffcdb0', '--sky-glow': '#ffe2c4', '--star': 0.15,
    '--cloud': '#e4c6de', '--cloud-shade': '#b394be', '--cloud-light': '#fff4ec',
    '--grass-0': '#88e1ab', '--grass-1': '#45a882', '--grass-2': '#24705f', '--grass-edge': '#1b5048',
    '--cliff-0': '#dda386', '--cliff-1': '#a2666b', '--cliff-2': '#5a3450',
    '--path': '#f6e6da', '--path-edge': '#cbb1ab', '--crystal': '#b5f4ff', '--rim': '#ffe0c8', '--water': '#bfeaff',
    '--fog': '#a993c4', '--lamp': 0.35, '--zzz': '#ffffff', '--leaf-0': '#6ad39a', '--leaf-1': '#33876c', '--trunk': '#7a5150',
  },
  day: {
    '--wall-0': '#23262e', '--wall-1': '#16181e', '--floor-0': '#2b2e36', '--floor-1': '#111318', '--frame': '#0c0d11', '--hill-far': '#7fb0d6', '--hill-near': '#5e9a86', '--town': '#ffffff', '--sun': '#fffbe8',
    '--sky-0': '#3d8ee0', '--sky-1': '#8cc8f7', '--sky-2': '#dff3ff', '--sky-glow': '#ffffff', '--star': 0,
    '--cloud': '#ffffff', '--cloud-shade': '#cfe0f3', '--cloud-light': '#ffffff',
    '--grass-0': '#93e4a8', '--grass-1': '#4cae79', '--grass-2': '#2a7a5c', '--grass-edge': '#1e5a47',
    '--cliff-0': '#e8b08a', '--cliff-1': '#bb7762', '--cliff-2': '#6e4150',
    '--path': '#fbf3e6', '--path-edge': '#d6c3ae', '--crystal': '#b9f6ff', '--rim': '#ffffff', '--water': '#c8f0ff',
    '--fog': '#bfe0f7', '--lamp': 0, '--zzz': '#4a5070', '--leaf-0': '#6fd59a', '--leaf-1': '#2f8a63', '--trunk': '#8a5a48',
  },
};
