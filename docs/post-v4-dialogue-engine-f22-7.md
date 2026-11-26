# Dialogue Engine — F22.7 (Context-Aware Conversational Initiative)

## F22.7 — COMPLETE (mínimo, turno ativo)

## 1. Objetivo
Permitir participação própria (self-disclosure) de forma contextual, sem "perguntar sempre" e sem
mensagens fora do turno ativo (sem scheduler/SSE/websocket — F13/F19 preservados).

## 2. Estado inicial
HEAD `44061d1` (F22.6); tree limpo.

## 3. Implementação
- `DialogueResponseStrategy` ganhou `selfDisclosureMode: FORBIDDEN | OPTIONAL | ENCOURAGED`
  (determinístico): FORBIDDEN para QUESTION/INTERRUPTION/SILENCE; ENCOURAGED para SUPPORT/CALLBACK
  com afinidade ≥ 0,7; OPTIONAL nos demais. Derivação agora recebe `relationshipAffinity`.
- Prompt do LLM: linha de orientação de compartilhamento próprio quando não FORBIDDEN
  ("pode compartilhar algo próprio quando fizer sentido, sem obrigação").
- Sem novo planner, sem persistência, sem iniciativa fora do turno.

## 4. Testes / validação
strategy 9/9 (novo caso), ollama 13/13, naturalness 7/7 (foco 29/29). API full **3008 testes** com
1 flake histórico (`conversation.autonomous #13`, já reproduzido verde isolado em fases
anteriores); demais 3007 verdes. tsc/ESLint verdes. F9 PASS antes/depois. A/B rerun (LLM question
40%, duplicate 3,3%, fallback 0, latência 975ms — variância do modelo documentada).

## 5. Limitações / decisões
- Iniciativa restrita ao turno ativo; cadence/cooldown de iniciativa ficam para requisito futuro.
- Determinístico permanece reativo (estratégia afeta o prompt/LLM); sem RNG.
- **Próximo passo:** F22.8 avaliação final multi-turno + promotion gate.
