# V3 — Implementation Log

## Fase 1 — Fundação de dados externos (circuitos)

- **Data:** 2026-09-25
- **Objetivo:** criar a fundação estruturada de circuitos/calendário externos, com provider abstrato, sync idempotente, lock/coalescing, registro de execuções e normalização defensiva — sem tocar nos dados narrativos do usuário.

### Arquivos principais
- `prisma/schema.prisma`: novos `ExternalCircuit`, `Circuit`, `ExternalBindingCircuit`, `ExternalSyncRun` (+ enum `ExternalSyncStatus`); `ExternalRace` ampliado (officialName, circuitExternalId, locality, country, latitude, longitude, time, url, externalCircuitId); `Race.circuitId` (opcional, legado preservado).
- `prisma/migrations/20260925180000_add_external_circuit_foundation/migration.sql`: aditiva (sem DROP).
- `apps/api/src/modules/external-sync/`: `external-data-provider.ts` (abstração + implementação Jolpica), `external-sync-run.ts` (lock/coalescing + registro `ExternalSyncRun`), `jolpica.client.ts` (`getCircuits` paginado + url/lat/long), `jolpica.normalizer.ts` (`normalizeCircuits`, `normalizeCircuitsFromRaces`, país normalizado, coordenadas validadas), `jolpica.persist.ts` (`persistCircuits`, corridas com circuito vinculado), `jolpica.service.ts` (escopo `CIRCUITS`, runs envolvendo fetch+persistência), `jolpica.routes.ts` (auditoria `triggeredById`).
- `apps/api/src/modules/circuits/circuit.service.ts`: `ensureCircuitForUniverse` (materialização por Universe + binding, idempotente).
- Testes: `jolpica.circuit-normalizer.test.ts`, `external-circuit-sync.test.ts`, `circuits/circuit.service.test.ts`; ajustes em `jolpica.normalizer.test.ts` e `jolpica-sync.integration.test.ts` (campos novos e contagem de circuitos).

### Migrations executadas
- `20260925180000_add_external_circuit_foundation` — aplicada em `f1-narrative` (dev, aditiva) e `f1_narrative_test` (testes).

### Testes executados
- Focados: 7 arquivos / 59 testes — 100%.
- Suíte completa API: 98 arquivos / 1696 testes — 100%.
- `typecheck` API: 0 erros. Lint API: 30 erros (baseline inalterado; 0 novos).

### Problemas encontrados
1. `prisma generate` falhou com `EPERM` (a instância do Kiro segurava a DLL do query engine). Intervenção mínima: parada apenas da API, migração aditiva no dev DB, `generate` e **um único** restart; health validado (200). Sem interrupção da web.
2. O registro `ExternalSyncRun` inicialmente envolvia apenas a persistência — falhas de fetch não eram auditadas. Corrigido: o run agora envolve **fetch + persistência** (e o lock cobre a chamada externa).

### Decisões tomadas
Ver `docs/v3-decisions.md` (D-001 a D-006).

### Limitações
- F1DB não integrado nesta fase; campos `lengthMeters/turns/direction/layoutKey` existem e ficam nulos até fonte aprovada (nada inventado).
- O provider cobre `getCircuits` e `getSeasonSchedule`; os demais escopos continuam no `JolpicaClient` (abstração incremental, sem big-bang).
- `CIRCUITS` ignora o ano no run (`seasonYear = null`).
- `Race.circuitId` permanece opcional; backfill de corridas legadas fica para a Fase 3 (calendário).
- O banco `f1_narrative_test` foi mantido durante a execução das fases (recriado é descartável) e será removido ao final da V3.

### Commit
- `feat(v3): add structured external circuit model` (hash registrado no relatório da execução).

### Próximo passo
- Fase 2 — Timeline foundation (`TimelineEvent` + `WorldSnapshot` + recompute determinístico reutilizando o engine de progressão).
