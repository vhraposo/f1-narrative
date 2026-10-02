# Dialogue Engine — F6

## Estado
- Branch `v4-Living-F1-Universe`.
- Commits F6: F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`,
  F6.5 (este commit).
- Nenhum commit anterior reescrito; sem amend, push ou migration.
- Execução F6.5: evals F6-E01..E10 (TEST DB, determinístico) + validação completa + este doc.

## Objetivo da F6
Dar iniciativa autônoma determinística ao Dialogue Engine: evidências de domínio
(evento/memória/relationship/goal/inatividade) viram oportunidade de conversa, o tick autônomo
seleciona com fairness/dedupe/cooldown, e em FULL cada oportunidade gera no máximo um envelope
executado pelo pipeline existente F3–F5, com o Command Layer como writer único.

## Arquitetura
Cadeia inegociável mantida:
`DOMÍNIO → EVENTO/EVIDÊNCIA → OPPORTUNITY SIGNAL → ConversationOpportunity → AUTONOMY SELECTION
→ ENVELOPE → PLANNER → REALIZER → OUTPUT VALIDATOR → DOMAIN GATE → COMMAND LAYER → Message`.
Nada decide conteúdo fora do planner/realizer; a oportunidade apenas indica que existe conversa
e quem inicia. LLM não decide regra de domínio; default determinístico.

## F6.1 — ConversationOpportunity
`conversation/conversation.opportunity.ts`: schema (universeId, conversationId, characterId,
targetCharacterId?, reason, priority 0..1, fingerprint sha256, windowStart ISO) e
`buildConversationOpportunity` puro/determinístico com taxonomia fechada (WORLD_EVENT,
RELATIONSHIP_CHANGE, MEMORY_TRIGGER, GOAL_PRESSURE, INACTIVITY); retorna null para universo
divergente, não-participante, target fora ou strength ≤ 0.

## F6.2 — Seleção no tick autônomo
`autonomy/autonomy.opportunities.ts`: `buildAutonomyOpportunityPlan` deriva candidatos no tick e
`selectConversationOpportunities` (puro) ordena por prioridade desc → fairness rank (ordem de
`listAutonomousCharacters`) → razão → conversationId → fingerprint; dedupe por
fingerprint/evidenceId; cooldown por personagem/conversa (horizonte `AUTONOMY_TICK_WINDOW_HOURS`);
≤1 oportunidade por personagem e por conversa/tick; budget
`AUTONOMY_MAX_CONVERSATIONS_PER_TICK` (default 2). `autonomy.service.ts` audita
`conversationOpportunity` e `opportunitySelection` em `AiDecision.metadata.requestMetadata`.
OFF/PAUSED/STOPPED/REUSED não selecionam; OBSERVER/GUIDED/FULL selecionam e auditam.

## F6.3 — Envelope a partir da oportunidade
`autonomy.service.ts` (FULL, após o loop comportamental): revalida conversa ACTIVE, speaker/target
participantes e todos no mesmo Universe; chama `simulateConversationTurn` com seed
(`OpportunityEnvelopeSeed`: conversationId, characterId, targetCharacterId, fingerprint,
windowStart) e `maxDepth` = min(ações restantes, mensagens restantes). `conversation.simulation.ts`
ganhou opening de conversa vazia (`planOpportunityOpening`), promoção do seed LOW_SCORE como
`OPPORTUNITY_SEED`, `preferredFirstSpeakerCharacterId` no planner determinístico e cap de turns
iniciais por `maxDepth`. `conversation.autonomous.ts` aceita target da oportunidade na abertura.
Mensagens contam como RESPOND nos budgets do tick; personagens com oportunidade pulam a execução
genérica de behavior (evita ação dupla). Resultado auditado em `AutonomyTickResult.envelopes` e
por mensagem em `AiDecision` (CONVERSATION_TURN_DUE, EXECUTED, executedMessageId).

## F6.4 — Ponte eventos→oportunidade
`conversation/conversation.opportunity-bridge.ts` (puro): converte `OpportunityEvidence`
(EVENT/MEMORY/RELATIONSHIP_CHANGE/GOAL/INACTIVITY) em `ConversationOpportunitySignal[]`.
Estratégia A (adaptador), pois `EVENT_CREATED`/`MEMORY_CREATED`/`RELATIONSHIP_CHANGED` não têm
consumidor de produção e `RACE_FINISHED` só gera audit em `processRaceConsequences`; a ponte não
persiste nada, não cria event bus/outbox/fila/worker/writer.
`evidenceId` canônico por raiz: EVENT `event:<id>`; MEMORY com `eventId` → `event:<eventId>`
(senão `memory:<id>`); RELATIONSHIP_CHANGE `sourceType=EVENT`+`sourceId` → `event:<sourceId>`
(senão `relationship-change:<id>`); GOAL `goal:<id>`; INACTIVITY
`inactivity:<conversationId>:<lastMessageId|none>`. `applyEventEvolution` cria RelationshipChange
(EVENT) e Memory (eventId) do mesmo evento, que convergem para a mesma evidência.

## F6.5 — Evals e fechamento
`conversation/conversation.dialogue-f6-evals.test.ts` — 10 evals E01..E10 + agregação de métricas,
em TEST DB com fixtures próprias e cleanup em `afterAll` (users, universes, characters,
conversations, messages, events/derivações, memories, goals, relationships, decisions, ticks).
Resultados reais desta execução (todos PASS):
- E01 evento gera oportunidade: 1 audit WORLD_EVENT, `evidenceId=event:<id>`, fingerprint sha256,
  windowStart da janela.
- E02 personagem irrelevante excluído: evento [A,B] em conversa [A,C] → só A inicia; B sem audit.
- E03 personagem relevante inicia (FULL): A inicia respondendo a mensagem de B (replyTo real).
- E04 AI→AI espontâneo: conversa sem USER; A abre; todas as mensagens AI_CHARACTER.
- E05 reação relationship-aware: plano contém RELATIONSHIP_SIGNAL; target B preservado no decision.
- E06 oportunidade duplicada bloqueada: evento + memória derivada + changes convergem em
  `event:<id>`; 1 audit com candidateCount ≥ 4 e selectedCount 1.
- E07 cooldown bloqueia spam: tick 2 sem audit novo; tick 3 libera após o horizonte.
- E08 stop natural: envelope 1 fala, stop NO_OPPORTUNITY, sem mensagem adicional.
- E09 isolamento de Universe: evento home não vaza; universe estrangeiro sem decisions e com
  mensagens intactas.
- E10 replay determinístico: plano replicado com mesmos fingerprints/evidenceIds; tick repetido
  REUSED sem novas decisions/envelopes.

## Fluxo completo
1. Evidência persistida (Event/derivações, Memory, RelationshipChange, CharacterGoal, inatividade).
2. Ponte F6.4 → `ConversationOpportunitySignal` por personagem AI elegível na conversa.
3. `buildConversationOpportunity` (F6.1) → candidato com fingerprint determinístico.
4. Seleção F6.2 (prioridade, fairness, dedupe, cooldown, caps, budget).
5. Audit em `AiDecision.metadata.requestMetadata` (sem writer novo).
6. Em FULL: `simulateConversationTurn` com seed → planner (intenção/continuidade/stop) → realizer
   → output validator → domain gate (`evaluateBehaviorDecision`, RESPOND) → Command Layer
   (`executeBehaviorDecision` → Message).
7. Auditoria do envelope no retorno do tick e por mensagem.

## Budgets
- `AUTONOMY_MAX_CONVERSATIONS_PER_TICK` (default 2): envelopes por tick.
- `AUTONOMY_MAX_ACTIONS_PER_TICK`, `AUTONOMY_MAX_MESSAGES_PER_TICK`: capam as falas do envelope.
- `AUTONOMY_TICK_WINDOW_HOURS`: janela de evidências e horizonte de cooldown.
- Limites de conversa F3 (`maxAiTurnsPerRound`, `maxTotalAiMessages`, `maxConsecutiveSameSpeaker`,
  `inactivityTimeoutMs`) e janela de energia continuam valendo por envelope.

## Dedupe
Fingerprint sha256 por (universe, conversa, personagem, target, razão, windowStart, evidenceId);
`DUPLICATE_FINGERPRINT` e `DUPLICATE_EVIDENCE` na seleção; ≤1 por personagem/conversa/tick;
evento + memória derivada + relationship change derivado compartilham `event:<id>`.

## Cooldown
Derivado de audits anteriores no horizonte `AUTONOMY_TICK_WINDOW_HOURS` (personagem, conversa,
fingerprint, evidenceId). Sem novo sistema de cooldown.

## Fingerprint / evidenceId
Algoritmo F6.1 inalterado. `evidenceId` canônico por raiz de domínio (ver F6.4). Replay do mesmo
evento/linha produz o mesmo evidenceId e fingerprint.

## Isolamento por Universe
Queries escopadas por universe/personagens; conversations exigem todos os participantes no mesmo
universe; `buildConversationOpportunity` rejeita universo divergente; F5 monta contexto por
speaker. E09 demonstra em TEST DB.

## AI→AI
Permitido: a conversa pode não ter USER; o primeiro speaker vem da oportunidade (preferred +
promoção); o target é preservado na abertura e, com histórico, a última mensagem é o alvo;
continuação/stop vêm do loop do planner existente.

## Modos
- OFF: nenhuma execução/seleção.
- OBSERVER: seleção + audit, sem mensagens.
- GUIDED: seleção + audit, sem envelope nesta fase.
- FULL: seleção + audit + envelope pelo pipeline F3–F5.
- PAUSED/STOPPED: sem execução. REUSED: tick repetido não reexecuta.

## Command Layer
Único writer: toda mensagem nasce em `executeBehaviorDecision` (RESPOND) após o domain gate;
auditado com `executedMessageId`. Nenhum caminho paralelo de escrita foi criado.

## Resultados reais (F6.5)
- Evals F6-E01..E10: 11 testes (10 evals + métricas) PASS, em TEST DB, repetidos 2x sem flake.
- Subset conversation+autonomy: 31 files / 451 tests verdes.
- Suíte completa API: 204 files / 2875 tests verdes.
- `npx tsc --noEmit` verde; ESLint do escopo verde; `npx tsc -p tsconfig.json` verde.
- TEST DB com cleanup completo; DEV somente leitura; nenhuma migration.

## Limitações
- Evals cobrem o fluxo autônomo F6; não medem naturalidade subjetiva nem latência.
- LLM real não é exercitado (caminho determinístico default; provider atrás de flag).
- `PilotExperience` não é fonte direta de sinal; corrida flui por Event/Memory.
- Rejeições da seleção não são persistidas (apenas seleção + resumo no audit).
- Candidatos consideram só `listAutonomousCharacters` (até `AUTONOMY_MAX_CHARACTERS_PER_TICK`).
- Cooldown pode suprimir por uma janela um sinal persistente (goal/inatividade) por design.

## Riscos conhecidos
- Loops A↔B entre envelopes → cooldown + fingerprint + ≤1/conversa/tick.
- Cascatas → stop do planner + budgets do tick.
- Ticks concorrentes → fingerprint/lock do SimulationTick; repetido = REUSED.
- Fingerprint de linhas derivadas de evento mudou com a canonicalização F6.4 (sem dados F6 em
  produção; documentado).
- Flake histórico 1x em `conversation.autonomous.test.ts` #13 (não reproduzido; passou isolado e
  nos reruns completos desta execução).

## Decisões arquiteturais
- Uma oportunidade = um envelope (0..N falas, AI↔AI permitido); primeiro speaker da oportunidade.
- Seleção/execução no tick existente; nenhum SimulationTick/loop/writer/bus novo.
- Evidência canônica por raiz (`event:<id>`) para derivados de evento.
- Modos preservam a semântica acumulada (GUIDED sem envelope, FULL executa).
- LLM atrás de flag; determinístico default; planner decide intenção/continuidade/stop.

## Próximos passos
- F7 — private groups/secrets.
- F8 — UI/microbehaviors.
- F9 — benchmark gate.
