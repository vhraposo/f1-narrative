# v5 — Motor de corrida (probabilidade, simulação e calibração)

## 1. Visão geral
Duas camadas:
1. **Força latente** (determinística) — atributos + carro + pista + clima + forma + casa.
2. **Incerteza** (sorteada com seed) — ruído de performance + DNF + safety car.
A saída é uma **distribuição de posições** por piloto (não um vencedor único).

```
atributos do piloto ─┐
atributos do carro ──┼─► força por pista ─► qualy ─► grid ─► corrida ─► distribuição
pista (pesos) ───────┤                                    │
clima ───────────────┤                                    ├─ DNF (separado)
forma/casa/feats ────┘                                    └─ SC/estratégia
```

## 2. Normalização
- Atributo bruto `v ∈ [0,100]` → `a = clamp((v - 40) / 55, 0, 1)` (grid F1 real concentra 55–95).
- Carro: mesma normalização por dimensão.
- Pista: pesos `w_k ∈ [0,1]`, normalizados para somar 1 por grupo.

## 3. Força do piloto na pista
`D_i = Σ_k w_k(track) * a_ik`

Onde `w_k` agrupa:
- ritmo (classificação/corrida/precisão),
- técnica (frenagem/curvas/tração/suavidade),
- mental (adaptabilidade/foco/experiência),
- corrida (racecraft/resistência).

## 4. Força do carro na pista
`C_t = Σ_j w_j(track) * car_tj` (aero, potência, chassi, pneus, confiabilidade, etc.)

Confiabilidade e pit crew **não entram na força de pace**: entram em processos separados.

## 5. Força total
`S_i = exp(β0 + βD*D_i + βC*C_t + βF*form_i + βH*home_i + βX*experience_i + βW*wetInteraction_i)`

- `βD, βC, ...` ajustados por backtest (não inventar); esperado `βC > βD` (carro domina).
- `home_i = 1` se nacionalidade do piloto = país da pista (bônus pequeno, ex. 0.05–0.10).
- `form_i` = últimas 5 corridas (pontos/posição relativa), limitado.
- `wetInteraction` = adaptabilidade × intensidade da chuva.
- Feats entram como `βfeat * feat_modifier` (pequeno).

## 6. Qualificação
- Performance de uma volta: `q_i = D_i^quali + C_t^oneLap + ruído_q`.
- `ruído_q ~ Normal(0, σq)` com `σq` calibrado (erro de volta/pressão).
- Grid = ordenar por `q_i`; penalidades (motor/caixa) aplicadas depois.
- Sorteio por sessão (Q1/Q2/Q3) se quisermos narrativa; para probabilidades, uma amostra de grid
  por iteração MC é suficiente.

## 7. Corrida
Modelo recomendado (calibrável e rápido):
1. Sortear **DNF** por piloto: `p_dnf = 1 - exp(-λ_track * reliability_t * risk_incident_i)`.
   `risk_incident_i` depende de Foco, pista (rua), clima e tráfego.
2. Para os que terminam, sortear ordem com **Plackett–Luce**:
   `P(ordem) = Π_{pos} θ_i / Σ_{restantes} θ_j`, com `θ_i = S_i * (1 - penalty_strategy)`.
3. Aplicar efeito de **ultrapassagem difícil**: se a pista tem dificuldade alta, o grid pesa mais
   no resultado (ex.: multiplicar `θ` por fator de track position ou limitar ganho de posições).
4. **Pit/estratégia**: modelo leve — número de paradas, pit loss da pista, suavidade/degradação;
   afeta o tempo final, não a ordem por si só.
5. **Safety car**: Bernoulli por pista; pode comprimir o grid e alterar estratégia (fator pequeno).
6. **Clima**: cenário sorteado antes (seco/garoa/chuva); ajusta grip, degradação, DNF e
   adaptabilidade.

Alternativa de maior fidelidade (fase posterior): simulação volta a volta com pneus/tráfego/SC.
Não necessária para probabilidades; útil para narrativa ("ultrapassou na volta 42").

## 8. Monte Carlo e saídas
- 20.000–50.000 iterações (seed fixo por `universeId:raceId:engineVersion`).
- Saídas por piloto: `P(vitória)`, `P(pódio)`, `P(pontos)`, `P(top10)`, posição esperada,
  intervalo de confiança (5–95%), distribuição completa (P1..P20/DNF).
- Agregações: favorito, surpresa, "em risco de DNF", batalha de companheiros.
- Custo: PL/MC em memória ~ms–s para 20 pilotos; sem I/O por iteração.

## 9. Invariantes e segurança
- O motor é **read-only** sobre o domínio: não altera Race/RaceResult/WorldState.
- A corrida oficial (quando gerada) continua passando por `finalizeRaceInTx`/timeline.
- Nenhum LLM no cálculo; nenhuma chamada de rede em runtime.
- Universe isolation: só pilotos/equipes do universo; seed canônico global quando criar.
- Replay: mesma seed + mesma versão ⇒ mesma distribuição.

## 10. Calibração e avaliação
- Backtest **walk-forward** com corridas históricas (Jolpica/F1DB): treinar/ajustar até a corrida
  N-1, prever N.
- Métricas: log loss (ordem top-3), Brier (P1/Pódio), ECE (calibração), Kendall tau, rank-PIT,
  acurácia de vitória. Comparar com baseline "grid".
- Critérios de aceite iniciais:
  - log loss de vitória melhor que baseline grid;
  - ECE ≤ 0,05;
  - P(vitória) do favorito calibrada (não 90% quando real é 40%);
  - sensibilidade: mudar atributo em +5 altera probabilidade de forma coerente;
  - nenhum piloto com P>95% sem dominância extrema.
- Repetir calibração a cada mudança de regulamento/temporada.

## 11. Exemplo ilustrativo (Interlagos, Alicya)
> Valores fictícios, só para explicar o fluxo.
- D_Alicya = 0,78; C_equipe = 0,74; casa = +0,06; forma = 0.
- S = exp(β0 + βD*0,78 + βC*0,74 + 0,06). Supondo βD=1,2, βC=2,0, β0=-1,5:
  S ≈ exp(-1,5+0,94+1,48+0,06) = exp(0,98) ≈ 2,66.
- Rival forte: S ≈ 3,47; vários entre 1,8–2,6.
- PL: P(vitória) ≈ 2,66 / Σ ≈ 13% (exemplo).
- MC adiciona DNF/ruído: P(pódio) ~30%, P(pontos) ~70%, P1..P20 distribuição.
- O painel mostra "13% vitória · 30% pódio · 70% pontos" com barra de incerteza, nunca "vai vencer".

## 12. Anti-padrões
- Não usar `Math.random()` sem seed; não usar d20 puro; não dar bônus de casa >10%; não deixar
  carro explicar 100% (piloto precisa importar em quali/chuva/ultrapassagem); não calibrar "no
  olho"; não exibir número único de "overall".
