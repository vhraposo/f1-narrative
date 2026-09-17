export const TOPIC_MATCH_VERSION = "topic-match.v1";

export const TOPIC_MATCH_RULE =
  "topic-match.v1-rule: match = 2+ distinct significant shared tokens OR single strong token (>=5 chars | Capitalized | ALL_CAPS in source); accents/case normalized; stopwords PT+EN ignored";

const STOPWORDS = new Set<string>([
  "a", "an", "and", "ao", "aos", "are", "as", "at", "ate", "be", "been",
  "being", "bem", "boa", "bom", "bomdia", "both", "but", "by", "cada",
  "can", "coisa", "com", "como", "contra", "could", "da", "das", "day",
  "de", "dela", "delas", "dele", "deles", "depois", "dessa", "desse",
  "dia", "did", "disso", "do", "does", "dois", "dos", "e", "each", "ela",
  "elas", "ele", "eles", "em", "entre", "era", "essa", "essas", "esse",
  "esses", "esta", "estas", "este", "estes", "eu", "few", "foi", "for",
  "from", "ha", "had", "has", "have", "he", "her", "here", "hers", "him",
  "his", "how", "i", "if", "in", "into", "is", "it", "its", "ja", "la",
  "lhe", "logo", "mais", "mas", "me", "mesmo", "meu", "minha", "more",
  "most", "my", "na", "nas", "nem", "no", "nos", "nossa", "nossas",
  "nosso", "nossos", "not", "noite", "num", "numa", "o", "of", "off",
  "oi", "ola", "olha", "olhe", "on", "or", "os", "other", "ou", "our",
  "ours", "out", "own", "para", "pela", "pelas", "pelo", "pelos", "por",
  "qual", "quando", "que", "quem", "same", "sao", "se", "seja", "sem",
  "ser", "seu", "she", "should", "so", "sobre", "some", "sou", "sua",
  "such", "tambem", "tarde", "te", "tem", "tendo", "tens", "than",
  "that", "the", "their", "theirs", "them", "then", "there", "these",
  "they", "this", "those", "through", "tido", "to", "todo", "toda",
  "todas", "todos", "too", "tu", "tua", "tudo", "um", "uma", "under",
  "until", "up", "us", "very", "voce", "voces", "was", "we", "were",
  "what", "when", "where", "which", "while", "who", "whom", "why", "will",
  "with", "would", "you", "your", "yours",
]);

function rawTokens(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

export function normalizeTopicText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedTokens(text: string): string[] {
  const normalized = normalizeTopicText(text);
  if (normalized.length === 0) return [];
  return normalized.split(" ");
}

function isSignificant(token: string): boolean {
  return token.length >= 2 && !STOPWORDS.has(token);
}

export function significantTokens(text: string): string[] {
  return [...new Set(normalizedTokens(text).filter(isSignificant))].sort();
}

function firstLetter(token: string): string | undefined {
  return token.match(/\p{L}/u)?.[0];
}

function isCapitalizedInSource(source: string, normalizedToken: string): boolean {
  return rawTokens(source).some((original) => {
    if (normalizeTopicText(original) !== normalizedToken) return false;
    const first = firstLetter(original);
    if (first === undefined) return false;
    return first.toUpperCase() === first && first.toLowerCase() !== first;
  });
}

function isAcronymInSource(source: string, normalizedToken: string): boolean {
  return rawTokens(source).some((original) => {
    if (original.length < 2) return false;
    if (normalizeTopicText(original) !== normalizedToken) return false;
    return original === original.toUpperCase() && original !== original.toLowerCase();
  });
}

function isStrongToken(message: string, token: string): boolean {
  if (token.length >= 5) return true;
  return isCapitalizedInSource(message, token) || isAcronymInSource(message, token);
}

export function topicOverlap(message: string, text: string): string[] {
  const messageTokens = significantTokens(message);
  if (messageTokens.length === 0) return [];
  const textTokens = new Set(significantTokens(text));
  return messageTokens.filter((token) => textTokens.has(token));
}

export function isTopicMatch(message: string, text: string): boolean {
  const shared = topicOverlap(message, text);
  if (shared.length >= 2) return true;
  if (shared.length === 1) return isStrongToken(message, shared[0]);
  return false;
}