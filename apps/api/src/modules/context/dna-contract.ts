import type { Prisma } from "@prisma/client";

export const CHARACTER_DNA_KEYS = [
  "personality",
  "behavior",
  "speechStyle",
  "tendencies",
  "values",
  "traits",
] as const;

export type CharacterDnaKey = (typeof CHARACTER_DNA_KEYS)[number];

export interface CharacterDna {
  personality?: string;
  behavior?: string;
  speechStyle?: string;
  tendencies?: string;
  values?: string;
  traits?: string;
}

const KEY_ALIASES: Record<CharacterDnaKey, readonly string[]> = {
  personality: ["personality", "personalidade"],
  behavior: ["behavior", "comportamento"],
  speechStyle: ["speechStyle", "speech_style", "estiloDeFala", "estilo_de_fala"],
  tendencies: ["tendencies", "tendencias", "natureza"],
  values: ["values", "valores", "principios"],
  traits: ["traits", "caracteristicas", "characteristics"],
};

const LINE_CAP = 500;
const BIOGRAPHY_SNIPPET_MAX = 600;

function capLength(value: string): string {
  if (value.length <= LINE_CAP) return value;
  return `${value.slice(0, LINE_CAP)}…`;
}

export function flattenScalars(value: Prisma.JsonValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => flattenScalars(item))
      .filter((part): part is string => part !== null);
    return parts.length === 0 ? null : parts.join(", ");
  }
  if (typeof value === "object") {
    const parts: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const scalar = flattenScalars((value as Record<string, Prisma.JsonValue>)[key]);
      if (scalar !== null) parts.push(`${key}: ${scalar}`);
    }
    return parts.length === 0 ? null : parts.join("; ");
  }
  return null;
}

export function normalizeCharacterDna(
  value: Prisma.JsonValue | null | undefined,
): CharacterDna {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  const aliasToKey = new Map<string, CharacterDnaKey>();
  for (const [canon, aliases] of Object.entries(KEY_ALIASES)) {
    for (const alias of aliases) aliasToKey.set(alias, canon as CharacterDnaKey);
  }

  const out: CharacterDna = {};
  const seen = new Set<CharacterDnaKey>();
  for (const rawKey of Object.keys(value).sort()) {
    if (seen.size === CHARACTER_DNA_KEYS.length) break;
    const canon = aliasToKey.get(rawKey);
    if (!canon || seen.has(canon)) continue;
    const scalar = flattenScalars((value as Record<string, Prisma.JsonValue>)[rawKey]);
    if (scalar !== null) {
      out[canon] = capLength(scalar);
      seen.add(canon);
    }
  }
  return out;
}

export function characterDnaHasContent(dna: CharacterDna): boolean {
  return CHARACTER_DNA_KEYS.some((key) => dna[key] !== undefined);
}

const DNA_LABELS: ReadonlyArray<[CharacterDnaKey, string]> = [
  ["personality", "Personality"],
  ["behavior", "Behavior"],
  ["speechStyle", "Speech style"],
  ["tendencies", "Tendencies"],
  ["values", "Values"],
  ["traits", "Traits"],
];

export function formatDnaLines(dna: CharacterDna): string[] {
  return DNA_LABELS.filter(([key]) => dna[key] !== undefined).map(
    ([key, label]) => `- ${label}: ${dna[key]}`,
  );
}

export function formatBiographySnippet(
  biography: string | null | undefined,
): string | null {
  if (typeof biography !== "string") return null;
  const trimmed = biography.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= BIOGRAPHY_SNIPPET_MAX) return trimmed;
  const cut = trimmed.slice(0, BIOGRAPHY_SNIPPET_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  const truncated = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${truncated}…`;
}