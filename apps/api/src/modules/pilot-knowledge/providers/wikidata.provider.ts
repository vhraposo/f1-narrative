import type {
  DriverIdentityQuery,
  ExternalDriverKnowledgeProvider,
  ProviderCareerData,
  ProviderIdentityCandidate,
  ProviderProfileResult,
  ProviderRelationship,
  ProviderRelationship as ProviderRelationshipType,
  ProviderSourceReference,
} from "./provider.types.js";

export type WikidataBindingValue = { readonly value: string };
export type WikidataBinding = Record<string, WikidataBindingValue | undefined>;
export type WikidataSparqlResponse = {
  readonly results?: { readonly bindings?: readonly WikidataBinding[] };
};

export type WikidataFetchLike = (
  input: string,
  init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string },
) => Promise<{ readonly ok: boolean; readonly status: number; readonly text: () => Promise<string> }>;

export class WikidataProviderError extends Error {
  constructor(
    public readonly code: "HTTP" | "MALFORMED" | "NETWORK",
    message: string,
  ) {
    super(message);
    this.name = "WikidataProviderError";
  }
}

export function buildWikidataSearchQuery(name: string): string {
  const safe = name.replace(/["\\]/g, " ").trim();
  return [
    "SELECT ?item ?itemLabel ?dob ?countryLabel ?number WHERE {",
    "  ?item wdt:P106 wd:Q10843402;",
    '        rdfs:label ?label . FILTER(LANG(?label) = "en")',
    `  FILTER(CONTAINS(LCASE(?label), LCASE("${safe}")))`,
    "  OPTIONAL { ?item wdt:P569 ?dob . }",
    "  OPTIONAL { ?item wdt:P27 ?country . }",
    "  OPTIONAL { ?item wdt:P1618 ?number . }",
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }',
    "} LIMIT 10",
  ].join("\n");
}

export function buildWikidataDetailsQuery(qid: string): string {
  const safe = qid.replace(/[^Q0-9]/g, "");
  return [
    "SELECT ?item ?itemLabel ?dob ?placeLabel ?countryLabel ?number ?officialSite",
    "       ?relType ?relLabel ?relStart ?relEnd WHERE {",
    `  BIND(wd:${safe} AS ?item)`,
    "  OPTIONAL { ?item wdt:P569 ?dob . }",
    "  OPTIONAL { ?item wdt:P19 ?place . }",
    "  OPTIONAL { ?item wdt:P27 ?country . }",
    "  OPTIONAL { ?item wdt:P1618 ?number . }",
    "  OPTIONAL { ?item wdt:P856 ?officialSite . }",
    '  OPTIONAL { ?item wdt:P26 ?rel . BIND("SPOUSE" AS ?relType) BIND(?rel AS ?relPerson) }',
    '  OPTIONAL { ?item wdt:P1533 ?rel . BIND("ROMANTIC_PARTNER" AS ?relType) BIND(?rel AS ?relPerson) }',
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }',
    "} LIMIT 50",
  ].join("\n");
}

function bindingQid(value: WikidataBindingValue | undefined): string | null {
  if (!value) return null;
  const match = /Q\d+/.exec(value.value);
  return match ? match[0] : null;
}

function parseDateValue(value: WikidataBindingValue | undefined): Date | null {
  if (!value) return null;
  const raw = value.value;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relationshipKind(relType: string | undefined): ProviderRelationshipType["kind"] | null {
  if (relType === "SPOUSE") return "SPOUSE";
  if (relType === "ROMANTIC_PARTNER") return "ROMANTIC_PARTNER";
  if (relType === "PARENT") return "PARENT";
  if (relType === "CHILD") return "CHILD";
  if (relType === "SIBLING") return "SIBLING";
  return null;
}

export type WikidataParsedDetails = {
  readonly qid: string | null;
  readonly label: string | null;
  readonly dateOfBirth: Date | null;
  readonly placeOfBirth: string | null;
  readonly country: string | null;
  readonly number: number | null;
  readonly officialSite: string | null;
  readonly relationships: readonly ProviderRelationship[];
};

export function parseWikidataDetails(response: WikidataSparqlResponse): WikidataParsedDetails {
  const bindings = response.results?.bindings ?? [];
  const first = bindings[0];
  const item = bindings.find((row) => row.item)?.item;
  const numberValue = bindings.find((row) => row.number)?.number?.value;
  const parsedNumber = numberValue !== undefined ? Number(numberValue) : NaN;
  const relationships: ProviderRelationship[] = [];
  const seen = new Set<string>();
  for (const row of bindings) {
    const kind = relationshipKind(row.relType?.value);
    const label = row.relLabel?.value;
    if (!kind || !label) continue;
    const key = `${kind}:${label}:${row.relStart?.value ?? ""}:${row.relEnd?.value ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const validFrom = parseDateValue(row.relStart);
    const validTo = parseDateValue(row.relEnd);
    relationships.push({
      kind,
      targetType: "PUBLIC_PERSON",
      targetExternalId: null,
      targetWikidataQid: bindingQid(row.relPerson),
      displayName: label,
      state: validTo ? "ENDED" : validFrom ? "ACTIVE" : "UNKNOWN",
      validFrom,
      validTo,
    });
  }
  return {
    qid: bindingQid(item),
    label: bindings.find((row) => row.itemLabel)?.itemLabel?.value ?? null,
    dateOfBirth: parseDateValue(first?.dob),
    placeOfBirth: bindings.find((row) => row.placeLabel)?.placeLabel?.value ?? null,
    country: bindings.find((row) => row.countryLabel)?.countryLabel?.value ?? null,
    number: Number.isFinite(parsedNumber) ? parsedNumber : null,
    officialSite: bindings.find((row) => row.officialSite)?.officialSite?.value ?? null,
    relationships,
  };
}

export class WikidataProvider implements ExternalDriverKnowledgeProvider {
  readonly source = "WIKIDATA" as const;

  constructor(
    private readonly options: {
      readonly fetchImpl?: WikidataFetchLike;
      readonly endpoint?: string;
    } = {},
  ) {}

  private async runQuery(query: string): Promise<WikidataParsedDetails> {
    const endpoint = this.options.endpoint ?? "https://query.wikidata.org/sparql";
    const fetchImpl = this.options.fetchImpl ?? (globalThis.fetch as unknown as WikidataFetchLike);
    if (typeof fetchImpl !== "function") {
      throw new WikidataProviderError("NETWORK", "fetch indisponível para Wikidata");
    }
    let response: Awaited<ReturnType<WikidataFetchLike>>;
    try {
      response = await fetchImpl(`${endpoint}?format=json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/sparql-results+json",
        },
        body: `query=${encodeURIComponent(query)}`,
      });
    } catch {
      throw new WikidataProviderError("NETWORK", "Falha de rede ao consultar Wikidata");
    }
    if (!response.ok) {
      throw new WikidataProviderError("HTTP", `Wikidata respondeu ${response.status}`);
    }
    const text = await response.text();
    let parsed: WikidataSparqlResponse;
    try {
      parsed = JSON.parse(text) as WikidataSparqlResponse;
    } catch {
      throw new WikidataProviderError("MALFORMED", "Resposta inválida da Wikidata");
    }
    return parseWikidataDetails(parsed);
  }

  async resolveDriverIdentity(query: DriverIdentityQuery): Promise<ProviderIdentityCandidate[]> {
    if (query.wikidataQid) {
      const details = await this.runQuery(buildWikidataDetailsQuery(query.wikidataQid));
      return [
        {
          externalId: query.wikidataQid,
          name: details.label ?? query.name,
          fullName: details.label ?? query.fullName ?? null,
          nationality: details.country,
          number: details.number,
          dateOfBirth: details.dateOfBirth,
          wikidataQid: query.wikidataQid,
        },
      ];
    }
    if (query.name.trim().length === 0) return [];
    const details = await this.runQuery(buildWikidataSearchQuery(query.name));
    const label = details.label;
    if (!label || !details.qid) return [];
    return [
      {
        externalId: details.qid,
        name: label,
        fullName: label,
        nationality: details.country,
        number: details.number,
        dateOfBirth: details.dateOfBirth,
        wikidataQid: details.qid,
      },
    ];
  }

  async fetchStructuredProfile(candidate: ProviderIdentityCandidate): Promise<ProviderProfileResult> {
    const qid = candidate.wikidataQid ?? candidate.externalId;
    const details = await this.runQuery(buildWikidataDetailsQuery(qid));
    const officialLinks = details.officialSite ? { website: details.officialSite } : null;
    const dateOfBirth = details.dateOfBirth ?? candidate.dateOfBirth ?? null;
    return {
      profile: {
        fullName: details.label ?? candidate.fullName ?? null,
        publicName: details.label ?? candidate.name,
        dateOfBirth,
        placeOfBirth: details.placeOfBirth,
        nationality: details.country ?? candidate.nationality ?? null,
        representedCountry: details.country ?? candidate.nationality ?? null,
        driverNumber: details.number ?? candidate.number ?? null,
        driverCode: null,
        currentTeamName: null,
        officialLinks,
        biographyFacts: {
          publicName: details.label ?? candidate.name,
          fullName: details.label ?? candidate.fullName ?? null,
          dateOfBirth,
          placeOfBirth: details.placeOfBirth,
          nationality: details.country ?? candidate.nationality ?? null,
          representedCountry: details.country ?? candidate.nationality ?? null,
        },
      },
      source: this.detailsSource(qid),
    };
  }

  async fetchRelationships(candidate: ProviderIdentityCandidate): Promise<ProviderRelationship[]> {
    const qid = candidate.wikidataQid ?? candidate.externalId;
    const details = await this.runQuery(buildWikidataDetailsQuery(qid));
    return [...details.relationships];
  }

  async fetchCareerData(candidate: ProviderIdentityCandidate): Promise<ProviderCareerData> {
    void candidate;
    return { seasons: [], championships: [] };
  }

  async fetchSourceReferences(candidate: ProviderIdentityCandidate): Promise<ProviderSourceReference[]> {
    const qid = candidate.wikidataQid ?? candidate.externalId;
    return [this.detailsSource(qid)];
  }

  private detailsSource(qid: string): ProviderSourceReference {
    return {
      provider: "WIKIDATA",
      sourceKind: "DATABASE_EXPORT",
      url: `https://www.wikidata.org/wiki/${qid}`,
      title: `Wikidata ${qid}`,
      license: "CC0",
      attributionRequirement: null,
      attributionText: "Wikidata — CC0",
      sourceVersion: null,
    };
  }
}

export function createWikidataProviderFromEnv(
  fetchImpl?: WikidataFetchLike,
): WikidataProvider {
  const endpoint = process.env.WIKIDATA_SPARQL_URL?.trim();
  return new WikidataProvider({
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(endpoint ? { endpoint } : {}),
  });
}
