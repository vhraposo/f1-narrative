import { describe, expect, it } from "vitest";
import { computeContentHash } from "./jolpica.hash.js";
import {
  normalizeDriverSeasons,
  normalizeDrivers,
  normalizeRaceResults,
  normalizeRaces,
  normalizeSeason,
  normalizeStandings,
  normalizeTeams,
} from "./jolpica.normalizer.js";
import type {
  JolpicaConstructorRaw,
  JolpicaDriverRaw,
  JolpicaRaceRaw,
  JolpicaRaceWithResultsRaw,
  JolpicaStandingsListRaw,
} from "./jolpica.client.js";

const FERRARI: JolpicaConstructorRaw = {
  constructorId: "ferrari",
  name: "Ferrari",
  nationality: "Italian",
};

const MCLAREN: JolpicaConstructorRaw = {
  constructorId: "mclaren",
  name: "McLaren",
  nationality: "British",
};

const LAUDA: JolpicaDriverRaw = {
  driverId: "lauda",
  permanentNumber: "1",
  code: "LAU",
  givenName: "Niki",
  familyName: "Lauda",
  nationality: "Austrian",
};

const HUNT: JolpicaDriverRaw = {
  driverId: "hunt",
  permanentNumber: "11",
  code: "HUN",
  givenName: "James",
  familyName: "Hunt",
  nationality: "",
};

const DONNELLY: JolpicaDriverRaw = {
  driverId: "donnelly",
  givenName: "Martin",
  familyName: "Donnelly",
};

describe("normalizeSeason", () => {
  it("mantém year e marca name/status nulos (fonte não fornece)", () => {
    const item = normalizeSeason(1975, []);
    expect(item.data).toEqual({
      year: 1975,
      name: null,
      status: null,
    });
    expect(item.sourceRecord).toEqual({ year: 1975, roundCount: 0 });
  });
});

describe("normalizeTeams", () => {
  it("mapeia constructors para ExternalTeam com shortName/color nulos", () => {
    const [item] = normalizeTeams([FERRARI, MCLAREN]);
    expect(item.data).toEqual({
      externalId: "ferrari",
      name: "Ferrari",
      shortName: null,
      color: null,
    });
    expect(item.sourceRecord).toEqual({
      constructorId: "ferrari",
      name: "Ferrari",
      nationality: "Italian",
    });
  });
});

describe("normalizeDrivers", () => {
  it("monta nome completo e converge vazios para null", () => {
    const items = normalizeDrivers([LAUDA, HUNT, DONNELLY]);
    expect(items).toHaveLength(3);
    const lauda = items.find((i) => i.data.externalId === "lauda")!;
    expect(lauda.data.name).toBe("Niki Lauda");
    expect(lauda.data.fullName).toBe("Niki Lauda");
    expect(lauda.data.nationality).toBe("Austrian");
    expect(lauda.data.number).toBe(1);

    const hunt = items.find((i) => i.data.externalId === "hunt")!;
    expect(hunt.data.nationality).toBeNull();
    expect(hunt.data.number).toBe(11);

    const donnelly = items.find((i) => i.data.externalId === "donnelly")!;
    expect(donnelly.data.number).toBeNull();
  });
});

describe("normalizeRaces", () => {
  it("mapeia corrida e converte date UTC", () => {
    const races: JolpicaRaceRaw[] = [
      {
        season: "1975",
        round: "1",
        raceName: "Argentine Grand Prix",
        Circuit: {
          circuitId: "buenos_aires",
          circuitName: "Autodromo Juan y Oscar Galvez",
          Location: { locality: "Buenos Aires", country: "Argentina" },
        },
        date: "1975-01-12",
      },
      {
        round: "2",
        raceName: "Brazilian Grand Prix",
        Circuit: { circuitName: "Interlagos" },
        date: "1975-01-26",
      },
    ];
    const items = normalizeRaces(races, 1975);
    expect(items).toHaveLength(2);
    const first = items.find((i) => i.data.round === 1)!;
    expect(first.data).toEqual({
      seasonYear: 1975,
      round: 1,
      grandPrix: "Argentine Grand Prix",
      name: "Argentine Grand Prix",
      circuitName: "Autodromo Juan y Oscar Galvez",
      date: new Date("1975-01-12T00:00:00.000Z"),
      status: null,
    });
    expect(first.sourceRecord.locality).toBe("Buenos Aires");
  });

  it("descarta corridas sem round válido", () => {
    const items = normalizeRaces([{ round: undefined, raceName: "X" }], 1975);
    expect(items).toHaveLength(0);
  });
});

describe("normalizeRaceResults", () => {
  it("mapeia results com fastestLap true/false/null", () => {
    const races: JolpicaRaceWithResultsRaw[] = [
      {
        season: "1975",
        round: "1",
        raceName: "GP",
        Results: [
          {
            number: "1",
            position: "1",
            positionText: "1",
            points: "9",
            grid: "1",
            status: "Finished",
            Driver: LAUDA,
            Constructor: FERRARI,
            FastestLap: { rank: "1", lap: "53" },
          },
          {
            number: "11",
            position: "2",
            positionText: "2",
            points: "6",
            grid: "3",
            Driver: HUNT,
            Constructor: MCLAREN,
            FastestLap: { rank: "2", lap: "55" },
          },
          {
            position: "30",
            positionText: "R",
            points: "0",
            status: "Retired",
            Driver: DONNELLY,
            Constructor: MCLAREN,
          },
        ],
      },
    ];
    const { results, drivers } = normalizeRaceResults(races, 1975);
    expect(results).toHaveLength(3);
    const lauda = results.find((r) => r.data.driverExternalId === "lauda")!;
    expect(lauda.data).toEqual({
      seasonYear: 1975,
      round: 1,
      driverExternalId: "lauda",
      position: 1,
      points: 9,
      grid: 1,
      fastestLap: true,
      status: "Finished",
    });
    const hunt = results.find((r) => r.data.driverExternalId === "hunt")!;
    expect(hunt.data.fastestLap).toBe(false);
    const donnelly = results.find((r) => r.data.driverExternalId === "donnelly")!;
    expect(donnelly.data.position).toBe(30);
    expect(donnelly.data.grid).toBeNull();
    expect(donnelly.data.fastestLap).toBeNull();
    expect(drivers).toHaveLength(3);
  });
});

describe("normalizeDriverSeasons", () => {
  it("extrai drivers, times e rol null (fonte não fornece papel)", () => {
    const list: JolpicaStandingsListRaw = {
      season: "1975",
      round: "24",
      DriverStandings: [
        {
          position: "1",
          points: "64.5",
          wins: "5",
          Driver: LAUDA,
          Constructors: [FERRARI, MCLAREN],
        },
        {
          position: "2",
          points: "33",
          wins: "1",
          Driver: HUNT,
          Constructors: [MCLAREN],
        },
      ],
    };
    const payload = normalizeDriverSeasons(list, 1975);
    expect(payload.driverSeasons).toHaveLength(2);
    expect(payload.drivers).toHaveLength(2);
    expect(payload.teams).toHaveLength(2);
    const lauda = payload.driverSeasons.find(
      (d) => d.data.driverExternalId === "lauda",
    )!;
    expect(lauda.data).toEqual({
      seasonYear: 1975,
      driverExternalId: "lauda",
      teamExternalId: "ferrari",
      teamNameSnapshot: "Ferrari",
      number: 1,
      role: null,
    });
  });

  it("deduplica driver com múltiplas entradas de standings", () => {
    const list: JolpicaStandingsListRaw = {
      DriverStandings: [
        { Driver: LAUDA, Constructors: [FERRARI] },
        { Driver: LAUDA, Constructors: [MCLAREN] },
      ],
    };
    const payload = normalizeDriverSeasons(list, 1975);
    expect(payload.driverSeasons).toHaveLength(1);
  });
});

describe("normalizeStandings", () => {
  it("converte pontos decimais e mantém podiums null", () => {
    const list: JolpicaStandingsListRaw = {
      DriverStandings: [
        { position: "1", points: "64.5", wins: "5", Driver: LAUDA },
      ],
    };
    const [item] = normalizeStandings(list, 1975);
    expect(item.data).toEqual({
      seasonYear: 1975,
      driverExternalId: "lauda",
      position: 1,
      points: 64.5,
      wins: 5,
      podiums: null,
    });
  });
});

describe("computeContentHash", () => {
  it("é determinístico independente da ordem das chaves", () => {
    const a = { b: 1, a: "x", c: null };
    const b = { c: null, b: 1, a: "x" };
    expect(computeContentHash(a)).toBe(computeContentHash(b));
  });

  it("muda quando o conteúdo muda", () => {
    expect(computeContentHash({ points: 9 })).not.toBe(
      computeContentHash({ points: 10 }),
    );
  });

  it("normaliza Date pelo ISO (estabilidade de datas)", () => {
    const a = { date: new Date("1975-01-12T00:00:00.000Z") };
    const b = { date: new Date("1975-01-12T00:00:00.000Z") };
    expect(computeContentHash(a)).toBe(computeContentHash(b));
    expect(computeContentHash({ date: new Date("1975-01-13T00:00:00.000Z") })).not.toBe(
      computeContentHash(a),
    );
  });

  it("lida com undefined sem lançar", () => {
    expect(typeof computeContentHash({ a: undefined, b: null })).toBe("string");
  });
});