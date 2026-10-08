# Dialogue Engine — F22.6 (Naturalness / Diversity / Anti-Repetition)

## F22.6 — COMPLETE

## 1. Objetivo
Reduzir repetição mecânica sem aleatoriedade: anti-repetição determinística no realizer +
métricas de repetição reutilizáveis.

## 2. Estado inicial
HEAD `34218b7` (F22.5); tree limpo; origin sincronizado.

## 3. Arquitetura
Inalterada. `pickPhrase` do realizer determinístico passou a evitar candidato idêntico a mensagem
do histórico recente (mesmo seed; busca determinística pelo próximo do pool). Nova métrica pura
`measureRecentRepetition`.

## 4. Achados
- O seed do realizer já variava por contexto, mas nada impedia a mesma frase escolhida em turnos
  consecutivos quando o pool é pequeno.
- Métricas de repetição não existiam; F22.8 precisa delas.

## 5. Implementação
- `conversation.dialogue-realizer.ts`: `normalizeForRepeat` + desvio determinístico do candidato
  quando ele já aparece em `recentMessages` (se todos repetirem, mantém o original — sem loop).
- `conversation.dialogue-repetition.ts` (novo): `measureRecentRepetition(messages)` →
  `{ count, duplicateRate, openingRate }` (normalização NFD; abertura = 2 primeiras palavras).
- Sem RNG, sem temperatura, sem persistência.

## 6. Arquivos
`conversation.dialogue-repetition.ts` (novo) + `.test.ts` (novo), `conversation.dialogue-realizer.ts`,
`docs/post-v4-dialogue-engine-f22-6.md`, `docs/HANDOFF.md`.

## 7. Testes
repetition 4/4 + realizer 32/32 + human-quality 7/7 (foco 44/44). API full **3007 testes** com 1
flake histórico (`pilot-knowledge.provision #4`, já reproduzido verde isolado 13/13 na F22.4);
demais 3006 verdes. tsc/ESLint verdes.

## 8. Benchmark F9
`F9 BENCHMARK GATE: PASS` (12/12) antes e depois.

## 9. A/B (30 cenários, `llama3.2`)
determinístico inalterado. LLM: question rate 30%, duplicate 6,7%, fallback 3,3%, unique 96,7%,
latência 930ms, avg 43 chars. Variância do modelo 3B entre execuções continua dominando os
agregados; nenhuma regressão observada.

## 10. Performance / segurança / banco
Anti-repetição é O(pool) sobre dados já presentes; métrica pura. Sem migration; DEV intocado;
F9/F11/F12/F14/F15 preservados.

## 11. Flakes
`pilot-knowledge.provision #4` no full (histórico), verde isolado na fase anterior; nada novo.

## 12. Limitações / decisões
- Anti-repetição cobre igualdade normalizada da frase inteira; repetição estrutural (mesma
  abertura com palavras diferentes) é medida, não bloqueada (evita overfitting).
- LLM não teve temperatura/seed alterados (sem A/B que justifique).
- **Próximo passo:** F22.7 iniciativa conversacional (mínima, dentro do turno ativo).
