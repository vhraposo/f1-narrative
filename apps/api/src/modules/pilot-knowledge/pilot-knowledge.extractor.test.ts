import { describe, expect, it } from "vitest";

import type { GenerationProvider } from "../generation/generation.assembly.js";
import {
  EXTRACTION_SYSTEM_PROMPT,
  createProviderPilotPersonaExtractor,
  emptyPilotPersonaExtractor,
  parseExtractionResponse,
} from "./pilot-knowledge.extractor.js";

function stubProvider(text: string, mode: "generated" | "assembly-only" = "generated"): GenerationProvider {
  return {
    name: "stub",
    async run() {
      return {
        mode,
        ...(mode === "generated" ? { text } : {}),
        tokenStats: { systemPromptChars: 1, contextBlocks: 0 },
      } as never;
    },
  };
}

describe("pilot persona extractor", () => {
  it("1) parseia JSON válido mesmo cercado de texto", () => {
    const result = parseExtractionResponse(
      'Segue a extração:\n{"status":"SUPPORTED","claims":[{"traitKey":"humorStyle","proposedValue":"humor seco","sourceKind":"OBSERVED_PUBLIC_BEHAVIOR","evidenceType":"TEAM_PROFILE","confidence":0.7,"summary":"perfil oficial descreve humor seco"}]}\nFim.',
    );
    expect(result.status).toBe("SUPPORTED");
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.traitKey).toBe("humorStyle");
  });

  it("2) JSON inválido ou fora do schema não é aceito", () => {
    expect(() => parseExtractionResponse("sem json aqui")).toThrow(/JSON/);
    expect(() =>
      parseExtractionResponse('{"status":"MAYBE","claims":[]}'),
    ).toThrow();
    expect(() =>
      parseExtractionResponse('{"status":"SUPPORTED","claims":[{"traitKey":"x"}]}'),
    ).toThrow();
  });

  it("3) extractor provider-backed usa o provider e valida a saída", async () => {
    const extractor = createProviderPilotPersonaExtractor(
      stubProvider(
        '{"status":"UNCERTAIN","claims":[{"traitKey":"hobbies","proposedValue":"ciclismo","sourceKind":"INFERRED","evidenceType":"STRUCTURED_DATA","confidence":null,"summary":"indício de ciclismo"}]}',
      ),
    );
    const result = await extractor.extract({
      driverName: "Piloto",
      sourceTitle: "Fonte",
      sourceText: "conteúdo transitório",
      evidenceType: "STRUCTURED_DATA",
    });
    expect(result.status).toBe("UNCERTAIN");
    expect(result.claims[0]?.confidence).toBeNull();

    const unsupported = createProviderPilotPersonaExtractor(stubProvider("", "assembly-only"));
    await expect(
      unsupported.extract({
        driverName: "Piloto",
        sourceTitle: "Fonte",
        sourceText: "x",
        evidenceType: "STRUCTURED_DATA",
      }),
    ).rejects.toThrow(/Extração indisponível/);
  });

  it("4) prompt de extração proíbe invenção e cópia", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("extraindo claims públicos");
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("não invente");
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("síntese original");
    expect(EXTRACTION_SYSTEM_PROMPT).not.toContain("personalidade desse piloto");
  });

  it("5) extractor vazio retorna UNSUPPORTED sem claims", async () => {
    const result = await emptyPilotPersonaExtractor.extract({
      driverName: "Piloto",
      sourceTitle: "Fonte",
      sourceText: "x",
      evidenceType: "STRUCTURED_DATA",
    });
    expect(result).toEqual({ status: "UNSUPPORTED", claims: [] });
  });
});
