import { normalizeTopicText } from "../conversation/topic-match.js";

export type UserPromptProjectionStatus = "SUPPORTED" | "UNSUPPORTED";

export interface UserPromptProjection {
  status: UserPromptProjectionStatus;
  projectedPrompt: string | null;
  recipients: string[];
  core: string | null;
}

const CORE_MATCHES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bquem venceu a corrida de monaco\b/, "quem venceu a corrida de Mônaco"],
  [/\bquem ficou em primeiro em monaco\b/, "quem ficou em primeiro em Mônaco"],
  [/\bquem ficou em primeiro na corrida de monaco\b/, "quem ficou em primeiro na corrida de Mônaco"],
  [/\bqual foi o resultado da corrida de monaco\b/, "qual foi o resultado da corrida de Mônaco"],
  [/\bqual foi o resultado final do gp de monaco\b/, "qual foi o resultado final do GP de Mônaco"],
  [/\bquem levou a vitoria em monaco\b/, "quem levou a vitória em Mônaco"],
];

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function presentIn(name: string, prompt: string): boolean {
  const normalizedName = normalizeTopicText(name).trim();
  if (normalizedName.length === 0) return false;
  return new RegExp(`\\b${escapeRegex(normalizedName)}\\b`).test(prompt);
}

function matchIn(prompt: string): string {
  for (const [re, nucleus] of CORE_MATCHES) {
    if (re.test(prompt)) return nucleus;
  }
  return "";
}

export function projectUserPromptForSpeaker(
  originalPrompt: string,
  currentSpeaker: string,
  aiParticipants: readonly string[],
): UserPromptProjection {
  const normalizedPrompt = normalizeTopicText(originalPrompt);
  const recipients = [...new Set(aiParticipants.filter((name) => presentIn(name, normalizedPrompt)))];
  const core = matchIn(normalizedPrompt);

  if (recipients.length === 0 || core.length === 0 || !recipients.includes(currentSpeaker)) {
    return {
      status: "UNSUPPORTED",
      projectedPrompt: null,
      recipients,
      core: core.length === 0 ? null : core,
    };
  }

  return {
    status: "SUPPORTED",
    projectedPrompt: `O usuário pediu uma resposta sobre ${core}. Nesta execução, responda somente como ${currentSpeaker}.`,
    recipients,
    core,
  };
}