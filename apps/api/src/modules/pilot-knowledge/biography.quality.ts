import type { ApprovedClaimSet } from "./biography.claims.js";
import { claimVocabulary } from "./biography.claims.js";

export type BiographyQualityResult = {
  readonly ok: boolean;
  readonly issues: readonly string[];
  readonly sentenceCount: number;
};

const FOREIGN_FUNCTION_WORDS = new Set([
  "the",
  "and",
  "with",
  "from",
  "was",
  "were",
  "his",
  "her",
  "their",
  "its",
  "this",
  "that",
  "these",
  "those",
  "but",
  "or",
  "starting",
  "followed",
  "while",
  "into",
  "over",
  "under",
  "between",
  "before",
  "after",
  "where",
  "when",
  "which",
  "who",
  "how",
]);

const PT_FUNCTION_WORDS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e",
  "ele", "ela", "em", "entre", "era", "essa", "esse", "esta", "este", "foi",
  "na", "nas", "no", "nos", "o", "os", "ou", "para", "pela", "pelo", "por",
  "que", "se", "sem", "seu", "sua", "suas", "seus", "um", "uma", "é", "já",
  "ainda", "além", "após", "até", "desde", "durante", "onde", "quando", "com",
  "também", "tornou", "passou", "correu", "largou", "venceu", "conquistou",
  "nasceu", "começou", "iniciou", "entrou", "estreou", "disputou", "soma",
  "campeão", "campeã", "piloto", "títulos", "título", "temporada", "temporadas",
  "vitórias", "vitória", "pódios", "pódio", "poles", "pole", "largadas",
  "voltas", "mundiais", "mundial", "equipe", "equipes", "categoria",
  "categorias", "kart", "karting", "fórmula", "anos", "ano", "cidade",
  "país", "primeiro", "primeira", "primeiros", "primeiras", "grande",
  "prêmio", "prêmios", "gp", "f1", "na", "então", "onde", "assim",
]);

const MONTH_WORDS = new Set([
  "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
  "agosto", "setembro", "outubro", "novembro", "dezembro",
]);

function tokenizeWithPositions(text: string) {
  const tokens: Array<{ value: string; lower: string; startOfSentence: boolean }> = [];
  const regex = /[\p{L}\p{N}]+/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    const startOfSentence = /(^|[.!?]\s+|\n)$/.test(before.slice(-3))
      || /(^|[.!?]\s*)$/.test(before);
    tokens.push({
      value: match[0],
      lower: match[0].toLowerCase(),
      startOfSentence,
    });
  }
  return tokens;
}

const PT_SUFFIX_PATTERN =
  /(ção|ções|são|sões|dade|dades|mente|eiro|eira|ista|istas|ismo|ismos|agem|agens|oso|osa|ados|adas|ado|ada|vel|veis|ência|ências)$/;

const PT_LONG_WORDS = new Set([
  "profissional",
  "profissionais",
  "internacional",
  "internacionais",
  "automobilismo",
  "automobilistica",
  "automobilistico",
  "motorsport",
]);

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function validateBiographyText(input: {
  readonly text: string;
  readonly claims: ApprovedClaimSet;
}): BiographyQualityResult {
  const issues: string[] = [];
  const text = input.text;
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return { ok: false, issues: ["empty-text"], sentenceCount: 0 };
  }
  if (trimmed.length < 80) issues.push("too-short");
  if (trimmed.length > 2400) issues.push("too-long");
  if (/[<>]/.test(trimmed)) issues.push("html-tags");
  if (/(\*\*|__|^\s*#{1,6}\s|```|\[[^\]]+\]\([^)]+\))/m.test(trimmed)) {
    issues.push("markdown");
  }
  if (/https?:\/\//i.test(trimmed)) issues.push("url-in-text");
  if (/[{}]/.test(trimmed) && /"[^"]+"\s*:/.test(trimmed)) issues.push("json-in-text");
  if (/(\{\{|\}\}|TODO|lorem ipsum|undefined|null\b)/i.test(trimmed)) {
    issues.push("placeholder");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed)) {
    issues.push("control-chars");
  }

  const sentences = splitSentences(trimmed);
  if (sentences.length < 2) issues.push("too-few-sentences");
  if (sentences.length > 14) issues.push("too-many-sentences");

  const vocabulary = claimVocabulary(input.claims);
  const tokens = tokenizeWithPositions(trimmed);
  const lowerTokens = new Set(tokens.map((token) => token.lower));

  for (const token of tokens) {
    if (token.lower.length >= 14 && token.lower.length <= 40) {
      let suspect = false;
      for (let split = 5; split <= token.lower.length - 5; split += 1) {
        const head = token.lower.slice(0, split);
        const tail = token.lower.slice(split);
        if (lowerTokens.has(head) && lowerTokens.has(tail)) {
          suspect = true;
          break;
        }
      }
      if (suspect) issues.push(`concatenated-words:${token.lower}`);
    }
    if (
      token.lower.length >= 12 &&
      /^[a-zà-ú]+$/.test(token.lower) &&
      !vocabulary.has(token.lower) &&
      !PT_FUNCTION_WORDS.has(token.lower) &&
      !PT_LONG_WORDS.has(token.lower) &&
      !PT_SUFFIX_PATTERN.test(token.lower)
    ) {
      issues.push(`unknown-long-token:${token.lower}`);
    }
    if (
      FOREIGN_FUNCTION_WORDS.has(token.lower) &&
      !vocabulary.has(token.lower) &&
      !(token.lower === "not" && false)
    ) {
      issues.push(`mixed-language:${token.lower}`);
    }
    if (
      !token.startOfSentence &&
      token.value.length >= 4 &&
      /^[\p{Lu}]/u.test(token.value) &&
      !vocabulary.has(token.lower) &&
      !PT_FUNCTION_WORDS.has(token.lower) &&
      !MONTH_WORDS.has(token.lower)
    ) {
      issues.push(`unsupported-proper-noun:${token.value}`);
    }
  }

  const claimYears = new Set<number>();
  for (const claim of input.claims.claims) {
    if (claim.year !== null) claimYears.add(claim.year);
    if (claim.endYear !== null) claimYears.add(claim.endYear);
  }
  const textYears = new Set(
    (trimmed.match(/\b(?:19|20)\d{2}\b/g) ?? []).map((year) => Number(year)),
  );
  for (const year of textYears) {
    if (!claimYears.has(year)) issues.push(`unsupported-year:${year}`);
  }

  const seen = new Set<string>();
  for (const sentence of sentences) {
    const key = sentence.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) issues.push("duplicate-sentence");
    seen.add(key);
  }

  const uniqueIssues = [...new Set(issues)];
  return {
    ok: uniqueIssues.length === 0,
    issues: uniqueIssues,
    sentenceCount: sentences.length,
  };
}
