import { describe, expect, it, vi } from "vitest";

import {
  createCommonsCircuitPhotoProvider,
  isReusableCommonsLicense,
  parseCommonsImageInfo,
} from "./circuit-photo.provider.js";

const PAYLOAD = {
  query: {
    pages: {
      "1": {
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/full/monza.jpg",
            thumburl: "https://upload.wikimedia.org/thumb/monza.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Monza.jpg",
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 4.0" },
              Artist: { value: '<a href="/wiki/User:Foo">Foo Bar</a>' },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
            },
          },
        ],
      },
    },
  },
};

describe("circuit photo provider (Wikimedia Commons)", () => {
  it("1) allowlist aceita CC0/CC BY/CC BY-SA e rejeita NC/ND", () => {
    expect(isReusableCommonsLicense("CC0")).toBe(true);
    expect(isReusableCommonsLicense("CC BY 4.0")).toBe(true);
    expect(isReusableCommonsLicense("CC BY-SA 4.0")).toBe(true);
    expect(isReusableCommonsLicense("CC BY-NC 4.0")).toBe(false);
    expect(isReusableCommonsLicense("CC BY-ND 4.0")).toBe(false);
    expect(isReusableCommonsLicense("All rights reserved")).toBe(false);
    expect(isReusableCommonsLicense(null)).toBe(false);
  });

  it("2) parseia metadata com licença reutilizável e sanitiza autor", () => {
    const photo = parseCommonsImageInfo(PAYLOAD);
    expect(photo).not.toBeNull();
    expect(photo?.url).toContain("thumb/monza.jpg");
    expect(photo?.source).toBe("WIKIMEDIA_COMMONS");
    expect(photo?.author).toBe("Foo Bar");
    expect(photo?.license).toBe("CC BY-SA 4.0");
    expect(photo?.attribution).toContain("Foo Bar");
    expect(photo?.sourceUrl).toContain("commons.wikimedia.org");
  });

  it("3) rejeita imagem sem licença reutilizável", () => {
    const nonFree = JSON.parse(JSON.stringify(PAYLOAD)) as typeof PAYLOAD;
    nonFree.query.pages["1"].imageinfo[0].extmetadata.LicenseShortName.value =
      "CC BY-NC 4.0";
    expect(parseCommonsImageInfo(nonFree)).toBeNull();
    expect(parseCommonsImageInfo({})).toBeNull();
    expect(parseCommonsImageInfo(null)).toBeNull();
  });

  it("4) provider desabilitado não chama a rede", async () => {
    const fetchImpl = vi.fn();
    const provider = createCommonsCircuitPhotoProvider({
      enabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await provider({ circuitId: "c1", name: "Monza", locality: "Monza" })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("5) provider habilitado resolve e usa cache; erro degrada para null", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => PAYLOAD,
    }));
    const provider = createCommonsCircuitPhotoProvider({
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const first = await provider({ circuitId: "c1", name: "Monza", locality: "Monza" });
    const second = await provider({ circuitId: "c1", name: "Monza", locality: "Monza" });
    expect(first?.license).toBe("CC BY-SA 4.0");
    expect(second?.license).toBe("CC BY-SA 4.0");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const failing = createCommonsCircuitPhotoProvider({
      enabled: true,
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });
    expect(
      await failing({ circuitId: "c2", name: "Spa", locality: "Spa" }),
    ).toBeNull();
  });
});
