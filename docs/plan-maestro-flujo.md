# Plan maestro: Mundial Lab como sala de control

Este documento define el flujo verdadero del producto, las fases de construcción y las instrucciones que Codex debe seguir al implementar la experiencia. La idea central no es crear una página informativa: Mundial Lab debe sentirse como una sala de control donde cada participante opera modelos durante la Copa del Mundo.

## Gancho del producto

El usuario no solo ve el Mundial. Entra como Data Director.

No todos pueden ser Data Directors de una selección, pero aquí pueden competir como si dirigieran un modelo: leen el partido, ajustan supuestos, reaccionan a eventos en vivo y después se evalúa qué tan bien calibraron sus decisiones.

## Principios

- Cada control debe mover algo real en el modelo o en la visualización.
- Ningún modelo debe fingir que usa parámetros que no le corresponden.
- La página principal no debe cambiar modelos dentro de la misma vista; debe funcionar como tablero de entrada.
- Cada modelo necesita su propia página, con explicación, controles y animación propia.
- Cada partido necesita una página viva, con estadio, marcador, eventos, alineaciones, modelo activo y evaluación.
- El frontend debe ser ligero; los cálculos pesados pertenecen al backend Hadox mediante jobs.
- Los resultados cerrados son datos fijos: ya no se predicen, se usan para evaluación y entrenamiento.
- Durante el partido, el estado debe permanecer vivo: eventos, minuto, marcador y sustituciones modifican la lectura.
- El tono debe ser intrigante, pambolero y científicamente serio.

## Flujo principal del usuario

### 1. Entrada al tablero

El usuario llega a una portada funcional, no a una landing genérica. Debe ver:

- Partidos disponibles.
- Partidos en vivo.
- Partidos cerrados.
- Modelos disponibles.
- Ranking de Data Directors.
- Llamado claro: elegir un partido para operar un modelo.

La acción principal debe ser entrar a un partido.

### 2. Antes del partido

En la página del partido, el usuario ve:

- Estadio.
- Equipos.
- Fecha, grupo o fase.
- Estado del partido.
- Alineaciones iniciales o probables.
- Jugadores de impacto.
- Modelo seleccionado.
- Predicción inicial.

El usuario puede:

- Elegir modelo.
- Ajustar parámetros permitidos por ese modelo.
- Ajustar jugadores mediante un modelo de impacto acotado.
- Lanzar una predicción inicial.
- Guardar su lectura antes del inicio.

### 3. Durante el partido

La página entra en modo sala de control:

- Marcador vivo.
- Minuto.
- Timeline de eventos.
- Vista del estadio.
- Cambios de probabilidad.
- Ajustes disponibles.
- Comparación contra modelo base Mundial Lab.

El usuario puede reaccionar:

- Ajustar parámetros del modelo.
- Cambiar lectura de jugadores.
- Registrar una nueva predicción en una ventana de tiempo.
- Enviar una corrida pesada al backend si el modelo lo requiere.

Las ventanas sugeridas para scoring son:

- Prepartido.
- Minuto 15.
- Minuto 30.
- Medio tiempo.
- Minuto 60.
- Minuto 75.
- Final.

### 4. Después del partido

Cuando el admin cierre el partido:

- El resultado queda fijo.
- El partido deja de aceptar predicciones competitivas.
- Se evalúan las predicciones del usuario.
- Se actualiza el ranking.
- La página pasa a modo análisis.

El usuario debe ver:

- Qué predijo.
- Qué pasó.
- Dónde se equivocó o acertó.
- Qué modelo reaccionó mejor.
- Qué tan calibrada fue su lectura.

## Estadio

El estadio no es decoración. Debe afectar el modelo como contexto.

Variables iniciales:

- Sede.
- Altitud.
- Temperatura.
- Humedad.
- Tipo de cancha.
- Capacidad o presión ambiental.
- Distancia de viaje aproximada.
- Ventaja regional o adaptación.

Efectos posibles:

- Ritmo esperado.
- Fatiga.
- Precisión.
- Probabilidad de goles tardíos.
- Ventaja de sede.
- Volatilidad del partido.

Visualmente, el estadio debe ser la escena base del partido. Puede empezar como vista 3D o isométrica ligera, con jugadores representados por puntos, tarjetas o zonas de influencia.

## Jugadores como modelo de impacto

No se simulará jugador por jugador con física completa en la primera versión. Los jugadores entran como modificadores acotados del equipo y del estado del partido.

### Atributos de jugador

- Posición.
- Ataque.
- Defensa.
- Creación.
- Presión.
- Portería.
- Balón parado.
- Disciplina.
- Resistencia.
- Estado físico.
- Titularidad.
- Forma reciente.
- Riesgo de lesión o sustitución.

### Estados de jugador

- Titular.
- Banca.
- Lesionado.
- Suspendido.
- Tocado.
- Fatigado.
- Con tarjeta amarilla.
- Expulsado.
- Sustituido.

### Impactos agregados

- Delantero: conversión, tiros peligrosos, goles esperados.
- Medio creativo: generación de xG, pases clave, control.
- Contención: reduce transiciones rivales.
- Defensa central: baja xG rival y balón parado.
- Lateral o extremo: ritmo, amplitud, centros, transición.
- Portero: reduce goles esperados contra.
- Capitán o líder: reduce volatilidad tras eventos negativos.

Los impactos deben tener límites. El usuario no debe poder romper el modelo con valores extremos.

## Controles por modelo

Cada modelo debe exponer únicamente parámetros que sí puede usar.

| Parámetro | Poisson | Elo | Dixon-Coles | Bayes Live | Ensemble |
|---|---:|---:|---:|---:|---:|
| Ataque/defensa | Sí | No directo | Sí | Parcial | Por modelo |
| Ventaja sede | Sí | Sí | Sí | Sí | Sí |
| Ritmo | Sí | No natural | Sí | Sí | Sí |
| Forma reciente | Parcial | Sí | Sí | Como prior | Sí |
| Tarjeta roja | Ajuste externo | Ajuste externo | Ajuste externo | Sí | Sí |
| xG/tiros en vivo | No natural | No natural | Parcial | Sí | Sí |
| Correlación de marcador bajo | No | No | Sí | No | Por modelo |
| Peso entre modelos | No | No | No | No | Sí |

### Poisson

Controles:

- Fuerza ofensiva equipo A.
- Fuerza defensiva equipo A.
- Fuerza ofensiva equipo B.
- Fuerza defensiva equipo B.
- Ritmo.
- Ventaja de sede.
- Penalización por tarjeta roja.
- Impacto ofensivo/defensivo agregado de jugadores.

Salida:

- Lambdas de goles.
- Distribución de marcadores.
- Probabilidad de local/empate/visita.
- Total de goles esperado.

### Elo

Controles:

- K-factor.
- Ventaja de sede.
- Peso de forma reciente.
- Ajuste por fase o importancia.
- Diferencia de ratings.

Salida:

- Probabilidad de resultado.
- Movimiento esperado de rating.
- Confianza relativa.

Nota: Elo no produce marcador naturalmente. Si se muestra marcador probable, debe venir de una capa adicional documentada.

### Dixon-Coles

Controles:

- Ataque.
- Defensa.
- Ventaja de sede.
- Correlación de marcadores bajos.
- Decaimiento temporal.
- Ritmo.

Salida:

- Distribución corregida de marcadores.
- Explicación de 0-0, 1-0, 1-1.
- Probabilidad de resultado.

### Bayes Live

Controles:

- Prior inicial.
- Peso de eventos recientes.
- Evidencia por tiros.
- Evidencia por xG.
- Evidencia por tarjetas.
- Evidencia por posesión territorial.
- Volatilidad.
- Impacto de sustituciones.

Salida:

- Creencias actualizadas.
- Cambio de probabilidad por evento.
- Explicación de evidencia.

### Ensemble

Controles:

- Peso de Poisson.
- Peso de Elo.
- Peso de Dixon-Coles.
- Peso de Bayes Live.
- Temperatura o calibración.
- Penalización por sobreconfianza.

Salida:

- Predicción combinada.
- Contribución por modelo.
- Modelo dominante.
- Riesgo de sobreajuste.

## Scoring y desempate

Para que el juego no se vuelva trivial, se deben evaluar varias dimensiones.

Métricas:

- Signo correcto: local, empate o visita.
- Brier score.
- Log loss.
- Marcador exacto.
- Diferencia de goles.
- Total de goles.
- Calibración por ventanas de tiempo.
- Calidad de reacción después de goles, tarjetas o sustituciones.
- Bonus por predicción temprana correcta.
- Penalización por cambios tardíos o sobreconfianza.

Categorías de ranking:

- Director total.
- Director conservador: mejor calibración.
- Director valiente: mejor lectura de escenarios improbables.
- Director táctico: mejor reacción en vivo.
- Director de marcador: mejor precisión de goles.
- Director de modelos: mejor uso de ensemble.

## Backend

El backend debe estar preparado para no estar prendido todo el tiempo. La arquitectura debe aceptar modo bajo demanda.

Módulos mínimos:

- `matches`: calendario, estado, marcador, cierre.
- `stadiums`: sede, clima base, contexto.
- `teams`: equipos, ratings, forma, plantillas.
- `players`: atributos, estados e impacto.
- `events`: goles, tarjetas, tiros, xG, sustituciones, lesiones.
- `models`: contratos de entrada/salida por modelo.
- `jobs`: cola de corridas pesadas.
- `predictions`: predicciones de usuarios y modelo base.
- `scoring`: evaluación y rankings.
- `admin`: captura y cierre de partidos.

Flujo de jobs:

1. El frontend solicita una corrida.
2. El backend crea un job.
3. Worker procesa cuando haya capacidad.
4. Resultado se guarda con snapshot de datos, parámetros, modelo y seed.
5. El usuario consulta el resultado o recibe correo.

## Frontend

Páginas mínimas:

- `/`: tablero principal.
- `/partidos/`: calendario completo.
- `/partidos/:id/`: sala de control del partido.
- `/modelos/poisson/`: página del modelo Poisson.
- `/modelos/elo/`: página del modelo Elo.
- `/modelos/dixon-coles/`: página del modelo Dixon-Coles.
- `/modelos/bayes-live/`: página del modelo Bayes Live.
- `/modelos/ensemble/`: página del modelo Ensemble.
- `/directores/`: rankings y perfiles.
- `/admin/live-control/`: captura operativa de eventos.
- `/backend/`: explicación técnica de arquitectura y jobs.

Componentes centrales:

- `MatchControlRoom`.
- `StadiumScene`.
- `LiveTimeline`.
- `ModelSelector`.
- `ModelControls`.
- `ProbabilityPanel`.
- `PlayerImpactPanel`.
- `PredictionHistory`.
- `ScoringPanel`.
- `Footer`.

## Datos

Datos base iniciales:

- Calendario completo del Mundial.
- Equipos.
- Estadios.
- Plantillas cuando estén disponibles.
- Ratings iniciales.
- Eventos capturados manualmente.

Regla importante: si un dato real no está confirmado, debe etiquetarse como estimado, provisional o simulado.

## Fases de implementación

### Fase 1: Rediseño del flujo

Objetivo: que la experiencia deje de sentirse como demo suelta y se vuelva sala de control.

Tareas:

- Rehacer home como tablero de Data Director.
- Rehacer página de partido como control room.
- Separar claramente prepartido, en vivo y cerrado.
- Agregar estadio visual base.
- Agregar panel de selección de modelo.
- Agregar timeline de eventos.

### Fase 2: Modelo de impacto

Objetivo: introducir jugadores y estadio como variables reales.

Tareas:

- Crear esquema de estadio.
- Crear esquema de jugador.
- Crear esquema de alineación.
- Crear cálculo de impacto agregado por equipo.
- Conectar impacto a Poisson y Bayes Live primero.
- Mostrar panel de jugadores ajustables.

### Fase 3: Controles honestos por modelo

Objetivo: que cada modelo tenga controles propios y útiles.

Tareas:

- Definir contrato de entrada/salida por modelo.
- Implementar controles Poisson.
- Implementar controles Elo.
- Implementar controles Dixon-Coles.
- Implementar controles Bayes Live.
- Implementar controles Ensemble.
- Evitar controles compartidos que no afecten la salida.

### Fase 4: Competencia y scoring

Objetivo: que haya juego, desempate y narrativa.

Tareas:

- Guardar predicciones por ventana.
- Calcular métricas.
- Crear rankings por categoría.
- Mostrar comparación contra modelo base Mundial Lab.
- Crear vista postpartido de evaluación.

### Fase 5: Backend con jobs

Objetivo: mover simulaciones pesadas al servidor Hadox.

Tareas:

- Definir API de jobs.
- Crear cola.
- Crear worker de simulaciones.
- Guardar resultados versionados.
- Preparar notificación por correo.
- Permitir frontend ligero con fallback a datos precalculados.

### Fase 6: Animaciones educativas

Objetivo: convertir los modelos en experiencias visuales entendibles.

Tareas:

- Mantener animación base en todas las páginas de modelo.
- Crear una animación distinta por modelo.
- En Poisson, visualizar distribución de marcadores.
- En Elo, visualizar desplazamiento de rating.
- En Dixon-Coles, visualizar corrección de marcadores bajos.
- En Bayes Live, visualizar actualización de creencias por evento.
- En Ensemble, visualizar pesos y mezcla de modelos.

### Fase 7: Admin operativo

Objetivo: que los dueños de la página puedan capturar el Mundial.

Tareas:

- Panel para iniciar partido.
- Panel para registrar evento.
- Panel para ajustar minuto y marcador.
- Panel para registrar sustituciones.
- Panel para cerrar partido.
- Auditoría básica de cambios.

## Instrucciones para Codex

Antes de implementar nuevas pantallas o modelos, leer este documento y respetar estas reglas:

- Mantener todo el texto público en español correcto.
- No usar instrucciones internas de marca como texto visible.
- La página principal debe ser tablero, no carrusel de modelos.
- Cada modelo debe tener página propia.
- Cada partido debe tener página propia.
- No crear controles falsos: si un parámetro no cambia el cálculo o la visualización, no debe existir.
- Si se usa un dato simulado, debe estar marcado como simulado.
- Si se usa un dato real, debe indicar fuente o procedencia cuando sea posible.
- Priorizar componentes reutilizables, pero sin esconder la diferencia entre modelos.
- Verificar visualmente con navegador después de cambios relevantes de frontend.
- Ejecutar build antes de cerrar cambios importantes.
- Mantener Docker como ruta principal de ejecución.
- No asumir que el backend está siempre encendido.
- Diseñar el frontend para poder funcionar con snapshots y resultados precalculados.

## Próximo paso recomendado

Empezar por Fase 1 y Fase 2 juntas en una versión mínima:

- Home como tablero de Data Director.
- Página de partido como sala de control.
- Estadio visual inicial.
- Jugadores de impacto simulados y acotados.
- Poisson conectado al impacto.
- Timeline en vivo manual.

Con eso el proyecto empieza a sentirse como el producto real y no como una colección de páginas.
