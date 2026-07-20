# Auditoria de datos por modelo

Fecha de corte: 2026-05-31

Este documento define que datos esta usando Mundial Lab hoy, que datos dice usar en la experiencia, que datos faltan para que cada modelo tenga valor real y como priorizar la ingesta sin perder simplicidad.

## Diagnostico corto

Hoy el producto ya tiene una base navegable y operable, pero todavia mezcla tres niveles de madurez:

- Datos reales/estructurados: fixture completo de 104 partidos, sedes, ciudades, horarios, equipos de cada partido.
- Seeds tecnicos: 16 equipos con `rating`, `attack`, `defense`, grupo y confederacion.
- Datos simulados: jugadores de impacto, clima/estadio derivado por ciudad, senal xG, forma reciente, evidencia viva y algunas correcciones de modelo.

La prioridad no es agregar mas controles. La prioridad es que cada control mueva una variable trazable con origen claro.

## Inventario actual del repo

| Dataset | Archivo / tabla | Estado | Uso actual |
| --- | --- | --- | --- |
| Equipos semilla | `data/teams_seed.json`, tabla `teams` | Parcial | Backend Monte Carlo usa `rating`, `attack`, `defense`; frontend de sala viva no consulta estos ratings todavia. |
| Fixture 2026 | `data/matches_seed.json`, tabla `matches` | Bueno para navegacion | 104 partidos, 72 de grupos y 32 de eliminacion; todos aparecen como `scheduled`. |
| Eventos de partido | tabla `match_events` | Estructura lista, casi sin datos | Sirve para captura manual admin; todavia no alimenta Bayes Live de forma robusta. |
| Predicciones de directores | tabla `live_predictions` | Estructura lista | Guarda predicciones, pero el leaderboard todavia usa una metrica placeholder. |
| Jugadores de impacto | `apps/frontend/src/lib/impactModel.ts` | Simulado | Genera seis roles por equipo con hash del nombre; util para UX, insuficiente como dato cientifico. |
| Estadio/contexto | `stadiumContext()` | Derivado/simulado | Usa ciudad para inferir altitud, humedad, temperatura y presion. |
| Modelos backend torneo | `apps/backend/app/models/simulator.py` | Basico | Simula torneo con Poisson y Elo simplificados usando `rating/attack/defense`. |
| Modelos frontend partido | `apps/frontend/src/lib/impactModel.ts` | Prototipo avanzado | Opera partido vivo con estadio, impacto de jugadores, marcador, minuto y controles. |

## Que usa realmente cada modelo hoy

### Poisson

Usa hoy:

- `home_score`, `away_score`, `minute`
- `homeImpact.attack`, `awayImpact.attack`
- `homeImpact.defense`, `awayImpact.defense`
- `homeImpact.tempo`, `awayImpact.tempo`
- `homeImpact.fatigue`, `awayImpact.fatigue`
- `stadium.humidity`, `stadium.altitude_m`
- `attack_bias`, `defense_bias`, `tempo_bias`, `venue_edge`

Problema:

- Las lambdas salen de impacto simulado, no de datos historicos reales de goles/xG.
- No hay backtest ni calibracion contra resultados reales.

Datos que necesita:

- Resultados historicos internacionales por seleccion.
- Goles anotados/recibidos por ventana temporal.
- Fuerza ofensiva/defensiva estimada por partido.
- Opcional profesional: xG si conseguimos fuente abierta event-level.

### Elo

Usa hoy:

- En backend: `team.rating`.
- En frontend vivo: diferencia agregada de impacto de jugadores, `form_weight`, `venue_edge`, `stadium.travel_load`.
- `elo_k` aparece en diagnostico, pero no actualiza rating en vivo todavia.

Problema:

- El rating semilla existe, pero no hay pipeline de actualizacion historica ni postpartido.
- `elo_k` debe afectar un workflow de recalculo, no solo mostrarse.

Datos que necesita:

- Historial de partidos internacionales con fecha, equipos, marcador, torneo y sede neutral/local.
- Tabla `team_ratings` con rating antes/despues por partido.
- Importancia del partido para ajustar K.

### Dixon-Coles

Usa hoy:

- Base Poisson.
- `low_score_correlation`.
- `recency_decay`.
- Masa aproximada de marcadores `0-0`, `1-0`, `0-1`, `1-1` calculada desde top scores.

Problema:

- No estima rho con historico real.
- No tiene ventana temporal real; `recency_decay` existe como control, pero no pondera una muestra historica.

Datos que necesita:

- Historial de marcadores internacionales.
- Fecha del partido para ponderacion temporal.
- Fit de parametros ataque/defensa/rho.
- Backtest especifico de empate y marcadores bajos.

### Bayes Live

Usa hoy:

- Prior desde base Poisson.
- Marcador actual.
- `xg_signal` manual.
- `prior_strength`, `evidence_weight`.

Problema:

- La evidencia viva no viene de eventos reales.
- Los eventos admin no se convierten todavia en features cuantitativas.

Datos que necesita:

- Eventos de partido: gol, roja, amarilla, sustitucion, lesion, tiros, tiros a puerta, xG, corners, posesion territorial.
- Stream manual/admin mientras no haya API viva.
- Tabla `live_features` agregada por minuto.
- Posterior guardado por minuto para trazabilidad.

### Ensemble

Usa hoy:

- Predicciones frontend de Poisson, Elo, Dixon-Coles y Bayes.
- Pesos `poisson_weight`, `elo_weight`, `dixon_weight`, `bayes_weight`.
- `calibration`.

Problema:

- Mezcla modelos que no tienen la misma madurez.
- No penaliza modelos mal calibrados con datos reales.

Datos que necesita:

- Salidas versionadas de cada modelo.
- Metricas de calibracion por modelo.
- Backtest por contexto: fase, confederacion, favorito, marcador bajo, partido vivo.
- Regla de peso dinamico basada en desempeno historico.

## Fuentes abiertas recomendadas

| Fuente | Para que sirve | Licencia / notas | Prioridad |
| --- | --- | --- | --- |
| OpenFootball World Cup / worldcup.json | Fixture, grupos, sedes, resultados historicos de Mundial | Public domain segun el proyecto. Muy util para fixture y estructura. | Alta | https://github.com/openfootball/worldcup.json |
| StatsBomb Open Data | Eventos, tiros, xG, alineaciones y 360 en competencias seleccionadas | Requiere atribucion a StatsBomb y respetar sus terminos. No cubre todo el Mundial 2026 en vivo. | Alta para ejemplos educativos y xG historico | https://github.com/statsbomb/open-data |
| football-data.co.uk | Resultados, estadisticas y odds en CSV, principalmente ligas/mercados | Gratis, util para rating systems; revisar cobertura internacional exacta antes de depender. | Media | https://www.football-data.co.uk/data |
| Dataset historico de resultados internacionales tipo Kaggle/martj42 | Elo, Poisson, Dixon-Coles con selecciones nacionales desde 1872 | CC0/Public Domain en Kaggle; ideal para historico de selecciones, con revision de calidad. | Alta | https://www.kaggle.com/datasets/martj42/international-football-results-from-1872-to-2017 |
| FIFA.com | Fixture oficial, sedes, resultados oficiales cuando ocurran | Fuente oficial, no necesariamente dataset abierto comodo. Mejor como verificacion/manual admin. | Alta para captura oficial | https://www.fifa.com |

## Modelo de datos minimo que falta

### `team_match_history`

Campos:

- `match_id`
- `date`
- `home_team_id`
- `away_team_id`
- `home_score`
- `away_score`
- `tournament`
- `neutral`
- `venue`
- `city`
- `source`
- `source_version`

Modelos que alimenta:

- Elo
- Poisson
- Dixon-Coles
- Ensemble

### `team_strength_snapshots`

Campos:

- `team_id`
- `as_of_date`
- `rating_elo`
- `attack_strength`
- `defense_strength`
- `recent_form`
- `matches_window`
- `source_snapshot_id`

Modelos que alimenta:

- Poisson
- Elo
- Ensemble

### `match_lineups`

Campos:

- `match_id`
- `team_id`
- `player_id`
- `player_name`
- `role`
- `starter`
- `status`
- `source`

Modelos que alimenta:

- Poisson vivo
- Bayes Live
- Ensemble

### `live_features`

Campos:

- `match_id`
- `minute`
- `home_xg`
- `away_xg`
- `home_shots`
- `away_shots`
- `home_red_cards`
- `away_red_cards`
- `home_pressure`
- `away_pressure`
- `event_count`
- `source`

Modelos que alimenta:

- Bayes Live
- Poisson vivo
- Ensemble

### `model_runs`

Campos:

- `run_id`
- `model`
- `match_id`
- `created_at`
- `seed`
- `parameters_json`
- `data_snapshot_id`
- `output_json`
- `metrics_json`

Modelos que alimenta:

- Todos, porque aqui vive la trazabilidad.

## Roadmap recomendado

### Fase 1: Honestidad de datos

- Mostrar en UI si una variable es `publica`, `admin`, `derivada` o `simulada`.
- Agregar en el manifiesto de experimento la lista de datasets usados.
- Evitar que el modo cientifico prometa xG real si sigue siendo manual/simulado.

### Fase 2: Historico internacional

- Ingerir resultados internacionales.
- Calcular Elo real por fecha.
- Estimar ataque/defensa por ventana temporal.
- Reemplazar `teams_seed.json` como fuente primaria de fuerza.

### Fase 3: Poisson y Dixon-Coles calibrados

- Entrenar lambdas por seleccion.
- Ajustar rho Dixon-Coles con historico.
- Guardar backtests y curvas de calibracion.
- Exponer sensibilidad real: lambda, rho, decay, overdispersion.

### Fase 4: Vivo admin

- Convertir eventos admin en features.
- Crear captura rapida para xG manual aproximado, roja, lesion, sustitucion y momentum.
- Guardar posterior Bayes por minuto.

### Fase 5: Ensemble competitivo

- Mezclar modelos segun desempeno por contexto.
- Penalizar mala calibracion.
- Comparar cada Data Director contra baseline, modelo elegido y ensemble Hadox.

## Regla de producto

Cada modelo debe poder responder tres preguntas:

1. Que datos le entraron.
2. Que parametro movio el usuario.
3. Como cambio la prediccion por ese movimiento.

Si una variable no puede responder esas tres cosas, se queda como explicacion pedagogica o se elimina de la sala de control.
