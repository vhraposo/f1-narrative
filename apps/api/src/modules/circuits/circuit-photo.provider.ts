export type CircuitPhotoMetadata = {
  readonly url: string;
  readonly source: "WIKIMEDIA_COMMONS";
  readonly sourceUrl: string;
  readonly fileUrl: string | null;
  readonly author: string | null;
  readonly license: string;
  readonly licenseUrl: string | null;
  readonly attribution: string;
  readonly retrievedAt: string;
};

export type CircuitPhotoProvider = (input: {
  readonly circuitId: string;
  readonly name: string;
  readonly locality: string | null;
}) => Promise<CircuitPhotoMetadata | null>;

const ALLOWED_LICENSE_PATTERNS: readonly RegExp[] = [
  /^cc0/i,
  /^cc by[-\s]?sa/i,
  /^cc by/i,
  /^public domain/i,
];

export function isReusableCommonsLicense(shortName: string | null | undefined): boolean {
  if (!shortName) return false;
  const value = shortName.trim();
  if (value.length === 0) return false;
  if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv/i.test(value)) return false;
  return ALLOWED_LICENSE_PATTERNS.some((pattern) => pattern.test(value));
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCommonsImageInfo(payload: unknown): CircuitPhotoMetadata | null {
  if (typeof payload !== "object" || payload === null) return null;
  const query = (payload as Record<string, unknown>).query;
  if (typeof query !== "object" || query === null) return null;
  const pages = (query as Record<string, unknown>).pages;
  if (typeof pages !== "object" || pages === null) return null;
  const candidates = Object.values(pages as Record<string, unknown>);
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const record = candidate as Record<string, unknown>;
    const imageInfo = Array.isArray(record.imageinfo) ? record.imageinfo[0] : null;
    if (typeof imageInfo !== "object" || imageInfo === null) continue;
    const info = imageInfo as Record<string, unknown>;
    const fileUrl = stringValue(info.url);
    const descriptionUrl = stringValue(info.descriptionurl);
    const metadata = (info.extmetadata ?? {}) as Record<string, unknown>;
    const licenseShortName = stripHtml(
      stringValue((metadata.LicenseShortName as Record<string, unknown>)?.value) ?? "",
    );
    if (!fileUrl || !descriptionUrl) continue;
    if (!isReusableCommonsLicense(licenseShortName)) continue;
    const artist = stripHtml(
      stringValue((metadata.Artist as Record<string, unknown>)?.value) ?? "",
    );
    const licenseUrl =
      stringValue((metadata.LicenseUrl as Record<string, unknown>)?.value) ?? null;
    const attributionParts = [
      artist.length > 0 ? artist : "Wikimedia Commons",
      licenseShortName,
    ];
    return {
      url: stringValue(info.thumburl) ?? fileUrl,
      source: "WIKIMEDIA_COMMONS",
      sourceUrl: descriptionUrl,
      fileUrl,
      author: artist.length > 0 ? artist : null,
      license: licenseShortName,
      licenseUrl,
      attribution: attributionParts.join(" · "),
      retrievedAt: new Date().toISOString(),
    };
  }
  return null;
}

export function createCommonsCircuitPhotoProvider(options: {
  readonly enabled: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}): CircuitPhotoProvider {
  const cache = new Map<string, CircuitPhotoMetadata | null>();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;

  return async ({ circuitId, name, locality }) => {
    if (!options.enabled) return null;
    if (cache.has(circuitId)) return cache.get(circuitId) ?? null;
    const query = [name, locality, "circuit"].filter(Boolean).join(" ");
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrsearch", query);
    url.searchParams.set("gsrnamespace", "6");
    url.searchParams.set("gsrlimit", "5");
    url.searchParams.set("prop", "imageinfo");
    url.searchParams.set("iiprop", "url|extmetadata");
    url.searchParams.set("iiurlwidth", "800");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.toString(), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        cache.set(circuitId, null);
        return null;
      }
      const payload = (await response.json()) as unknown;
      const photo = parseCommonsImageInfo(payload);
      cache.set(circuitId, photo);
      return photo;
    } catch {
      cache.set(circuitId, null);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
