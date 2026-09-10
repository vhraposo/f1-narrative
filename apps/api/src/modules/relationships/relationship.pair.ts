
export interface CanonicalRelationshipPair {
  characterAId: string;
  characterBId: string;
}

export class InvalidRelationshipPairError extends Error {
  constructor() {
    super("Os personagens A e B devem ser diferentes");
    this.name = "InvalidRelationshipPairError";
  }
}

export function canonicalizeRelationshipPair(
  a: string,
  b: string,
): CanonicalRelationshipPair {
  if (a === b) {
    throw new InvalidRelationshipPairError();
  }
  return a < b
    ? { characterAId: a, characterBId: b }
    : { characterAId: b, characterBId: a };
}