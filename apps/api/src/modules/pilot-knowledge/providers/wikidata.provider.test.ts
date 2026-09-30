import { describe, expect, it } from "vitest";

import {
  WikidataProvider,
  WikidataProviderError,
  buildWikidataDetailsQuery,
  buildWikidataSearchQuery,
  parseWikidataDetails,
  type WikidataFetchLike,
} from "./wikidata.provider.js";

function makeFetch(handler: (body: string) => { status?: number; payload: unknown; raw?: string }): WikidataFetchLike {
  return async (_input, init) => {
    const body = init?.body ?? "";
    const result = handler(body);
    const status = result.status ?? 200;
    const text = result.raw ?? JSON.stringify(result.payload);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    };
  };
}

const DETAILS_PAYLOAD = {
  results: {
    bindings: [
      {
        item: { value: "http://www.wikidata.org/entity/Q9673" },
        itemLabel: { value: "Max Verstappen" },
        dob: { value: "1997-09-30T00:00:00Z" },
        placeLabel: { value: "Hasselt" },
        countryLabel: { value: "Reino dos Países Baixos" },
        number: { value: "33" },
        officialSite: { value: "https://www.verstappen.com" },
        relType: { value: "ROMANTIC_PARTNER" },
        relLabel: { value: "Pessoa A" },
        relPerson: { value: "http://www.wikidata.org/entity/Q100" },
        relStart: { value: "2023-01-01T00:00:00Z" },
      },
      {
        item: { value: "http://www.wikidata.org/entity/Q9673" },
        itemLabel: { value: "Max Verstappen" },
        relType: { value: "ROMANTIC_PARTNER" },
        relLabel: { value: "Pessoa A" },
        relPerson: { value: "http://www.wikidata.org/entity/Q100" },
        relStart: { value: "2023-01-01T00:00:00Z" },
      },
      {
        item: { value: "http://www.wikidata.org/entity/Q9673" },
        relType: { value: "ROMANTIC_PARTNER" },
        relLabel: { value: "Pessoa B" },
        relPerson: { value: "http://www.wikidata.org/entity/Q200" },
        relStart: { value: "2019-01-01T00:00:00Z" },
        relEnd: { value: "2021-01-01T00:00:00Z" },
      },
    ],
  },
};

describe("WikidataProvider", () => {
  it("1) resolve por QID com label, nascimento, país e número", async () => {
    const provider = new WikidataProvider({
      fetchImpl: makeFetch(() => ({ payload: DETAILS_PAYLOAD })),
    });
    const candidates = await provider.resolveDriverIdentity({
      name: "Max Verstappen",
      wikidataQid: "Q9673",
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.externalId).toBe("Q9673");
    expect(candidates[0]?.nationality).toBe("Reino dos Países Baixos");
    expect(candidates[0]?.dateOfBirth?.toISOString().slice(0, 10)).toBe("1997-09-30");
  });

  it("2) resolve por nome via busca SPARQL", async () => {
    const searchPayload = {
      results: {
        bindings: [
          {
            item: { value: "http://www.wikidata.org/entity/Q9673" },
            itemLabel: { value: "Max Verstappen" },
            dob: { value: "1997-09-30T00:00:00Z" },
            countryLabel: { value: "Reino dos Países Baixos" },
          },
        ],
      },
    };
    const provider = new WikidataProvider({ fetchImpl: makeFetch(() => ({ payload: searchPayload })) });
    const candidates = await provider.resolveDriverIdentity({ name: "max verstappen" });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.wikidataQid).toBe("Q9673");
  });

  it("3) perfil estruturado e source CC0 com URL da entidade", async () => {
    const provider = new WikidataProvider({ fetchImpl: makeFetch(() => ({ payload: DETAILS_PAYLOAD })) });
    const result = await provider.fetchStructuredProfile({ externalId: "Q9673", name: "Max Verstappen" });
    expect(result.profile.placeOfBirth).toBe("Hasselt");
    expect(result.profile.officialLinks).toEqual({ website: "https://www.verstappen.com" });
    expect(result.profile.biographyFacts.dateOfBirth?.toISOString().slice(0, 10)).toBe("1997-09-30");
    expect(result.source.provider).toBe("WIKIDATA");
    expect(result.source.license).toBe("CC0");
    expect(result.source.url).toBe("https://www.wikidata.org/wiki/Q9673");
  });

  it("4) relacionamentos com validade temporal e dedupe", async () => {
    const provider = new WikidataProvider({ fetchImpl: makeFetch(() => ({ payload: DETAILS_PAYLOAD })) });
    const relationships = await provider.fetchRelationships({ externalId: "Q9673", name: "Max Verstappen" });
    expect(relationships).toHaveLength(2);
    expect(relationships[0]?.displayName).toBe("Pessoa A");
    expect(relationships[0]?.state).toBe("ACTIVE");
    expect(relationships[0]?.validFrom?.toISOString().slice(0, 10)).toBe("2023-01-01");
    expect(relationships[0]?.targetType).toBe("PUBLIC_PERSON");
    expect(relationships[0]?.targetWikidataQid).toBe("Q100");
    expect(relationships[1]?.state).toBe("ENDED");
    expect(relationships[1]?.validTo?.toISOString().slice(0, 10)).toBe("2021-01-01");
  });

  it("5) erros sanitizados: HTTP, malformed e rede", async () => {
    const http = new WikidataProvider({ fetchImpl: makeFetch(() => ({ status: 429, payload: {} })) });
    await expect(http.resolveDriverIdentity({ name: "x", wikidataQid: "Q1" })).rejects.toMatchObject({
      code: "HTTP",
    });

    const malformed = new WikidataProvider({ fetchImpl: makeFetch(() => ({ payload: {}, raw: "{oops" })) });
    await expect(malformed.resolveDriverIdentity({ name: "x", wikidataQid: "Q1" })).rejects.toMatchObject({
      code: "MALFORMED",
    });

    const network = new WikidataProvider({
      fetchImpl: async () => {
        throw new Error("socket");
      },
    });
    await expect(network.resolveDriverIdentity({ name: "x", wikidataQid: "Q1" })).rejects.toMatchObject({
      code: "NETWORK",
    });
    expect(new WikidataProviderError("HTTP", "msg").message).toBe("msg");
  });

  it("6) career data não é inventada pela Wikidata", async () => {
    const provider = new WikidataProvider({ fetchImpl: makeFetch(() => ({ payload: DETAILS_PAYLOAD })) });
    const career = await provider.fetchCareerData({ externalId: "Q9673", name: "Max Verstappen" });
    expect(career.seasons).toEqual([]);
    expect(career.championships).toEqual([]);
  });

  it("7) queries SPARQL usam propriedades oficiais e sanitizam entrada", () => {
    expect(buildWikidataSearchQuery('Max "injection"')).not.toContain('"injection"');
    expect(buildWikidataDetailsQuery("Q9673; DROP")).toContain("wd:Q9673");
    expect(buildWikidataDetailsQuery("Q9673; DROP")).not.toContain("DROP");
  });

  it("8) parser é tolerante a resposta vazia", () => {
    const parsed = parseWikidataDetails({});
    expect(parsed.qid).toBeNull();
    expect(parsed.relationships).toEqual([]);
    expect(parsed.dateOfBirth).toBeNull();
  });
});
