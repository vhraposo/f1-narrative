import { get, patch, post, remove } from "./api";

export type Character = {
  id: string;
  name: string;
  nationality: string;
  gender: string | null;
  birthDate: string;
  imageUrl: string | null;
  biography: string | null;
  dna: Record<string, unknown>;
  controlledBy: "USER" | "AI";
  createdAt: string;
  updatedAt: string;
};

export type CreateCharacterInput = {
  name: string;
  nationality: string;
  gender?: string | null;
  birthDate: string;
  imageUrl?: string | null;
  biography?: string | null;
};

export type UpdateCharacterInput = Partial<CreateCharacterInput>;

type ListResponse = { characters: Character[] };
type ItemResponse = { character: Character };

export function listCharacters(): Promise<Character[]> {
  return get<ListResponse>("/api/characters").then((r) => r.characters);
}

export function getCharacter(id: string): Promise<Character> {
  return get<ItemResponse>(`/api/characters/${id}`).then((r) => r.character);
}

export function createCharacter(
  input: CreateCharacterInput,
): Promise<Character> {
  return post<ItemResponse>("/api/characters", input).then((r) => r.character);
}

export function updateCharacter(
  id: string,
  input: UpdateCharacterInput,
): Promise<Character> {
  return patch<ItemResponse>(`/api/characters/${id}`, input).then(
    (r) => r.character,
  );
}

export function deleteCharacter(id: string): Promise<void> {
  return remove<void>(`/api/characters/${id}`);
}
