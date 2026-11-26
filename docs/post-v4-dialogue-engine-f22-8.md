# Dialogue Engine — F22.8 (Final Human Conversation Evaluation & Promotion Gate)

## F22.8 — COMPLETE — F22 PROGRAM COMPLETE

## 1. Objetivo
Avaliação final do programa F22: multi-turno real, métricas multidimensionais, artefato de revisão
humana e decisão de promoção do LLM.

## 2. Estado inicial
HEAD `99143cb` (F22.7); tree limpo; origin sincronizado; Docker/Postgres ativos; Ollama ativo
(`llama3.2`).

## 3. Implementação F22.8
- `src/scripts/human-quality-multiturn.ts` (novo) + npm `human-quality:multiturn`: 4 sequências ×
  5 turnos (smalltalk, support-close, rival-tension, memory-emotion), deterministic + LLM (se
  disponível), métricas por sequência (questionRate, duplicateRate, openingRate, violations,
  fallbacks, genericCount, latência); artefatos em `%TEMP%/opencode/f22-8-multiturn/`.
- `docs/evaluations/f22-human-review.md` (novo): **human-review-ready** (nenhuma revisão humana
  real; pares representativos + negativos testados).
- Sem migration; nada persistido; sem mudança de default.

## 4. Evidência multi-turno (real, `llama3.2`, 1 amostra por turno)
| Sequência | deterministic | LLM |
|---|---|---|
| smalltalk | 0 violações, 0 perguntas, 0 dup, 0ms | **questionRate 0,80**, 0 violações, incoerências, 4,2s/5 turnos |
| support-close | 0 violações, 0 perguntas, 0ms | questionRate 0,40, trechos terapêuticos/incoerentes, 5,0s |
| rival-tension | 0 violações, questionRate 0,20, 0ms | questionRate 0,60, 3,9s |
| memory-emotion | 0 violações, 0 perguntas, 0ms | questionRate 0,20, 1 violação `QUESTION_NOT_ALLOWED`, 4,4s |

## 5. Promotion gate — decisão: **LLM NOT PROMOTED**
Critérios (§F22.8.9) vs evidência:
1. Segurança — ok (sem leakage/bypass; guardas ativos).
2. Estrutura — ok (0 structural leakage pós-F22.3; fallback/guard presentes).
3. Persona — **falha**: incoerência e paraphrase fraca multi-turno.
4. Naturalness — **falha**: question overuse até 80%; tom de assistente mutando.
5. Fallback — ok (baixo: 0–6,7%).
6. Performance — custo medido: ~0,8–1,1s/turno vs ~0ms determinístico.
7. Multi-turn — **falha**: degrada em sequências.
→ `DIALOGUE_REALIZER=deterministic` permanece **default**; `llm` segue **experimental**.

## 6. Progressão do programa (F22.1→F22.8)
- F22.1 baseline + tone-aware (emoção passa a influenciar).
- F22.2 LLM realizer atrás de flag + A/B (25 cenários) — não promovido.
- F22.3 strategy + guardrails (echo/estrutural/emoji/assistente/action/pergunta) — leakage/emoji/
  nome zerados; guard rate 6,7%.
- F22.4 curadoria de contexto/memória + budget + fronteira de conhecimento.
- F22.5 persona/relação projetadas do domínio (`voice`/affinity) no prompt.
- F22.6 anti-repetição determinística + métricas de repetição.
- F22.7 self-disclosure na estratégia (turno ativo; sem scheduler).
- F22.8 multi-turno real + gate — determinístico default.

## 7. Respostas objetivas
1. **Mais natural?** Não comprovado para o LLM (question overuse/incoerência); determinístico
   consistente e sem artefatos.
2. **Personagem mais reconhecível?** Parcialmente: persona projeta voz/relação; sem evidência de
   ganho geral.
3. **Relação influencia?** Sim no domínio (pool neutro/estratégia/prompt); efeito no LLM não
   medido isoladamente.
4. **Memória com parcimônia?** Sim: curadoria (dedupe/eco/cap 3) + prompt não obrigatório.
5. **Conhecimento correto?** Fronteira reforçada; guardas impedem eco/claim; sem vazamento
   observado.
6. **Evita padrões de chatbot?** Sim no determinístico; LLM ainda mostra tom de assistente.
7. **Menos pergunta artificial?** Determinístico sim (0–20%); LLM **não** (até 80%).
8. **Menos repetição?** Sim no determinístico (anti-repeat + 0 dup nas sequências).
9. **Mais iniciativa adequada?** Estratégia permite self-disclosure; cadence não avaliada.
10. **LLM melhor que determinístico?** Não no estado atual (ganhos pontuais vs falhas multi-turn).
11. **Custo do LLM:** ~0,8–1,1s/turno, 1 chamada/turno, 0–6,7% fallback, sem DB extra.
12. **Deve ser promovido?** Não.
13. **Por quê?** Question overuse, incoerência multi-turno, tom de assistente e persona fraca com
    o modelo 3B disponível; determinístico cumpre melhor o critério "resposta que aquela pessoa
    daria".

## 8. Validação final
F9 **PASS 12/12**; API full 3008 testes com o flake histórico `conversation.autonomous #13`
(reproduzido no full e **verde isolado 13/13**); tsc/ESLint verdes; web não alterada.

## 9. Limitações / próximos passos
- Modelo único 3B, 1 amostra/turno; sem revisão humana real; sem juiz LLM (por decisão).
- Próximos candidatos (requerem requisito/produto): modelo maior ou fine-tune; F22.9 não criada
  automaticamente; itens condicionados do backlog permanecem (paginação/virtualização, presença,
  setErrorHandler).
