"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ExternalSourceBadge } from "@/components/external/external-source-badge";
import { UniverseEditorContent } from "@/components/universe/universe-roster-comparison";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { usePlayerEntrySetup } from "@/hooks/use-player-entry";
import { useWorld } from "@/hooks/use-world";

export default function UniverseEditorPage() {
  const setup = usePlayerEntrySetup();
  const world = useWorld();

  const seasons = useMemo(() => setup.data?.seasons ?? [], [setup.data]);

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedSeasonId != null) return;
    const current = world.data?.currentSeasonId;
    const preferred = seasons.some((s) => s.id === current)
      ? current
      : (seasons[0]?.id ?? null);
    if (preferred != null) {
      setSelectedSeasonId(preferred);
    }
  }, [seasons, selectedSeasonId, world.data?.currentSeasonId]);

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="UNIVERSO / UNIVERSE EDITOR"
        title="Editor de Universo"
        description="Compare a configuração da FONTE EXTERNA (somente leitura) com o estado atual do seu universo narrativo. Divergências são escolhas de narrativa e só mudam com sua ação explícita."
        meta={
          <>
            <span>Fonte externa legada como ponto de referência</span>
            <span>Cada equipe espelhada é comparada assento a assento</span>
          </>
        }
        action={<ExternalSourceBadge className="self-start" />}
      />

      {setup.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {setup.isError ? (
        <ErrorState
          heading="h2"
          title="Dados indisponíveis"
          description="Não foi possível carregar as temporadas do universo."
          action={
            <Button
              variant="outline"
              onClick={() => void setup.refetch()}
              disabled={setup.isRefetching}
            >
              {setup.isRefetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Tentar novamente
            </Button>
          }
        />
      ) : null}

      {!setup.isLoading && !setup.isError && seasons.length === 0 ? (
        <EmptyState
          kicker="UNIVERSE EDITOR"
          title="Nenhuma temporada espelhada."
          description="Crie temporadas e vincule a fonte externa para habilitar o editor de universo."
        />
      ) : null}

      {!setup.isLoading &&
        !setup.isError &&
        seasons.length > 0 &&
        selectedSeasonId != null ? (
        <UniverseEditorContent
          seasons={seasons}
          seasonId={selectedSeasonId}
          onSeasonChange={setSelectedSeasonId}
        />
      ) : null}
    </div>
  );
}