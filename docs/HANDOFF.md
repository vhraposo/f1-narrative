# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `5719019` — `feat(conversation): bridge domain evidence to conversation opportunities` (F6.4)
- Working tree: limpo (após commit deste HANDOFF)
- Última fase concluída: F6.4
- Subfase atual: nenhuma; F6.5 não iniciada
- Próximo checkpoint: F6.5 — evals F6-E01..E10 + full API/build + doc F6

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
- F6.4 ponte eventos→oportunidade — `5719019` (concluída)
- F6.5 evals F6-E01..E10 + full API/build + doc F6 — PENDENTE

F7 (private groups/secrets), F8 (UI/microbehaviors), F9 (benchmark gate): não iniciadas.

## Última implementação (F6.4)
Investigação (sem alterar código) e ponte evento→oportunidade:
- Achados do fluxo real: eventos nascem em `createEventWithDerivations` (behavior command CREATE_EVENT,
  world-simulation schedule, event routes, ai-behavior, race-narrative) e derivam NewsItem +
  `applyEventEvolution` (que cria RelationshipChange com `sourceType="EVENT"`/`sourceId=eventId` e
  UMA Memory com `eventId`). Os triggers `EVENT_CREATED`, `MEMORY_CREATED` e `RELATIONSHIP_CHANGED`
  NÃO têm consumidor de produção (só types/policy/routes/testes); `RACE_FINISHED` é consumido por
  `processRaceConsequences` apenas para criar AiDecision de auditoria — nenhum deles produzia
  oportunidade. Por isso a estratégia escolhida foi **A (adaptador)**, não B.
- `conversation.opportunity-bridge.ts` (novo, puro/determinístico): converte `OpportunityEvidence`
  (EVENT/MEMORY/RELATIONSHIP_CHANGE/GOAL/INACTIVITY) em `ConversationOpportunitySignal[]` com
  strength/target determinísticos. Não persiste nada, não executa conversa, não chama LLM.
  `buildAutonomyOpportunityPlan` consome a ponte (substituiu os loops inline da F6.2); depois
  `buildConversationOpportunity` → seleção F6.2 → envelope F6.3 permanecem intocados.
- `evidenceId` canônico por raiz de domínio: EVENT `event:<id>`; MEMORY com `eventId` →
  `event:<eventId>` (senão `memory:<id>`); RELATIONSHIP_CHANGE com `sourceType="EVENT"`+`sourceId`
  → `event:<sourceId>` (senão `relationship-change:<id>`); GOAL `goal:<id>`; INACTIVITY
  `inactivity:<conversationId>:<lastMessageId|none>`. Algoritmo de fingerprint F6.1 inalterado
  (apenas o valor de evidenceId de linhas derivadas de evento foi canonicalizado, deliberadamente).
- Dedupe/idempotência: evento + memória derivada + relationship change derivados compartilham
  `event:<id>`; a seleção F6.2 rejeita os derivados com `DUPLICATE_EVIDENCE` e mantém a maior
  prioridade (WORLD_EVENT). Replay do mesmo evento/linha gera o mesmo evidenceId/fingerprint.
- Race: Event da narrativa de corrida → WORLD_EVENT `event:<id>`; Memory de race-consequences
  (sem eventId) → MEMORY_TRIGGER `memory:<id>`. Sem novo reason.
- Modos e envelope F6.3 inalterados: OFF/PAUSED/STOPPED/REUSED não executam; OBSERVER/GUIDED
  audit-only; FULL executa via `simulateConversationTurn`.
Testes: +16 (12 puros da ponte + 4 de integração no tick: dedupe evento+derivações, isolamento
por universe, evento sem conversa elegível, FULL evento→oportunidade→envelope). Subset
conversation+autonomy 30 files / 440 tests verde. Suíte completa API 203 files / 2864 tests verde.
`tsc --noEmit`, ESLint do escopo e build `tsc -p` verdes.
Flake observado 1x (não reproduzido): `conversation.autonomous.test.ts` #13 (primeira seleção
esperada para characterA veio characterB) no subset; passou isolado e no rerun do subset — sem
relação com F6.4; documentado e não mascarado.

## Próxima ação — F6.5 (exata)
Fechar a fase F6 com evals e documentação, sem novo mecanismo:
- implementar/rodar as evals F6-E01..E10 no padrão das evals existentes (determinístico, TEST DB
  com cleanup), cobrindo opportunity→seleção→envelope e a ponte F6.4;
- rodar conversation suite + full API + build API (`tsc -p`) reais;
- escrever o doc F6 (escopo, arquitetura, evidência, limitações) em `docs/`;
- não alterar planner/realizer/validator/Command Layer nem criar event bus/outbox/writer novo.

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
- F6.4: evidência derivada de Event usa a raiz canônica `event:<id>` (evento, memória derivada e
  relationship change derivado convergem para o mesmo evidenceId).

## Riscos conhecidos (F6)
- Loops A↔B entre envelopes → cooldown + fingerprint + ≤1 envelope/conversa/tick (F6.2/F6.3).
- Cascatas → janela/stop do planner + budgets de ações/mensagens/conversas do tick.
- Ticks concorrentes → fingerprint/lock do SimulationTick existente; tick repetido = REUSED.
- Duplicação → fingerprint por evidência/janela + evidenceId canônico por raiz (F6.4).
- Custo LLM → caminho autônomo sem provider; realizer determinístico default.
- Vazamento entre universos → queries escopadas + validação de participantes + F5 por speaker.
- Evals F6 ainda não escritas (F6.5); flake pontual do teste #13 (não reproduzido).

## Regras essenciais
Ver `AGENTS.md`. DEV read-only; TEST com cleanup; um commit por subfase; nunca amend;
atualizar este HANDOFF ao fim de cada subfase; código real prevalece sobre o handoff.

## Prompt de retomada
"Leia `docs/HANDOFF.md` e `AGENTS.md`. Valide Git (branch, HEAD, working tree). Confirme que
o HEAD é o checkpoint registrado. Execute a próxima ação descrita no HANDOFF (F6.5). Rode os
testes/typecheck/lint, crie um commit novo, atualize `docs/HANDOFF.md` e pare no checkpoint
verde. Não use amend."
