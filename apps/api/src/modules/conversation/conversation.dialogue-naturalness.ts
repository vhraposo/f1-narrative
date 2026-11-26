import type { DialogueEmotionTone } from "./conversation.dialogue-emotion.js";

export type ConversationNaturalnessViolation =
  | "ECHO_OF_INTERLOCUTOR"
  | "STRUCTURAL_LEAKAGE"
  | "EMOJI_DEGENERATION"
  | "ASSISTANT_TONE"
  | "ACTION_CLAIM"
  | "QUESTION_NOT_ALLOWED";

const STRUCTURAL_PATTERNS: readonly RegExp[] = [
  /["']messages["']\s*:/i,
  /```/,
  /^\s*(?:assistant|speaker|character|answer|resposta)\s*:/i,
  /[{}]/,
  /^\s*[\]}]/,
];

const ASSISTANT_PATTERNS: readonly RegExp[] = [
  /estou aqui para (?:ajudar|auxiliar)/i,
  /como (?:posso|podemos) (?:te )?ajudar/i,
  /se precisar(?: de algo)?,? (?:é só|estou)/i,
  /estou à disposição/i,
  /\bquer (?:alguma coisa|algo) (?:para|pra) (?:te )?ajudar\b/i,
  /\bposso ajudar\b/i,
];

const ACTION_CLAIM_PATTERNS: readonly RegExp[] = [
  /\b(?:vou|vamos|devemos|devo|deixa eu)\s+(?:verificar|checar|pesquisar|buscar|consultar|confirmar)\b/i,
  /\b(?:verificar|checar|consultar) (?:o|a|no|na|os|as) (?:sistema|app|site|previsão|agenda|tv)\b/i,
  /\b(?:estou|tô)\s+(?:vendo|olhando|verificando|checando)\s+(?:o|a|no|na)\s+(?:tempo|previsão|internet|sistema|agenda)\b/i,
];

const EMOJI_PATTERN = /(?:\p{Extended_Pictographic})/gu;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalize(value).split(" ").filter((token) => token.length > 2);
}

function longestSharedRun(left: string[], right: string[]): number {
  let best = 0;
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      let run = 0;
      while (
        i + run < left.length &&
        j + run < right.length &&
        left[i + run] === right[j + run]
      ) {
        run += 1;
      }
      if (run > best) best = run;
    }
  }
  return best;
}

export function isEchoOfInterlocutor(
  text: string,
  replyToContent: string | null | undefined,
): boolean {
  if (!replyToContent) return false;
  const replyTokens = tokenize(replyToContent);
  if (replyTokens.length < 6) return false;
  const responseTokens = tokenize(text);
  if (responseTokens.length === 0) return false;
  const run = longestSharedRun(replyTokens, responseTokens);
  const threshold = Math.max(4, Math.ceil(replyTokens.length * 0.6));
  return run >= threshold;
}

export function validateConversationNaturalness(input: {
  readonly text: string;
  readonly replyToContent: string | null | undefined;
  readonly emotionTone: DialogueEmotionTone | null;
  readonly emojiAllowed: boolean;
  readonly questionMode?: "FORBIDDEN" | "OPTIONAL" | "REQUIRED" | null;
}): readonly ConversationNaturalnessViolation[] {
  const violations: ConversationNaturalnessViolation[] = [];
  const text = input.text.trim();
  if (text.length === 0) return violations;

  if (input.questionMode === "FORBIDDEN" && text.includes("?")) {
    violations.push("QUESTION_NOT_ALLOWED");
  }

  if (STRUCTURAL_PATTERNS.some((pattern) => pattern.test(text))) {
    violations.push("STRUCTURAL_LEAKAGE");
  }
  if (ASSISTANT_PATTERNS.some((pattern) => pattern.test(text))) {
    violations.push("ASSISTANT_TONE");
  }
  if (ACTION_CLAIM_PATTERNS.some((pattern) => pattern.test(text))) {
    violations.push("ACTION_CLAIM");
  }
  if (isEchoOfInterlocutor(text, input.replyToContent)) {
    violations.push("ECHO_OF_INTERLOCUTOR");
  }

  const emojis = text.match(EMOJI_PATTERN) ?? [];
  const lowEnergy = input.emotionTone === "SAD" || input.emotionTone === "TENSE";
  if (emojis.length > 0) {
    const withoutEmojis = text.replace(EMOJI_PATTERN, "").replace(/\s+/g, " ").trim();
    if (emojis.length > 3 || withoutEmojis.length === 0 || lowEnergy || !input.emojiAllowed) {
      violations.push("EMOJI_DEGENERATION");
    }
  }
  return violations;
}
