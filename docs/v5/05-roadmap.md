# v5 — Roadmap, critérios de aceite e perguntas abertas

## Subfases propostas

### V5.1 — Fundação de dados (pistas + clima) — **DONE**
- Sem migration: perfis são assets versionados (`data/v5/*.json`) com schema Zod e loader.
- 23 circuitos do calendário F1DB 2026, geometria real, derivados de resultados reais, clima
  Open-Meteo (fallback NASA POWER), proveniência/licença/confiança por circuito.
- Campos sem fonte marcados `unavailable` (potência/downforce/freio/tração/pneu/grip/pit loss/SC).
- **Evidência**: `track-profile.test.ts` 4/4; tsc limpo; F9 PASS.

### V5.2 — Atributos de piloto + seed + treino (motor)
- **Estender** `DriverAttribute` existente (não duplicar): migrar os 4 campos para os 10 da V5 +
  potencial/forma/fadiga/moral/confiança; ajustar `qualifying`/`race-simulation` e `evolution`.
- Seed pelo universo (resultados/standings/companheiro) com faixa de incerteza; treino por
  calendário (XP, custo crescente, teto, idade, fadiga); IA com o mesmo orçamento.
- **Aceite**: 20+ pilotos seedados; nenhum atributo fora de faixa; temporada simulada sem
  inflação; treino reproduzível.

### V5.3 — Performance de equipe/carro
- Schema `TeamCarProfile`; seed por construtores/forma/DNF/pit; upgrades datados.
- Testes de soma/pesos e de upgrade decrescente.
- **Aceite**: 11 equipes; carro coerente com standings do universo; F9 intacto.

### V5.4 — Motor de corrida + probabilidades
- Qualy (grid) + corrida PL/ordem de estatísticas + DNF + casa + clima + feats (mínimo).
- Monte Carlo com seed; endpoint read-only `GET /api/races/:id/prediction` (ou similar) em TEST.
- Backtest walk-forward (Jolpica) com log loss/Brier/ECE/rank-PIT; relatório de calibração.
- **Aceite**: probabilidades somam 1; favorito calibrado (ECE ≤ 0,05 no backtest); baseline de
  grid superado; P(vitória) sensível a atributos; sem escrita de domínio.

### V5.5 — Loop RPG (treino/calendário/feats)
- Janelas de treino no calendário; foco escolhido; fadiga/lesão; feats/fatos.
- IA de treino determinística para pilotos controlados pela IA.
- **Aceite**: progressão em 1 temporada simulada sem inflação; feats limitados; replay.

### V5.6 — Integração de UI
- Painel pré-corrida (probabilidades + incerteza), painel de atributos/treino, upgrades da equipe.
- Não alterar chat/Dialogue Engine; owner-only.
- **Aceite**: UI lê APIs; estados de loading/erro; sem dados de outros universos; web tests.

### V5.7 — Avaliação final e calibração
- Backtest ampliado, sensibilidade, stress (chuva, rua, DNF), docs.
- Feature flag para o motor (ex.: `V5_RACE_ENGINE=off|shadow|on`), default `off` até aprovação.
- **Aceite**: relatório completo; números reproduzíveis; HANDOFF/commit por subfase.

## Critérios de qualidade do programa
- Probabilidades **calibradas** (não só "ordem plausível").
- Carro dominante sem apagar o piloto; bônus de casa/feats limitados.
- Nenhum dado inventado sem fonte; dataset versionado.
- Determinismo/replay; universe isolation; sem LLM no domínio.
- Nada de regressão em F9/F11–F23; API/Web verdes; migrações só quando necessárias.

## Riscos
1. **Licenciamento/scraping** (F1/Pirelli): usar fontes abertas (Jolpica/F1DB/Open-Meteo) e
   referência com atribuição; revisão jurídica antes de publicar dados derivados.
2. **Overfitting de calibração**: walk-forward obrigatório; não ajustar no mesmo dado de teste.
3. **Peso do carro**: se o carro explicar quase tudo, o RPG perde graça; calibrar para que
   quali/chuva/ultrapassagem deem espaço ao piloto.
4. **Universo divergente**: quando o universo do jogador difere do real, o seed externo não pode
   sobrescrever fatos do universo; usar universo primeiro.
5. **Complexidade**: começar com PL+MC; lap-by-lap só se necessário para narrativa.
6. **UX de probabilidade**: evitar precisão falsa; mostrar intervalos/faixas.
7. **Migrações**: planejar com cuidado; TEST primeiro; DEV read-only.

## Perguntas abertas (precisam de decisão do produto)
1. **Fonte de verdade do seed**: universo (corridas já rodadas) > snapshot externo? Proposta: sim,
   externo só na criação/refresh canônico.
2. **Escopo do grid**: usar o grid real 2026 (Antonelli/Mercedes etc.) ou personagens do universo?
   O projeto já tem dados reais via sync; confirmar se o v5 usa o grid do universo ou trava o
   snapshot 2026.
3. **Personagens fictícios**: como seedar? Proposta: baseline de scouting + potencial + histórico
   do universo; sem dados externos.
4. **Exibição**: número, letra/estrela ou faixa? Proposta: faixa + número só em modo dev.
5. **Corrida oficial**: só probabilidades ou também gerar resultado oficial? Se gerar, precisa
   passar pelo pipeline existente de resultados/timeline (determinístico).
6. **Sprint/reverse grid/pontos**: regras da temporada do universo; confirmar.
7. **Lesões/aposentadoria/contratos**: entram no v5 ou depois?
8. **Economia de treino**: quantos pontos por semana/corrida? IA tem o mesmo orçamento?
9. **Upgrades**: 2 janelas por temporada é suficiente? Quem decide (jogador/IA)?
10. **Clima**: sortear por sessão ou por fim de semana? Mostrar previsão antes?
11. **Persistência**: salvar `RacePrediction` para auditoria/replay? (proposta: sim, opcional)
12. **Relação com o Dialogue Engine**: atributos/resultados podem virar contexto de conversa
    (ex.: "ganhou em Interlagos")? Se sim, via Event/Memory existentes, não via LLM.
13. **Licença**: publicar derivados de Pirelli/FIA? Restringir a uso interno/atribuição.
14. **Benchmark**: F9 continua sendo o gate do diálogo; criar benchmark próprio do motor (backtest)
    como gate da v5.
15. **Calibração**: janela histórica (2014–2026?) e normalização por regulamento (2026 é novo).

## Próximo passo sugerido
Começar por **V5.1** (dados de pista/clima) — é a fundação que permite evitar números inventados e
destrava o seed de pilotos/equipes. Antes de codar: aprovar as perguntas 1–6 (grid, seed, exibição,
corrida oficial, sprint, clima).
