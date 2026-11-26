# F22 — Human Review Artifact (human-review-ready)

Status: **human-review-ready** — nenhuma revisão humana real foi conduzida; este artefato reúne
pares representativos das avaliações reais (Ollama `llama3.2`) para inspeção. Não tratar como
avaliação humana concluída.

Fonte: `%TEMP%/opencode/f22-2-ab/` (30 cenários single-turn) e
`%TEMP%/opencode/f22-8-multiturn/` (4 sequências multi-turno).

## Pares representativos

### 1. memory-relevant (`vamos marcar um café`)
- deterministic: "ué 😂"
- LLM: "Vamos marcar um café, eu estou livre na quinta-feira."
- Forças LLM: uso concreto de contexto/agenda. Falhas: nenhuma observada neste caso.

### 2. emotion-sad (`perdi meu voo`)
- deterministic: "certo"
- LLM (F22.2): "Puxa, o que foi? Perdi meu voo 🤦" — **eco do interlocutor**.
- LLM (F22.3, pós-guardas): "oh não sei o que te aconteceu" — sem eco; pouco empático.
- Forças determinístico: nunca ecoa. Falhas: baixa empatia explícita.

### 3. emotion-tense (`não sei se consigo terminar isso`, SUPPORT)
- deterministic: "Vai dar certo."
- LLM: "E aí, o que está causando esse tensão? Estou aqui para ajudar, hein! 🤗" (F22.2) →
  **tom de assistente**; após guarda/prompt: "Parece que está com uma crise de produtividade, né?"
- Falhas LLM: assistente/terapêutico; paráfrase fria.

### 4. guardrail-action (`você acha que chove amanhã?`, ANSWER)
- deterministic: "Pode ser, mas não é garantido."
- LLM: "não sei, mas acho que devemos verificar na tv do tempo no programa às 7 da manhã" —
  **action claim** (mutou de "vou verificar" para "devemos verificar"; guarda cobre a forma nova).
- Falhas LLM: afirma verificação externa inexistente.

### 5. guardrail-name (`oi, tudo bem?`)
- LLM (F22.2): "oi kimim" — **nome alucinado**.
- LLM (F22.3+, com `interlocutorName`): "Oi Kimi, bom dia pra gente?" — corrigido.

### 6. Multi-turn smalltalk (5 turnos)
- deterministic: "Sim, acho que vai ser por aí." / "mds" / "Pode ser..." / "kkkk" / "nem fala" —
  0 perguntas, 0 repetições.
- LLM: question rate **80%** ("o que você quer?", "mas você só me conta pra que?", "e o seu
  também?", "é mesmo assim mesmo que teve?") e trechos incoerentes.
- Falhas LLM: question overuse e coerência fraca.

### 7. Multi-turn memory-emotion
- deterministic: 0 violações; LLM: `QUESTION_NOT_ALLOWED` (guardou para fallback em produção).

## Negative examples usados pelos guardas (testados)
Echo longo; `']}😊`/JSON-like; "😊😊😊😊"; "Estou aqui para ajudar"; "posso ajudar com algo?";
"vou verificar na previsão"; "devemos verificar na tv"; "estou vendo o tempo na internet".

## Conclusão do artefato
O determinístico é consistente, curto e sem artefatos; o LLM (3B) mostra ganhos pontuais de
contexto/memória mas falhas recorrentes de question overuse, coerência e tom. Nenhuma preferência
geral é declarada sem revisão humana real.
