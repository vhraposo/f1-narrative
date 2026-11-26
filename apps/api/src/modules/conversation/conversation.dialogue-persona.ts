import type { RealizerVoice } from "./conversation.dialogue-realizer.js";

export type RelationshipLabel = "distante" | "neutra" | "próxima";

export function describeRelationshipAffinity(affinity: number | null): RelationshipLabel | null {
  if (affinity === null || !Number.isFinite(affinity)) return null;
  if (affinity <= 0.3) return "distante";
  if (affinity >= 0.7) return "próxima";
  return "neutra";
}

export function describeVoiceStyle(voice: RealizerVoice): string {
  const traits: string[] = [];
  traits.push(voice.informality >= 0.6 ? "informal" : voice.informality <= 0.35 ? "formal" : "equilibrado");
  if (voice.warmth >= 0.65) traits.push("caloroso");
  if (voice.warmth <= 0.3) traits.push("seco");
  if (voice.humor >= 0.65) traits.push("bem-humorado");
  if (voice.verbosity <= 0.3) traits.push("conciso");
  if (voice.verbosity >= 0.7) traits.push("expansivo");
  return traits.join(", ");
}
