import type { Accessory, Appearance, Archetype, VoiceStyle } from '../../../shared/types.ts';

export const ARCHETYPES: { value: Archetype; label: string; blurb: string; station: string }[] = [
  { value: 'explorer', label: 'Explorer', blurb: 'Curious researcher with twin star antennae and a travel scarf', station: 'Research station' },
  { value: 'scholar', label: 'Scholar', blurb: 'Careful writer with round glasses and a notebook', station: 'Writing desk' },
  { value: 'host', label: 'Host', blurb: 'Friendly talker with soft ears and a headset', station: 'Communication hub' },
  { value: 'builder', label: 'Builder', blurb: 'Hands-on engineer with goggles and a tool belt', station: 'Coding rig' },
  { value: 'sprite', label: 'Sprite', blurb: 'A simple sprout creature. Choose any body shape and accessory', station: 'Garden pod' },
];

const BY_VOICE: Record<VoiceStyle, Archetype> = { curious: 'explorer', calm: 'scholar', chatty: 'host', determined: 'builder', neutral: 'sprite' };

/** Agents saved before 2.0 have no archetype; their voice style picks the closest design. */
export function archetypeOf(appearance: Appearance, voice: VoiceStyle): Archetype {
  return appearance.archetype ?? BY_VOICE[voice] ?? 'sprite';
}

/**
 * Before 2.0 accessories stood in for personality (glasses, headphones...). Archetypes draw those
 * details themselves, so legacy accessories are only kept for sprites.
 */
export function extraAccessory(appearance: Appearance, voice: VoiceStyle): Accessory {
  if (appearance.archetype) return appearance.accessory;
  return archetypeOf(appearance, voice) === 'sprite' ? appearance.accessory : 'none';
}
