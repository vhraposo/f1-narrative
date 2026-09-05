// Regra única de canonicalização de pares de Relationship.
// (A,B) e (B,A) representam o mesmo par lógico: A é SEMPRE o menor id e B o
// maior. Aplicada em toda escrita antes do acesso ao Prisma; as leituras do
// domínio são agnósticas à direção e dependem apenas do par canônico.

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