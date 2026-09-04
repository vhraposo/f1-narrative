"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { Character } from "@/lib/characters";
import type { Relationship } from "@/lib/relationships";

type RelationshipFormValues = {
  characterAId: string;
  characterBId: string;
  dimensions: Record<string, unknown> | undefined;
};

type RelationshipFormProps = {
  characters: Character[];
  charactersLoading: boolean;
  charactersError: string | null;
  initial?: Relationship;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (input: RelationshipFormValues) => void;
  onCancel: () => void;
};

function parseDimensions(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return undefined;
  }
  const parsed: unknown = JSON.parse(trimmed);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("As dimensões devem ser um objeto JSON.");
  }
  return parsed as Record<string, unknown>;
}

export function RelationshipForm({
  characters,
  charactersLoading,
  charactersError,
  initial,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: RelationshipFormProps) {
  const isEdit = Boolean(initial);

  const [characterAId, setCharacterAId] = useState(
    initial?.characterAId ?? "",
  );
  const [characterBId, setCharacterBId] = useState(
    initial?.characterBId ?? "",
  );
  const [dimensionsRaw, setDimensionsRaw] = useState(
    initial ? JSON.stringify(initial.dimensions ?? {}, null, 2) : "",
  );
  const [dimensionsError, setDimensionsError] = useState<string | null>(null);

  useEffect(() => {
    setCharacterAId(initial?.characterAId ?? "");
    setCharacterBId(initial?.characterBId ?? "");
    setDimensionsRaw(initial ? JSON.stringify(initial.dimensions ?? {}, null, 2) : "");
    setDimensionsError(null);
  }, [initial]);

  const canSubmit =
    isEdit ||
    (characterAId !== "" &&
      characterBId !== "" &&
      characterAId !== characterBId);

  function handleSubmit() {
    let dimensions: Record<string, unknown> | undefined;
    try {
      dimensions = parseDimensions(dimensionsRaw);
    } catch (e) {
      setDimensionsError(
        e instanceof Error ? e.message : "JSON inválido nas dimensões.",
      );
      return;
    }
    setDimensionsError(null);
    if (isEdit && initial) {
      onSubmit({
        characterAId: initial.characterAId,
        characterBId: initial.characterBId,
        dimensions,
      });
      return;
    }
    onSubmit({ characterAId, characterBId, dimensions });
  }

  const options = characters
    .filter((c) =>
      isEdit
        ? true
        : c.id !== characterAId && c.id !== characterBId,
    )
    .map((c) => ({
      id: c.id,
      label: `${c.name}${c.nationality ? ` (${c.nationality})` : ""}`,
    }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Editar relação" : "Nova relação"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="characterA">Personagem A</Label>
            {charactersLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : charactersError ? (
              <p className="text-sm text-destructive">
                Falha ao carregar personagens.
              </p>
            ) : isEdit ? (
              <p className="text-sm font-medium">
                {initial?.characterA.name}
              </p>
            ) : (
              <select
                id="characterA"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={characterAId}
                disabled={isSubmitting}
                onChange={(e) => setCharacterAId(e.target.value)}
              >
                <option value="">Selecione...</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="characterB">Personagem B</Label>
            {charactersLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : charactersError ? (
              <p className="text-sm text-destructive">
                Falha ao carregar personagens.
              </p>
            ) : isEdit ? (
              <p className="text-sm font-medium">
                {initial?.characterB.name}
              </p>
            ) : (
              <select
                id="characterB"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={characterBId}
                disabled={isSubmitting}
                onChange={(e) => setCharacterBId(e.target.value)}
              >
                <option value="">Selecione...</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {!isEdit && characterAId !== "" && characterAId === characterBId && (
          <p className="text-sm text-destructive">
            Escolha dois personagens diferentes.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="dimensions">
            Dimensões (opcional — objeto JSON)
          </Label>
          <textarea
            id="dimensions"
            rows={4}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            placeholder='{"amizade": 80, "confianca": 50}'
            value={dimensionsRaw}
            disabled={isSubmitting}
            onChange={(e) => setDimensionsRaw(e.target.value)}
          />
          {dimensionsError && (
            <p className="text-sm text-destructive">{dimensionsError}</p>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={isSubmitting || !canSubmit}
          onClick={handleSubmit}
        >
          {isSubmitting ? "Salvando..." : "Salvar"}
        </Button>
      </CardFooter>
    </Card>
  );
}
