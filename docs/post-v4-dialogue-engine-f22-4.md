# Dialogue Engine — F22.4 (Context / Memory Curation)

## F22.4 — COMPLETE

## 1. Objetivo
Melhorar a qualidade do contexto que chega ao realizer (curadoria), não aumentar volume:
dedupe, remoção de redundância com o histórico imediato, limite e métricas de orçamento.

## 2. Estado inicial / Git
HEAD `33b420e` (F22.3); tree limpo; origin sincronizado; sem push/merge/rebase/reset/amend.

## 3. Arquitetura (antes → depois)
Pipeline inalterado. Entre `memoryContext` e o realizer foi inserida curadoria determinística:
`memorySummaries` passa por `curateDialogueMemories` (normaliza, remove vazias/duplicadas, remove
memórias idênticas a mensagens recentes, cap 3). Prompt do LLM ganhou fronteira explícita de
conhecimento ("você não sabe nada além desta conversa; não presuma o que o interlocutor sabe").

## 4. Achados
- `memorySummaries` chegava ao realizer como slice direto do retrieval (até 3), sem dedupe nem
  remoção de eco do histórico — podendo repetir conteúdo já visível nas `recentMessages`.
- `knowledgeContext`/`topicContext` continuam sem ir ao prompt (decisão F22.2 de não despejar
  IDs/JSON interno); a fronteira foi expressa como instrução, não como dump.
- Não há evidência de que mais contexto melhore; a curadoria atua para não piorar.

## 5. Implementação
- `conversation.dialogue-context-curation.ts` (novo): `normalizeContextText`,
  `curateDialogueMemories(memories, { recentTexts, limit })`, `measureDialogueContextBudget(context)`
  (chars/componentes/memórias/recentes).
- `conversation.simulation.ts`: `memorySummaries: curatedMemories` (recentes do turno como
  referência de redundância).
- `conversation.dialogue-realizer-ollama.ts`: linha de fronteira de conhecimento no system prompt.
- `src/scripts/human-quality-ab.ts`: aplica a curadoria nos cenários (o A/B passa a exercitar
  F22.4).

## 6. Arquivos
`conversation.dialogue-context-curation.ts` (novo), `.test.ts` (novo),
`conversation.simulation.ts`, `conversation.dialogue-realizer-ollama.ts`,
`src/scripts/human-quality-ab.ts`, `docs/post-v4-dialogue-engine-f22-4.md`, `docs/HANDOFF.md`.

## 7. Testes
`conversation.dialogue-context-curation.test.ts` (4): normalização, dedupe/eco/vazias, limite,
orçamento. Foco curation+ollama: 17/17. API full: **3000 testes** com 1 falha conhecida
(`pilot-knowledge.provision #4`, reproduzido no full e **verde isolado 13/13**); demais 2999
verdes. tsc/ESLint verdes.

## 8. Benchmark F9
`F9 BENCHMARK GATE: PASS` (12/12) antes e depois; thresholds intactos.

## 9. A/B (30 cenários, `llama3.2`, 1 amostra, com curadoria aplicada)
determinístico inalterado (guard 0, ~0ms). LLM: question rate 53%, duplicate 3,3%, fallback 6,7%,
guard 6,7%, latência 826ms, avg 44 chars. **Honestidade**: a variância do modelo 3B entre
execuções (23%→30%→47%→53% de question rate) domina os agregados; **não há evidência de ganho
atribuível à curadoria nos agregados** — o ganho é estrutural e testado (determinístico).

## 10. Performance / segurança / banco
Curadoria é função pura O(n) sem queries/retrieval/LLM extra. Sem migration; nada persistido;
DEV intocado. F9/F11/F12/F14/F15 preservados; LLM sem autoridade.

## 11. Flakes
`pilot-knowledge.provision #4` (histórico) no full, verde isolado; nada novo.

## 12. Limitações / decisões
- Cura por normalização/eco/limite; sem ranking semântico novo (evita retrieval novo).
- `topicContext`/`knowledgeContext` seguem fora do prompt (IDs/internos); F22.5+ pode revisitar.
- LLM continua experimental; default determinístico.
- **Próximo passo:** F22.5 persona/relationship adaptation.
