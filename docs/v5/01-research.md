# v5 — Pesquisa e evidências

## 1. Sistemas de RPG: o que a literatura sugere
- **Resolução**: toda ação combina *habilidade + dificuldade + circunstância + imprevisibilidade*.
  O design deve escolher explicitamente como cada fator entra (modificador no dado, no alvo, ou
  na dispersão). Referência clássica: Torben Mogensen, *Dice-Rolling Mechanisms in RPGs*.
- **Curvas**: rolagens de sino (3d6) concentram resultados; d20 é linear. Para corrida, queremos
  **erro controlado** (dias bons/ruins), não caos: preferir ruído gaussiano/Gumbel calibrado a
  d20 puro.
- **Retornos decrescentes**: custo crescente por ponto e/ou efetividade marginal menor. RuneQuest
  usa treino com custo crescente; é o padrão para progressão "de verdade".
- **Atributos vs. skills**: atributos são estáveis e treináveis devagar; skills derivadas são
  praticadas. Para pilotos, separamos **talentos/potencial** (atributos) de **forma** (estado).
- **Esportes + RPG**: simulações de futebol australiano e *Football Manager* mostram valor em
  **atributos múltiplos + traços** (personalidade, liderança) e em **rerrolar desempenho por
  partida** (dia bom/dia ruim), com fadiga degradando dentro da prova. Aplicamos isso à corrida.
- **Lição**: não usar um único "overall". Atributos precisam ser **situacionais** (pista, clima,
  pneu, pressão), e o resultado precisa de **distribuição**, não número fixo.

## 2. Como a F1 funciona (o que o modelo precisa capturar)
- **Dois ritmos diferentes**: volta rápida (qualificação) ≠ ritmo de corrida (gestão de pneu,
  tráfego, combustível). Modelos separados.
- **O carro domina**: análise bayesiana da era híbrida estima ~**88% da variância** de resultados
  explicada pelo construtor; o piloto decide margens. O modelo deve ter peso forte de carro, mas
  piloto ainda ser decisivo em pista de ultrapassagem difícil, chuva e classificação.
- **Pista importa**: demandas de potência, downforce, frenagem, tração, abrasão, evolução de
  pista, ultrapassagem, pit loss, safety car. O mesmo carro é 2º em Monza e 8º em Mônaco.
- **Confiabilidade**: DNF é processo separado do ritmo (probabilidade por equipe/piloto, pista,
  clima). Deve ser sorteado à parte para não contaminar a ordem de ritmo.
- **Clima**: chuva muda grip, estratégia, risco, desempenho de pilotos adaptáveis; taxa por
  circuito/mês (ex.: Spa ~60%, Singapura ~70%, Bahrain ~5% em referências de época; validar com
  climatologia própria).
- **Pontuação**: 25-18-15-12-10-8-6-4-2-1 (+1 FL); sprint 8-7-6-5-4-3-2-1; DNF = 0. O motor
  deve produzir a ordem e o sistema existente aplica pontos.
- **Contexto 2026**: regulamento novo (unidades de potência, carros mais ágeis), o que muda
  demandas de pista e ultrapassagem; usar dados da temporada corrente para calibrar, não médias
  antigas. Snapshot de exemplo (25/10/2026): Antonelli/Mercedes dominantes (607 pts Mercedes).
  Esse snapshot serve de exemplo de seed, nunca hardcode.

## 3. Modelos probabilísticos recomendados
- **Plackett–Luce** (e variantes truncadas/time-weighted): modelo clássico para ordem de chegada
  na F1; prevê permutações completas e é competitivo com odds de bookmakers (Henderson & Kirrane,
  2017). Fórmula: `P(i vence) = θi / Σθj`, com `θ` = força latente.
- **Thurstone/lattice (ordem de estatísticas)**: supera TrueSkill/Elo/Glicko/OpenSkill em 1.158
  corridas (log loss 2,225 vs 2,346–3,727; ECE 0,015). Trata o grid inteiro, não pares, e modela
  DNF como massa separada. É o alvo de qualidade para o v5.
- **Decomposição piloto × carro**: modelo bayesiano multinível (rank-ordered logit) separa
  habilidade do piloto, forma sazonal, vantagem do construtor e forma do construtor; ~88% da
  variância é do carro. Usaremos essa estrutura conceitual para calibrar pesos.
- **Pipelines aplicados**: XGBoost ranker (35 features: quali, pace do carro, forma, pista,
  confiabilidade, clima) + logístico de finish + Plackett–Luce com 10k sorteios Gumbel; avaliação
  walk-forward com log loss/Brier/ECE. Bom blueprint de features e validação.
- **Lição de calibração**: o motor não pode ser "fórmula bonita". Precisa de backtest
  walk-forward contra resultados históricos (Jolpica/F1DB) e métricas de calibração.

## 4. Dados de pista: o que coletar e onde
Campos mínimos por circuito (24 corridas):
- identidade: nome, país, cidade, timezone, lat/lon, fuso, tipo (rua/permanente/híbrido);
- geometria: extensão, voltas, distância total, nº de curvas (baixa/média/alta), reta mais longa,
  elevação, zonas de DRS, sentido;
- demandas (0–10): potência, downforce, frenagem, tração, estresse de pneu, abrasão, evolução;
- corrida: dificuldade de ultrapassagem (1–10), pit loss (s), prob. de safety car, nº típico de
  paradas, sensibilidade a estratégia;
- clima: pluviometria mensal, temperatura típica, umidade, probabilidade de chuva por sessão;
- história: primeiro GP, vencedores recentes, incidentes conhecidos (para feats/narrativa).

Fontes:
- **FIA/F1 oficial**: mapas, dados de sessão, nomes/distâncias.
- **Pirelli**: níveis de abrasão, tração, frenagem, evolução, downforce, estresse de pneu (usados
  em análises de estratégia).
- **FastF1/Jolpica/OpenF1**: voltas, setores, pit stops, grids, resultados (o projeto já usa
  Jolpica/OpenF1).
- **Open-Meteo Historical/Archive**: ERA5/ERA5-Land, 1940–presente, precipitação/chuva/horas de
  chuva/temperatura/vento; licença CC BY 4.0, 10k chamadas/dia grátis (não comercial).
- **Datasets de referência** (para conferência, não cópia cega): Kaggle F1 Circuits, F1Strategy
  (Pirelli), F1 2026 circuit guides, F1DB (CC-BY).
- **Notícias**: upgrades/desenvolvimento (Motorsport/F1/Crash) — ingestão manual curada, não
  scraping irrestrito.

Licenças: preferir CC-BY/oficial; registrar atribuição; não redistribuir dados proprietários da
F1; scraping respeitando robots/ToS e com cache offline.

## 5. Seed de piloto/equipe (estado atual)
- Piloto: posição/points no campeonato, média de quali vs companheiro, ritmo de corrida, vitórias,
  DNFs, experiência, desempenho em chuva, resultados no circuito, forma recente (últimas 5).
- Equipe: posição/points de construtores, pontos por corrida, confiabilidade (DNF), pit stop médio,
  upgrades recentes (notícias), tendência (forma 5 corridas).
- Snapshot real 2026 (exemplo, 25/10): Mercedes 607, Ferrari 474, Red Bull 355, McLaren 355;
  Antonelli líder com 365. O seed deve ser **do universo do jogador** quando ele já tem corridas;
  o snapshot externo serve só para a criação do universo/atualização canônica.
- Faixa/incerteza: gerar valor central + intervalo (ex.: 88 ± 4), para o jogador "scoutar" sem
  precisão falsa.

## 6. Implicações diretas para o design
1. Separar **qualificação** e **corrida** no motor.
2. Modelar **carro** como fator dominante, com atributos por pista.
3. Sortear **DNF** separadamente (confiabilidade × risco de incidente).
4. Usar **Plackett–Luce/Thurstone** para ordem e **Monte Carlo** para distribuições.
5. Calibrar com **backtest walk-forward** (log loss, Brier, ECE, rank-PIT).
6. Clima via **climatologia** por circuito/mês, não aleatório uniforme.
7. Bônus de casa e feats **pequenos e limitados** (não decidem sozinhos).
8. Atributos situacionais + treino com **retornos decrescentes** e potencial.
9. Nenhum LLM no cálculo; eventos narrativos (opcional) usam o motor existente de Events.
