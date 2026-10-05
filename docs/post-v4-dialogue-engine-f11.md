# Dialogue Engine — F11 (Unificação do AI Behavior com o Dialogue Engine)

## 1. Objetivo
Eliminar o segundo caminho de criação de `Message` do `SEND_MESSAGE` do AI Behavior,
encaminhando-o para o Dialogue Engine oficial (planner → contexto por speaker → realizer →
validator → domain gate → Command Layer → Message), sem nova engine, sem segundo writer e sem
religar streaming/LLM.

## 2. Estado inicial
- Branch `v4-Living-F1-Universe`; HEAD `c9eee60` (F10 análise); working tree limpo.
- `AI Behavior` (`ai-behavior.service.ts`) executava `SEND_MESSAGE` via
  `assembleGenerationBundle` + `persistGeneratedMessage` (writer paralelo, provider LLM;
  inerte com `nullProvider`).
- F9 PASS como barreira; UI de Conversations já usava o engine F3–F7.

## 3. Arquitetura anterior
```text
AiBehaviorPanel → POST /api/ai-behavior/execute → executeCharacterDecision
  → executeSendMessage → assembleGenerationBundle (contexto legado + provider LLM)
  → persistGeneratedMessage → Message
```
Writer fora do Command Layer, dependente de `generationProvider` (default `nullProvider` → 409).

## 4. Arquitetura nova
```text
AiBehaviorPanel → POST /api/ai-behavior/execute → executeCharacterDecision
  → executeSendMessage → simulateConversationTurn(conversationId, {
       userId, worldDate, maxDepth: 1,
       opportunity: { conversationId, characterId, target: null, fingerprint: decision.id, windowStart }
     })
     → getSimulationPlan (seed força o speaker)
     → planner determinístico → contexto F5 por speaker → realizer determinístico
     → validateDialogueOutput → runAutonomousConversationTurn
       → evaluateBehaviorDecision (domain gate CONVERSATION_TURN_DUE → RESPOND)
       → executeBehaviorDecision (Command Layer) → Message
  → atualiza AiDecision legado para EXECUTED + executedMessageId
```
O `provider` deixou de existir no módulo AI Behavior (serviço, rotas e `app.ts`); o texto agora
é o determinístico do realizer (sem LLM).

## 5. Arquivos alterados
- `apps/api/src/modules/ai-behavior/ai-behavior.service.ts`:
  - `executeSendMessage` usa `simulateConversationTurn` com seed (`maxDepth: 1`), exige
    WorldState, mapeia rejeição para `EXECUTION_REJECTED` e atualiza o `AiDecision` legado.
  - removidos `assembleGenerationBundle`, `persistGeneratedMessage`, `GenerationProvider`,
    `OllamaProviderError` e `AI_BEHAVIOR_INSTRUCTION`; `executeCharacterDecision` perde `provider`.
- `apps/api/src/modules/ai-behavior/ai-behavior.routes.ts`: removida a opção `provider`.
- `apps/api/src/app.ts`: registro de `aiBehaviorRoutes` sem opções.
- `apps/api/src/modules/ai-behavior/ai-behavior.test.ts`: adaptado ao novo contrato (mesma
  cobertura; ver seção 9).

## 6. Fluxo antigo vs novo
- Antigo: writer paralelo (`generation-persist`), contexto legado próprio, dependente de provider.
- Novo: writer único (Command Layer) e pipeline oficial determinístico; contexto por speaker
  (MemoryCharacter/universe) inalterado por F5/F7.

## 7. Decisão arquitetural
- Reutilizar `simulateConversationTurn` (F3–F5) com `OpportunityEnvelopeSeed`, que já existe para
  "primeiro speaker vem do domínio" e mantém planner/realizer/validator/Command Layer.
- `maxDepth: 1` preserva a semântica de uma mensagem por execução do painel.
- `targetCharacterId: null` deixa o replyTo ser derivado do histórico real (última mensagem);
  sem target artificial.
- Remover o `provider` do AI Behavior elimina a dependência de LLM e o segundo writer; o parâmetro
  era usado apenas por esse caminho.

## 8. Segurança
- **ACL**: `validateMessageTarget` continua validando participação/ownership; o engine revalida
  (participante + universos) e o Command Layer exige speaker/target participantes.
- **Audience/contexto**: o engine usa retrieval por speaker (`MemoryCharacter`) e filtro de
  universo (F7.2); nenhum conhecimento não autorizado entra no contexto.
- **Target/Universe**: decisão manipulada para conversa sem o executor → `TARGET_NOT_FOUND`;
  conversa cross-universe → rejeitada pelo engine/Command Layer (F7).
- **Command Layer**: `Message` agora só nasce no Command Layer; `persistGeneratedMessage`
  não é mais alcançável pelo AI Behavior.
- **LLM**: nenhum no caminho; decisões oficiais `llmUsed=false`.

## 9. Testes
- `ai-behavior.test.ts` **13/13** (3 execuções isoladas consecutivas), adaptado:
  - "executa SEND_MESSAGE pelo Dialogue Engine e persiste via Command Layer": verifica mensagem
    com `contextJson.language.provider = "dialogue-realizer"`, `behavior.reasonCode`, ausência de
    marcadores do writer legado (`family`/`generationKey`), `AiDecision` oficial
    `CONVERSATION_TURN_DUE` EXECUTED com o mesmo `executedMessageId`, `llmUsed=false`.
  - "rejeita execução quando o executor não participa da conversa alvo" (ACL/target).
  - "rejeição do engine não cria estado parcial" (speaker OFFLINE → REJECTED, 0 mensagens).
  - "rejeição é sanitizada e não deixa estado parcial" (WorldState ausente → PRECONDITION_FAILED,
    sem detalhes internos, 0 mensagens).
  - demais testes (cooldown, concorrência, CREATE_EVENT, isolamento, re-validação, guards)
    mantidos e verdes.
- Subset `ai-behavior + conversation + autonomy + behavior`: **42 files / 561 tests** verdes.
- API full: **2945/2946** (única falha é o flake pré-existente
  `pilot-knowledge.provision.test.ts #4`, que passa isolado; ver seção 15).
- Typecheck API verde; ESLint do escopo verde; build `tsc -p` verde.
- Web: `tsc --noEmit` verde; **70 files / 519 tests**; `next lint` OK; `next build` OK
  (nenhuma alteração web necessária).

## 10. Benchmark F9
`pnpm benchmark:f9` → **F9 BENCHMARK GATE: PASS** (12/12; contadores zerados), antes e depois da
mudança. Nenhum threshold alterado.

## 11. Banco
- TEST (`f1_narrative_test`) com fixtures/cleanup; DEV intocado.
- Nenhuma migration/schema change.
- `createFixture` do teste passou a criar `WorldState` com data fixa (pré-condição do engine).

## 12. Commits
- `d392196` `feat(ai-behavior): route SEND_MESSAGE through the dialogue engine`.
- Documentação/HANDOFF: este commit.

## 13. Limitações
- `CREATE_EVENT` do AI Behavior continua com write direto de Event (não é `Message`; fora do
  escopo da F11).
- Rotas legadas `/turn`, `/turn/stream`, `/generate` permanecem (segundo caminho dormente;
  decisão F10 de não religar streaming).
- Streaming continua não integrado.

## 14. Riscos
- Qualquer novo caminho de escrita de `Message` fora do Command Layer deve ser impedido por code
  review/gate; a F11 cobre o AI Behavior.
- `simulateConversationTurn` pode rejeitar (0 mensagens) em casos de conteúdo repetido/indisponível
  — o painel exibe decisão REJECTED/EXECUTION_REJECTED.

## 15. Flakes
- Conhecido/pré-existente: `pilot-knowledge.provision.test.ts #4` — reproduzido no full (ordem de
  marcos), passa isolado; documentado desde F6. Não relacionado à F11.
- `conversation.autonomous.test.ts #13` apareceu uma vez durante uma execução completa sob pressão
  do ambiente e passou isolado/reruns; flake histórico documentado.
- Nenhuma instabilidade nova atribuída à F11 (3 execuções isoladas do ai-behavior verdes).

## 16. Achados honestos
- O engine cria um `AiDecision` oficial (`CONVERSATION_TURN_DUE`) além do `AiDecision` legado do
  AI Behavior; testes que contavam decisões EXECUTED por personagem precisaram filtrar
  `contextVersion: "ai-behavior.v1"` (adaptação, sem enfraquecer).
- Fixtures do AI Behavior não criavam `WorldState`; isso passou a ser necessário porque o engine
  exige `currentDate`. Adicionado com data fixa para determinismo.
- A mensagem do painel agora traz o texto determinístico do realizer (não mais o texto do
  provider), mudança intencional de contrato registrada.

## 17. O que deliberadamente não foi feito
- Religar streaming/LLM; unificar `CREATE_EVENT`; remover rotas legadas; alterar UI/composer.

## 18. Próximo estado
P1 da F10 eliminado. Backlog restante: streaming como transporte do realizer (se houver requisito
de UX), presença real, virtualização/performance, `CREATE_EVENT` do ai-behavior via pipeline
oficial (opcional), drift schema↔migrations.
