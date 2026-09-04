import { get, patch, post, remove } from "./api";

export type RelationshipCharacter = {
  id: string;
  name: string;
  nationality: string;
  imageUrl: string | null;
};

export type Relationship = {
  id: string;
  characterAId: string;
  characterBId: string;
  dimensions: Record<string, unknown>;
  characterA: RelationshipCharacter;
  characterB: RelationshipCharacter;
  createdAt: string;
  updatedAt: string;
};

export type CreateRelationshipInput = {
  characterAId: string;
  characterBId: string;
  dimensions?: Record<string, unknown>;
};

export type UpdateRelationshipInput = {
  dimensions?: Record<string, unknown>;
};

type ListResponse = { relationships: Relationship[] };
type ItemResponse = { relationship: Relationship };

export function listRelationships(): Promise<Relationship[]> {
  return get<ListResponse>("/api/relationships").then(
    (r) => r.relationships,
  );
}

export function getRelationship(id: string): Promise<Relationship> {
  return get<ItemResponse>(`/api/relationships/${id}`).then((r) => r.relationship);
}

export function createRelationship(
  input: CreateRelationshipInput,
): Promise<Relationship> {
  return post<ItemResponse>("/api/relationships", input).then(
    (r) => r.relationship,
  );
}

export function updateRelationship(
  id: string,
  input: UpdateRelationshipInput,
): Promise<Relationship> {
  return patch<ItemResponse>(`/api/relationships/${id}`, input).then(
    (r) => r.relationship,
  );
}

export function deleteRelationship(id: string): Promise<void> {
  return remove<void>(`/api/relationships/${id}`);
}
