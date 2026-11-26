# v5 — Atributos, progressão, equipe, pista e clima

## 1. Escala e filosofia
- Atributos de **0 a 100**, com faixas: 40–59 reserva/novato; 60–74 sólido; 75–84 top; 85–94
  elite; 95+ geração histórica. Grid adulto concentra 55–90.
- Exibição por letra/estrelas para não fingir precisão; número interno só em dev.
- **Potencial** (por atributo) limita o teto; **forma** (temporária) é separada.
- Nenhum "overall" único: a força é calculada **por contexto** (pista, clima, pneu).

## 2. Os 12 atributos (proposta)
| # | Atributo | Grupo | O que representa | Usado em |
|---|---|---|---|---|
| 1 | Ritmo de Classificação | Ritmo | volta rápida, pneu novo, uma volta | quali |
| 2 | Ritmo de Corrida | Ritmo | pace em stint, consistência de volta | corrida |
| 3 | Precisão | Ritmo | repetir o máximo sem erro (consistência) | quali + corrida |
| 4 | Frenagem | Técnica | tardia/estável em zonas de brake | pistas de frenagem |
| 5 | Curvas | Técnica | velocidade em baixa/média/alta | curvas |
| 6 | Tração | Técnica | saída de curva, pneu traseiro | tração/rua |
| 7 | Suavidade | Técnica | vida de pneu (o mais importante na corrida) | degradação |
| 8 | Adaptabilidade | Mental | chuva, pista em evolução, setup, mudanças | clima/evolução |
| 9 | Foco | Mental | erro sob pressão, travada, rodada | incidentes |
| 10 | Experiência | Mental | leitura de corrida, estratégia, menos erro | estratégia/erro |
| 11 | Racecraft | Corrida | ultrapassar, defender, largar, tráfego | ultrapassagem |
| 12 | Resistência | Físico | queda de rendimento no fim, calor | stints longos/calor |

> Alternativa em aberto: separar **Chuva** de Adaptabilidade. Fica como pergunta aberta (05).

## 3. Pesos por pista (exemplo conceitual)
Cada circuito tem pesos (0–1) por atributo; a força é uma soma ponderada normalizada.

| Dimensão da pista | Puxa principalmente |
|---|---|
| Potência (Monza, Baku) | Ritmo de Corrida, Frenagem, Racecraft |
| Downforce (Mônaco, Hungria) | Curvas, Precisão, Tração, Adaptabilidade |
| Frenagem (Singapura, Interlagos) | Frenagem, Foco, Suavidade |
| Tração (ruas, saídas lentas) | Tração, Suavidade, Resistência |
| Estresse de pneu (Spa, Bahrain) | Suavidade, Ritmo de Corrida, Resistência |
| Ultrapassagem difícil | Classificação (grid) e Racecraft ganham peso |
| Chuva/mixed | Adaptabilidade, Precisão, Foco, Experiência |

Exemplo **Interlagos** (perfil a validar com dados): frenagem alta, tração média-alta, downforce
médio, ultrapassagem média, chuva ~45% na época, pit loss ~20–22 s, SC ~40%. Puxa Frenagem,
Tração, Suavidade, Adaptabilidade e Racecraft.

## 4. Performance de equipe/carro (8 atributos)
| Atributo | Representa | Fonte de seed |
|---|---|---|
| Aero/Downforce | carga aerodinâmica e equilíbrio | posição/points de construtores; upgrades |
| Potência | unidade de potência/eficiência | standings, notícias, 2026 regs |
| Chassi/Balanço | janela de setup, estabilidade | forma recente, resultados |
| Pneus | gestão/degradação do carro | telemetria/quali vs corrida |
| Confiabilidade | taxa de DNF | histórico da equipe |
| Pit Crew | tempo de pit stop | FastF1/estatísticas |
| Desenvolvimento | ganho por upgrade/temporada | notícias + tokens de upgrade |
| Estratégia | acerto de chamadas | modelagem leve (opcional) |

- Seed: `car_score = f(posição construtores, forma 5 corridas, confiabilidade, pit, upgrades)`.
- Upgrades: 2 janelas por temporada; notícia virá com força/área (ex.: +Aero, +Potência) e o
  engine aplica ganho decrescente (evitar inflação).

## 5. Clima
- Base: **climatologia** do circuito/mês (Open-Meteo 1995–2025): `p_rain`, `rain_mm`, `temp`,
  `humidity`, `wind`.
- Fim de semana: sortear cenário por sessão (seco / garoa / chuva forte) com probabilidade
  derivada da climatologia + variação sazonal; não uniforme.
- Efeitos: grip (seco/úmido), degradação (seco), risco de incidente, vantagem de Adaptabilidade,
  estratégia (pneu de chuva), SC.

## 6. Progressão (RPG)
- **XP**: por corrida (finish/posição/ultrapassagens/consistência), treino e objetivos.
- **Treino**: blocos no calendário; o jogador escolhe foco (ex.: frenagem, suavidade, físico),
  com custo de tempo e fadiga; IA de pilotos treina automaticamente (política determinística).
- **Custo crescente**: `custo(p) = base * (1 + (p/40)^1.6)` (calibrar); acima de 85 custa muito.
- **Potencial**: teto por atributo (ex.: 78–95) definido no seed; treino não passa do teto.
- **Idade**: curva de ganho/perda (jovem ganha mais físico/ritmo; veterano ganha experiência e
  perde físico levemente); nada de declínio aleatório sem causa.
- **Fadiga/lesão**: treino intenso e sequência de corridas aumentam fadiga; lesão é rara e
  tratada como evento de domínio (não aleatório puro).
- **Feats/fatos**: conquistas (1ª vitória, pole em casa, hat-trick, sequência de DNFs) viram
  modificadores pequenos e nomeados (ex.: "+1 Foco em Interlagos"), com duração/limite.
- **Bônus de casa**: se `track.country == character.nationality`, +2–4% de força (ou +1 em
  atributos-chave), uma vez por fim de semana; nunca decide sozinho.

## 7. Exemplo ilustrativo (Alicya em Interlagos)
> Valores **hipotéticos** só para explicar o fluxo; o seed real virá dos dados.
- Alicya: Ritmo Corrida 82, Classificação 78, Frenagem 84, Curvas 76, Tração 80, Suavidade 81,
  Precisão 79, Adaptabilidade 83, Foco 75, Experiência 68, Racecraft 77, Resistência 80.
- Equipe (exemplo): Aero 78, Potência 76, Chassi 77, Pneus 80, Confiabilidade 82, Pit 75,
  Desenvolvimento 74, Estratégia 76.
- Pista: frenagem 0,85; tração 0,8; suavidade 0,75; adaptabilidade 0,7; racecraft 0,6; etc.
- Força = Σ(peso × atributo normalizado) + carro × peso_pista + bônus_casa − risco.
- Saída: P(vitória) ~8%, P(pódio) ~28%, P(pontos) ~65% (números inventados para ilustrar; o
  motor real calculará e o backtest calibrará).
- Não exibir "Alicya vai vencer"; exibir distribuição e intervalo.

## 8. Regras de honestidade
- Nunca usar biografia/notícia como atributo sem quantificação explícita e fonte.
- Nenhum atributo pode ser "10/10 em tudo"; somas/limites por classe.
- Atualizações de equipe só em janelas e com custo; sem upgrade infinito.
- Dados de seed têm data e fonte; quando o universo divergir do real, vale o universo.
