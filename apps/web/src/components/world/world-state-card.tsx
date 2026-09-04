import { CalendarDays } from "lucide-react";
import { useRaces, useSeasons } from "@/hooks/use-championship";
import { useWorld } from "@/hooks/use-world";
import { RACE_SESSION_LABELS } from "@/lib/world";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Painel contextual (somente leitura) do estado global do universo.
// Reutiliza os dados já existentes de Season/Race (use-championship) para
// resolver os nomes a partir dos ids escalares mantidos no WorldState.
export function WorldStateCard() {
  const { data: world, isLoading } = useWorld();
  const { data: seasons } = useSeasons();

  const season = seasons?.find((s) => s.id === world?.currentSeasonId);
  const { data: races } = useRaces(season?.id ?? "");
  const race = races?.find((r) => r.id === world?.currentRaceId);

  if (isLoading) {
    return (
      <div className="space-y-2 text-muted-foreground">
        <p className="text-sm font-medium">Estado do mundo</p>
        <p className="text-xs">Carregando o estado atual…</p>
      </div>
    );
  }

  if (!world) {
    return null;
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <CalendarDays className="h-4 w-4" />
        Estado do mundo
      </p>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Data atual</dt>
          <dd className="text-right">{formatDate(world.currentDate)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Temporada atual</dt>
          <dd className="text-right">
            {season ? season.name ?? `Temporada ${season.year}` : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Corrida atual</dt>
          <dd className="text-right">{race?.name ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Sessão atual</dt>
          <dd className="text-right">
            {world.currentSession
              ? RACE_SESSION_LABELS[world.currentSession]
              : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}