# Dialogue Engine — F20 (Conversation UI Performance Audit)

## F20 — COMPLETE — SMALL PERFORMANCE FIX

## 1. Objetivo
Avaliar o item de backlog "virtualização de mensagens/auto-resize/skeletons; evals de
performance/latência" na UI de conversas e implementar apenas a melhoria pequena, segura e
proporcional à evidência do código.

## 2. Estado inicial / Git
- Branch `v4-Living-F1-Universe`; HEAD `0ef21e6` (F19 concluída); working tree limpo; 1 commit à
  frente de origin; sem push/merge/rebase/reset/amend. DEV read-only; Docker/Postgres ativos.

## 3. Arquitetura encontrada (evidência)
- **API sem paginação**: `GET /api/conversations/:id/messages` (`conversation.routes.ts:666-670`)
  retorna TODAS as mensagens (`orderBy createdAt asc`, sem `take`/cursor). Os limites do engine
  (`conversation.policy.ts`: `maxTotalAiMessages=20`, `recentMessageWindow=12`,
  `maxAiTurnsPerRound=4`) limitam turnos de IA, não mensagens de usuário nem o histórico.
- **UI sem virtualização**: `MessageList` renderiza todas as mensagens; a cada render reconstruía
  `messageById` (Map O(n)) e fazia `findAuthor` (scan O(n) por mensagem) — O(n²) no pior caso — e
  `MessageBubble` não era memoizada, então mudanças de estado da lista (`unseenCount`, sinal de
  scroll) re-renderizavam todas as bolhas.
- Sem biblioteca de virtualização instalada; sem infraestrutura de medição de performance.

## 4. Decisão
- **Implementar agora (proporcional)**: memoização estrutural na lista (`useMemo` para
  `participantsById`, `messageById` e `rows` derivadas; `MessageBubble` com `React.memo`), sem
  dependência nova e sem mudança de contrato/UX.
- **Deferir virtualização e paginação**: exigem requisito de produto (janela de histórico,
  "carregar mais"/cursor) e/ou dependência nova; mudariam comportamento visível. Documentado como
  próximo incremento condicionado.
- Sem `content-visibility`/`contain` CSS: alteraria `scrollHeight` e a lógica de scroll/âncora.

## 5. Implementação
- `message-bubble.tsx`: `MessageBubble` exportada via `memo(...)` (comparação shallow; props
  `message`/`author`/`replyTo` estáveis por origem no React Query e nas linhas memoizadas).
- `message-list.tsx`: `participantsById`/`messageById`/`rows` derivados com `useMemo` ANTES dos
  early returns (Rules of Hooks), eliminando scans por render; `findAuthor` removido; render passa
  a iterar `rows` (mesmos separadores de dia, headers e reply previews).
- Sem comentários novos no código.

## 6. Comportamento preservado
- Mesma árvore renderizada (dias, headers por remetente, reply preview, unseen count, scroll).
- Identidade visual/alinhamento inalterados; nenhuma prop ou contrato mudou.

## 7. Testes
- Foco `src/components/conversations`: **12 files / 54 tests** verdes (inclui `message-list`,
  `message-list-experience`, `message-bubble`, `conversation-thread`, hubs/composer).
- Web full: **70 files / 519 tests** verdes; `tsc --noEmit` limpo; `next lint` sem erros (apenas
  warning pré-existente em `lib/team-identity.ts`); `next build` compilou.

## 8. Benchmark F9
`pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` (12/12) antes e depois; thresholds intactos.
API intocada (nenhum arquivo de API alterado).

## 9. Banco
Nenhuma migration/schema change; DEV intocado; TEST não necessário além do benchmark.

## 10. Flakes
Nenhum nesta fase. (F19 registrou incidente de infra Docker/Postgres, já restaurado.)

## 11. Limitações
- Sem virtualização/paginação: conversas muito longas continuam renderizando/baixando todo o
  histórico (o ganho da F20 é reduzir re-render e custo por render, não o tamanho do DOM/rede).
- Sem medição objetiva (não há infra de perf/evals); o ganho é estrutural, não medido em ms.

## 12. Achados honestos
- O gap de escalabilidade real é a **API sem paginação** + render de todo o histórico; a
  memoização é a parte segura que podia ser feita sem decisão de produto.
- `React.memo` só é eficaz porque as linhas agora são memoizadas; sem isso, `replyTo` recriado a
  cada render anularia o memo.
- Virtualização "por antecipação" adicionaria dependência e complexidade sem volume comprovado.

## 13. Decisões arquiteturais
- Otimização proporcional e sem dependência nova; nenhuma mudança de contrato.
- Paginação/virtualização ficam condicionadas a requisito (janela de histórico/volume real).
- Nenhum estado/derivação novo fora do React (sem cache paralelo).

## 14. Próximo passo
Backlog restante: guarda semântica de secret (se necessária) e, condicionado a requisito,
paginação/virtualização do histórico de conversas (com evals de latência).
