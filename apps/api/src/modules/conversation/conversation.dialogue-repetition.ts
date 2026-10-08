function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function openingOf(value: string): string {
  return normalize(value).split(" ").slice(0, 2).join(" ");
}

export function measureRecentRepetition(
  messages: readonly { readonly content: string }[],
): {
  readonly count: number;
  readonly duplicateRate: number;
  readonly openingRate: number;
} {
  const count = messages.length;
  if (count === 0) return { count: 0, duplicateRate: 0, openingRate: 0 };
  const texts = messages.map((message) => normalize(message.content)).filter(Boolean);
  const openings = texts.map(openingOf);
  const uniqueTexts = new Set(texts).size;
  const uniqueOpenings = new Set(openings).size;
  return {
    count,
    duplicateRate: 1 - uniqueTexts / Math.max(1, texts.length),
    openingRate: 1 - uniqueOpenings / Math.max(1, openings.length),
  };
}
