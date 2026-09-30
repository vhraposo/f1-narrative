import { describe, expect, it, vi } from "vitest";

import {
  biographyClaimsFromFacts,
  buildBiographyComposerUserPrompt,
  createLlmBiographyComposer,
  sanitizeComposedBiography,
} from "./biography.composer.js";

describe("biography composer", () => {
  it("1) sanitiza HTML, URLs, markdown e limita tamanho", () => {
    const html =
      "<p>Lando Norris nasceu em Bristol, na Inglaterra, em novembro de 1999, e chegou à Fórmula 1 pela McLaren em 2019.</p><script>alert(1)</script><a href=\"https://x\">link</a>";
    const clean = sanitizeComposedBiography(html);
    expect(clean).not.toBeNull();
    expect(clean).not.toContain("<");
    expect(clean).not.toContain("http");
    expect(clean).not.toContain("script");
  });

  it("2) rejeita textos curtos ou vazios", () => {
    expect(sanitizeComposedBiography("")).toBeNull();
    expect(sanitizeComposedBiography("curto demais")).toBeNull();
    expect(
      sanitizeComposedBiography("```json\n{\"a\":1}\n```"),
    ).toBeNull();
  });

  it("3) monta prompt com apenas os claims fornecidos", () => {
    const prompt = buildBiographyComposerUserPrompt({
      subject: "Lando Norris",
      claims: [{ label: "Nascimento", value: "1999-11-13" }],
    });
    expect(prompt).toContain("Lando Norris");
    expect(prompt).toContain("1999-11-13");
    expect(prompt).toContain("apenas com esses fatos");
  });

  it("4) derivar claims de fatos localiza nacionalidade e estatísticas", () => {
    const claims = biographyClaimsFromFacts({
      fullName: "Lando Norris",
      publicName: "Lando Norris",
      dateOfBirth: new Date("1999-11-13T00:00:00.000Z"),
      placeOfBirth: "Bristol",
      nationality: "British",
      debutYear: 2019,
      teams: ["McLaren"],
      championships: [2025],
      career: {
        wins: 13,
        podiums: 49,
        poles: 19,
        fastestLaps: 20,
        titles: 1,
        starts: 150,
      },
    });
    const byLabel = new Map(claims.map((claim) => [claim.label, claim.value]));
    expect(byLabel.get("Nacionalidade")).toBe("britânica");
    expect(byLabel.get("Local de nascimento")).toBe("Bristol");
    expect(byLabel.get("Títulos mundiais (anos finais)")).toBe("2025");
    expect(byLabel.get("Estatísticas de carreira na F1")).toContain("13 vitórias");
  });

  it("5) composer com provider: usa somente saída gerada e válida", async () => {
    const run = vi.fn(async () => ({
      mode: "generated",
      text: "Lando Norris nasceu em Bristol, na Inglaterra, em novembro de 1999. Desde cedo mostrou talento no kart e chegou à Fórmula 1 em 2019 pela McLaren, tornando-se campeão mundial em 2025.",
    }));
    const composer = createLlmBiographyComposer({ name: "stub", run });
    const text = await composer({ subject: "Lando Norris", claims: [] });
    expect(text).toContain("Bristol");
    expect(run).toHaveBeenCalledOnce();

    const assemblyOnly = createLlmBiographyComposer({
      name: "null",
      run: vi.fn(async () => ({ mode: "assembly-only" })),
    });
    expect(await assemblyOnly({ subject: "X", claims: [] })).toBeNull();
  });
});
