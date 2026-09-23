import { describe, expect, it } from "vitest";
import {
  PROJECTION_SUPPORTED_CANONICALS,
  projectUserPromptForSpeaker,
} from "./user-prompt-projection.js";

const PROJ = (
  prompt: string,
  speaker: string,
  participants: readonly string[] = ["Luca", "Mia"],
) => projectUserPromptForSpeaker(prompt, speaker, participants);

describe("projectUserPromptForSpeaker — SUPPORTED (109Q-10)", () => {
  it("F1) quem venceu a corrida de Mônaco → SUPPORTED; recipient + core corretos", () => {
    const r = PROJ("Quem venceu a corrida de Mônaco? Respondam Luca e Mia.", "Luca");
    expect(r.status).toBe("SUPPORTED");
    expect(r.recipients).toEqual(["Luca", "Mia"]);
    expect(r.core).toBe("quem venceu a corrida de Mônaco");
  });

  it("F2) quem ficou em primeiro na corrida de Mônaco → SUPPORTED; core específico", () => {
    const r = PROJ(
      "Respondam Luca e Mia à seguinte pergunta: quem ficou em primeiro na corrida de Mônaco?",
      "Luca",
    );
    expect(r.status).toBe("SUPPORTED");
    expect(r.recipients).toEqual(["Luca", "Mia"]);
    expect(r.core).toBe("quem ficou em primeiro na corrida de Mônaco");
  });

  it("F3) qual foi o resultado da corrida de Mônaco → SUPPORTED", () => {
    const r = PROJ("Luca e Mia, quero ouvir de vocês: qual foi o resultado da corrida de Mônaco?", "Luca");
    expect(r.status).toBe("SUPPORTED");
    expect(r.core).toBe("qual foi o resultado da corrida de Mônaco");
  });

  it("F4) quem ficou em primeiro em Mônaco → SUPPORTED; core específico", () => {
    const r = PROJ("Luca e Mia, cada um me diga quem ficou em primeiro em Mônaco.", "Luca");
    expect(r.status).toBe("SUPPORTED");
    expect(r.recipients).toEqual(["Luca", "Mia"]);
    expect(r.core).toBe("quem ficou em primeiro em Mônaco");
  });

  it("F5) qual foi o resultado final do GP de Mônaco → SUPPORTED", () => {
    const r = PROJ("Luca e Mia, qual foi o resultado final do GP de Mônaco?", "Luca");
    expect(r.status).toBe("SUPPORTED");
    expect(r.core).toBe("qual foi o resultado final do GP de Mônaco");
  });

  it("F6) quem levou a vitória em Mônaco → SUPPORTED", () => {
    const r = PROJ("Luca e Mia, quem levou a vitória em Mônaco?", "Luca");
    expect(r.status).toBe("SUPPORTED");
    expect(r.core).toBe("quem levou a vitória em Mônaco");
  });

  it("projeção é específica por speaker (nunca igual entre dois speakers)", () => {
    const l = PROJ("Quem venceu a corrida de Mônaco? Respondam Luca e Mia.", "Luca");
    const m = PROJ("Quem venceu a corrida de Mônaco? Respondam Luca e Mia.", "Mia");
    expect(l.status).toBe("SUPPORTED");
    expect(m.status).toBe("SUPPORTED");
    expect(l.projectedPrompt).toContain("responda somente como Luca.");
    expect(m.projectedPrompt).toContain("responda somente como Mia.");
    expect(l.projectedPrompt).not.toBe(m.projectedPrompt);
    expect(l.projectedPrompt).not.toContain("Mia");
    expect(m.projectedPrompt).not.toContain("Luca");
  });

  it("projeção preserva o núcleo reconhecido (Mônaco)", () => {
    const r = PROJ("Quem venceu a corrida de Mônaco? Respondam Luca e Mia.", "Luca");
    expect(r.projectedPrompt).toBe(
      "O usuário pediu uma resposta sobre quem venceu a corrida de Mônaco. Nesta execução, responda somente como Luca.",
    );
  });

  it("Luca + Mia + Noah → três recipients e projeção por speaker", () => {
    const participants = ["Luca", "Mia", "Noah"];
    const prompt =
      "Luca, Mia e Noah, quem venceu a corrida de Mônaco? Respondam!";
    for (const speaker of participants) {
      const r = projectUserPromptForSpeaker(prompt, speaker, participants);
      expect(r.status).toBe("SUPPORTED");
      expect(r.recipients).toEqual(participants);
      expect(r.core).toBe("quem venceu a corrida de Mônaco");
      expect(r.projectedPrompt).toContain(`responda somente como ${speaker}.`);
    }
  });

  it("suporta variações de capitalização e pontuação final", () => {
    const r = PROJ("luca e mia, QUEM VENCEU A CORRIDA DE MÔNACO?", "Luca");
    expect(r.status).toBe("SUPPORTED");
    expect(r.core).toBe("quem venceu a corrida de Mônaco");
  });

  it("suporta pequenas diferenças de acentuação (base normaliza)", () => {
    const r = PROJ("Luca e Mia, quem venceu a corrida de Monaco?", "Luca");
    expect(r.status).toBe("SUPPORTED");
    expect(r.core).toBe("quem venceu a corrida de Mônaco");
  });

  it("SUPPORTED exige que o speaker atual esteja entre os recipients", () => {
    const r = PROJ("Mia, quem venceu a corrida de Mônaco?", "Luca", ["Luca", "Mia"]);
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.projectedPrompt).toBeNull();
  });
});

describe("projectUserPromptForSpeaker — UNSUPPORTED (109Q-10)", () => {
  const unsupported: ReadonlyArray<{ id: string; prompt: string }> = [
    { id: "F7", prompt: "Vocês dois, respondam cada um quem venceu a corrida de Mônaco." },
    { id: "F8", prompt: "Os dois pilotos da QA Racing, qual é a resposta de vocês sobre o vencedor de Mônaco?" },
    { id: "F9", prompt: "Luca e Mia, vocês dois, quero ouvir a opinião de cada um sobre o vencedor." },
    { id: "F10", prompt: "E vocês, qual foi a resposta?" },
    { id: "F11", prompt: "Cada um, sua resposta sobre o vencedor." },
    { id: "F12", prompt: "Quero a resposta de vocês dois sobre Mônaco." },
    { id: "X1", prompt: "Luca, quem ganhou?" },
    { id: "X2", prompt: "Mia, qual foi o vencedor de Mônaco?" },
    { id: "X3", prompt: "Luca, quem terminou em primeiro em Mônaco?" },
    { id: "X4", prompt: "Mia, me diga o resultado de Mônaco." },
    { id: "X5", prompt: "Luca e Mia, quem venceu em Interlagos?" },
  ];

  for (const { id, prompt } of unsupported) {
    it(`${id}) UNSUPPORTED preserves original input`, () => {
      const r = PROJ(prompt, "Luca");
      expect(r.status).toBe("UNSUPPORTED");
      expect(r.projectedPrompt).toBeNull();
    });
  }

  it("não aceita destinatários ausentes do roster AI participante", () => {
    const r = projectUserPromptForSpeaker(
      "Quem venceu a corrida de Mônaco? Respondam Carlos.",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.recipients).toEqual([]);
    expect(r.projectedPrompt).toBeNull();
  });

  it("não interpreta 'vocês dois' como destinatário", () => {
    const r = PROJ("Vocês dois, quem venceu a corrida de Mônaco?", "Luca");
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.recipients).toEqual([]);
    expect(r.projectedPrompt).toBeNull();
  });

  it("não interpreta indireção por equipe como destinatário", () => {
    const r = PROJ("Os dois pilotos da QA Racing, quem venceu a corrida de Mônaco?", "Luca");
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.recipients).toEqual([]);
    expect(r.projectedPrompt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// STEP 109Q-13 — estrutura data-driven (sem ampliar comportamento).
//   S1 ordem dos recipients reflete a lista de participantes (nenhum reordena);
//   S2 speaker atual dentro dos recipients → SUPPORTED;
//   S3 speaker atual fora dos recipients → UNSUPPORTED;
//   S4 projeção por speaker nunca duplicada e específica;
//   S5 case/accents/punctuation não quebram a detecção;
//   S6 originalPrompt jamais é mutado pela projeção;
//   S7 2 AI → apenas os nomeados são recipients;
//   S8 3 AI → apenas os nomeados são recipients.
// ---------------------------------------------------------------------------

describe("STEP 109Q-13 — estrutura data-driven", () => {
  it("S1) ordem dos recipients preserva a ordem dos participantes", () => {
    const r = projectUserPromptForSpeaker(
      "Noah, Mia e Luca, quem venceu a corrida de Mônaco?",
      "Luca",
      ["Luca", "Mia", "Noah"],
    );
    expect(r.status).toBe("SUPPORTED");
    expect(r.recipients).toEqual(["Luca", "Mia", "Noah"]);
  });

  it("S2) speaker atual dentro dos recipients → SUPPORTED", () => {
    const r = projectUserPromptForSpeaker(
      "Luca e Mia, quem venceu a corrida de Mônaco?",
      "Mia",
      ["Luca", "Mia", "Noah"],
    );
    expect(r.status).toBe("SUPPORTED");
    expect(r.recipients).toEqual(["Luca", "Mia"]);
  });

  it("S3) speaker atual fora dos recipients → UNSUPPORTED", () => {
    const r = projectUserPromptForSpeaker(
      "Luca, quem venceu a corrida de Mônaco?",
      "Mia",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.projectedPrompt).toBeNull();
  });

  it("S4) projeção específica por speaker e sem duplicação", () => {
    const l = projectUserPromptForSpeaker(
      "Luca e Mia, quem venceu a corrida de Mônaco?",
      "Luca",
      ["Luca", "Mia"],
    );
    const m = projectUserPromptForSpeaker(
      "Luca e Mia, quem venceu a corrida de Mônaco?",
      "Mia",
      ["Luca", "Mia"],
    );
    expect(l.projectedPrompt).not.toBe(m.projectedPrompt);
    expect(l.projectedPrompt).toContain("responda somente como Luca.");
    expect(m.projectedPrompt).toContain("responda somente como Mia.");
  });

  it("S5) case, acentos e pontuação não alteram a detecção", () => {
    const r = projectUserPromptForSpeaker(
      "  luca  &  mía, QUEM  VENCEU  A  CORRIDA  DE  MONACO!!!  ",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("SUPPORTED");
    expect(r.core).toBe("quem venceu a corrida de Mônaco");
    expect(r.recipients).toEqual(["Luca", "Mia"]);
  });

  it("S6) originalPrompt não é mutado pela projeção", () => {
    const original = "Luca e Mia, quem venceu a corrida de Mônaco?";
    const snapshot = original;
    projectUserPromptForSpeaker(original, "Luca", ["Luca", "Mia"]);
    expect(original).toBe(snapshot);
  });

  it("S7) 2 AI → apenas os nomeados viram recipients", () => {
    const r = projectUserPromptForSpeaker(
      "Luca, quem venceu a corrida de Mônaco?",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.recipients).toEqual(["Luca"]);
    expect(r.status).toBe("SUPPORTED");
  });

  it("S8) 3 AI → apenas os nomeados viram recipients", () => {
    const r = projectUserPromptForSpeaker(
      "Luca e Mia, quem venceu a corrida de Mônaco?",
      "Luca",
      ["Luca", "Mia", "Noah"],
    );
    expect(r.status).toBe("SUPPORTED");
    expect(r.recipients).toEqual(["Luca", "Mia"]);
  });
});

// ---------------------------------------------------------------------------
// STEP 109Q-14 — expansão conservadora de cobertura.
//   T1 "primeiro lugar" → canônico "em primeiro" (equivalente claro);
//   T2 "resultado do GP" sem "final" → canônico "resultado final do GP".
//   T3..T6 variações já cobertas por normalização (ordem/pontuação/case/acentos).
//   T7..T10 anti-falsos-positivos permanecem UNSUPPORTED.
// ---------------------------------------------------------------------------

describe("STEP 109Q-14 — expansão conservadora de cobertura", () => {
  it("T1) 'quem ficou em primeiro lugar' -> canônico 'em primeiro'", () => {
    const r = projectUserPromptForSpeaker(
      "Luca e Mia, quem ficou em primeiro lugar em Mônaco?",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("SUPPORTED");
    expect(r.core).toBe("quem ficou em primeiro em Mônaco");
    expect(r.recipients).toEqual(["Luca", "Mia"]);
  });

  it("T2) 'qual foi o resultado do GP' sem 'final' -> canônico 'resultado final'", () => {
    const r = projectUserPromptForSpeaker(
      "Luca e Mia, qual foi o resultado do GP de Mônaco?",
      "Mia",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("SUPPORTED");
    expect(r.core).toBe("qual foi o resultado final do GP de Mônaco");
    expect(r.recipients).toEqual(["Luca", "Mia"]);
  });

  it("T3) ordem invertida já era coberta -> SUPPORTED", () => {
    const r = projectUserPromptForSpeaker(
      "Quem venceu a corrida de Mônaco, Luca e Mia?",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("SUPPORTED");
  });

  it("T4) pontuação intermediária já era coberta -> SUPPORTED", () => {
    const r = projectUserPromptForSpeaker(
      "Luca, quem venceu a corrida de Mônaco, Mia?",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("SUPPORTED");
    expect(r.recipients).toEqual(["Luca", "Mia"]);
  });

  it("T5) capitalização e acentos extremos já eram cobertos -> SUPPORTED", () => {
    const r = projectUserPromptForSpeaker(
      "LUCA E MIA, QUEM VENCEU A CORRIDA DE MONACO?",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("SUPPORTED");
    expect(r.core).toBe("quem venceu a corrida de Mônaco");
  });

  it("T6) separadores de ponto já eram cobertos -> SUPPORTED", () => {
    const r = projectUserPromptForSpeaker(
      "Luca. Quem venceu a corrida de Mônaco? Mia.",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("SUPPORTED");
    expect(r.recipients).toEqual(["Luca", "Mia"]);
  });

  it("T7) anti-falso-positivo: 'primeiro lugar' em outro local -> UNSUPPORTED", () => {
    const r = projectUserPromptForSpeaker(
      "Luca e Mia, quem ficou em primeiro lugar em Ímola?",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.projectedPrompt).toBeNull();
  });

  it("T8) anti-falso-positivo: outro ordinal não deve casar 'primeiro'", () => {
    const r = projectUserPromptForSpeaker(
      "Luca e Mia, quem ficou em terceiro lugar em Mônaco?",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.projectedPrompt).toBeNull();
  });

  it("T9) anti-falso-positivo: 'ganhou' continua UNSUPPORTED", () => {
    const r = projectUserPromptForSpeaker(
      "Luca e Mia, quem ganhou a corrida de Mônaco?",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.projectedPrompt).toBeNull();
  });

  it("T10) anti-falso-positivo: 'quem foi o vencedor' continua UNSUPPORTED", () => {
    const r = projectUserPromptForSpeaker(
      "Luca e Mia, quem foi o vencedor da corrida de Mônaco?",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.projectedPrompt).toBeNull();
  });

it("T11) anti-falso-positivo: referência indireta 'vocês dois' -> UNSUPPORTED", () => {
    const r = PROJ(
      "Vocês dois, quem venceu a corrida de Mônaco?",
      "Luca",
      ["Luca", "Mia"],
    );
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.recipients).toEqual([]);
    expect(r.projectedPrompt).toBeNull();
  });
});

describe("STEP 109Q-19 — decisão de cobertura (fronteira explícita)", () => {
  it("Q1) fronteira de canônicos é exatamente o conjunto data-driven atual (8 cores)", () => {
    expect(PROJECTION_SUPPORTED_CANONICALS).toEqual([
      "quem venceu a corrida de Mônaco",
      "quem ficou em primeiro em Mônaco",
      "quem ficou em primeiro em Mônaco",
      "quem ficou em primeiro na corrida de Mônaco",
      "qual foi o resultado da corrida de Mônaco",
      "qual foi o resultado final do GP de Mônaco",
      "qual foi o resultado final do GP de Mônaco",
      "quem levou a vitória em Mônaco",
    ]);
  });

  const suportedFamilies: ReadonlyArray<{ core: string; prompt: () => string }> = [
    {
      core: "quem venceu a corrida de Mônaco",
      prompt: () => "Luca e Mia, quem venceu a corrida de Mônaco?",
    },
    {
      core: "quem ficou em primeiro em Mônaco",
      prompt: () => "Luca e Mia, quem ficou em primeiro lugar em Mônaco?",
    },
    {
      core: "quem ficou em primeiro em Mônaco",
      prompt: () => "Luca e Mia, quem ficou em primeiro em Mônaco?",
    },
    {
      core: "quem ficou em primeiro na corrida de Mônaco",
      prompt: () => "Luca e Mia, quem ficou em primeiro na corrida de Mônaco?",
    },
    {
      core: "qual foi o resultado da corrida de Mônaco",
      prompt: () => "Luca e Mia, qual foi o resultado da corrida de Mônaco?",
    },
    {
      core: "qual foi o resultado final do GP de Mônaco",
      prompt: () => "Luca e Mia, qual foi o resultado do GP de Mônaco?",
    },
    {
      core: "qual foi o resultado final do GP de Mônaco",
      prompt: () => "Luca e Mia, qual foi o resultado final do GP de Mônaco?",
    },
    {
      core: "quem levou a vitória em Mônaco",
      prompt: () => "Luca e Mia, quem levou a vitória em Mônaco?",
    },
  ];

  for (const { core, prompt } of suportedFamilies) {
    it(`Q2) núcleo '${core}' → SUPPORTED com recipientes preservados`, () => {
      const r = PROJ(prompt(), "Luca");
      expect(r.status).toBe("SUPPORTED");
      expect(r.core).toBe(core);
      expect(r.recipients).toEqual(["Luca", "Mia"]);
      expect(r.projectedPrompt).toBe(
        `O usuário pediu uma resposta sobre ${core}. Nesta execução, responda somente como Luca.`,
      );
    });
  }

  const antiFalsos: ReadonlyArray<{ id: string; prompt: string }> = [
    { id: "X6", prompt: "Luca e Mia, quem ganhou a corrida de Mônaco?" },
    { id: "X7", prompt: "Luca e Mia, quem foi o vencedor da corrida de Mônaco?" },
    { id: "X8", prompt: "Luca e Mia, quem venceu em Interlagos?" },
    { id: "X9", prompt: "Luca e Mia, quem levou a vitória em Ímola?" },
    { id: "X10", prompt: "Luca e Mia, qual foi o resultado do GP de Ímola?" },
    { id: "X11", prompt: "Luca e Mia, quem ficou em terceiro em Mônaco?" },
    { id: "X12", prompt: "Luca e Mia, quem ficou em segundo na corrida de Mônaco?" },
  ];

  for (const { id, prompt } of antiFalsos) {
    it(`Q3) ${id}) fora da fronteira → UNSUPPORTED preservando original`, () => {
      const r = PROJ(prompt, "Luca");
      expect(r.status).toBe("UNSUPPORTED");
      expect(r.projectedPrompt).toBeNull();
    });
  }

  it("Q4) cada canônico da fronteira tem ao menos um recipiente e projeção direta por speaker", () => {
    for (const core of PROJECTION_SUPPORTED_CANONICALS) {
      const r = projectUserPromptForSpeaker(
        `Luca e Mia, ${core}?`,
        "Luca",
        ["Luca", "Mia"],
      );
      expect(r.status).toBe("SUPPORTED");
      expect(r.core).toBe(core);
    }
  });
});