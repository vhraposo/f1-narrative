# Dialogue Engine — F22.5 (Persona / Relationship Adaptation)

## F22.5 — COMPLETE

## 1. Objetivo
Fazer a fala refletir quem é a personagem e qual é a relação, sem inventar eixos de personalidade
e sem biografia despejada — projetando apenas o que o domínio já possui (`voice` + afinidade).

## 2. Estado inicial
HEAD `71ba1f1` (F22.4); tree limpo; origin sincronizado.

## 3. Arquitetura
Inalterada. Adicionada projeção determinística efêmera (`conversation.dialogue-persona.ts`) usada
no prompt do realizer; o determinístico já diferenciava personas via `voiceBucket(informality)` e
afinidade (pool neutro), mantido como está.

## 4. Achados
- A identidade já existia em `voice` (informality/warmth/humor/emojiTendency/verbosity derivados da
  afinidade) mas o prompt não a expressava de forma qualitativa; só números.
- Relação tinha apenas `affinity` (0..1) — nenhum campo de intimacy/trust/tension a inventar.
- Não há biography dumping no determinístico; o risco é do LLM.

## 5. Implementação
- `conversation.dialogue-persona.ts` (novo): `describeRelationshipAffinity(affinity)` →
  "distante"/"neutra"/"próxima" (null/NaN → null); `describeVoiceStyle(voice)` → traços qualitativos
  derivados (informal/formal/equilibrado, caloroso/seco, bem-humorado, conciso/expansivo).
- Prompt do LLM: seções `RELAÇÃO: <rótulo> (afinidade X)` e `ESTILO: <traços>` (projeção do
  existente, sem novos eixos).
- Sem mudanças no determinístico (já adaptava por voz/afinidade) e sem persistência.

## 6. Arquivos
`conversation.dialogue-persona.ts` (novo) + `.test.ts` (novo), `conversation.dialogue-realizer-ollama.ts`,
`conversation.dialogue-realizer-ollama.test.ts`, `docs/post-v4-dialogue-engine-f22-5.md`,
`docs/HANDOFF.md`.

## 7. Testes
persona 3/3; ollama prompt 13/13 (foco 16/16). API full **218 files / 3003 tests — 100% verde**;
tsc/ESLint verdes.

## 8. Benchmark F9
`F9 BENCHMARK GATE: PASS` (12/12) antes e depois; thresholds intactos.

## 9. A/B (30 cenários, `llama3.2`)
determinístico inalterado. LLM: question rate 26,7%, duplicate 6,7%, fallback 0%, unique 96,7%,
latência 982ms, avg 54 chars. Variância entre execuções do modelo permanece (não atribuível só à
F22.5); nenhuma regressão observada nos agregados.

## 10. Performance / segurança / banco
Projeção pura, zero custo de I/O. Sem migration; nada persistido; DEV intocado. F9/F11/F12/F14/F15
preservados; LLM sem autoridade.

## 11. Flakes
Nenhum no full desta fase.

## 12. Limitações / decisões
- Persona limitada ao que o domínio tem (`voice` + affinity); intimacy/trust/tension inexistentes
  não foram simulados.
- Biography dumping não é barrado por guarda (sem caso observado); risco documentado para o LLM.
- LLM readiness (leitura intermediária): **PROMISING em variação/contexto; NOT READY em persona/
  coerência** — default continua determinístico.
- **Próximo passo:** F22.6 naturalness/diversity/anti-repetition.
