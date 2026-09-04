"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DriverCard } from "@/components/drivers/driver-card";
import { Button } from "@/components/ui/button";
import { useDeleteDriver, useDrivers } from "@/hooks/use-driver-profiles";
import type { Driver } from "@/lib/driver-profiles";

export default function DriversPage() {
  const { data, isLoading, isError, error, refetch } = useDrivers();
  const deleteMutation = useDeleteDriver();
  const [removingId, setRemovingId] = useState<string | null>(null);

  function handleRemove(driver: Driver) {
    setRemovingId(driver.characterId);
    deleteMutation.mutate(driver.characterId, {
      onSettled: () => setRemovingId(null),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pilotos</h1>
        <p className="text-muted-foreground">
          Os pilotos do seu universo narrativo.
        </p>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-destructive">Não foi possível carregar os pilotos.</p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Erro desconhecido"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground">Você ainda não tem pilotos.</p>
          <p className="text-sm text-muted-foreground">
            Abra um personagem e torne-o piloto para começar.
          </p>
          <Button className="mt-4">
            <Link
              href="/app/characters"
              className="inline-flex items-center gap-2"
            >
              Ir para personagens
            </Link>
          </Button>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((driver) => (
            <DriverCard
              key={driver.characterId}
              driver={driver}
              onRemove={handleRemove}
              isRemoving={removingId === driver.characterId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
