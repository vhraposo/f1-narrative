# Dialogue Engine — F10 (Production Integration / End-to-End)

## 1. Objetivo
Responder tecnicamente: o Dialogue Engine F3–F9 é realmente o engine usado pela experiência de
conversa do produto? Se não, qual o menor caminho seguro para torná-lo assim — sem criar uma
segunda engine e sem religar streaming/LLM por antecipação.

## 2. Estado inicial
- Branch `v4-Living-F1-Universe`; HEAD `7c9b417` (F9 concluída); working tree limpo.
- F3–F9 concluídas; benchmark `pnpm benchmark:f9` PASS como barreira de regressão.
- DEV read-only; TEST (`f1_narrative_test`) para testes.

## 3. Arquitetura real encontrada
- **Caminho da UI de Conversas**: `MessageComposer`
  (`apps/web/src/components/conversations/message-composer.tsx`) → `useCreateMessage` +
  `useSimulateTurn` + `planSimulationTurn` (`apps/web/src/hooks/use-conversations.ts`,
  `apps/web/src/lib/conversations.ts`) → `POST /api/conversations/:id/messages` (user message)
  → `POST /api/conversations/:id/simulate-turn/plan` + `POST /api/conversations/:id/simulate-turn`
  (`conversation-autonomous.routes.ts`) → `simulateConversationTurn`
  (`conversation.simulation.ts`) → planner (`conversation.dialogue.ts`) → per-speaker context F5
  (`conversation.dialogue-context.ts` + `memory.retrieval.ts`) → realizer determinístico
  (`conversation.dialogue-realizer.ts`) → output validator (`conversation.dialogue-output.ts`)
  → `runAutonomousConversationTurn` (`conversation.autonomous.ts`) → domain gate
  `evaluateBehaviorDecision` (linha 213) → Command Layer `executeBehaviorDecision` (linha 228)
  → `behavior.commands.ts` RESPOND → `Message`.
- **Caminho legado de geração/streaming** (não usado pela UI de Conversas): `POST /turn`,
  `POST /turn/stream`, `GET/POST /generate` → `executeTurn` (`conversation-turn.ts`) /
  `assembleGenerationBundle` → `assembleContext` → provider LLM → `persistGeneratedMessage`
  (`generation-persist.ts:84`, `message.create` na linha 111). Não passa por
  planner/realizer/validator nem pelo Command Layer.
- **Segundo writer alcançável pela UI**: `AiBehaviorPanel`
  (`apps/web/src/app/app/characters/[id]/page.tsx:323` → `components/ai-behavior/ai-behavior-panel.tsx`)
  → `useExecuteAiDecision` → `executeCharacterDecision` (`ai-behavior.service.ts`) →
  `executeSendMessage` (`:237`) → `assembleGenerationBundle` + `persistGeneratedMessage`
  (mesmo writer legado), com `provider: generationProvider ?? nullProvider`
  (`app.ts:168`).

## 4. Fluxo atual end-to-end (UI real)
`ConversationThread → MessageComposer` (envio do usuário via API) → `simulate-turn/plan` (nomes
para o indicador de digitação) → `simulate-turn` → engine determinístico F3–F5 → domain gate →
Command Layer → `Message` persistida → React Query invalida/atualiza a thread. Nenhuma página
usa `useStreamingTurn`, `useGenerateMessage`, `useAutonomousTurn` ou `turnMessage` (grep em
`apps/web/src` mostra uso apenas em `lib/`/`hooks/`/testes).

## 5. Streaming legado
- Presente em `conversation-turn-stream.routes.ts` + `streamTurnMessage`/`useStreamingTurn`
  (cliente) + provider de geração (`nullProvider` default; Ollama injetável).
- O SSE é transporte; a geração é o pipeline legado (`executeTurn`), que **duplica** partes do
  engine (contexto próprio) e **não usa** planner/realizer/validator/Command Layer.
- Por default (`nullProvider`), `persistGeneratedMessage` não persiste → as rotas legadas e o
  painel de AI Behavior para SEND_MESSAGE falham controladamente.
- F7.2/F7.3 já corrigiram o vazamento de audiência no contexto legado (`assembleContext` com
  `audienceCharacterId`), então não há vazamento conhecido nesse caminho; o problema é
  arquitetural (segunda engine/segundo writer), não de confidencialidade imediata.

## 6. Comparação dos caminhos
| Aspecto | Caminho atual (UI Conversas) | Streaming legado | Desejado |
|---|---|---|---|
| Contexto | F5 per-speaker | `assembleContext` + audiência F7.2 | um só |
| MemoryCharacter | sim (retrieval por speaker) | sim (audience=speaker) | sim |
| Event audience | indireto (eventos não entram no F3–F5) | sim (filtro por audiência) | sim |
| Conversation ACL | `/simulate-turn` exige participante | `/turn*` exige participante | sim |
| Knowledge asymmetry | sim (`knownFacts` por speaker) | parcial (contexto filtrado) | sim |
| Planner | `DeterministicDialoguePlanner` | não usa | usa |
| Realizer | determinístico (default) | provider LLM legado | realizer |
| Validator | `validateDialoguePlan`/`validateDialogueOutput` | não usa | usa |
| Command Layer | `executeBehaviorDecision` (RESPOND) | `persistGeneratedMessage` (writer paralelo) | Command Layer |
| Persistência | `behavior.commands` → Message | `generation-persist` → Message | uma só |
| LLM | não no default (flag) | sim se provider injetado (default nullProvider) | opcional |
| Determinismo | sim | não | exigido no caminho |
| Replay | sim (F9 B01) | não | sim |
| F9 benchmark | coberto | não coberto | coberto |

## 7. Gaps
- **P0 — segurança/correção**: nenhum encontrado. ACL, MemoryCharacter, Event audience, Universe
  isolation e Command Layer permanecem íntegros no caminho da UI; o caminho legado recebe
  contexto filtrado por audiência (F7.2) e valida ownership/participação.
- **P1 — arquitetura**: `ai-behavior.service.executeSendMessage` é um segundo writer de Message
  (generation + `persistGeneratedMessage`) alcançável pelo painel de personagem; ativo apenas se
  um `generationProvider` for configurado (default `nullProvider` → não persiste e responde 409).
  Rotas legadas `/turn`, `/turn/stream`, `/generate` também são caminhos de geração paralelos
  (não usados pela UI de Conversas).
- **P2 — UX**: streaming não integrado ao composer (por decisão); no painel de AI Behavior,
  executar SEND_MESSAGE sem provider resulta em erro 409 sem explicação de arquitetura.
- **P3 — otimização**: itens já no backlog F9 (presença, virtualização, performance).

## 8. Decisão arquitetural
- **Opção B para a experiência de conversa**: a UI de Conversas já usa o Dialogue Engine F3–F7
  protegido pelo benchmark F9; o streaming legado **não deve ser religado agora**, pois exigiria
  uma segunda engine ou um refactor maior (integrar geração LLM como realizer atrás do mesmo
  planner/validator/Command Layer).
- **Opção C/P1 registrada para backlog**: unificar ou desativar o caminho `ai-behavior` de
  SEND_MESSAGE em fase própria, com testes próprios; não implementado na F10 por ser mudança
  estrutural média que altera semântica de feature existente.
- Nenhuma alteração de código nesta fase (Caso 1/3 do critério de parada).

## 9. Implementação
Não houve implementação de produção. Entregue: esta análise e atualização do HANDOFF.

## 10. Segurança
Confirmado no código real:
- **ACL**: rotas de conversa (`/simulate-turn*`, `/turn*`, `/messages`) exigem participante
  (`accessibleConversation`/`accessibleConversationId`).
- **MemoryCharacter**: retrieval por speaker no F5 e `audienceCharacterId` no legado.
- **Event audience**: `EventCharacter`/`EventVisibility` no contexto legado e APIs; o pipeline
  F3–F5 não injeta eventos no diálogo.
- **Universe isolation**: F6/F9 já protegem; F7.2 filtra `universeId` nos dois caminhos.
- **Command Layer**: único writer do caminho da UI; o writer legado é o P1 documentado.

## 11. Testes
Nenhum teste novo (sem implementação). Validação executada nesta fase:
- `pnpm benchmark:f9` (barreira de regressão) — resultado abaixo.
- Suítes completas não reexecutadas porque nenhum arquivo de código foi alterado; o último
  checkpoint verde (F9) registra API 211 files / 2945 tests e web 70 files / 519 tests.

## 12. Benchmark F9
`pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` (12/12, contadores zerados). Nenhum threshold
alterado.

## 13. Banco
Nenhuma migration; nenhuma escrita em DEV; TEST não foi necessário nesta fase (sem fixtures
novas). DEV permanece intocado.

## 14. Git
HEAD inicial `7c9b417`; commits F10: apenas documentação (esta análise + HANDOFF). Sem amend,
reset, rebase, merge ou push.

## 15. Limitações
- A F10 não integrou streaming nem removeu o caminho legado (decisão explícita).
- O P1 do `ai-behavior` permanece; em produção sem provider o painel falha controladamente.
- Métricas de latência/UX não medidas.

## 16. Riscos
- Se um deployment configurar `generationProvider`, o segundo writer passa a persistir mensagens
  fora do Command Layer — aceitável hoje apenas porque o contexto é filtrado por audiência, mas
  é dívida arquitetural (P1).
- Religar streaming sem refactor reintroduziria uma segunda lógica de diálogo.

## 17. Próximos passos
1. (P1) Refatorar o `ai-behavior` SEND_MESSAGE para o mesmo pipeline (planner/realizer/validator/
   Command Layer) **ou** desativar a execução dessa ação no painel, com testes próprios.
2. (P2, opcional) Streaming como transporte do realizer determinístico (sem nova engine),
   somente se houver requisito real de UX.
3. Backlog F9 mantido (presença, virtualização, drift de migrations, performance).
