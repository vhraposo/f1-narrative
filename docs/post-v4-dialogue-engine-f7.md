# Dialogue Engine — F7 (privacidade: private groups / secrets)

## Estado
- Branch `v4-Living-F1-Universe`.
- Commits F7: F7.0 `2207c0f` (análise), F7.1 `286a165`, F7.2 `6e390be`, F7.3 `c0bbe39`,
  F7.4 `9be1ff4`, F7.5 `185bdef`, F7.6 (este commit).
- Nenhum commit anterior reescrito; sem amend/push; nenhuma migration aplicada fora de TEST.
- F6 permanece encerrada e verde.

## Objetivo
Fechar privacidade narrativa sem criar arquitetura paralela: autorização determinística
server-side, contexto autorizado por audiência, LLM nunca decide autorização, Command Layer
continua writer único, sem event bus/outbox/novo pipeline.

## F7.0 — Análise
`docs/post-v4-dialogue-engine-f7-analysis.md`: modelo real, rotas, dois caminhos de contexto,
riscos, alternativas A–D e recomendação D combinada. Conclusão-chave: ConversationParticipant
sozinho não basta; o grant de conhecimento existente é `MemoryCharacter`; Event já tem audiência
de facto em `EventCharacter`.

## F7.1 — Conversation ACL
- Schema: `ConversationVisibility { PRIVATE, UNIVERSE }` + `Conversation.visibility @default(PRIVATE)`
  (migration aditiva).
- Decisão: **sem `Conversation.universeId`**; o Universe é derivado dos participantes
  (`Character.universeId`), evitando segunda fonte de verdade.
- Criação/adição de participante validam ownership + universe (404 sem vazar existência);
  global catalog (userId/universeId null) permitido; `UNIVERSE` fail-closed (acesso participantes).
- Leitura/listagem permanecem somente participantes (helpers existentes fortalecidos).

## F7.2 — Memory audience
- `context.assembly` ganhou `audienceCharacterId?`: seleção de memórias por `MemoryCharacter` do
  speaker (fail-closed se não participa; filtro de universe quando conhecido).
- `generation.assembly` resolve o speaker antes de montar contexto e passa a audiência — o pool
  compartilhado do caminho legado deixou de vazar memória entre speakers.
- `GET /context?characterId=` opcional filtra por audiência e valida participante.
- Memory APIs já escopavam por `MemoryCharacter`; coberto por testes de não vazamento.
- F5 já era assimétrico (retrieval por speaker + `buildDialogueKnowledgeContext`): preservado.

## F7.3 — Event audience
- Schema: `EventVisibility { PUBLIC, RESTRICTED }` + `Event.visibility @default(PUBLIC)`
  (migration aditiva; PUBLIC preserva o comportamento global).
- `createEventWithDerivations`/schema aceitam `visibility`; `GET /api/events` e `/api/events/:id`
  escopam: PUBLIC para todos; RESTRICTED só criador/personagens do usuário/universe.
- `syncNewsForEvent` não gera notícia para RESTRICTED e remove ao reclassificar.
- Contexto por audiência considera eventos vinculados ao speaker e exige PUBLIC ou participante.
- F6 já respeitava `EventCharacter`; coberto por testes.

## F7.4 — F6 audience
Auditoria: a ponte F6.4 só emite sinal para personagem presente na conversa E na evidência
(EventCharacter/MemoryCharacter/par do RelationshipChange); memória filtra universe; goal é do
próprio personagem; envelope revalida participantes/universe. **Nenhum gap de contrato** — subfase
entregue como cobertura (`autonomy.f7-audience.test.ts`: restricted/public, derivados, isolamento
de Universe, FULL/GUIDED/OFF/OBSERVER, dedupe/replay).

## F7.5 — Command Layer
- `behavior.commands.ts` (RESPOND/SEND_MESSAGE): alvo, quando presente, precisa ser participante
  da conversa (`TARGET_NOT_PARTICIPANT`); universo validado como antes. Writer único preservado.
- Output validator mantido **estrutural**; nenhuma detecção semântica de segredo no caminho
  crítico (decisão explícita: a defesa é impedir o contexto não autorizado).
- Testes cobrem bypass direto (API/Command Layer/turno autônomo) e regressão legítima.

## F7.6 — Evals e fechamento
`conversation.dialogue-f7-evals.test.ts` (20 evals, TEST DB, cleanup): E01/E02 ACL PRIVATE,
E03 cross-universe, E04 UNIVERSE fail-closed, E05/E06 MemoryCharacter, E07 contexto legado,
E08 knownFacts, E09/E10/E11 Event PUBLIC/RESTRICTED/contexto, E12/E13/E14/E15 F6 audience e
derivados, E16/E17/E18 Command Layer/bypass, E19 Universe isolation, E20 replay determinístico.

## Modelo de autorização final
1. **Conversa**: participação (`ConversationParticipant`); criação/adição limitada ao universe
   do usuário; `visibility` PRIVATE (participantes) com UNIVERSE reservado/fail-closed.
2. **Conhecimento (Memory)**: `MemoryCharacter` é o grant; retrieval, knowledge, contexto legado
   e F6 respeitam; APIs escopadas por participante.
3. **Evento**: `EventVisibility` + `EventCharacter`/`createdById`; listagem/leitura escopadas;
   notícia só para PUBLIC.
4. **F6**: evidência restrita só gera oportunidade para quem está na audiência e na conversa.
5. **Command Layer**: revalida conversa, speaker, target e universe antes de escrever.
6. Autorização é determinística, server-side, sem LLM/prompt/contextJson.

## Isolamento de Universe
Queries escopadas; conversas/adición de participante rejeitam outro universe; memória filtra
`universeId` (retrieval e F6); eventos por personagens do universe; contexto por speaker.
Coberto por E03/E19 e suítes F7.1–F7.5.

## Migrations
- `20261002130000_add_conversation_visibility` (enum + coluna default PRIVATE).
- `20261002140000_add_event_visibility` (enum + coluna default PUBLIC).
Ambas aditivas, aplicadas e validadas em TEST (`migrate deploy`; `migrate status` up to date).
DEV intocado. Drift pré-existente schema↔migrations NÃO foi corrigido (fora de escopo).

## Testes e resultados reais
- F7 evals: 20/20 verdes (rodadas 1x; sem flake).
- F6 evals E01..E10: verdes no subset afetado.
- Subset afetado (conversation/autonomy/context/memory/events/news/behavior/generation):
  **75 files / 1265 tests** verdes.
- Suíte completa API: **210 files / 2933 tests** verdes.
- `npx tsc --noEmit` verde; ESLint dos escopos alterados verde; build `tsc -p` verde.
- TEST DB com cleanup completo; DEV somente leitura.

## Flakes
`conversation.autonomous.test.ts` #13 (characterB antes de characterA) reproduziu 1x durante
F7.2, passou isolado e em reruns; não apareceu em F7.6. Mecânica provável: penalties
RECENTLY_SPOKE/REDUNDANT_RESPONSE + timestamps reais vs worldDate fixo. Não mascarado; correção
fora do escopo F7.

## Limitações
- `UNIVERSE` permanece fail-closed (sem semântica aberta) — decidido na F7.1.
- `/craft` e `/context` sem `characterId` continuam sendo visão owner-level da conversa
  (observabilidade; não alimentam LLM com speaker).
- Memory APIs são user-level: o dono do universo vê memórias dos próprios personagens; o grant
  controla a assimetria entre personagens no contexto/geração.
- Conversas legadas cross-universe/inconsistentes não foram retro-corrigidas.
- Não há detecção semântica de segredo no output (por design; a origem é impedida).
- `Secret`/`KnowledgeGrant` não foram criados (MemoryCharacter/EventCharacter suficientes).

## Riscos
- Vazamento semântico via paráfrase só é mitigado pela ausência do conteúdo no contexto (correto
  por design); não há guarda textual.
- Dados legados fora das novas invariantes exigem auditoria futura.
- Flake #13 permanece.

## Decisões arquiteturais
- Sem `Conversation.universeId`; sem novo agregado de secret; sem event bus/outbox/segundo writer.
- Filtro de audiência no Context Assembly (não no prompt); Command Layer como segunda barreira.
- Defaults de migration preservam comportamento (PRIVATE/PUBLIC).

## O que NÃO foi implementado
- Semântica aberta de `UNIVERSE`, `Secret`/`KnowledgeGrant`, detecção semântica de segredo,
  acesso ADMIN/QA a conteúdo restrito, retro-correção de dados legados, F8/F9.

## Próximos passos
- F8 — UI/microbehaviors (expor `visibility` na UI, badges, fluxo de grupos).
- F9 — benchmark gate.
