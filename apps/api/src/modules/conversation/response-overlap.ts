import { significantTokens } from "./topic-match.js";

export const RESPONSE_OVERLAP_VERSION = "response-overlap.v1";

export const RESPONSE_OVERLAP_RULE =
  "response-overlap.v1-rule: jaccard sobre tokens significativos (sinais topic-match v1); >=0.7 = alta sobreposição";

export const HIGH_OVERLAP_THRESHOLD = 0.7;

export function lexicalOverlap(textA: string, textB: string): number {
  const tokensA = significantTokens(textA);
  const tokensB = significantTokens(textB);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setB = new Set(tokensB);
  let shared = 0;
  for (const token of tokensA) {
    if (setB.has(token)) shared += 1;
  }
  const union = tokensA.length + tokensB.length - shared;
  if (union === 0) return 0;
  return shared / union;
}

export function maxLexicalOverlap(candidate: string, others: readonly string[]): number {
  if (others.length === 0) return 0;
  let max = 0;
  for (const other of others) {
    const score = lexicalOverlap(candidate, other);
    if (score > max) max = score;
  }
  return max;
}

export function isHighLexicalOverlap(score: number): boolean {
  return score >= HIGH_OVERLAP_THRESHOLD;
}