const SPEAKER_COLOR_PALETTE = [
  "text-cyan-300",
  "text-sky-300",
  "text-blue-300",
  "text-indigo-300",
  "text-violet-300",
  "text-purple-300",
  "text-fuchsia-300",
  "text-pink-300",
  "text-rose-300",
  "text-orange-300",
  "text-amber-300",
  "text-yellow-300",
  "text-emerald-300",
  "text-green-300",
  "text-teal-300",
] as const;

const FALLBACK_SPEAKER_COLOR = "text-brand";

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function speakerColorClass(characterId: string | null | undefined): string {
  if (!characterId) return FALLBACK_SPEAKER_COLOR;
  const slot = fnv1a(characterId) % SPEAKER_COLOR_PALETTE.length;
  return SPEAKER_COLOR_PALETTE[slot] as string;
}

export function speakerColorPaletteSize(): number {
  return SPEAKER_COLOR_PALETTE.length;
}
