import { BarChart3, Beaker, Binary, Database, FileJson, GitCompare, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { ModelName } from "../types";

type ModelConcept = {
  label: string;
  technical: string;
  description: string;
  reading: string;
};

type ProfessionalSpec = {
  premise: string;
  features: string[];
  diagnostics: string[];
  validation: string[];
  artifacts: string[];
};

const concepts: Record<ModelName, ModelConcept[]> = {
  elo: [
    {
      label: "Factor K",
      technical: "elo_k",
      description: "Controla que tan fuerte aprende el rating despues de un resultado nuevo.",
      reading: "Mas alto: reacciona rapido. Mas bajo: protege la historia.",
    },
    {
      label: "Ventaja de sede",
      technical: "venue_edge",
      description: "Suma contexto de estadio, viaje y adaptacion al rating del equipo favorecido.",
      reading: "Ayuda a discutir localia, altura, viaje y familiaridad.",
    },
    {
      label: "Forma reciente",
      technical: "form_weight",
      description: "Decide cuanto pesa la racha reciente frente a la historia acumulada.",
      reading: "Sirve cuando la reputacion ya no cuenta toda la historia.",
    },
  ],
  poisson: [
    {
      label: "Lambda base",
      technical: "base_lambda",
      description: "Punto de partida de goles esperados antes de aplicar fuerza de equipos.",
      reading: "Define si el partido nace abierto o cerrado.",
    },
    {
      label: "Sesgo ofensivo",
      technical: "attack_bias",
      description: "Aumenta la contribucion del ataque al calculo de goles esperados.",
      reading: "Sube cuando el plan de juego crea volumen real.",
    },
    {
      label: "Sesgo defensivo",
      technical: "defense_bias",
      description: "Ajusta cuanto reduce o permite la defensa rival en la lambda final.",
      reading: "Explica por que una defensa ordenada baja marcadores probables.",
    },
  ],
  dixon_coles: [
    {
      label: "Correccion rho",
      technical: "low_score_correlation",
      description: "Corrige la masa de 0-0, 1-0, 0-1 y 1-1 cuando Poisson se queda corto.",
      reading: "La perilla clave: donde el futbol cerrado rompe independencia simple.",
    },
    {
      label: "Decaimiento temporal",
      technical: "recency_decay",
      description: "Da mas peso a partidos recientes sin tirar por completo el historico.",
      reading: "Evita que partidos viejos dicten una eliminatoria actual.",
    },
    {
      label: "Marcadores bajos",
      technical: "low_score_mass",
      description: "Hace visible cuanto del modelo vive en resultados cerrados.",
      reading: "Cuando sube, el empate y el 1-0 merecen lectura especial.",
    },
  ],
  bayes_live: [
    {
      label: "Fuerza del prior",
      technical: "prior_strength",
      description: "Define cuanto respetamos la prediccion previa antes de ver el partido.",
      reading: "Un prior fuerte evita sobrerreaccionar al ruido temprano.",
    },
    {
      label: "Evidencia viva",
      technical: "evidence_weight",
      description: "Mide que tanto mueven goles, xG, tarjetas, presion o sustituciones.",
      reading: "Sube cuando el partido contradice la lectura inicial.",
    },
    {
      label: "Senal xG",
      technical: "xg_signal",
      description: "Inclina el posterior hacia quien genera peligro real aunque el marcador no lo muestre.",
      reading: "Permite separar dominio real de posesion esteril.",
    },
  ],
  ensemble: [
    {
      label: "Diversidad minima",
      technical: "diversity_floor",
      description: "Evita que una sola familia de senales domine toda la lectura del comite.",
      reading: "El ensamble necesita desacuerdo util, no obediencia ciega.",
    },
    {
      label: "Temperatura de mezcla",
      technical: "blend_temperature",
      description: "Controla si la mezcla se vuelve agresiva con el favorito o conserva incertidumbre.",
      reading: "Mas temperatura: mas cautela. Menos temperatura: decision mas filosa.",
    },
    {
      label: "Umbral de acuerdo",
      technical: "agreement_threshold",
      description: "Define cuanta coincidencia necesita el comite antes de subir confianza.",
      reading: "Si los modelos no coinciden, el director debe verlo.",
    },
    {
      label: "Limite de confianza",
      technical: "confidence_cap",
      description: "Impide vender certeza falsa cuando los modelos internos discrepan.",
      reading: "Una prediccion robusta tambien sabe decir: no estoy tan seguro.",
    },
  ],
};

const professionalSpecs: Record<ModelName, ProfessionalSpec> = {
  elo: {
    premise: "Trata el rating como una variable de estado: audita memoria, velocidad de aprendizaje y sesgo contextual antes de confiar en la jerarquia.",
    features: ["Rating previo", "Diferencia Elo", "Forma reciente", "Ventaja de sede", "Margen de victoria"],
    diagnostics: ["Curva logistica rating-probabilidad", "Delta de rating por evento", "Sensibilidad al K-factor"],
    validation: ["Brier score por ventana temporal", "Log loss contra favoritos", "Calibracion por buckets de probabilidad"],
    artifacts: ["rating_snapshot.csv", "elo_run_manifest.json", "rating_drift.svg"],
  },
  poisson: {
    premise: "Convierte fuerza ofensiva y defensiva en lambdas defendibles. El cientifico debe vigilar dispersion, independencia y calibracion de marcadores.",
    features: ["xG ofensivo", "xGA defensivo", "Ritmo", "Sede", "Fatiga agregada"],
    diagnostics: ["Heatmap de scoreline", "Marginal de goles", "Residual entre goles reales y esperados"],
    validation: ["Calibration curve de over/under", "Log loss de marcador exacto", "Error absoluto de goles esperados"],
    artifacts: ["lambda_table.parquet", "scoreline_matrix.json", "poisson_backtest.csv"],
  },
  dixon_coles: {
    premise: "Mantiene Poisson como base, pero agrega una correccion local para el futbol cerrado. La pregunta profesional es si rho corrige o inventa empates.",
    features: ["Lambdas Poisson", "Masa 0-0/1-0/0-1/1-1", "Decaimiento temporal", "Ritmo", "Fase del torneo"],
    diagnostics: ["Comparativo Poisson vs Dixon-Coles", "Masa de marcadores bajos", "Curva de rho"],
    validation: ["Backtest en partidos cerrados", "Brier score de empate", "Lift contra Poisson base"],
    artifacts: ["rho_sweep.csv", "low_score_audit.json", "dc_backtest.csv"],
  },
  bayes_live: {
    premise: "Separa creencia previa de evidencia viva. El profesional debe controlar peso, calidad y latencia de las senales antes de mover el posterior.",
    features: ["Prior prepartido", "xG en vivo", "Tarjetas", "Sustituciones", "Presion territorial"],
    diagnostics: ["Prior vs posterior", "Waterfall de evidencia", "Timeline de actualizacion"],
    validation: ["Sharpness del posterior", "Calibration drift minuto a minuto", "Error despues de eventos clave"],
    artifacts: ["evidence_stream.jsonl", "posterior_trace.csv", "bayes_live_manifest.json"],
  },
  ensemble: {
    premise: "No mezcla por promedio bonito: mide diversidad, redundancia, calibracion y desacuerdo para decidir que modelo merece voz en cada contexto.",
    features: ["Prediccion Poisson", "Prediccion Elo", "Correccion Dixon-Coles", "Posterior Bayes", "Desacuerdo del comite"],
    diagnostics: ["Contribucion por modelo", "Mapa de consenso", "Banda de incertidumbre calibrada"],
    validation: ["Stacking backtest", "Ablation por modelo", "Penalizacion por mala calibracion"],
    artifacts: ["ensemble_weights.json", "ablation_report.csv", "consensus_trace.svg"],
  },
};

export function ModelControls({ modelId }: { modelId: ModelName }) {
  const [mode, setMode] = useState<"director" | "cientifico">("director");
  const spec = professionalSpecs[modelId];

  return (
    <section className="model-controls concept-controls">
      <div className="workflow-title">
        <SlidersHorizontal />
        <h3>Controles de entendimiento</h3>
      </div>
      <div className="mode-switch" aria-label="Nivel de lectura del modelo">
        <button className={mode === "director" ? "active" : ""} onClick={() => setMode("director")} type="button">
          Director
        </button>
        <button className={mode === "cientifico" ? "active" : ""} onClick={() => setMode("cientifico")} type="button">
          Cientifico
        </button>
      </div>

      {mode === "director" ? (
        <>
          <div className="concept-grid">
            {concepts[modelId].map((concept) => (
              <article key={concept.technical}>
                <span>
                  <span>
                    {concept.label}
                    <small>{concept.technical}</small>
                  </span>
                </span>
                <p>{concept.description}</p>
                <strong>{concept.reading}</strong>
              </article>
            ))}
          </div>
          <p>
            Esta seccion no opera el modelo: es una guia para entender que decisiones conceptuales hay
            detras. La operacion real vive en la sala de partido, donde el contexto, jugadores y eventos
            si modifican la prediccion.
          </p>
        </>
      ) : (
        <div className="pro-lab">
          <article className="pro-lab-intro">
            <Beaker />
            <h4>Laboratorio profesional</h4>
            <p>{spec.premise}</p>
          </article>
          <article>
            <Database />
            <h4>Features auditables</h4>
            <ul>{spec.features.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
          <article>
            <BarChart3 />
            <h4>Diagnosticos visuales</h4>
            <ul>{spec.diagnostics.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
          <article>
            <GitCompare />
            <h4>Validacion</h4>
            <ul>{spec.validation.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
          <article>
            <FileJson />
            <h4>Artefactos de corrida</h4>
            <ul>{spec.artifacts.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
          <article>
            <Binary />
            <h4>Regla de simplicidad</h4>
            <p>
              El usuario normal ve una decision clara. El cientifico puede abrir trazas, backtests,
              parametros y manifiestos sin convertir la pagina principal en un notebook.
            </p>
          </article>
        </div>
      )}
    </section>
  );
}
