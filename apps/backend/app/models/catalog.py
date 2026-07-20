from app.schemas import ModelModule, ModelWorkflowStep


MODEL_MODULES = [
    ModelModule(
        id="elo",
        name="Elo dinámico",
        short_name="Elo",
        status="activo",
        question="¿Qué tan fuerte es una selección si cada partido mueve su reputación?",
        intuition="El modelo convierte una diferencia de rating en probabilidad de victoria. Si un favorito pierde, el golpe al rating es mayor.",
        data_inputs=[
            "Resultados históricos internacionales",
            "Rating inicial por selección",
            "Importancia del partido",
            "Ventaja de sede o localía",
        ],
        workflow=[
            ModelWorkflowStep(name="Ingesta", description="Carga partidos históricos con fecha, rival, marcador y torneo."),
            ModelWorkflowStep(name="Actualización", description="Recalcula rating después de cada partido con una constante K configurable."),
            ModelWorkflowStep(name="Probabilidad", description="Convierte diferencia de ratings en probabilidad de ganar."),
            ModelWorkflowStep(name="Simulación", description="Usa esas probabilidades para recorrer grupos y eliminatorias."),
        ],
        student_takeaway="Elo enseña aprendizaje incremental: el dato nuevo no borra la historia, la corrige.",
    ),
    ModelModule(
        id="poisson",
        name="Poisson de goles",
        short_name="Poisson",
        status="activo",
        question="¿Cuántos goles esperamos de cada equipo antes de que ruede la pelota?",
        intuition="El fútbol tiene pocos goles. Poisson modela conteos raros y permite simular marcadores completos, no solo ganador.",
        data_inputs=[
            "Goles anotados y recibidos",
            "Fuerza ofensiva",
            "Fuerza defensiva",
            "Promedio global de goles",
        ],
        workflow=[
            ModelWorkflowStep(name="Perfil", description="Estima ataque y defensa relativos de cada selección."),
            ModelWorkflowStep(name="Lambda", description="Calcula goles esperados para equipo A y equipo B."),
            ModelWorkflowStep(name="Marcador", description="Muestrea goles de cada lado desde distribuciones Poisson."),
            ModelWorkflowStep(name="Tabla", description="Agrega puntos, diferencia de goles y desempates."),
        ],
        student_takeaway="Poisson muestra cómo una idea matemática sencilla puede producir marcadores plausibles.",
    ),
    ModelModule(
        id="dixon_coles",
        name="Dixon-Coles",
        short_name="Dixon-Coles",
        status="prototipo",
        question="¿Por qué el 0-0, 1-0 y 1-1 necesitan trato especial?",
        intuition="Es una extensión del modelo Poisson que corrige resultados de baja anotación, justo donde el fútbol se vuelve raro.",
        data_inputs=[
            "Marcadores históricos",
            "Fecha del partido para ponderar recencia",
            "Ataque y defensa",
            "Corrección de baja anotación",
        ],
        workflow=[
            ModelWorkflowStep(name="Ponderación", description="Da más peso a partidos recientes sin tirar los antiguos."),
            ModelWorkflowStep(name="Ajuste", description="Aprende ataque, defensa y parámetro de baja anotación."),
            ModelWorkflowStep(name="Corrección", description="Modifica probabilidades de 0-0, 1-0, 0-1 y 1-1."),
            ModelWorkflowStep(name="Comparación", description="Compara contra Poisson puro para explicar el valor del ajuste."),
        ],
        student_takeaway="Dixon-Coles enseña que el modelo debe respetar el deporte, no solo la fórmula.",
    ),
    ModelModule(
        id="bayes_live",
        name="Bayes en vivo",
        short_name="Bayes",
        status="prototipo",
        question="¿Cuánto cambia nuestra creencia cuando ocurre una sorpresa?",
        intuition="El modelo empieza con una creencia previa y la actualiza con evidencia nueva, sin fingir certeza absoluta.",
        data_inputs=[
            "Prior por ranking o Elo",
            "Resultados capturados manualmente",
            "Incertidumbre por equipo",
            "Peso de evidencia reciente",
        ],
        workflow=[
            ModelWorkflowStep(name="Prior", description="Define una creencia inicial sobre la fuerza de cada selección."),
            ModelWorkflowStep(name="Evidencia", description="Recibe resultados manuales o fixtures ya jugados."),
            ModelWorkflowStep(name="Posterior", description="Actualiza fuerza e incertidumbre después del partido."),
            ModelWorkflowStep(name="Narrativa", description="Explica cuánto cambió el pronóstico y por qué."),
        ],
        student_takeaway="Bayes enseña a cambiar de opinión con datos sin vender humo predictivo.",
    ),
    ModelModule(
        id="ensemble",
        name="Ensamble de modelos",
        short_name="Ensamble",
        status="activo",
        question="¿Qué pasa si varios modelos ven el mismo Mundial desde ángulos distintos?",
        intuition="Combina señales de rating, goles esperados, forma y simulación para producir una predicción más robusta.",
        data_inputs=[
            "Ratings",
            "Ataque y defensa",
            "Forma reciente",
            "Pesos configurables por modelo",
        ],
        workflow=[
            ModelWorkflowStep(name="Señales", description="Lee predicciones base de Elo, Poisson y otros módulos."),
            ModelWorkflowStep(name="Pesos", description="Mezcla modelos con ponderaciones transparentes."),
            ModelWorkflowStep(name="Monte Carlo", description="Corre miles de torneos con incertidumbre."),
            ModelWorkflowStep(name="Auditoría", description="Reporta qué señales empujaron cada resultado."),
        ],
        student_takeaway="Un ensamble no elimina la incertidumbre: la organiza y la vuelve discutible.",
    ),
]


def list_model_modules() -> list[ModelModule]:
    return MODEL_MODULES


def get_model_module(model_id: str) -> ModelModule | None:
    return next((model for model in MODEL_MODULES if model.id == model_id), None)
