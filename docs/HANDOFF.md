# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `9c1c006` — `feat(autonomy): execute conversation envelopes from selected opportunities` (F6.3)
- Working tree: limpo (após commit deste HANDOFF)
- Última fase concluída: F6.3
- Subfase atual: nenhuma; F6.4 não iniciada
- Próximo checkpoint: F6.4 — ponte eventos→oportunidade

## Roadmap (commits reais)
F5 (concluída):
- F5.1 emotion — `89358c6`
- F5.2 topic — `541d0f7`
- F5.3 memory — `91d319e`
- F5.4 knowledge asymmetry + buildDialogueContext — `4c6ac82`

F6:
- F6.1 conversation opportunity — `48e83ba` (concluída)
- F6.2 seleção no autonomy tick — `502f998` (concluída)
- F6.3 execução de envelope a partir da oportunidade (AI↔AI, TEST DB) — `9c1c006` (concluída)
- F6.4 ponte eventos→oportunidade — PENDENTE
- F6.5 evals F6-E01..E10 + full API/build + doc F6 — PENDENTE

F7 (private groups/secrets), F8 (UI/microbehaviors), F9 (benchmark gate): não iniciadas.

## Última implementação (F6.3)
Envelope de conversa executado a partir da oportunidade selecionada, SEM novo loop/writer:
- `autonomy.service.ts`: em `FULL`, após o loop comportamental, itera
  `opportunityPlan.selection.selected` (a MESMA seleção que gerou o audit F6.2 em
  `AiDecision.metadata.requestMetadata.conversationOpportunity`; não há recomputação nem terceiro
  transporte). Revalida conversa (`ACTIVE`, speaker/target participantes, todos no mesmo universe)
  e chama o pipeline existente `simulateConversationTurn` com seed e `maxDepth`. Envelope budget =
  `min(AUTONOMY_MAX_ACTIONS_PER_TICK - ações, AUTONOMY_MAX_MESSAGES_PER_TICK - mensagens usadas)`.
  Mensagens do envelope contam como RESPOND (actions/messages do tick). Resultado auditado no
  retorno do tick (`AutonomyTickResult.envelopes`) e por mensagem em `AiDecision`
  (`CONVERSATION_TURN_DUE`, status EXECUTED, `executedMessageId`). Personagens com oportunidade
  pulam a execução genérica de behavior no FULL (o envelope é a iniciativa; evita ação dupla).
- `conversation.simulation.ts`: `getSimulationPlan`/`simulateConversationTurn` aceitam
  `opportunity?: OpportunityEnvelopeSeed` ({ conversationId, characterId, targetCharacterId,
  fingerprint, windowStart }). Valida seed (conversa, speaker AI, disponibilidade, target
  participante); conversa vazia abre via `planOpportunityOpening` (candidate set do seed +
  planner determinístico + `validateDialoguePlan`); seed rejeitado por LOW_SCORE é promovido
  como `OPPORTUNITY_SEED`; planner recebe `preferredFirstSpeakerCharacterId` (primeiro turno do
  domínio, intenção/continuidade/stop continuam do planner); `maxDepth` explícito também limita
  os turns iniciais (cap do tick); target da oportunidade é preservado na abertura via override.
- `conversation.dialogue.ts`: `DialogueCandidateSet.lastMessageId` passou a `string | null`
  (abertura sem mensagem); planner determinístico honra `preferredFirstSpeakerCharacterId`
  (rotação estável do turno inicial); `allowedIntentsFor` exportado.
- `conversation.autonomous.ts`: `runAutonomousConversationTurn` aceita `targetCharacterId` para
  usar como alvo quando ainda não há mensagem (com histórico, a última mensagem continua o alvo).
- Modos: `OFF`/`PAUSED`/`STOPPED`/`REUSED` não executam envelope; `OBSERVER`/`GUIDED` seguem
  audit-only; `FULL` executa. Determinístico default; `simulateConversationTurn` sem provider usa
  `DeterministicDialogueRealizer` (nenhuma chamada LLM no caminho autônomo).
- Segurança anti-loop/duplicação: F6.2 já garante ≤1 oportunidade por conversa/personagem/tick,
  dedupe por fingerprint/evidenceId e cooldown por personagem/conversa (`TICK_WINDOW_HOURS`).
  F6.3 não reabre seleção: itera a lista selecionada uma única vez; `maxDepth` limita o envelope;
  tick repetido retorna `REUSED` antes de qualquer seleção/execução. Nenhum novo sistema de
  cooldown foi criado.
- Contexto F5 por speaker preservado: `simulateConversationTurn` continua chamando
  `retrieveRelevantMemories(characterId)` + emotion/topic/memory/knowledge/relationship por
  speaker; nada virou contexto compartilhado.
Testes: +17 (2 puros do planner, 5 do pipeline com opportunity seed, 10 no tick; teste FULL da
F6.2 adaptado para a nova semântica). Subset conversation+autonomy 29 files / 424 tests verde.
Suíte completa API 202 files / 2848 tests verde. `tsc --noEmit`, ESLint do escopo e build
`tsc -p` verdes.

## Próxima ação — F6.4 (exata)
Ponte eventos→oportunidade, sem novo writer/loop:
- inspecionar primeiro os triggers/consumidores existentes de eventos (`createEventWithDerivations`,
  `processRaceConsequences`, `evaluateBehaviorDecision` com triggers EVENT_CREATED/RACE_FINISHED/
  MEMORY_CREATED/RELATIONSHIP_CHANGED) e decidir se a ponte é (a) um adaptador que enfileira
  sinais para `buildConversationOpportunity`/`buildAutonomyOpportunityPlan` ou (b) metadata de
  trigger já existente — NUNCA event bus/outbox novo;
- manter fingerprint/evidenceId estáveis e o modo (OFF/OBSERVER/GUIDED/FULL) como em F6.2/F6.3;
- testes de dedupe/idempotência e de isolamento por universe; DEV read-only, TEST com cleanup.

## Decisões F6 (tomadas)
- Iniciativa automática só em GUIDED/FULL; OFF não executa; OBSERVER audit-only; GUIDED sem
  execução de envelope; FULL executa envelope via pipeline F3–F5.
- `AUTONOMY_MAX_CONVERSATIONS_PER_TICK=2` (env-configurável); envelope respeita também
  `AUTONOMY_MAX_ACTIONS_PER_TICK` e `AUTONOMY_MAX_MESSAGES_PER_TICK`.
- Não criar novo SimulationTick, event bus/outbox, pipeline textual ou writer.
- Reutilizar `evaluateBehaviorDecision`, Command Layer e `simulateConversationTurn`
  (planner/realizer/validator/contexto por speaker).
- Uma oportunidade = um envelope de conversa (0..N falas, AI↔AI permitido); primeira fala vem
  da oportunidade; continuação/stop vêm do planner existente.
- Consumo da oportunidade: a seleção em memória da F6.2 (fonte do audit) é passada ao envelope
  com fingerprint/evidenceId; não recomputar `buildAutonomyOpportunityPlan` no mesmo tick.

## Riscos conhecidos (F6)
- Loops A↔B entre envelopes → cooldown + fingerprint + ≤1 envelope/conversa/tick (F6.2/F6.3).
- Cascatas → janela/stop do planner + budgets de ações/mensagens/conversas do tick.
- Ticks concorrentes → fingerprint/lock do SimulationTick existente; tick repetido = REUSED.
- Duplicação → fingerprint por evidência/janela; mensagens passam pelo Command Layer.
- Custo LLM → caminho autônomo sem provider; realizer determinístico default.
- Vazamento entre universos → queries escopadas + validação de participantes + F5 por speaker.

## Regras essenciais
Ver `AGENTS.md`. DEV read-only; TEST com cleanup; um commit por subfase; nunca amend;
atualizar este HANDOFF ao fim de cada subfase; código real prevalece sobre o handoff.

## Prompt de retomada
"Leia `docs/HANDOFF.md` e `AGENTS.md`. Valide Git (branch, HEAD, working tree). Confirme que
o HEAD é o checkpoint registrado. Execute a próxima ação descrita no HANDOFF (F6.4). Rode os
testes/typecheck/lint, crie um commit novo, atualize `docs/HANDOFF.md` e pare no checkpoint
verde. Não use amend."
