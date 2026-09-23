import { normalizeTopicText } from "../conversation/topic-match.js";

export type UserPromptProjectionStatus = "SUPPORTED" | "UNSUPPORTED";

export interface UserPromptProjection {
  status: UserPromptProjectionStatus;
  projectedPrompt: string | null;
  recipients: string[];
  core: string | null;
}

interface CoreMatcher {
  pattern: RegExp;
  canonical: string;
}

// Ordem importa: o primeiro matcher que casar define o núcleo canônico.
const CORE_MATCHERS: readonly CoreMatcher[] = [
  { pattern: /\bquem venceu a corrida de monaco\b/, canonical: "quem venceu a corrida de Mônaco" },
  { pattern: /\bquem ficou em primeiro lugar em monaco\b/, canonical: "quem ficou em primeiro em Mônaco" },
  { pattern: /\bquem ficou em primeiro em monaco\b/, canonical: "quem ficou em primeiro em Mônaco" },
  { pattern: /\bquem ficou em primeiro na corrida de monaco\b/, canonical: "quem ficou em primeiro na corrida de Mônaco" },
  { pattern: /\bqual foi o resultado da corrida de monaco\b/, canonical: "qual foi o resultado da corrida de Mônaco" },
  { pattern: /\bqual foi o resultado do gp de monaco\b/, canonical: "qual foi o resultado final do GP de Mônaco" },
  { pattern: /\bqual foi o resultado final do gp de monaco\b/, canonical: "qual foi o resultado final do GP de Mônaco" },
  { pattern: /\bquem levou a vitoria em monaco\b/, canonical: "quem levou a vitória em Mônaco" },
];

export const PROJECTION_SUPPORTED_CANONICALS: readonly string[] =
  CORE_MATCHERS.map((m) => m.canonical);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function presentIn(name: string, prompt: string): boolean {
  const normalizedName = normalizeTopicText(name).trim();
  if (normalizedName.length === 0) return false;
  return new RegExp(`\\b${escapeRegex(normalizedName)}\\b`).test(prompt);
}

function matchCore(prompt: string): string | null {
  for (const matcher of CORE_MATCHERS) {
    if (matcher.pattern.test(prompt)) return matcher.canonical;
  }
  return null;
}

function buildProjection(core: string, currentSpeaker: string): string {
  return `O usuário pediu uma resposta sobre ${core}. Nesta execução, responda somente como ${currentSpeaker}.`;
}

function hasRecipientsSupport(prompt: string, aiParticipants: readonly string[]): string[] {
  return [...new Set(aiParticipants.filter((name) => presentIn(name, prompt)))];
}

export function projectUserPromptForSpeaker(
  originalPrompt: string,
  currentSpeaker: string,
  aiParticipants: readonly string[],
): UserPromptProjection {
  const normalizedPrompt = normalizeTopicText(originalPrompt);
  const recipients = hasRecipientsSupport(normalizedPrompt, aiParticipants);
  const core = matchCore(normalizedPrompt);

  if (recipients.length === 0 || core === null || !recipients.includes(currentSpeaker)) {
    return {
      status: "UNSUPPORTED",
      projectedPrompt: null,
      recipients,
      core,
    };
  }

  return {
    status: "SUPPORTED",
    projectedPrompt: buildProjection(core, currentSpeaker),
    recipients,
    core,
  };
}