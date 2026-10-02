# V4 — Living F1 Universe (arquitetura consolidada)

## Fluxo final

```
WORLD STATE (canonical)
  → DOMAIN EVENTS / RACE RESULTS
  → EXPERIENCE (reconcilePilotExperiences)
  → MEMORY (projeção determinística + retrieval)
  → RELATIONSHIP (applyRelationshipDelta + histórico)
  → BEHAVIOR CONTEXT (determinístico, ON_TRACK apenas)
  → GOALS (CharacterGoal, derivação/reconciliação)
  → POLICY + SCORE (behavior-scoring.v1)
  → AI DECISION (AiDecision auditada)
  → COMMAND (único writer: Message/Event/Memory/Relationship)
  → CONSEQUÊNCIAS (news, social, memória)
  → PRÓXIMO TICK (autonomia)
```

## Fronteiras

- **Canonical:** WorldState, Season, SeasonDriverEntry, Race, RaceSession, RaceResult,
  ChampionshipStanding, TimelineEvent. Nunca escrito pelo motor narrativo/LLM.
- **Narrative/social:** Conversation, Message, Relationship, RelationshipChange, Event,
  PilotExperience, Memory, CharacterGoal, AiDecision, SimulationTick.
- **LLM:** periferia (linguagem/planejamento opcional); nenhum provider obrigatório; zero chamadas no
  loop autônomo por padrão. Providers configuráveis (Ollama existente).

## Entidades novas do V4

- `CharacterGoal` (V4.1): kind/priority/status/source/ruleCode/fingerprint/target/validade.
- `RelationshipChange` (V4.3): histórico auditável por dimensão com fingerprint idempotente.
- `SimulationTick` (V4.5): janela/versão/status/dryRun/fingerprint único + summary.
- `Universe.autonomyMode/autonomyStatus/lastSimulationAt/nextSimulationAt/simulationVersion` (V4.7).
- `AiActionType` estendido (RESPOND/CREATE_MEMORY/UPDATE_RELATIONSHIP) e `Conversation.status`.

## Migrations do V4

| Fase | Migration |
| --- | --- |
| V4.0 | `20261001180000_extend_ai_action_type` |
| V4.1 | `20261001190000_add_character_goal` |
| V4.2 | `20261001200000_add_conversation_status` |
| V4.3 | `20261001210000_add_relationship_change` |
| V4.5 | `20261001220000_add_simulation_tick` |
| V4.7 | `20261001230000_add_universe_autonomy` |

Todas aditivas; DEV com 44 migrations; backups por fase (`f1narrative_dev_pre_v40/v42/v43/v45/v47`).

## APIs novas

- Behavior: goals (CRUD manual), decisions (avaliar/consultar/executar).
- Conversas: turn-plan e autonomous-turn (V4.2).
- World: simulation-tick e simulation-ticks (V4.5).
- Autonomia: GET/PATCH autonomy, POST autonomy/tick (V4.7).
- Observability: decision trace, simulation trace, activity, metrics (V4.8).

## Serviços principais

- Behavior: `behavior.{context,goals,policy,scoring,decision,commands,execution,language}`.
- Conversa: `conversation.{policy,turn-engine,autonomous}`.
- Relações: `relationship.{rules,evolution}` + `event-evolution` (writer único).
- Memória: `memory.{policy,retrieval}` + `pilot-experience.reconcile` (Experience→Memory).
- Simulação: `world-simulation.tick` + `race-consequences.service`.
- Autonomia: `autonomy.service`.
- Observabilidade: `observability.service`.

## Invariantes globais

- Universe isolation em todos os writers; ownership por universo/usuário; USER nunca autônomo.
- Idempotência: fingerprints (ação, goal, relationship change, tick) + derivedKey (memória) +
  sourceKey (experience) + guardas de duplicata (decisões por tick/race).
- Stale: decisões revalidam contexto antes de executar (`STALE_CONTEXT`).
- Correções: `invalidatePilotExperienceForCorrection` + `invalidateRaceConsequences`.
- Cânone imutável pelo motor narrativo; retries não duplicam efeitos.

## Testes (V4)

V4.0 20 · V4.1 37 (behavior total) · V4.2 20 · V4.3 8 · V4.4 6 · V4.5 8 · V4.6 6 · V4.7 9 · V4.8 4
(mais regressões de módulos existentes). Suíte final: API 2649/2649 (184 arquivos), Web 506/506.

## Limitações e dívida técnica

- Sem fila durável (pg-boss) — runner explícito; documentado como evolução.
- Sessões practice/qualifying/sprint não geram consequências dedicadas.
- Semantic memory (pgvector) não usada — retrieval determinístico cobre o volume atual.
- UI de inspetor de comportamento não construída (APIs de trace prontas).
- Resíduo legado de messages/events/conversations no TEST (pré-existente).
