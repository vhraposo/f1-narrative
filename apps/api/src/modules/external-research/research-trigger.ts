export const RESEARCH_TRIGGER_VERSION = "research-trigger.v1";
export const RESEARCH_TRIGGER_RULE = "research-trigger.v1#mode=pure#scope=decision";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type ResearchTriggerReasonCode =
  | "DEFINITION_REQUEST"
  | "QUESTION"
  | "EXTERNAL_CONCEPT"
  | "INTERNAL_COVERAGE";

const REASON_ORDER: readonly ResearchTriggerReasonCode[] = [
  "DEFINITION_REQUEST",
  "QUESTION",
  "EXTERNAL_CONCEPT",
  "INTERNAL_COVERAGE",
];

export interface ResearchTriggerWeights {
  definitionRequest: number;
  question: number;
  externalConcept: number;
  internalCoverage: number;
}

export interface ResearchTriggerConfig {
  threshold: number;
  maxConceptTokens: number;
  weights: ResearchTriggerWeights;
}

export const RESEARCH_TRIGGER_DEFAULT_CONFIG: ResearchTriggerConfig = {
  threshold: 25,
  maxConceptTokens: 6,
  weights: {
    definitionRequest: 20,
    question: 8,
    externalConcept: 20,
    internalCoverage: -30,
  },
};

function deepMerge<T>(base: T, patch: unknown): T {
  if (typeof patch !== "object" || patch === null) return (patch as T) ?? base;
  const baseRecord = base as Record<string, unknown>;
  const out: Record<string, unknown> = { ...baseRecord };
  for (const k of Object.keys(patch as Record<string, unknown>)) {
    const baseVal = baseRecord[k];
    const patchVal = (patch as Record<string, unknown>)[k];
    out[k] =
      typeof baseVal === "object" && baseVal !== null && typeof patchVal === "object" && patchVal !== null
        ? deepMerge(baseVal as Record<string, unknown>, patchVal)
        : patchVal;
  }
  return out as T;
}

export function resolveResearchTriggerConfig(
  input?: Partial<ResearchTriggerConfig>,
): ResearchTriggerConfig {
  if (input === undefined) return RESEARCH_TRIGGER_DEFAULT_CONFIG;
  return deepMerge(RESEARCH_TRIGGER_DEFAULT_CONFIG, input);
}

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface ResearchTriggerInternalContext {
  participants?: Array<{ name?: string | null; dna?: unknown; biography?: string | null | undefined } | null | undefined>;
  memories?: Array<{ content?: string | null; summary?: string | null | undefined } | null | undefined>;
  events?: Array<{ title?: string | null; description?: string | null | undefined } | null | undefined>;
  relationships?: Array<{ characterAName?: string | null; characterBName?: string | null | undefined } | null | undefined>;
  recentMessages?: Array<{ content?: string | null } | null | undefined>;
  worldState?: {
    worldDate?: string | null;
    currentSeasonId?: string | null;
    currentRaceId?: string | null;
    raceNames?: Array<string | null | undefined> | null | undefined;
  } | null | undefined;
}

export interface ResearchTriggerInput {
  message: string;
  internal?: ResearchTriggerInternalContext;
}

export interface ResearchTriggerDecision {
  shouldResearch: boolean;
  reasons: ResearchTriggerReasonCode[];
  confidence: number;
  queryHint?: string;
}

// ---------------------------------------------------------------------------
// Tokenização / normalização (determinística, sem LLM)
// ---------------------------------------------------------------------------

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(text: string): string {
  return stripAccents((text ?? "").toLowerCase()).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Sentence-level signal detection
// ---------------------------------------------------------------------------

const INTERROGATIVE_FIRST_TOKENS = new Set([
  "quem","que","qual","quais","quando","onde","como","porque","por que",
  "quanto","quanta","quantos","quantas",
  "why","what","when","where","which","whose","how","whom",
]);

const DEFINITION_LEAD_RE =
  /(?:o que e\b|o que é\b|o que eh\b|o que significa\b|o que quer dizer\b|o que seria\b|o que e que\b|o que sao\b|o que são\b|quem e\b|quem é\b|quem eh\b|quem foi\b|quem sera\b|como funciona\b|como e que\b|como eh que\b|qual e\b|qual é\b|quando e\b|quando é\b|onde e\b|onde é\b|por que\b|porque\b|explique\b|explain\b|define\b|what is\b|what does\b|what do\b|who is\b|who was\b|how does\b|how do\b|when did\b|when is\b|where is\b|meaning of\b|significa\b)/i;

function containsDefinitionLead(message: string): boolean {
  return DEFINITION_LEAD_RE.test(message);
}

function isQuestionByEnd(message: string): boolean {
  return message.trimEnd().endsWith("?");
}

function isQuestionByStart(message: string): boolean {
  const firstToken = normalize(message).split(" ")[0];
  return firstToken !== undefined && INTERROGATIVE_FIRST_TOKENS.has(firstToken);
}

function isQuestion(message: string): boolean {
  return isQuestionByEnd(message) || isQuestionByStart(message);
}

function containsDefinition(message: string): boolean {
  return containsDefinitionLead(message);
}

// ---------------------------------------------------------------------------
// Concept extraction
// ---------------------------------------------------------------------------

const CONNECTORS = new Set(["de","da","do","das","dos","e","em","no","na","nos","nas","a","ao","aos","as"]);
const DEMONSTRATIVES = new Set(["isso","isto","esse","essa","este","esta","esses","essas","estes","estas","ele","ela","eles","elas","o","a","os","as","um","uma","uns","umas"]);
const LEADING_ARTICLES = new Set(["o","a","os","as","um","uma","uns","umas"]);
const FULL_STOPWORDS = new Set([
  "é","ser","está","tem","têm","ha","há","foi","era","seja","estava",
  "estao","estão","será","sera","nao","não","ja","já","bem","ainda",
  "muito","pouco","mais","menos","porém","porque","mas","ou","se","que",
  "voce","você","ele","ela","eles","elas","nos","me","te","lhe","lhes",
  "qual","quais","este","esta","esse","essa","isto","isso","aquilo",
  "como","quando","onde",
  "what","where","when","why","how","who","which","whose","whom",
  "is","are","am","was","were","be","been","being","do","does","did",
  "has","have","had","having","will","shall","may","might","can","could","should","would","must",
  "the","a","an","of","in","on","at","to","for","with","and","or","but","not",
]);

const DISCOURSE_SCAFFOLDING = new Set<string>([
  ...INTERROGATIVE_FIRST_TOKENS,
  ...DEMONSTRATIVES,
  "exatamente",
  "exato",
  "realmente",
  "afinal",
]);

const MAX_CONCEPT_CANDIDATES = 5;

function extractConceptCandidates(message: string): string[] {
  const tokens = normalize(message).split(/\s+/).filter((t) => t.length > 0);
  const result: string[] = [];
  const maxWindow = RESEARCH_TRIGGER_DEFAULT_CONFIG.maxConceptTokens;
  for (let start = 0; start < tokens.length; start++) {
    if (result.length >= MAX_CONCEPT_CANDIDATES) break;
    const firstTok = tokens[start]!;
    if (firstTok.length < 2) continue;
    if (FULL_STOPWORDS.has(firstTok) || DISCOURSE_SCAFFOLDING.has(firstTok)) continue;
    let best: string | null = null;
    const endLimit = Math.min(tokens.length, start + maxWindow);
    for (let end = start + 1; end < endLimit; end++) {
      const lastTok = tokens[end]!;
      if (DISCOURSE_SCAFFOLDING.has(lastTok)) break;
      if (CONNECTORS.has(lastTok) || LEADING_ARTICLES.has(lastTok) || FULL_STOPWORDS.has(lastTok)) continue;
      const candidate = tokens.slice(start, end + 1).join(" ");
      const coreTokens = tokens.slice(start, end + 1).filter((t) => !CONNECTORS.has(t) && !FULL_STOPWORDS.has(t));
      if (coreTokens.length < 2) continue;
      best = candidate;
    }
    if (best !== null) result.push(best);
  }
  return result;
}

function cleanQueryPhrase(raw: string): string {
  let s = raw
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = s.split(/\s+/);
  while (tokens.length > 0 && LEADING_ARTICLES.has(tokens[0]!)) {
    tokens.shift();
  }
  while (tokens.length > 0 && FULL_STOPWORDS.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(" ");
}

function isDemonstrative(norm: string): boolean {
  return DEMONSTRATIVES.has(norm);
}

function isCapitalized(token: string): boolean {
  return token.length > 0 && token[0]! === token[0]!.toUpperCase() && token[0] !== token[0]!.toLowerCase();
}

function hasParticipantToken(candidateNorm: string, internal?: ResearchTriggerInternalContext): boolean {
  const parts = candidateNorm.split(/\s+/);
  if (parts.length === 0) return false;
  for (const p of internal?.participants ?? []) {
    const name = normalize(p?.name ?? "");
    if (!name) continue;
    if (candidateNorm === name) return true;
    if (parts[0] === name.split(/\s+/)[0]) return true;
  }
  return false;
}

export function formulateResearchQuery(
  message: string,
  internal?: ResearchTriggerInternalContext,
  config?: Partial<ResearchTriggerConfig>,
): string | null {
  const trimmed = (message ?? "").trim();
  if (trimmed.length === 0) return null;

  const quoted = trimmed.match(/["'""\u201c\u201d`](.+?)["'""\u201c\u201d`]/);
  if (quoted) {
    const q = cleanQueryPhrase(quoted[1]);
    if (q.length >= 2 && !isDemonstrative(normalize(q))) return capQuery(q, config);
  }

  const defMatch = trimmed.match(DEFINITION_LEAD_RE);
  if (defMatch) {
    const after = trimmed.slice((defMatch.index ?? 0) + defMatch[0].length);
    let obj = after.split(/[?.\n!,;:]/)[0]?.trim() ?? "";
    obj = cleanQueryPhrase(obj);
    if (obj.length >= 2) {
      const normObj = normalize(obj);
      if (!isDemonstrative(normObj) && !hasParticipantToken(normObj, internal)) {
        return capQuery(obj, config);
      }
    }
  }

  const candidates = extractConceptCandidates(trimmed);
  for (const c of candidates) {
    if (!hasParticipantToken(c, internal)) {
      return capQuery(c, config);
    }
  }

  const origTokens = trimmed.trim().split(/\s+/);
  for (let i = 0; i < origTokens.length; i++) {
    const ot = origTokens[i]!;
    if (!ot) continue;
    if (isCapitalized(ot)) {
      const norm = normalize(ot);
      if (FULL_STOPWORDS.has(norm) || CONNECTORS.has(norm) || LEADING_ARTICLES.has(norm) || DEMONSTRATIVES.has(norm) || INTERROGATIVE_FIRST_TOKENS.has(norm)) continue;
      if (!hasParticipantToken(norm, internal)) return capQuery(ot, config);
    }
  }

  return null;
}

function capQuery(query: string, config?: Partial<ResearchTriggerConfig>): string {
  const cfg = resolveResearchTriggerConfig(config);
  const tokens = query.split(/\s+/).slice(0, cfg.maxConceptTokens);
  while (tokens.length > 0 && (FULL_STOPWORDS.has(tokens[tokens.length - 1]!) || CONNECTORS.has(tokens[tokens.length - 1]!) || LEADING_ARTICLES.has(tokens[tokens.length - 1]!))) {
    tokens.pop();
  }
  return tokens.join(" ");
}

// ---------------------------------------------------------------------------
// Internal coverage (Internal-First)
// ---------------------------------------------------------------------------

function buildCorpus(internal?: ResearchTriggerInternalContext): string {
  const parts: string[] = [];
  for (const p of internal?.participants ?? []) {
    if (p?.name) parts.push(p.name);
    if (p?.biography) parts.push(p.biography);
    if (p?.dna !== undefined && p?.dna !== null) {
      parts.push(typeof p.dna === "string" ? p.dna : JSON.stringify(p.dna));
    }
  }
  for (const m of internal?.memories ?? []) {
    if (m?.content) parts.push(m.content);
    if (m?.summary) parts.push(m.summary);
  }
  for (const e of internal?.events ?? []) {
    if (e?.title) parts.push(e.title);
    if (e?.description) parts.push(e.description);
  }
  for (const r of internal?.relationships ?? []) {
    if (r?.characterAName) parts.push(r.characterAName);
    if (r?.characterBName) parts.push(r.characterBName);
  }
  for (const m of internal?.recentMessages ?? []) {
    if (m?.content) parts.push(m.content);
  }
  for (const n of internal?.worldState?.raceNames ?? []) {
    if (n) parts.push(n);
  }
  return normalize(parts.join(" "));
}

function isConceptCovered(concept: string, internal?: ResearchTriggerInternalContext): boolean {
  const normConcept = normalize(concept);
  if (normConcept.length < 3) return false;
  const corpus = buildCorpus(internal);
  if (corpus.length < normConcept.length) return false;
  return corpus.includes(normConcept);
}

// ---------------------------------------------------------------------------
// Score / decision (pure, deterministic)
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function canonicalReasons(reasons: ResearchTriggerReasonCode[]): ResearchTriggerReasonCode[] {
  const set = new Set(reasons);
  return REASON_ORDER.filter((r) => set.has(r));
}

export function shouldResearch(
  input: ResearchTriggerInput,
  config?: Partial<ResearchTriggerConfig>,
): ResearchTriggerDecision {
  const cfg = resolveResearchTriggerConfig(config);
  const message = (input.message ?? "").trim();
  if (message.length === 0) {
    return { shouldResearch: false, reasons: [], confidence: 0 };
  }

  const concept = formulateResearchQuery(message, input.internal, config);
  const conceptCovered = concept !== null && isConceptCovered(concept, input.internal);

  const reasons: ResearchTriggerReasonCode[] = [];
  let score = 0;

  const def = containsDefinition(message);
  const q = isQuestion(message);

  if (def) { reasons.push("DEFINITION_REQUEST"); score += cfg.weights.definitionRequest; }
  if (q)   { reasons.push("QUESTION"); score += cfg.weights.question; }

  if (conceptCovered) {
    reasons.push("INTERNAL_COVERAGE");
    score += cfg.weights.internalCoverage;
  } else if (concept !== null) {
    reasons.push("EXTERNAL_CONCEPT");
    score += cfg.weights.externalConcept;
  }

  const should = concept !== null && !conceptCovered && score >= cfg.threshold;
  const confidence = clamp(Math.round((score / 50) * 100) / 100, 0, 1);

  return {
    shouldResearch: should,
    reasons: canonicalReasons(reasons),
    confidence,
    ...(should ? { queryHint: capQuery(concept!, config) } : {}),
  };
}
