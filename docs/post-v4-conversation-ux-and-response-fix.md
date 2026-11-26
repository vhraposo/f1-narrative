# Post-V4 — Conversation UX & Autonomous Response Fix

## Root cause (reproduzido em TEST)

O composer enviava apenas `POST /api/conversations/:id/messages` (persistia a mensagem do usuário) e
**nunca** chamava o endpoint V4.2 `POST /api/conversations/:id/autonomous-turn`. A resposta de IA
dependia do botão legado "Gerar resposta IA", que usava o pipeline antigo `POST /turn/stream`
(`executeTurn` + `selectSpeakers` com threshold de sinais). Para "Bom dia" o seletor legado não
encontrava motivo (`NO_RESPONSE_OPPORTUNITY`), e a UI exibia "Nenhum personagem tinha motivo para
responder neste turno." — além de re-persistir o prompt como mensagem do usuário (duplicação).

Segundo defeito encontrado na investigação (backend/score): o `RESPOND` também recebia
`cooldownPenalty` diário por alvo (`actionType:target:bucket`), então uma segunda mensagem do mesmo
usuário no mesmo dia derrubava o score do RESPOND (-45) e a decisão virava NO_ACTION — impedindo
respostas em sequência. Correção: cooldown diário aplica-se apenas a ações proativas
(`SEND_MESSAGE`), mantendo `NO_DUPLICATE_ACTION` e turn budgets para o RESPOND.

## Correção

- Backend: `scoreBehaviorCandidate` aplica `cooldownPenalty` somente para `SEND_MESSAGE`.
- Frontend: `lib/conversations.ts` ganhou `runAutonomousTurn`; `useAutonomousTurn` invalida
  messages/conversa/lista; o submit do composer (único botão de envio) persiste a mensagem e, na
  confirmação, dispara o autonomous turn (sequencial — sem race com `NO_MESSAGES`).
- Botão "Gerar resposta IA" removido; nenhum botão substituto.
- Estado "Andrea Kimi Antonelli está digitando…" (visual, não persistido); falha do turno mostra
  "Não foi possível gerar uma resposta agora." sem apagar/duplicar a mensagem.
- Nenhuma migration; nenhum LLM obrigatório (fallback determinístico cobre provider ausente/falho).

## UX (referência WhatsApp Web, sem assets/código proprietário)

- Header compacto: voltar, avatar do grupo, título, "Grupo · N participantes", "+ Adicionar" ao
  lado de "Editar".
- "+ Adicionar" abre modal de participantes (lista atual com remover; disponíveis com multi-select,
  tipo IA/Você, contagem, impedindo duplicatas/os já participantes).
- Conversa ocupa a maior parte da tela; painel permanente de participantes removido.
- Balões: usuário à direita; demais à esquerda com avatar/nome (agrupados em mensagens consecutivas
  do mesmo speaker) e timestamp.
- Empty state elegante; avisos técnicos removidos do composer.

## Testes

- API: `conversation.autonomous.test.ts` 10/10 + 11) fallback sem provider — mensagem do usuário via
  `POST /messages` → `autonomous-turn` → Message AI com `characterId` correto e fallback.
- Web: composer reescrito (6), chat-turn integração (3) e streaming/typing reescrito (2), dialog de
  participantes (3). Os testes legados do botão removido foram reescritos para o novo contrato.

## Limitações

- Sem streaming de tokens no turno autônomo (resposta aparece completa; indicador de digitação cobre
  o perceptível).
- Criação de grupo mantém o formulário atual com seleção de participantes antes de criar (avatares e
  ordenação refináveis).
- Web: 498 testes (era 506) porque 11 casos do botão legado foram substituídos por 9 do novo fluxo +
  3 do modal; cobertura do fluxo novo é maior.

## QA

API 2651/2651 (184 arquivos); Web 498/498 (67); typecheck 0; lint 0; builds OK. DEV somente leitura:
RaceResult 286, Standings 23, Timeline 2, Entries 46, WorldState 2, AiDecision 0. TEST: 0 usuários/
universes/decisions residuais.
