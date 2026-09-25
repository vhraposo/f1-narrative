# F1 Narrative Universe — Roadmap V3 (Proposta)

> Documento de proposta para as fases pós-V2 (V3.00+). Auditoria V3.00 concluída
> sobre o estado final do V2 (`ad339b3`, branch `V3-Changes`). Este documento é a
> base de decisão para o planejamento das fases V3.01 em diante e complementa o
> `docs/roadmap.md` (fases 1–13, todas ACCEPTED).

---

## 1. Estado auditado (V3.00)

| Fase | Escopo | Status |
|---|---|---|
| V2.13–V2.15 | race-weekend UI, championship-progression, narrative, race-narrative, driver-entry, world-state | **ACCEPTED** |
| V2.16 | QA hardening (suíte complete, runtime E2E, concorrência, DEV intacta) | **ACCEPTED** (sem diff de código) |

Baseline atual:

- Suíte: 94 arquivos, 1662 testes — **1659 passed, 3 failed** (pre-existentes).
- Typecheck API: 0. Lint API: 30 erros pre-existentes (0 nos módulos V2).
- Web tsc: 4 erros pre-existentes. Web lint: 0 erros / 13 warnings.
- DBs residuais no Postgres: `f1_narrative` (DEV, intocada), `f1_narrative_test`
  (DB canônico de teste, com dados residuais das execuções), `f1nw_qa_v212`
  (sobra de QA do V2.12, nunca removida).

---

## 2. Auditoria de gaps (A–M)

| Item | Classificação | Evidência |
|---|---|---|
| A. Circuit data | **PARTIAL** | `Race.circuit/country/date/round` strings opcionais (schema L364–366); `ExternalRace.circuitName` (L622). Sem model `Circuit`, sem trackMap, sem lat/lng. |
| B. Calendar | **PARTIAL** | Grid de RaceCards em `championship/page.tsx` ("Calendário de corridas"); `external-calendar.tsx`. Sem view de calendário dedicada. |
| C. Race sessions | **PARTIAL** | enum `RaceSession {PRACTICE, QUALIFYING, RACE}` (L50–54) + `WorldState.currentSession` (L1153); `RaceStatus` UPCOMING→QUALIFYING→RACE→FINISHED (L42–47); qualifying sim existe. Sem simulação de practice, sem sprint, sem modelos `QualifyingSession`/`PracticeSession`. |
| D. Driver number | **PARTIAL / conflito de modelo** | `DriverProfile.number Int?` (global, L289) **e** `SeasonDriverEntry.number Int?` (season, L446). Espelhos externos `ExternalDriver.number` e `ExternalDriverSeason.number`. Sem unique, sem validação, sem regra esportiva. |
| E. Next Race experience | **MISSING** | Sem banner "next race", sem contagem regressiva, sem página dedicada. |
| F. Timeline | **MISSING** | Sem Timeline; edição retroativa de eventos exigirá system de revision/rebuild. |
| G. User Profile | **MISSING** | Sem página de perfil/nick/avatar/config do usuário. |
| H. News × temporada | **PARTIAL** | `NewsItem` derivado de `Event` (Fase 7), sem integração com calendário/resumo de temporada. |
| I. External refresh | **PARTIAL** | Sync externo único existente; sem refresh por season; Universe Truth protegida (nunca sobrescrever). |
| J. Streaming/SSE | **MISSING** | `stream:false` no Ollama; sem `@fastify/websocket`, sem SSE. |
| K. IA / decisão autônoma | **PARTIAL** | Provider DI + rotas de geração (craft/generate, NullProvider por default, `COHERE_API_KEY` runtime fail-closed). Sem scheduler/autonomia. |
| L. Driver/Team evolution | **PARTIAL** | `TeamPerformance`, `DriverAttribute` existem e alimentam a simulação. Sem evolução atributal por temporada codificada. |
| M. WorldState progression | **PARTIAL** | `WorldState` com `currentSession`; transições de `RaceStatus`; championship-progression/apply existe. Progression ainda manual/por rota. |

Modelos de número do piloto (confirmado no schema):

- `DriverProfile.number Int?` — global, não-nullable-vazio, sem constraint única.
- `SeasonDriverEntry.number Int?` — season-scoped, sem constraint única.
- `ExternalDriver.number Int?` / `ExternalDriverSeason.number Int?` — espelhos da fonte externa.

Frontend sem: Calendar dedicado, Timeline, User Profile, Next Race banner, upload de headshot (headshots são URLs externas renderizadas direto no `<img>`; sem `@fastify/static`).

Infra: env zod exige apenas `BETTER_AUTH_SECRET` + `DATABASE_URL`; `COHERE_API_KEY` em runtime (`defaultRagProvider()`, fail-closed).

---

## 3. Dependency graph (código real)

```
External sync (Jolpica/OpenF1) ──► ExternalRace / ExternalDriver / ExternalTeam
Calendar / Circuit ──────────────► ExternalRace + Race
Driver number ───────────────────► DriverProfile.number + SeasonDriverEntry.number + ExternalDriver.number
Next Race ───────────────────────► Season + Race(status/date) + WorldState.currentSession + RaceStatus
Sessions ────────────────────────► RaceStatus + WorldState + race-simulation + qualifying.routes
News ────────────────────────────► Event (já implementado, Fase 7)
Timeline ────────────────────────► Event + WorldState + WorldStateEvent (edição retroativa ⇒ rebuild)
Streaming ───────────────────────► generation routes (craft/generate) + provider DI
WorldState progression ──────────► championship-progression + race-simulation + apply
```

---

## 4. Propuesta de fases V3.01+

Sequência recomendada por dependência arquitetural (não por ordem alfabética):

| Fase | Nome | Objetivo-chave |
|---|---|---|
| V3.01 | Circuit Catalog | model `Circuit` único (trackMap, lat/lng, país), `Race.circuitId`, seed, view web |
| V3.02 | Race Calendar sync | calendário externo (mirror separado de Universe Truth), sync Jolpica |
| V3.03 | Driver Number Management | driver number season-aware, colisões, regra esportiva, espelho externo |
| V3.04 | Race Weekend / Sessions | simulação de practice + qualifying + race, sprint, lifecycle `WorldState.currentSession` |
| V3.05 | Next Race experience | banner + página com contagem regressiva |
| V3.06 | Timeline | linha do tempo de eventos + edição retroativa com revision/rebuild |
| V3.07 | News × temporada | filtros/resumo de temporada |
| V3.08 | External refresh | refresh por season manual, proteção Universe Truth |
| V3.09 | Real-time / streaming | SSE sobre geração |
| V3.10 | AI behavior | scheduler leve, componente de decisão |
| V3.11 | Driver/Team evolution | atributos dinâmicos por temporada |
| V3.12 | WorldState progression auto | transições automáticas de fase |
| V3.13 | Tech debt autorizado | bloom das 3 falhas baseline, lint/typecheck, DBs residuais |

Cada fase, ao ser executada, deve registrar: objetivo, entidades, dependências,
escopo, não-escopo, critérios de aceite, backend tests, typecheck, lint, build,
smoke E2E, persistência/DB, integridade DEV/TEST.

---

## 5. Decisões de produto necessárias (blockers para fases específicas)

1. **Driver number**: fonte de verdade é global (`DriverProfile.number`) ou
   season-scoped (`SeasonDriverEntry.number`)? O schema tem ambos — escolher um
   para regra de colisão/validação. (Block V3.03)
2. **Circuit**: criar model dedicado com ID estável (recomendado) ou manter
   strings livres com normalização? (Block V3.01)
3. **Calendar sync**: automático (cron) ou manual trigger? Permitir
   override parcial do calendário externo no universo? (Block V3.02)
4. **Prerrogativa retroactiva**: edição retroativa de eventos na Timeline deve
   invalidar o estado derivado (rebuild) ou criar ramificação? (Block V3.06)
5. **Streaming**: SSE na rota `POST /generate` existente ou nova rota dedicada?
   (Block V3.09)
6. **IA scheduler**: autonomia programada é aceitável agora ou permanece
   pós-V3? (Block V3.10)
7. **Migração de dados V2**: os números fake (1–99) usados em seed precisam de
   migração quando o driver number virar único por season? (Block V3.03)
8. **DBs residuais**: `f1_narrative_test` (dados) e `f1nw_qa_v212` — dropar
   requer autorização (DEV intocada). (Block V3.13 opcional)

---

## 6. Critérios de conclusão do V3.00

- Auditoria consolidada (esta seção 2) com evidências no schema/routes/web.
- Dependency graph do código real (seção 3).
- Propuesta de fases V3.01+ com sequência recomendada (seção 4).
- Lista de decisões de produto (blockers) (seção 5).
- Commits em `V3-Changes` apenas; DEV DB intocada; sem push.