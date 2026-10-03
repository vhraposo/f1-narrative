# Dialogue Engine — F8 (UI / Microbehaviors)

## 1. Objetivo
Transformar o Dialogue Engine (F3–F7) numa experiência de conversa convincente no frontend,
sem criar uma segunda arquitetura: o backend continua fonte de verdade de mensagens,
personagens, participantes, permissões (ACL/visibility), conhecimento (MemoryCharacter),
eventos, oportunidades/autonomia e decisões. O frontend é camada de apresentação/interação.

## 2. Estado inicial
- Branch `v4-Living-F1-Universe`; HEAD `86b3999` (F7 concluída); working tree limpo.
- `apps/web`: Next.js 15 App Router, React 19, React Query, Tailwind/shadcn, vitest +
  testing-library. Já existiam `conversation-list/thread/message-list/message-bubble/
  message-composer/participants dialog`, `lib/conversations` e `hooks/use-conversations`
  (queries/mutations + `useStreamingTurn` do caminho legado `/turn/stream`, sem uso na UI).

## 3. Arquitetura do frontend (F8)
- Data fetching: React Query já existente (`useConversation(s)`, `useConversationMessages`,
  `useConversationParticipants`, mutations); nenhuma lib nova.
- Fluxo ativo da conversa: `createMessage` (mensagem do usuário) + `simulate-turn` (pipeline
  determinístico F3–F5). Decisão conservadora: NÃO religar o streaming legado (`/turn/stream`,
  provider LLM) para não mudar a semântica do engine nem depender de LLM; `useStreamingTurn`
  permanece disponível e testado, porém não é o caminho da UI.
- Autorização permanece server-side; a UI só reage a 403/404 e não renderiza conteúdo restrito.

## 4. Decisões
- Menor mudança: reutilizar componentes/hooks/DTOs existentes; sem endpoint novo.
- Backend não alterado em F8 (nenhuma rota/schema/migration).
- `Conversation.visibility` e `Event.visibility` são opcionais no DTO web (default PRIVATE/PUBLIC),
  refletindo o backend (F7.1/F7.3) sem quebrar fixtures.
- `MessageContextJson.dialogue` passou a ser tipado/parseado para reply visual.
- UNIVERSE é exibido com semântica honesta (acesso ainda restrito aos participantes — F7 fail-closed).
- Sem presença real/fake: o indicador de digitação vem do plano real (`simulate-turn/plan`).

## 5. Componentes
- `message-bubble.tsx`: USER (direita), AI (esquerda, avatar/cores por speaker), SYSTEM (pílula
  central), timestamp `<time>`, preview de reply compacto.
- `message-list.tsx`: agrupamento por speaker, separadores de dia, lookup de reply, auto-scroll
  inteligente, indicador “N novas mensagens”, retry de erro, `aria-live` no botão.
- `message-composer.tsx`: Enter envia / Shift+Enter quebra linha, `maxLength=5000`, estados de
  envio/erro, mapeamento 400/401/403/404/429/5xx, preserva texto em falha, `onMessageSent`.
- `conversation-thread.tsx`: header com título, badge de visibility (Privada/Universo), pilha de
  avatares de participantes, subtítulo, typing indicator real, estados de loading/erro/404,
  sinal de scroll ao enviar.
- `event-card.tsx`: badge “Restrito” para `Event.visibility=RESTRICTED`.

## 6. Data fetching
Sem N+1 por mensagem; reply usa o mapa de mensagens já carregadas (degrada sem request extra).
Invalidações continuam via React Query. Nenhum polling; nenhum loop de efeitos/scroll.

## 7. Message rendering
`sendertype` real decide alinhamento/identidade; agrupamento quando speaker consecutivo é o mesmo;
separador de dia força novo header; SYSTEM não é participante; reply mostra “Respondendo a X” com
preview truncado (sem duplicar o conteúdo inteiro).

## 8. Streaming/typing
O composer sinaliza digitação com base no plano real do `simulate-turn/plan`; mensagens entram ao
ser persistidas. O streaming legado existe no código mas não foi religado (decisão registrada).

## 9. Microbehaviors
Auto-scroll acompanha quando o usuário está perto do fim; ao ler histórico, mostra o botão de
novas mensagens e não força scroll; envio próprio força retorno ao fim via sinal; estados de
hover/foco/disabled; `motion-reduce:animate-none` em spinners/typing. Sem animações decorativas.

## 10. Privacidade
Nenhuma proteção client-side como autoridade. A UI esconde apenas estados/ações não autorizados e
trata 403/404 como “sem acesso”, sem enumerar. Não há secret no DOM; conteúdo restrito não é
renderizado porque o backend não o entrega. UNIVERSE fail-closed comunicado com honestidade.

## 11. Acessibilidade
`aria-label` no composer, `role=status`/`aria-live` no typing e no indicador de novas mensagens,
`aria-hidden` em elementos decorativos, `<time dateTime>`, foco visível (`focus-visible:ring`),
roles semânticos (button/link/title), sem depender só de cor (rótulos textuais), reduced motion.

## 12. Responsive
Lista/thread já colapsam em mobile (aside/thread `hidden lg:flex`); header compacto; avatares com
tamanho fixo e `ring`; composer fixo no rodapé; badges com `sr-only sm:not-sr-only`.

## 13. Performance
Memoização do mapa de mensagens por render; sem virtualização prematura (volume atual modesto);
auto-scroll via `requestAnimationFrame`; sem efeitos a cada render/queries duplicadas.

## 14. Testes
- Web: `npx tsc --noEmit` verde; `npx vitest run` **70 files / 519 tests** verdes;
  `next lint` OK (apenas warnings pré-existentes); `next build` produção OK.
- F8 testes novos: reply preview (bubble), separadores de dia/reply/novas mensagens/retry (list),
  Enter/Shift+Enter/limite/403/429/preservação de texto (composer), visibility/participantes/404
  (thread), badge Restrito (event card).
- API: `npx tsc --noEmit` verde; subset conversation/autonomy/context/events/behavior
  **51 files / 745 tests** verdes (inclui evals F6 E01–E10 e F7 E01–E20); suíte completa
  **210 files / 2933 tests** verdes.
- Nenhum teste removido/enfraquecido; sem `skip`/`todo`; sem sleeps novos.

## 15. Limitações
- Sem presença online real (não existe no backend) — apenas digitação/atividade reais.
- Streaming legado não integrado ao composer (mantido o pipeline determinístico F3–F5).
- Sem virtualização de mensagens (não necessária no volume atual).
- Auto-resize do composer e skeletons dedicados não implementados (spinner discreto).
- Badge Restrito exibido no card de evento; página de detalhe não recebeu badge dedicado.
- `visibility` é opcional no DTO web (default PRIVATE/PUBLIC) para compatibilidade de fixtures.

## 16. Riscos
- Dependência de defaults (`visibility` ausente = PRIVATE) — alinhado ao backend.
- Indicador de novas mensagens baseado em geometria; em navegadores sem `scrollTo` suave usa
  fallback nativo.
- Nenhum risco novo de privacidade: autorização continua 100% server-side.

## 17. Próximos passos
- F9 — benchmark gate (não iniciado).
- Backlog: presença real, reconexão/streaming da F3–F5, virtualização com volume alto, badges em
  detalhe de evento, skeletons.
