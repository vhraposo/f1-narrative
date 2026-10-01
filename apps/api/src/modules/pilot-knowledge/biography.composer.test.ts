import { describe, expect, it } from "vitest";

import { buildApprovedBiographyClaims } from "./biography.claims.js";
import {
  BIOGRAPHY_COMPOSER_VERSION,
  buildBiographyComposerUserPrompt,
  composerOutputToText,
  createLlmBiographyComposer,
  parseComposerOutput,
  sanitizeComposedBiography,
} from "./biography.composer.js";

const CLAIM_SET = buildApprovedBiographyClaims({
  externalDriverId: "ext-1",
  f1dbDriver: null,
  f1dbAmbiguous: false,
  f1dbSourceVersion: "v2026.15.1",
  facts: {
    fullName: "Piloto Teste",
    publicName: "Piloto Teste",
    dateOfBirth: new Date("1997-09-30T00:00:00.000Z"),
    nationality: "Dutch",
  },
});
const KNOWN_IDS = new Set(CLAIM_SET.claims.map((claim) => claim.id));

const PARAGRAPH_PAYLOAD = {
  language: "pt-BR",
  paragraphs: [
    {
      sentences: [
        { text: "Piloto Teste nasceu em 30 de setembro de 1997.", claimIds: ["CLAIM-001"] },
        { text: "Tem nacionalidade neerlandesa.", claimIds: ["CLAIM-002"] },
      ],
    },
  ],
};

describe("biography composer v3", () => {
  it("1) prompt usa somente claims com IDs estáveis e parágrafos planejados", () => {
    const prompt = buildBiographyComposerUserPrompt(CLAIM_SET);
    expect(prompt).toContain("Piloto Teste");
    expect(prompt).toContain("CLAIM-001");
    expect(prompt).toContain("PARÁGRAFO 1");
    expect(prompt).toContain("formato JSON exigido");
  });

  it("2) parse aceita JSON de parágrafos e rejeita formatos inválidos", () => {
    const parsed = parseComposerOutput(JSON.stringify(PARAGRAPH_PAYLOAD), KNOWN_IDS);
    expect(parsed).not.toBeNull();
    expect(composerOutputToText(parsed!)).toContain("nasceu");

    expect(parseComposerOutput("texto livre", KNOWN_IDS)).toBeNull();
    expect(
      parseComposerOutput(
        JSON.stringify({ ...PARAGRAPH_PAYLOAD, language: "en" }),
        KNOWN_IDS,
      ),
    ).toBeNull();
    expect(
      parseComposerOutput(
        JSON.stringify({
          language: "pt-BR",
          paragraphs: [
            {
              sentences: [
                { text: "Frase válida de teste com tamanho adequado.", claimIds: ["CLAIM-999"] },
              ],
            },
          ],
        }),
        KNOWN_IDS,
      ),
    ).toBeNull();
    expect(
      parseComposerOutput(
        JSON.stringify({
          language: "pt-BR",
          paragraphs: [{ sentences: [{ text: "curta", claimIds: ["CLAIM-001"] }] }],
        }),
        KNOWN_IDS,
      ),
    ).toBeNull();
    expect(
      parseComposerOutput(
        JSON.stringify({
          language: "pt-BR",
          paragraphs: Array.from({ length: 9 }, () => PARAGRAPH_PAYLOAD.paragraphs[0]),
        }),
        KNOWN_IDS,
      ),
    ).toBeNull();
  });

  it("3) composer com provider usa o contrato estruturado", async () => {
    const provider = {
      name: "stub",
      run: async () => ({
        mode: "generated",
        text: JSON.stringify(PARAGRAPH_PAYLOAD),
      }),
    };
    const composer = createLlmBiographyComposer(provider as never);
    const text = await composer({ claimSet: CLAIM_SET });
    expect(text).toContain("Piloto Teste");
    expect(BIOGRAPHY_COMPOSER_VERSION).toBe("biography-composer.v3");

    const assembly = createLlmBiographyComposer({
      name: "null",
      run: async () => ({ mode: "assembly-only" }),
    } as never);
    expect(await assembly({ claimSet: CLAIM_SET })).toBeNull();
  });

  it("4) sanitize continua syntax-level apenas para emergências", () => {
    const html = "<p>Texto longo o suficiente para passar do mínimo e ser utilizado como fallback de emergência.</p><script>x</script>";
    const clean = sanitizeComposedBiography(html);
    expect(clean).not.toBeNull();
    expect(clean).not.toContain("<");
  });
});
