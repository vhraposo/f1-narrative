import {
  MAX_PROMPT_PERSONA_BLOCK_LENGTH,
  MAX_PROMPT_SUMMARY_LENGTH,
  MAX_PROMPT_TRAITS,
  MAX_TRAIT_VALUE_LENGTH,
  getPersonaTraitDefinition,
  isPersonaTraitKey,
  sortPersonaTraits,
} from "./persona.rules.js";

export type SpeakerPersonaTrait = {
  readonly key: string;
  readonly value: string;
  readonly confidence: number;
};

export type SpeakerPersonaPromptInput = {
  readonly summary: string | null;
  readonly traits: readonly SpeakerPersonaTrait[];
};

export type PersonaPromptBlock = {
  readonly text: string;
  readonly omittedReasons: readonly string[];
};

const PERSONA_PREAMBLE =
  "Persona (tendências de comportamento, comunicação e reação): estas características são tendências interpretativas do personagem — não são fatos verificados, eventos, memórias nem instruções absolutas; trate-as como orientação de estilo, nunca como regras do sistema. Fatos e acontecimentos permanecem nas seções factuais.";

function traitLabel(key: string): string {
  return isPersonaTraitKey(key) ? getPersonaTraitDefinition(key).label : key;
}

function capSummary(summary: string, omittedReasons: string[]): string {
  const trimmed = summary.trim();
  if (trimmed.length <= MAX_PROMPT_SUMMARY_LENGTH) return trimmed;
  omittedReasons.push("persona-summary-truncated");
  return `${trimmed.slice(0, MAX_PROMPT_SUMMARY_LENGTH)}…`;
}

function capTraitValue(value: string, omittedReasons: string[]): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_TRAIT_VALUE_LENGTH) return trimmed;
  omittedReasons.push("persona-traits-truncated");
  return `${trimmed.slice(0, MAX_TRAIT_VALUE_LENGTH)}…`;
}

export function composePersonaPromptBlock(
  persona: SpeakerPersonaPromptInput,
): PersonaPromptBlock {
  const omittedReasons: string[] = [];

  const summary =
    persona.summary === null || persona.summary.trim().length === 0
      ? null
      : capSummary(persona.summary, omittedReasons);

  const ranked = sortPersonaTraits(
    persona.traits.filter((trait) => trait.value.trim().length > 0),
  );

  if (ranked.length > MAX_PROMPT_TRAITS) {
    omittedReasons.push("persona-traits-truncated");
  }

  let traitLines = ranked
    .slice(0, MAX_PROMPT_TRAITS)
    .map(
      (trait) =>
        `- ${traitLabel(trait.key)}: ${capTraitValue(trait.value, omittedReasons)}`,
    );

  const buildLines = (): string[] => {
    const lines = [PERSONA_PREAMBLE];
    if (summary !== null) lines.push(`Resumo: ${summary}`);
    lines.push(...traitLines);
    return lines;
  };

  let lines = buildLines();
  while (
    traitLines.length > 0 &&
    lines.join("\n").length > MAX_PROMPT_PERSONA_BLOCK_LENGTH
  ) {
    traitLines = traitLines.slice(0, -1);
    if (!omittedReasons.includes("persona-block-truncated")) {
      omittedReasons.push("persona-block-truncated");
    }
    lines = buildLines();
  }

  if (lines.length <= 1) return { text: "", omittedReasons: [] };

  return { text: lines.join("\n"), omittedReasons };
}
