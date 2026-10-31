// The cosmetic catalog: characters, accessories, islands and emotes, which are free and which are
// sold in the shop, and the daily deal rotation. Shared by the web app, the hub (to check what an
// install owns) and the shop server (to price checkouts), so they can never disagree.

import type { Accessory, Archetype } from './types.ts';

export type Island = 'nocturne' | 'sakura' | 'glacier' | 'ember' | 'verdant';
export type Emote = 'wave' | 'cheer' | 'nod' | 'jump' | 'dance' | 'spin' | 'heart' | 'laugh' | 'shrug' | 'surprised' | 'stretch' | 'bow';
export type ItemKind = 'character' | 'accessory' | 'island' | 'emote';

export interface Item {
  /** Stable id, `${kind}:${value}`. */
  id: string;
  kind: ItemKind;
  value: string;
  name: string;
  blurb: string;
  /** Price in US cents; 0 means free for everyone. */
  price: number;
}

const item = (kind: ItemKind, value: string, name: string, blurb: string, price = 0): Item => ({ id: `${kind}:${value}`, kind, value, name, blurb, price });

export const CHARACTERS: Item[] = [
  item('character', 'explorer', 'Explorer', 'Hovering sphere with a glass visor and floating gauntlets'),
  item('character', 'scholar', 'Scholar', 'Velvet pear with brass spectacles and a drafting tablet'),
  item('character', 'host', 'Host', 'Helmeted astronaut with studio headphones'),
  item('character', 'builder', 'Builder', 'Boxy engineer with welding goggles and a tool belt'),
  item('character', 'sprite', 'Sprite', 'Compact pod that wears any accessory'),
  item('character', 'sentinel', 'Sentinel', 'Armoured guardian with a glowing hex shield', 299),
  item('character', 'alchemist', 'Alchemist', 'Crystal-headed sage with orbiting prisms and a flask', 299),
  item('character', 'conductor', 'Conductor', 'Clockwork maestro with a baton and tailcoat', 299),
  item('character', 'wisp', 'Wisp', 'A soft glowing ghost that floats instead of walking', 299),
];

export const ACCESSORIES: Item[] = [
  item('accessory', 'none', 'None', 'Just the character'),
  item('accessory', 'antenna', 'Antenna', 'A glowing status bead on a stalk'),
  item('accessory', 'headphones', 'Headphones', 'Over-ear cans'),
  item('accessory', 'glasses', 'Glasses', 'Round brass frames'),
  item('accessory', 'beanie', 'Beanie', 'Knitted and warm'),
  item('accessory', 'bow', 'Bow', 'A neat ribbon'),
  item('accessory', 'leaf', 'Leaf', 'A single sprout on top'),
  item('accessory', 'crown', 'Crown', 'Five gold points'),
  item('accessory', 'visor', 'Visor', 'A sporty band'),
  item('accessory', 'scarf', 'Scarf', 'Wrapped round twice'),
  item('accessory', 'party-hat', 'Party hat', 'Striped cone with a pom-pom', 99),
  item('accessory', 'halo', 'Halo', 'A softly glowing ring', 99),
  item('accessory', 'top-hat', 'Top hat', 'Tall, black, with a satin band', 99),
  item('accessory', 'wizard-hat', 'Wizard hat', 'Starry and slightly crooked', 149),
  item('accessory', 'cat-ears', 'Cat ears', 'With pink inner ears', 99),
  item('accessory', 'flower', 'Flower crown', 'A ring of blossoms', 149),
  item('accessory', 'bowtie', 'Bow tie', 'Dapper and red', 99),
  item('accessory', 'cape', 'Cape', 'Flows behind as they move', 199),
  item('accessory', 'backpack', 'Backpack', 'Adventure-ready, with a bedroll', 149),
  item('accessory', 'jetpack', 'Jetpack', 'Twin thrusters with a flickering glow', 199),
];

export const ISLANDS: Item[] = [
  item('island', 'nocturne', 'Nocturne', 'Slate terraces under a starry night'),
  item('island', 'sakura', 'Sakura', 'Warm stone, cherry blossoms and drifting petals', 399),
  item('island', 'glacier', 'Glacier', 'Snow-capped stone, icy water and falling snow', 399),
  item('island', 'ember', 'Ember', 'Red sandstone with a glowing lava channel', 399),
  item('island', 'verdant', 'Verdant', 'Lush jungle green with turquoise water', 399),
];

export const EMOTES: Item[] = [
  item('emote', 'wave', 'Wave', 'Hello there'),
  item('emote', 'cheer', 'Cheer', 'Arms up'),
  item('emote', 'nod', 'Nod', 'Yes, got it'),
  item('emote', 'jump', 'Jump', 'A happy hop'),
  item('emote', 'dance', 'Dance', 'A little groove with music notes', 99),
  item('emote', 'spin', 'Spin', 'A full twirl', 99),
  item('emote', 'heart', 'Heart', 'Floats a heart above their head', 99),
  item('emote', 'laugh', 'Laugh', 'Shoulders shaking, eyes closed', 99),
  item('emote', 'shrug', 'Shrug', 'Who knows?', 99),
  item('emote', 'surprised', 'Surprised', 'Startled jump with a !', 99),
  item('emote', 'stretch', 'Stretch', 'A big yawn and a stretch', 99),
  item('emote', 'bow', 'Bow', 'A polite bow', 99),
];

export const CATALOG: Item[] = [...CHARACTERS, ...ACCESSORIES, ...ISLANDS, ...EMOTES];
export const ITEM = Object.fromEntries(CATALOG.map((i) => [i.id, i])) as Record<string, Item>;

export const isFree = (id: string) => (ITEM[id]?.price ?? 1) === 0;
export const owns = (owned: Iterable<string>, id: string) => isFree(id) || new Set(owned).has(id);

/** UTC calendar day used for deals, e.g. "2026-10-31". */
export function dealDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Deal {
  id: string;
  /** Percent off, 20 to 50. */
  off: number;
  price: number;
}

/** Three discounted items per UTC day, the same for every install and for the shop server. */
export function dailyDeals(day = dealDay()): Deal[] {
  const r = seeded(`ai-village-deals:${day}`);
  const pool = CATALOG.filter((i) => i.price > 0);
  const out: Deal[] = [];
  const kinds = new Set<ItemKind>();
  while (out.length < 3) {
    const i = pool[Math.floor(r() * pool.length)];
    if (out.some((d) => d.id === i.id) || (kinds.has(i.kind) && kinds.size < 3)) continue;
    kinds.add(i.kind);
    const off = [20, 25, 30, 40, 50][Math.floor(r() * 5)];
    out.push({ id: i.id, off, price: Math.max(49, Math.round((i.price * (100 - off)) / 100 / 10) * 10 - 1) });
  }
  return out;
}

/** What an item costs today (deal price when it is on offer). */
export function priceToday(id: string, day = dealDay()) {
  const deal = dailyDeals(day).find((d) => d.id === id);
  return deal ? deal.price : (ITEM[id]?.price ?? 0);
}

export const formatPrice = (cents: number) => (cents === 0 ? 'Free' : `$${(cents / 100).toFixed(2)}`);

export const ARCHETYPE_IDS = CHARACTERS.map((c) => c.value) as Archetype[];
export const ACCESSORY_IDS = ACCESSORIES.map((a) => a.value) as Accessory[];
export const ISLAND_IDS = ISLANDS.map((i) => i.value) as Island[];
export const EMOTE_IDS = EMOTES.map((e) => e.value) as Emote[];
