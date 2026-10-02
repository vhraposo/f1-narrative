# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `31981a3` — `docs: add continuity handoff and agent rules` (F6.1 permanece em `48e83ba`)
- Working tree: limpo
- Última fase concluída: F6.1
- Subfase atual: nenhuma; F6.2 não iniciada (sessão encerrada por orçamento de contexto —
  retomar pela seção "Próxima ação — F6.2" abaixo, sem repetir a investigação)
- Próximo checkpoint: F6.2 — seleção de oportunidades no `runAutonomousTick`

## Roadmap (commits reais)
F5 (concluída):
- F5.1 emotion — `89358c6`
- F5.2 topic — `541d0f7`
- F5.3 memory — `91d319e`
- F5.4 knowledge asymmetry + buildDialogueContext — `4c6ac82`

F6:
- F6.1 conversation opportunity — `48e83ba` (concluída)
- F6.2 seleção no autonomy tick — PENDENTE
- F6.3 execução de envelope a partir da oportunidade (AI↔AI, TEST DB) — PENDENTE
- F6.4 ponte eventos→oportunidade — PENDENTE
- F6.5 evals F6-E01..E10 + full API/build + doc F6 — PENDENTE

F7 (private groups/secrets), F8 (UI/microbehaviors), F9 (benchmark gate): não iniciadas.

## Última implementação (F6.1)
`conversation/conversation.opportunity.ts`: `ConversationOpportunitySchema` (universeId,
conversationId, characterId, targetCharacterId?, reason, priority 0..1, fingerprint sha256,
windowStart ISO) e `buildConversationOpportunity` puro/determinístico; taxonomia fechada
(WORLD_EVENT, RELATIONSHIP_CHANGE, MEMORY_TRIGGER, GOAL_PRESSURE, INACTIVITY); fingerprint
`sha256(universe:conversa:personagem:target|none:reason:windowStart:evidenceId)`; sem DB/LLM/
efeitos; retorna null para universo divergente, não-participante, target fora ou strength ≤ 0.
Testes: +12 (suíte conversation 372/372).

## Próxima ação — F6.2 (exata)
Selecionar oportunidades dentro do `runAutonomousTick` (`autonomy/autonomy.service.ts`),
sem novo loop:
- executar somente em `GUIDED`/`FULL`; `OFF` sem execução; `OBSERVER` audit-only;
- derivar sinais de fontes existentes (Event/race-consequences, CharacterGoal,
  RelationshipChange, Memory, inatividade da conversa vs `TICK_WINDOW_HOURS`);
- dedupe por fingerprint/evidenceId; cooldown por personagem/conversa;
- prioridade estável com desempate determinístico; fairness existente;
- novo budget `AUTONOMY_MAX_CONVERSATIONS_PER_TICK` (default 2, env) em
  `autonomy/autonomy.policy.ts`;
- registrar seleção/audit em `AiDecision.metadata` (sem novo writer);
- testes unitários da seleção; sem executar conversa ainda (isso é F6.3).

## Decisões F6 (tomadas)
- Iniciativa automática só em GUIDED/FULL; OFF não executa; OBSERVER audit-only.
- `AUTONOMY_MAX_CONVERSATIONS_PER_TICK=2` (env-configurável).
- Não criar novo SimulationTick, event bus/outbox, pipeline textual ou writer.
- Reutilizar `evaluateBehaviorDecision`, Command Layer e o pipeline F3–F5
  (planner/realizer/validator/contexto por speaker).
- Uma oportunidade = um envelope de conversa (0..N falas, AI↔AI permitido).

## Riscos conhecidos (F6)
- Loops A↔B entre envelopes → cooldown + fingerprint + ≤1 envelope/conversa/tick.
- Cascatas → janela/stop do planner + `AUTONOMY_MAX_ACTIONS_PER_TICK`.
- Ticks concorrentes → fingerprint/lock do SimulationTick existente.
- Duplicação → fingerprint por evidência/janela.
- Custo LLM → `AUTONOMY_MAX_LLM_CALLS_PER_TICK=0` + realizer determinístico default.
- Vazamento entre universos → queries escopadas + `buildDialogueContext` por speaker (F5).

## Regras essenciais
Ver `AGENTS.md`. DEV read-only; TEST com cleanup; um commit por subfase; nunca amend;
atualizar este HANDOFF ao fim de cada subfase; código real prevalece sobre o handoff.

## Prompt de retomada
"Leia `docs/HANDOFF.md` e `AGENTS.md`. Valide Git (branch, HEAD, working tree). Confirme que
o HEAD é o checkpoint registrado. Execute a próxima ação descrita no HANDOFF (F6.2). Rode os
testes/typecheck/lint, crie um commit novo, atualize `docs/HANDOFF.md` e pare no checkpoint
verde. Não use amend."
