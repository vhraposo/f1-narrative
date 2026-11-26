# v5 — F1 RPG & Race Simulation (Plano)

Branch: `v5-RPG`, criada a partir de `main` em `cb688f0` (merge PR #4 do v4, que contém o HEAD
v4 `6aed982`). A branch anterior `v5-F1-RPG` foi deletada. Nenhum commit foi feito nesta etapa;
as alterações locais do modelo Qwen (não commitadas) foram reaplicadas na working tree depois de
se perderem no pull — o `.env` e o modelo `qwen3.5:9b` instalado foram preservados.

## Tese da v5
Transformar a corrida em um **sistema de RPG de domínio**: atributos de piloto (treináveis),
performance de equipe/carro, perfil de pista, clima e fatos/feitos alimentam um motor
probabilístico **calibrado com dados reais**, não com números inventados. O jogador vê
probabilidades e distribuição de posições; a corrida continua pertencendo ao domínio
(Race/RaceResult/Command Layer), nunca ao LLM.

## Princípios
1. **Dados com proveniência**: cada campo de pista/equipe/piloto tem fonte, data de coleta e
   confiança. Scraping/ingestão é offline, versionada e cacheada — nunca em request.
2. **Determinismo reproduzível**: RNG semeado por universo+corrida; mesma entrada ⇒ mesma
   simulação (replay).
3. **Probabilidade, não certeza**: o motor devolve distribuições (vitória, pódio, pontos,
   posição), com incerteza explícita.
4. **Equipe pesa mais que piloto?** Calibrar: a literatura mostra que o carro explica a maior
   parte da variância (~88% em uma análise bayesiana), mas o piloto decide margens — o modelo
   deve refletir isso sem tornar o piloto irrelevante.
5. **Não quebrar F9/F11–F23**: corrida é domínio separado do diálogo; nenhum LLM no cálculo;
   nenhuma escrita fora do Command Layer.
6. **Universe isolation**: atributos e treino são por universo (personagem existe nele), com
   seed canônico global para criação.

## Documentos
- [`01-research.md`](01-research.md) — RPG, F1, modelos probabilísticos, fontes.
- [`02-attributes.md`](02-attributes.md) — atributos, treino, equipe, pista, clima, feats.
- [`03-race-engine.md`](03-race-engine.md) — fórmulas, simulação, calibração, saídas.
- [`04-data-pipeline.md`](04-data-pipeline.md) — scraping/ingestão, schema planejado, licenças.
- [`05-roadmap.md`](05-roadmap.md) — subfases, critérios de aceite, riscos, perguntas abertas.

## Status
- **V5.1 COMPLETE** — perfis de pista + climatologia reais, proveniência, validação e testes.
  Ver [`06-audit-and-status.md`](06-audit-and-status.md).
- **V5.2–V5.7 PENDING** — ver roadmap revisado em `05-roadmap.md`.

## Decisões já fechadas
- Modelo de força: **Plackett–Luce / ordem de estatísticas (Thurstone) + Monte Carlo** para
  probabilidades, com **DNF como processo separado** (confiabilidade).
- Seed de atributos por **forma atual + resultados históricos + qualy/ritmo vs companheiro +
  confiabilidade + experiência**, com faixa de incerteza (scouting), não número exato.
- Pista: dataset curado de 24 perfis (tipo, demandas, degradação, ultrapassagem, pit loss, SC,
  clima) com fonte e data.
- Clima: **climatologia histórica** (Open-Meteo) por circuito/mês + variação por fim de semana;
  não é `Math.random()` puro.
- Bônus de casa: pequeno e limitado (ex.: +3% de força equivalente), nunca determinante.
- Treino: pontos de XP por período, custo crescente, teto de potencial, fadiga/risco de lesão.
- Equipe: carro (aero, potência, chassi, pneus), confiabilidade, pit stop, desenvolvimento;
  seed pelo campeonato de construtores + forma recente + notícias de upgrade.

## Fora de escopo da v5 (por enquanto)
- Streaming/presença; novo motor de diálogo; LLM decidindo corrida; scraping em runtime;
  editor de pista; multiplayer.
