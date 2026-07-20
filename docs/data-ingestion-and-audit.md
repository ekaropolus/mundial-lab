# Mundial Lab: ingesta, auditoria y autopsia del modelo

Este documento define como vamos a meter datos sin contaminar los modelos. La regla es simple:

1. El scraper o API trae datos crudos.
2. El cargador valida, normaliza y guarda.
3. Los modelos leen solo tablas internas.
4. Cada dato debe tener fuente, version, URL y nivel de confianza.

## Niveles de confianza

- `real_verificado`: resultado o evento confirmado manualmente contra fuente primaria o varias fuentes.
- `publico_ingestado`: dato tomado de dataset abierto o API publica.
- `manual_admin`: dato capturado por admin de Mundial Lab.
- `estimado`: dato derivado por heuristica, clima, ciudad, rating o proxy.
- `simulado`: dato generado para experiencia educativa, no debe venderse como real.

## Fuentes iniciales

### Resultados internacionales

Fuente: `martj42/international_results`

URL: https://github.com/martj42/international_results

Uso:
- Elo.
- forma reciente.
- ataque/defensa base.
- backtesting historico.

Notas de auditoria:
- Es un dataset abierto de partidos internacionales masculinos.
- Incluye fecha, equipos, marcador, torneo, ciudad, pais y neutralidad.
- Ya existe cargador en `apps/backend/app/ingestion.py`.
- No trae xG, alineaciones ni eventos.

### Eventos, tiros, lineups y xG historico

Fuente: StatsBomb Open Data

URL: https://github.com/statsbomb/open-data

Uso:
- entrenamiento de xG.
- ejemplos historicos de heatmaps.
- lineups y eventos para partidos disponibles.
- visualizaciones didacticas.

Notas de auditoria:
- No es feed en vivo.
- La cobertura es selectiva por competencia/temporada.
- Sirve para entrenar y mostrar metodologia, no para prometer datos live del Mundial 2026.

### Resultados, estadisticas y odds de ligas

Fuente: Football-Data.co.uk

URL: https://www.football-data.co.uk/data.php

Uso:
- calibracion de probabilidades.
- ejemplos de mercado/casa.
- comparacion de lineas y odds historicas.

Notas de auditoria:
- Principalmente clubes y ligas.
- Puede servir para entrenar calibracion general, no para sustituir datos de selecciones.

### Resultados actuales del Mundial

Fuente inicial: ESPN site.api scoreboard `fifa.world`

URL base: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard

Uso:
- detectar partidos finalizados.
- cargar marcador final.
- disparar autopsia basica cuando ya exista linea del modelo.

Reglas de auditoria:
- Solo se aceptan eventos con `status.type.completed = true`.
- El resultado se mapea contra nuestro fixture por equipo local/visitante normalizado.
- Si el partido no mapea exactamente, queda en `unmatched` y no se carga.
- Nivel inicial: `publico_ingestado`.
- Para elevarlo a `real_verificado`, el ciclo automatico intenta confirmar el mismo marcador contra FOX Sports World Cup Scores.
- Si FOX no tiene el partido, si el HTML cambia, o si el marcador no coincide, el dato no se promueve: queda en `publico_ingestado` y aparece en `unconfirmed`.

## Tablas nuevas de verdad historica y autopsia

### `match_results_verified`

Guarda el resultado real cerrado y auditado. Tambien actualiza `matches`.

Uso:
- cerrar partido.
- activar autopsia.
- fijar Monte Carlo con resultados reales.

### `model_runs`

Guarda cada corrida:

- linea original de la casa.
- corrida de backtest.
- autopsia.
- corrida en vivo.

### `match_model_lines`

Guarda la prediccion de una corrida para un partido:

- probabilidades.
- goles esperados.
- favorito.
- confianza.
- marcadores probables.

### `model_autopsies`

Guarda la historia editorial y tecnica del aprendizaje:

- resultado observado.
- error de linea original.
- mejor lectura retrospectiva.
- leccion.
- copy social.

## Tablas siguientes

Estas todavia no estan implementadas y son la siguiente expansion:

### `players`

Jugadores reales por seleccion.

### `lineups`

Alineaciones por partido.

### `player_match_status`

Titular, banca, lesionado, suspendido, sustituido, minuto de entrada/salida.

### `match_shots`

Tiros y xG por evento.

### `match_team_stats`

Stats agregadas por minuto/equipo: tiros, posesion, corners, tarjetas, xG, field tilt.

### `match_spatial_events`

Eventos con coordenadas para mapas de calor.

### `stadium_conditions`

Clima/estadio por partido, con fuente y hora de medicion.

## Flujo de construccion

### Fase 1: carga manual auditable

Endpoints admin:

- `POST /admin/matches/{match_id}/verified-result`
- `POST /admin/model-runs`
- `POST /admin/match-lines`
- `POST /admin/matches/{match_id}/autopsy/basic`
- `POST /admin/data/sync-current-results`
- `POST /admin/house-simulation/save-match-lines`

Objetivo:
- cerrar resultados reales.
- guardar linea original.
- generar primera autopsia.

Rutina recomendada:

1. Antes de la jornada, guardar lineas de la casa:

```bash
python scripts/save_house_lines.py --scenario "Linea previa jornada 2026-06-15" --simulations 2500 --seed 20260615 --use-stadium --use-fixed-results
```

2. Despues de que terminen partidos, sincronizar finales:

```bash
python scripts/sync_current_results.py --start-date 20260615 --end-date 20260615
```

3. Revisar `unmatched` y `errors`. Nada con error entra como resultado verificado.

### Modo automatico Docker

El servicio `automation` corre:

1. Guarda una linea diaria de la casa con escenario `Auto linea casa YYYYMMDD`.
2. Sincroniza resultados finales de ESPN para los ultimos `AUTOMATION_LOOKBACK_DAYS`.
3. Confirma automaticamente contra FOX Sports cuando el marcador coincide exactamente.
4. Genera autopsias basicas pendientes si existe resultado verificado y linea de modelo.

Variables:

- `AUTOMATION_INTERVAL_SECONDS`: intervalo entre ciclos, default `1800`.
- `AUTOMATION_SMART_SCHEDULER`: activa scheduler por fixture, default `true`.
- `AUTOMATION_LIVE_INTERVAL_SECONDS`: intervalo cuando un partido esta por empezar o en vivo, default `60`.
- `AUTOMATION_CLOSING_INTERVAL_SECONDS`: intervalo despues de la ventana viva mientras falta verificar cierre, default `180`.
- `AUTOMATION_UPCOMING_INTERVAL_SECONDS`: intervalo cuando faltan menos de 12 horas para el siguiente partido, default `600`.
- `AUTOMATION_LOOKBACK_DAYS`: dias hacia atras para revisar finales, default `3`.
- `AUTOMATION_SIMULATIONS`: simulaciones por linea diaria, default `2500`.
- `AUTOMATION_CONFIRM_SECOND_SOURCE`: confirma ESPN contra FOX, default `true`.
- `AUTOMATION_SYNC_ENRICHMENT`: ingiere rosters, lineups, stats y tiros desde ESPN summary, default `true`.
- `AUTOMATION_SYNC_WEATHER`: ingiere clima de sede/kickoff desde Open-Meteo, default `true`.

Politica del scheduler inteligente:

- `live_window`: desde 45 minutos antes del kickoff hasta 135 minutos despues. Revisa cada `AUTOMATION_LIVE_INTERVAL_SECONDS`.
- `closing_window`: desde 135 hasta 360 minutos despues del kickoff si el resultado aun no esta `real_verificado`. Revisa cada `AUTOMATION_CLOSING_INTERVAL_SECONDS`.
- `upcoming_window`: si el proximo partido sin verificar ocurre en menos de 12 horas. Revisa cada `AUTOMATION_UPCOMING_INTERVAL_SECONDS`.
- `idle`: fuera de ventanas de partido. Revisa cada `AUTOMATION_INTERVAL_SECONDS`.
- Los partidos que ya estan `real_verificado` dejan de disparar ventanas rapidas.
- Endpoint de diagnostico: `GET /admin/automation/scheduler-state`.

Comando puntual:

```bash
python scripts/run_automation_cycle.py --today 20260614 --lookback-days 3 --simulations 2500
```

Sin confirmacion secundaria, solo para diagnostico:

```bash
python scripts/run_automation_cycle.py --today 20260614 --no-second-source
```

Servicio local:

```bash
docker compose up -d automation
```

### Fase 2: cargadores por archivo

Crear cargadores CSV/JSON para:

- resultados verificados.
- lineas originales.
- alineaciones.
- tiros/xG.
- stats por equipo.

### Fase 3: scrapers y APIs

Los scrapers deben llamar los mismos cargadores. No deben escribir directo a tablas de modelo.

Fuentes automatizadas actuales:

- ESPN scoreboard: resultados finales.
- FOX Sports scores: confirmacion secundaria de marcador.
- ESPN summary: rosters, titulares, stats de equipo, commentary y tiros con coordenadas cuando existen.
- Open-Meteo: clima horario por ciudad/kickoff.
- StatsBomb Open Data: carga historica controlada para xG/eventos/lineups. No corre en cada ciclo porque es dataset historico.

Comandos:

```bash
python scripts/ingest_espn_enrichment.py --start-date 20260611 --end-date 20260614
python scripts/ingest_stadium_weather.py --start-date 20260611 --end-date 20260615
python scripts/ingest_statsbomb_open.py --competition-name "FIFA World Cup" --limit-matches 20
```

Politica de scraping/carga:

- Usar APIs JSON publicas u open data antes que HTML.
- Mantener cache en `external_data_cache`.
- No evadir paywalls, login, rate limits, ni protecciones anti-bot.
- Guardar `source`, `source_url`, snapshot y job de ingesta.
- Si el dato no trae xG oficial, guardarlo como `null`, no inventarlo.

### Fase 4: autopsia calibrada

Despues de tener resultado real:

1. tomar linea original.
2. correr busqueda de parametros.
3. medir error contra resultado.
4. guardar mejor configuracion retrospectiva.
5. crear tarjeta social.

## Orden recomendado

1. Resultados reales y lineas originales.
2. Autopsia basica por partido.
3. Backtesting parametrico.
4. Alineaciones reales.
5. xG y tiros.
6. heatmaps/eventos espaciales.
