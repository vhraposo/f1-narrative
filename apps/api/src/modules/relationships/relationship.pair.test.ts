import { describe, expect, it } from "vitest";
import {
  canonicalizeRelationshipPair,
  InvalidRelationshipPairError,
} from "./relationship.pair.js";

describe("canonicalizeRelationshipPair", () => {
  const lower = "00000000-0000-0000-0000-000000000001";
  const higher = "00000000-0000-0000-0000-000000000099";

  it("A,B → par canônico (menor, maior)", () => {
    expect(canonicalizeRelationshipPair(lower, higher)).toEqual({
      characterAId: lower,
      characterBId: higher,
    });
  });

  it("B,A → mesmo par canônico (menor, maior)", () => {
    expect(canonicalizeRelationshipPair(higher, lower)).toEqual({
      characterAId: lower,
      characterBId: higher,
    });
  });

  it("determinístico e independente da ordem de entrada", () => {
    expect(canonicalizeRelationshipPair(lower, higher)).toEqual(
      canonicalizeRelationshipPair(higher, lower),
    );
  });

  it("A = A → lança erro (auto-relação não permitida)", () => {
    expect(() => canonicalizeRelationshipPair(lower, lower)).toThrow(
      InvalidRelationshipPairError,
    );
  });
});