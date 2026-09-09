import { SectionHeading } from "@/components/home/section-heading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ExternalSectionEmpty,
  ExternalSectionError,
  ExternalSectionLoading,
} from "@/components/external/external-section-state";
import { ExternalSourceBadge } from "@/components/external/external-source-badge";
import type {
  ExternalDriverSeason,
  ExternalTeam,
} from "@/lib/external-world";
import { cn } from "@/lib/utils";

type ExternalTeamsProps = {
  year: number;
  driverSeasons: ExternalDriverSeason[];
  teamsByExternalId: Record<string, ExternalTeam>;
  isLoading: boolean;
  isError: boolean;
  refetching: boolean;
  onRetry: () => void;
};

type SeasonTeam = {
  externalId: string;
  name: string;
  shortName: string | null;
  color: string | null;
  driverCount: number;
};

export function ExternalTeams({
  year,
  driverSeasons,
  teamsByExternalId,
  isLoading,
  isError,
  refetching,
  onRetry,
}: ExternalTeamsProps) {
  const seasonTeams = new Map<string, SeasonTeam>();
  for (const ds of driverSeasons) {
    if (!ds.teamExternalId) continue;
    const existing = seasonTeams.get(ds.teamExternalId);
    const team = teamsByExternalId[ds.teamExternalId];
    if (existing) {
      existing.driverCount += 1;
    } else {
      seasonTeams.set(ds.teamExternalId, {
        externalId: ds.teamExternalId,
        name:
          team?.name ?? ds.teamNameSnapshot ?? "Equipe desconhecida",
        shortName: team?.shortName ?? null,
        color: team?.color ?? null,
        driverCount: 1,
      });
    }
  }
  const teams = [...seasonTeams.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <section aria-label="Equipes externas" className="space-y-4">
      <SectionHeading
        kicker="Dados Externos"
        title="Equipes"
        action={<ExternalSourceBadge />}
      />
      {isLoading && <ExternalSectionLoading />}
      {isError && (
        <ExternalSectionError
          description="Não foi possível carregar as equipes da fonte."
          refetching={refetching}
          onRetry={onRetry}
        />
      )}
      {!isLoading && !isError && teams.length === 0 && (
        <ExternalSectionEmpty
          title={`Não há equipes da fonte para ${year}.`}
          description="As equipes são derivadas dos pilotos da temporada (ExternalDriverSeason) informados na fonte."
        />
      )}
      {!isLoading && !isError && teams.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <Card key={team.externalId}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span
                    aria-hidden
                    className={cn(
                      "h-5 w-1 shrink-0 rounded-full bg-foreground/10",
                    )}
                    style={team.color ? { backgroundColor: team.color } : undefined}
                  />
                  <span className="truncate">{team.name}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {team.shortName ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  ID externo: {team.externalId}
                </p>
                <p className="text-xs text-muted-foreground">
                  {team.driverCount} piloto{team.driverCount === 1 ? "" : "s"} na
                  temporada
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}