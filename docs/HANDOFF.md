# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `502f998` — `feat(autonomy): select conversation opportunities in autonomous tick` (F6.2)
- Working tree: limpo (após commit deste HANDOFF)
- Última fase concluída: F6.2
- Subfase atual: nenhuma; F6.3 não iniciada
- Próximo checkpoint: F6.3 — execução de envelope a partir da oportunidade (AI↔AI, TEST DB)

## Roadmap (commits reais)
F5 (concluída):
- F5.1 emotion — `89358c6`
- F5.2 topic — `541d0f7`
- F5.3 memory — `91d319e`
- F5.4 knowledge asymmetry + buildDialogueContext — `4c6ac82`

F6:
- F6.1 conversation opportunity — `48e83ba` (concluída)
- F6.2 seleção no autonomy tick — `502f998` (concluída)
- F6.3 execução de envelope a partir da oportunidade (AI↔AI, TEST DB) — PENDENTE
- F6.4 ponte eventos→oportunidade — PENDENTE
- F6.5 evals F6-E01..E10 + full API/build + doc F6 — PENDENTE

F7 (private groups/secrets), F8 (UI/microbehaviors), F9 (benchmark gate): não iniciadas.

## Última implementação (F6.2)
`autonomy/autonomy.opportunities.ts`: derivação e seleção determinística de oportunidades.
- `buildAutonomyOpportunityPlan`: fontes existentes somente leitura — Event no mundo
  (`worldDate` na janela, via EventCharacter), RelationshipChange (`createdAt` na janela),
  Memory ACTIVE (`createdAt` na janela, via MemoryCharacter), CharacterGoal ACTIVE
  (`priority/100`) e inatividade da conversa vs `TICK_WINDOW_HOURS` (idle desde a última
  mensagem/`conversation.createdAt`; strength 0.5 em 1 janela e 1.0 em 2+). Gera candidatos
  via `buildConversationOpportunity` (F6.1) com `windowStart = fromDate` e `evidenceId` prefixado
  (`event:`, `relationship-change:`, `memory:`, `goal:`, `inactivity:`).
- `selectConversationOpportunities` (puro): ordena por prioridade desc → fairness rank
  (ordem de `listAutonomousCharacters`, lastActionAt asc/id asc) → ordem de razão → conversationId
  → fingerprint; dedupe por fingerprint/evidenceId; cooldown por personagem/conversa (horizonte
  `TICK_WINDOW_HOURS`, lido de `AiDecision.metadata` anteriores); ≤1 personagem e ≤1 conversa por
  tick; budget `AUTONOMY_MAX_CONVERSATIONS_PER_TICK` (default 2). Somente leitura: sem DB write,
  sem LLM, sem executar conversa.
- `autonomy.service.ts`: no fluxo existente (sem novo loop), seleciona após `runSimulationTick`,
  usa a conversa/target da oportunidade na `evaluateBehaviorDecision` (fallback para o caminho
  antigo quando não há oportunidade) e audita em `AiDecision.metadata.requestMetadata`:
  `conversationOpportunity` (fingerprint, evidenceId, conversationId, characterId, target, reason,
  priority, windowStart, rank) e `opportunitySelection` (candidateCount, selectedCount, budget,
  budgetExhausted). OFF/PAUSED/STOPPED/REUSED não selecionam; OBSERVER/GUIDED/FULL selecionam e
  auditam; dry-run não seleciona.
- `autonomy.policy.ts`: novo budget `maxConversationsPerTick` (env
  `AUTONOMY_MAX_CONVERSATIONS_PER_TICK`, default 2).
Testes: +26 (16 puros de seleção + 10 de integração TEST DB com cleanup). Suíte completa API
201 files / 2831 tests verde. `tsc --noEmit` verde, ESLint do escopo verde, build (`tsc -p`) verde.
Flake observado 1x (não reproduzido): `pilot-knowledge.provision.test.ts` ordenação de marcos da
biografia em run completo; passou isolado e no rerun completo — não relacionado a F6.2.
Limitações de F6.2: candidatos consideram apenas os personagens retornados por
`listAutonomousCharacters` (até `AUTONOMY_MAX_CHARACTERS_PER_TICK`); rejeições da seleção
não são persistidas (só seleção + resumo em `AiDecision.metadata`); dry-run não seleciona.

## Próxima ação — F6.3 (exata)
Executar envelope de conversa a partir da oportunidade selecionada, SEM novo loop/writer:
- consumir a oportunidade auditada em `AiDecision.metadata.requestMetadata.conversationOpportunity`
  e/ou recomputar via `buildAutonomyOpportunityPlan` (fingerprint estável por janela);
- por oportunidade selecionada (≤ `AUTONOMY_MAX_CONVERSATIONS_PER_TICK`), chamar o pipeline
  existente `runAutonomousConversationTurn` / `planConversationTurn` + realizer/validator F3–F5
  (AI↔AI permitido; executor decide continuidade/stop; Command Layer continua writer único);
- manutenção de modo: OBSERVER/GUIDED sem execução de conversa; FULL pode executar; OFF nunca;
- determinístico default; LLM somente atrás de flag (`AUTONOMY_MAX_LLM_CALLS_PER_TICK=0`);
- testes AI↔AI em TEST DB (cleanup), envelope 0..N falas, isolamento por universe e nenhuma
  chamada `simulateConversationTurn` nova fora do pipeline existente.

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
o HEAD é o checkpoint registrado. Execute a próxima ação descrita no HANDOFF (F6.3). Rode os
testes/typecheck/lint, crie um commit novo, atualize `docs/HANDOFF.md` e pare no checkpoint
verde. Não use amend."
