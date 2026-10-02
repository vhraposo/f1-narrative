# Dialogue Engine — F2: evals reais + LLM planner opcional

Base inicial: 21483c6 (branch v4-Living-F1-Universe, após merge). F2A e F2B implementados.
F3/F4/F5 não implementados. Default permanece `deterministic`.

## F2A — Evaluation harness com banco TEST
Arquivo: `apps/api/src/modules/conversation/conversation.dialogue-realdb-evals.test.ts` (11 testes).
Fixtures reais e reproduzíveis: Universe, WorldState fixo (2026-10-01T12:00Z), USER Alicya,
6 AIs (Kimi, Max, Lando, Charles, George, Oscar), Conversation GROUP ACTIVE, Relationships
(Kimi 80/80, Max 60/55, Lando 55/45, Charles 20/20), Memory da "bomba d'água" (George+Alicya),
mensagens com timestamps fixos. Cleanup completo em afterAll. Somente TEST.

Cenários: S01 greeting, S02 direct mention, S03 group question, S04 emotional, S05 joke,
S06 callback, S07 topic shift, S09 support, S10 seis IAs ("oi"), S14 replay determinístico.

### Baseline real (medido nesta execução)
```
scenarios: 9
currentTotalSpeakers: 22
plannerTotalSpeakers: 22
currentAllParticipantCases: 0
plannerAllParticipantCases: 0
invalidPlans: 0
avgPlannerMs: 6
```
Interpretação honesta: o DeterministicDialoguePlanner **não altera** quem fala nesta amostra —
ele preserva a seleção do response-engine (que já era o candidate set) e adiciona a estrutura
nova: intent por turno, replyTo, continuation, stopReason e validação de domínio. S01 greeting
2 speakers de 6; S10 "oi" 2 de 6 (não escala com participant count); S02 primeiro = Kimi com
intent ANSWER; S05 todos JOKE; S04 4 de 6 com SUPPORT; S14 replay idêntico.
Isso significa que a melhoria medida na F2A é **estrutural**, não de seleção. A seleção ainda
herda os thresholds do response-engine.

## F2B — LLM planner opcional (atrás de flag)
Arquivo: `apps/api/src/modules/conversation/conversation.dialogue-planner.ts`.
- `resolveDialoguePlannerKind`: `DIALOGUE_PLANNER=off|deterministic|llm`, default
  `deterministic` (ausente/vazio → deterministic).
- `DialoguePlannerProvider`: interface pura (`plan(context) → unknown`), sem acesso a banco,
  sem writer, sem Command. Contexto em allowlist (`buildDialoguePlannerContext`): participantes
  do candidate set, IDs permitidos de replyTo, janela, budget, energy level — sem secrets,
  sem dump de memória.
- `LlmDialoguePlanner`: usa `DialoguePlanSchema` (structured output esperado do provider),
  valida IDs contra o candidate set (UNKNOWN_SPEAKER/UNKNOWN_REPLY_TO/INVALID_SCHEMA),
  registra `lastTrace` (provider, model, latencyMs, valid, fallback, invalidReason) e cai para
  `DeterministicDialoguePlanner` em qualquer falha (PROVIDER_ERROR etc.).
- `createDialoguePlanner(kind, provider)`: sem provider, mesmo `llm` resolve para deterministic.
- Nenhuma chamada de rede nos testes (provider stub). Nenhum provider/model hardcoded.

Testes: `conversation.dialogue-planner.test.ts` (11 testes): flag default/off/llm, provider
ausente, provider válido, falha de provider, schema inválido, speaker desconhecido, replyTo
desconhecido, USER/externo rejeitado, allowlist do contexto, roundtrip do schema.

## Provider/modelos — não executado
Nenhum provider LLM real (Ollama/OpenAI) está configurado no ambiente desta execução.
Portanto:
- benchmark LLM **não executado**; nenhum número de latência/custo/tokens/validade de
  structured output real é reportado;
- structured output foi validado apenas contra o contrato Zod local;
- a decisão técnica abaixo não usa dados de LLM.

## Decisão técnica
Manter `deterministic` como default. O LLM planner está implementado, validado e isolado por
flag, mas só deve ser considerado candidato a default após benchmark real com provider
disponível, medindo validade estruturada, fallback, latência e custo. F2A mostra que a camada
determinística é barata (~6ms) e 100% válida; o ganho esperado do LLM estaria em intenção/
replyTo/continuation, que ainda não têm métrica comparativa real.

## Segurança / performance
- Provider recebe apenas allowlist; sem credentials/headers/secrets.
- 1 planner call por envelope (quando LLM); domain valida tudo; cache não implementado
  (documentado: sem uso comprovado ainda).
- Planner determinístico: O(candidatos), ~5-10ms por cenário no harness.

## Testes / QA
- F2A: 11/11; F2B: 11/11; typecheck limpo.
- Conversation suite completa e full API executados após esta documentação (ver relatório).
- DEV: read-only; nenhuma escrita.
- Migrations: nenhuma.

## Próximos passos
1. Configurar provider (Ollama local ou hosted) e rodar o benchmark C1/C2/C3 do replan.
2. Medir LLM validity/fallback/latência/tokens; só então decidir default.
3. F3 (realizer curto/voz) continua sendo o próximo ganho de naturalidade textual.
