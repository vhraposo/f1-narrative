export type QualifyingContender = {
  driverProfileId: string;
  carSpeed: number;
  speed: number;
  consistency: number;
};

export type QualifyingResult = {
  driverProfileId: string;
  carSpeed: number;
  speed: number;
  consistency: number;
  pace: number;
  quality: number;
  grid: number;
};

export function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function qualifyingPace(contender: QualifyingContender): number {
  return 0.6 * contender.carSpeed + 0.4 * contender.speed;
}

export function qualifyingJitter(contender: QualifyingContender): number {
  return 8 * (1 - contender.consistency / 100);
}

export function simulateQualifying(
  contenders: QualifyingContender[],
  seed: number,
): QualifyingResult[] {
  const rng = mulberry32(seed);
  const scored = contenders.map((contender) => {
    const pace = qualifyingPace(contender);
    const jitterRange = qualifyingJitter(contender);
    const jitter = (rng() * 2 - 1) * jitterRange;
    const quality = Math.max(0, Math.min(100, pace + jitter));
    return { ...contender, pace, quality };
  });

  scored.sort((a, b) => {
    if (b.quality !== a.quality) return b.quality - a.quality;
    return a.driverProfileId.localeCompare(b.driverProfileId);
  });

  return scored.map((row, index) => ({ ...row, grid: index + 1 }));
}