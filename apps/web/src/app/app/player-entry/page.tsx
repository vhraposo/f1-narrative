"use client";

import { PlayerEntryFlow } from "@/components/player-entry/player-entry-flow";
import { PageHeader } from "@/components/ui/page-header";

export default function PlayerEntryPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        kicker="UNIVERSO / PLAYER ENTRY"
        title="Entrar na F1"
        description="Crie seu personagem e entre no grid espelhado de uma temporada do mundo real."
      />
      <PlayerEntryFlow />
    </div>
  );
}