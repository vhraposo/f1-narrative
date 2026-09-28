"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useDriverNumbers,
  useSetDriverNumber,
} from "@/hooks/use-driver-numbers";

const REASON_LABELS: Record<string, string> = {
  NUMBER_RESERVED: "Reservado",
  CHAMPION_ONLY: "Só o campeão",
  NUMBER_ALREADY_USED: "Em uso",
};

type Props = {
  seasonId: string;
  driverProfileId: string;
  currentNumber: number | null;
};

export function SeasonNumberPicker({
  seasonId,
  driverProfileId,
  currentNumber,
}: Props) {
  const { data, isLoading, isError } = useDriverNumbers(
    seasonId,
    driverProfileId,
  );
  const mutation = useSetDriverNumber(seasonId, driverProfileId);
  const [error, setError] = useState<string | null>(null);

  function handlePick(number: number) {
    setError(null);
    mutation.mutate(number, {
      onError: (err) =>
        setError(
          err instanceof Error ? err.message : "Falha ao salvar o número",
        ),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Número da temporada</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
        {isError && (
          <p className="text-sm text-destructive">
            Não foi possível carregar os números.
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {data && (
          <>
            <p className="text-xs text-muted-foreground">
              Atual:{" "}
              <span className="font-semibold text-foreground">
                {currentNumber ?? "sem número"}
              </span>
            </p>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10">
              {data.numbers.map((item) => {
                const isCurrent = item.number === currentNumber;
                const disabled =
                  (!item.available && !isCurrent) || mutation.isPending;
                const label = item.reason
                  ? (REASON_LABELS[item.reason] ?? item.reason)
                  : null;
                const owner =
                  item.reason === "NUMBER_ALREADY_USED" && item.driverName
                    ? `${label}: ${item.driverName}`
                    : label;
                return (
                  <Button
                    key={item.number}
                    type="button"
                    variant={isCurrent ? "default" : "outline"}
                    size="sm"
                    className="h-9 px-0 tabular-nums"
                    disabled={disabled}
                    title={isCurrent ? "Número atual" : (owner ?? undefined)}
                    aria-label={`Número ${item.number}${owner ? ` — ${owner}` : ""}`}
                    onClick={() => handlePick(item.number)}
                  >
                    {item.number}
                  </Button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Indisponíveis mostram o motivo. O #1 pertence ao campeão
              anterior; o #17 é reservado.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
