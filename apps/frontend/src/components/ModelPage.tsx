import { BarChart3, BrainCircuit, Clipboard, Database, FlaskConical, Gauge, ImageDown, Route, ShieldAlert, SlidersHorizontal, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchLearningLog, fetchPublicDataQuality } from "../lib/api";
import { DataQualitySummary, LearningLogEntry, ModelModule } from "../types";
import { ModelControls } from "./ModelControls";
import { ModelOrbit } from "./ModelOrbit";

type ModelPageProps = {
  model: ModelModule;
};

const modelKnowledge = {
  elo: {
    operation:
      "Elo es memoria competitiva: convierte jerarquia, forma reciente y contexto en una probabilidad simple de victoria.",
    context:
      "Conviene antes del partido, cuando la pregunta es quien llega mas fuerte. Es rapido, entendible y bueno para separar favoritos de aspirantes.",
    controls: [
      "K-factor: que tan rapido aprende el rating.",
      "Forma reciente: cuanto pesa lo ultimo contra la historia.",
      "Ventaja de sede: cuanto empuja el contexto local.",
    ],
    outputs: ["Probabilidad de victoria", "Diferencia de rating", "Banda de empate agregada"],
    charts: ["Curva rating-probabilidad", "Trayectoria de rating", "Sensibilidad al K-factor"],
    pitfalls: ["No predice marcador exacto.", "Puede enamorarse de la historia.", "Sufre si el rating inicial esta mal."],
    whenToUse: "Antes del kickoff, para poner jerarquia y detectar si la narrativa publica exagera a un equipo.",
    whenItLies: "Cuando una seleccion cambio mucho de plantilla o cuando el partido depende mas de tactica puntual que de fuerza historica.",
    neededData: "Ratings iniciales, resultados historicos, sede, forma reciente y peso de competicion.",
    publishHook: "Elo no grita goles: pone respeto. Si se equivoca, casi siempre fue porque la historia peso mas que la cancha.",
  },
  poisson: {
    operation:
      "Poisson transforma ataque y defensa en lambdas de gol esperado; de ahi sale una distribucion completa de marcadores.",
    context:
      "Conviene cuando quieres hablar de goles, marcadores probables, over/under y empates posibles con una base matematica clara.",
    controls: [
      "Lambda local y visitante: volumen esperado de gol.",
      "Sesgo ofensivo: cuanto empuja el ataque.",
      "Sesgo defensivo: cuanto aguanta o concede el rival.",
      "Ritmo esperado: si el partido se abre o se cierra.",
    ],
    outputs: ["Lambdas", "Heatmap de marcadores", "Probabilidades local/empate/visita"],
    charts: ["Heatmap 0-0 a 5-5", "Distribucion marginal de goles", "Sensibilidad de lambda"],
    pitfalls: ["Asume independencia simple.", "Puede fallar en partidos trabados.", "Necesita calibracion para empates bajos."],
    whenToUse: "Antes del partido, si tienes xG, goles esperados o fuerza ofensiva-defensiva defendible.",
    whenItLies: "Cuando el partido se vuelve tactico, emocional o de eliminatoria cerrada y la independencia de goles se rompe.",
    neededData: "Goles, xG, fuerza ofensiva, fuerza defensiva, localia, ritmo y forma reciente.",
    publishHook: "Poisson te dice que marcador vive en la sombra. Lo bonito es ver si la cancha le obedece al promedio.",
  },
  dixon_coles: {
    operation:
      "Dixon-Coles toma Poisson y corrige la zona rara del futbol: 0-0, 1-0, 0-1 y 1-1.",
    context:
      "Conviene cuando el partido huele a tension, poco gol o empate peligroso. Es Poisson con colmillo defensivo.",
    controls: [
      "Rho: correccion de marcadores bajos.",
      "Decaimiento temporal: cuanto pesa lo reciente.",
      "Ritmo esperado: volumen total de goles.",
    ],
    outputs: ["Masa de marcadores bajos", "Probabilidad de empate corregida", "Heatmap ajustado"],
    charts: ["Poisson vs Dixon-Coles", "Masa de 0-0/1-1", "Sensibilidad de rho"],
    pitfalls: ["Si rho se exagera, infla empates.", "Necesita historicos limpios.", "No ve eventos en vivo por si solo."],
    whenToUse: "Antes de partidos cerrados, especialmente cuando Poisson parece demasiado optimista con goles.",
    whenItLies: "Cuando el juego se rompe temprano con gol, roja o lesion y el partido deja de ser bajo-control.",
    neededData: "Marcadores historicos, lambdas base, ritmo, decaimiento temporal y contexto competitivo.",
    publishHook: "Dixon-Coles es el modelo que sospecha del 1-1. No es pesimista: es futbolero.",
  },
  bayes_live: {
    operation:
      "Bayes Live empieza con una creencia previa y la actualiza con evidencia: xG, tiros, tarjetas, dominio, cambios y goles.",
    context:
      "Conviene durante el partido, cuando necesitas cambiar de opinion sin vender humo.",
    controls: [
      "Fuerza del prior: cuanto respetas la lectura inicial.",
      "Peso de evidencia viva: cuanto reaccionas al juego.",
      "Senal xG: peligro real generado durante el partido.",
    ],
    outputs: ["Prior vs posterior", "Cambio por evidencia", "Incertidumbre restante"],
    charts: ["Waterfall de evidencia", "Timeline de actualizacion", "Posterior por minuto"],
    pitfalls: ["Un prior debil sobrerreacciona.", "Evidencia mala produce posterior malo.", "Debe separar ruido de senal."],
    whenToUse: "Durante el partido, despues de cambios fuertes de momentum o evidencia acumulada.",
    whenItLies: "Cuando los eventos son ruidosos, el xG viene de tiros pobres o el prior inicial estaba inflado.",
    neededData: "Prior prepartido, minuto, score, xG, tiros, tarjetas, sustituciones, posesion territorial y momentum.",
    publishHook: "Bayes no presume certeza: cambia de opinion con disciplina cuando la cancha le trae pruebas.",
  },
  ensemble: {
    operation:
      "El ensamble junta familias de modelos y decide cuanto escuchar a cada una segun contexto y desacuerdo.",
    context:
      "Conviene cuando quieres competir en serio: mezcla jerarquia, goles esperados, marcadores bajos y evidencia viva.",
    controls: [
      "Pesos por modelo: quien tiene voz.",
      "Temperatura: agresividad o cautela.",
      "Umbral de acuerdo: cuanto consenso exige.",
      "Limite de confianza: freno contra sobrecerteza.",
    ],
    outputs: ["Prediccion combinada", "Contribucion por modelo", "Desacuerdo del comite"],
    charts: ["Pesos por modelo", "Prediccion individual vs combinada", "Mapa de desacuerdo"],
    pitfalls: ["Puede ocultar errores.", "No elimina incertidumbre.", "Un consenso falso puede venir de senales redundantes."],
    whenToUse: "Cuando el partido tiene senales mezcladas y necesitas una postura robusta, no una sola voz.",
    whenItLies: "Cuando todos los modelos estan alimentados por el mismo sesgo o cuando los pesos no se auditan.",
    neededData: "Salidas de Elo, Poisson, Dixon-Coles, Bayes, xG, contexto de estadio y evaluacion historica.",
    publishHook: "El ensamble es mesa de debate: gana cuando sabe escuchar desacuerdo, no cuando aplasta la duda.",
  },
} as const;

function parseLearning(entry: LearningLogEntry) {
  try {
    return JSON.parse(entry.best_parameters_json) as {
      line?: {
        home_win?: number;
        draw?: number;
        away_win?: number;
        expected_home_goals?: number;
        expected_away_goals?: number;
      };
      probability_for_real_outcome?: number;
    };
  } catch {
    return {};
  }
}

function pct(value?: number) {
  return `${Math.round(Number(value ?? 0) * 1000) / 10}%`;
}

function learningProbability(entry?: LearningLogEntry) {
  if (!entry) return 0;
  return Number(parseLearning(entry).probability_for_real_outcome ?? 1 - entry.best_error);
}

function learningLift(entry?: LearningLogEntry) {
  if (!entry) return 0;
  const params = parseLearning(entry) as { outcome_probability_lift?: number };
  return Number(params.outcome_probability_lift ?? learningProbability(entry) - (1 - entry.original_error));
}

function modelNextAdjustment(model: ModelModule, entry?: LearningLogEntry) {
  if (!entry) return `Primero necesita resultados cerrados para saber si ${model.short_name} esta leyendo la cancha o solo contando bonito.`;
  if (model.id === "poisson") return "Revisar lambdas contra tiros/xG: si el marcador real se alejo mucho, el volumen de gol necesita castigo o impulso.";
  if (model.id === "elo") return "Comparar jerarquia historica contra forma reciente: Elo debe aprender cuando una camiseta pesa menos que el presente.";
  if (model.id === "dixon_coles") return "Auditar la zona 0-0, 1-0 y 1-1: si el partido fue cerrado, rho debe tener mas voz.";
  if (model.id === "bayes_live") return "Separar senal viva de ruido: tiros buenos, tarjetas y momentum deben mover el posterior sin sobre reaccionar.";
  if (model.id === "ensemble") return "Revisar el desacuerdo: si un modelo acerto solo, el ensamble debe explicar por que no lo escucho mas.";
  return "Comparar la lectura contra el resultado real y documentar que variable movio la historia.";
}

function modelLessonCopy(model: ModelModule, entry?: LearningLogEntry) {
  const knowledge = modelKnowledge[model.id];
  if (!entry) {
    return [
      `${model.name}: catedra viva de futbol y datos.`,
      "",
      knowledge.publishHook,
      `Cuando usarlo: ${knowledge.whenToUse}`,
      `Cuando sospechar: ${knowledge.whenItLies}`,
      "",
      `Ver catedra: https://mundial.hadox.org/modelos/${model.id}/`,
      "#MundialLab #FootballAnalytics #DataScience",
    ].join("\n");
  }
  const params = parseLearning(entry);
  return [
    `${model.name} a examen: ${entry.home_team} ${entry.home_score}-${entry.away_score} ${entry.away_team}.`,
    "",
    `${model.short_name} dio ${pct(params.probability_for_real_outcome)} al desenlace real.`,
    entry.lesson,
    "",
    knowledge.publishHook,
    "",
    `Autopsia: https://mundial.hadox.org/diario-aprendizaje/?match=${entry.slug}&model=${model.id}`,
    `Catedra: https://mundial.hadox.org/modelos/${model.id}/`,
    "#MundialLab #FootballAnalytics #DataScience",
  ].join("\n");
}

function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 5) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((current, index) => ctx.fillText(current, x, y + index * lineHeight));
}

function generateModelLessonCanvas(model: ModelModule, entry?: LearningLogEntry) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo generar la tarjeta.");
  const knowledge = modelKnowledge[model.id];
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, "#071118");
  gradient.addColorStop(0.55, "#064e3b");
  gradient.addColorStop(1, "#020617");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1350);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#7ee2a8";
  ctx.lineWidth = 3;
  for (let i = 0; i < 12; i += 1) {
    ctx.beginPath();
    ctx.ellipse(540, 610, 160 + i * 46, 60 + i * 22, -0.25, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(72, 82, 936, 1186);
  ctx.strokeStyle = "rgba(126,226,168,0.35)";
  ctx.strokeRect(72, 82, 936, 1186);

  ctx.fillStyle = "#7ee2a8";
  ctx.font = "900 34px Arial";
  ctx.fillText("CATEDRA DEL MODELO", 116, 160);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 108px Arial";
  drawWrappedText(ctx, model.name, 116, 270, 820, 104, 2);

  ctx.fillStyle = "#facc15";
  ctx.font = "900 34px Arial";
  const score = entry ? `${entry.home_team} ${entry.home_score}-${entry.away_score} ${entry.away_team}` : "Leccion lista para el siguiente partido";
  drawWrappedText(ctx, score, 116, 500, 820, 42, 2);

  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.font = "700 36px Arial";
  drawWrappedText(ctx, entry?.lesson ?? knowledge.publishHook, 116, 650, 840, 48, 6);

  ctx.fillStyle = "rgba(126,226,168,0.16)";
  ctx.fillRect(116, 970, 848, 146);
  ctx.fillStyle = "#7ee2a8";
  ctx.font = "900 30px Arial";
  ctx.fillText("CUANDO USARLO", 148, 1022);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 28px Arial";
  drawWrappedText(ctx, knowledge.whenToUse, 148, 1070, 780, 36, 2);

  ctx.fillStyle = "#facc15";
  ctx.font = "900 28px Arial";
  ctx.fillText(`mundial.hadox.org/modelos/${model.id}/`, 116, 1232);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "700 24px Arial";
  ctx.fillText("Mundial Lab - futbol, datos y modelos que se auditan", 116, 1278);
  return canvas;
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo generar la imagen."));
    }, "image/png");
  });
}

function downloadDataUrl(image: string, filename: string) {
  const link = document.createElement("a");
  link.href = image;
  link.download = filename;
  link.click();
}

function ModelLearningLog({ model }: { model: ModelModule }) {
  const [entries, setEntries] = useState<LearningLogEntry[]>([]);
  const [quality, setQuality] = useState<DataQualitySummary | null>(null);
  const [mode, setMode] = useState("cargando");
  const [shareImage, setShareImage] = useState("");
  const [shareText, setShareText] = useState("");
  const knowledge = modelKnowledge[model.id];

  useEffect(() => {
    fetchLearningLog(12, model.id)
      .then((items) => {
        const modelEntries = items.filter((entry) => entry.best_parameters_json.includes("model_autopsy"));
        setEntries(modelEntries);
        setMode(modelEntries.length ? "con evidencia" : "esperando partidos cerrados");
      })
      .catch(() => setMode("sin API"));
    fetchPublicDataQuality()
      .then(setQuality)
      .catch(() => setQuality(null));
  }, [model.id]);

  const featured = entries[0];
  const classroomStats = useMemo(() => {
    const probabilities = entries.map((entry) => Number(parseLearning(entry).probability_for_real_outcome ?? 0));
    const avg = probabilities.length ? probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length : 0;
    const avgLift = entries.length ? entries.reduce((sum, entry) => sum + learningLift(entry), 0) / entries.length : 0;
    const best = [...entries].sort((a, b) => learningProbability(b) - learningProbability(a))[0];
    return { avg, avgLift, best, count: entries.length };
  }, [entries]);

  const createModelCard = async () => {
    const canvas = generateModelLessonCanvas(model, featured);
    const image = canvas.toDataURL("image/png");
    setShareImage(image);
    setShareText(modelLessonCopy(model, featured));
  };

  const downloadModelCard = () => {
    if (!shareImage) return;
    downloadDataUrl(shareImage, `${model.id}-catedra-mundial-lab.png`);
  };

  const shareModelCard = async () => {
    const canvas = generateModelLessonCanvas(model, featured);
    const image = canvas.toDataURL("image/png");
    setShareImage(image);
    const text = modelLessonCopy(model, featured);
    setShareText(text);
    const blob = await canvasBlob(canvas);
    const file = new File([blob], `${model.id}-catedra-mundial-lab.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file], text })) {
      await navigator.share({ files: [file], text, title: `${model.name} | Mundial Lab` });
      return;
    }
    await navigator.clipboard?.writeText(text);
    downloadDataUrl(image, file.name);
  };

  return (
    <div className="model-learning-log">
      <div className="workflow-title">
        <BrainCircuit />
        <h3>Catedra viva del modelo</h3>
      </div>
      <p>
        Aqui el modelo deja de ser teoria: cada partido cerrado se vuelve caso de estudio, copy
        publicable y evidencia para decidir cuando confiar o desconfiar.
      </p>
      <span className="model-learning-status">{mode}</span>

      <div className="model-learning-brief">
        <article>
          <small>Lo que ya aprendio</small>
          <strong>
            {classroomStats.best
              ? `${model.short_name} defendio mejor el ${classroomStats.best.home_team} ${classroomStats.best.home_score}-${classroomStats.best.away_score} ${classroomStats.best.away_team}.`
              : `${model.short_name} todavia no tiene suficientes autopsias propias.`}
          </strong>
          <p>
            {classroomStats.best
              ? classroomStats.best.lesson
              : "Cuando cierren mas partidos, esta catedra va a mostrar casos reales, no ejemplos inventados."}
          </p>
        </article>
        <article>
          <small>Proxima decision tecnica</small>
          <strong>{modelNextAdjustment(model, classroomStats.best)}</strong>
          <p>
            Promedio auditado {classroomStats.count ? pct(classroomStats.avg) : "pendiente"} · mejora media{" "}
            {classroomStats.count ? `${classroomStats.avgLift >= 0 ? "+" : ""}${pct(classroomStats.avgLift)}` : "pendiente"}.
          </p>
        </article>
      </div>

      <div className="model-classroom-grid">
        <article>
          <small>Cuando usarlo</small>
          <strong>{knowledge.whenToUse}</strong>
        </article>
        <article>
          <small>Cuando te puede enganar</small>
          <strong>{knowledge.whenItLies}</strong>
        </article>
        <article>
          <small>Datos que lo hacen serio</small>
          <strong>{knowledge.neededData}</strong>
        </article>
        <article>
          <small>Promedio auditado</small>
          <strong>{classroomStats.count ? pct(classroomStats.avg) : "pendiente"}</strong>
        </article>
      </div>

      <div className="model-share-kit">
        <div>
          <small>Tarjeta publicable del modelo</small>
          <strong>{knowledge.publishHook}</strong>
          <p>Sirve para publicar la leccion del modelo aunque todavia no haya muchos casos cerrados.</p>
        </div>
        <div className="model-share-actions">
          <button onClick={createModelCard} type="button">
            <ImageDown size={15} />
            Crear tarjeta
          </button>
          <button onClick={() => navigator.clipboard?.writeText(shareText || modelLessonCopy(model, featured))} type="button">
            <Clipboard size={15} />
            Copiar copy
          </button>
          <button disabled={!shareImage} onClick={downloadModelCard} type="button">
            Descargar PNG
          </button>
          <button onClick={shareModelCard} type="button">
            Compartir
          </button>
        </div>
        {shareImage && <img alt={`Tarjeta publicable de ${model.name}`} src={shareImage} />}
        {shareText && <textarea readOnly value={shareText} />}
      </div>

      <div className="model-learning-grid">
        {entries.slice(0, 3).map((entry) => {
          const params = parseLearning(entry);
          const line = params.line ?? {};
          const matchQuality = quality?.matches.find((match) => match.slug === entry.slug);
          return (
            <article key={entry.id}>
              <small>Partido {entry.match_number} - {entry.stage}</small>
              <h4>{entry.home_team} {entry.home_score}-{entry.away_score} {entry.away_team}</h4>
              <strong>{pct(params.probability_for_real_outcome)} al resultado real</strong>
              <p>{entry.lesson}</p>
              <div className="model-case-data">
                <span className={matchQuality?.result_trust_level === "real_verificado" ? "ok" : "pending"}>resultado</span>
                <span className={matchQuality?.has_shots ? "ok" : "pending"}>tiros</span>
                <span className={matchQuality?.has_xg ? "ok" : "pending"}>xG</span>
                <span className={matchQuality?.has_lineups ? "ok" : "pending"}>lineup</span>
              </div>
              <div>
                <span>{pct(line.home_win)} L</span>
                <span>{pct(line.draw)} E</span>
                <span>{pct(line.away_win)} V</span>
              </div>
              <div className="model-learning-actions">
                <a href={`/diario-aprendizaje/?match=${entry.slug}&model=${model.id}`}>Autopsia del modelo</a>
                <a href={`/partidos/${entry.slug}/`}>Sala del partido</a>
              </div>
            </article>
          );
        })}
        {!entries.length && (
          <article className="model-empty-lesson">
            <small>{model.short_name}</small>
            <h4>Este modelo esta esperando su primer caso publicable.</h4>
            <p>
              No es un error: la cola automatica necesita resultados cerrados para auditarlo sin
              hacer trampa. Mientras tanto, usa la catedra y prueba el modelo en una sala de partido.
            </p>
            <div className="model-learning-actions">
              <a href="/partidos/">Probar en partidos</a>
              <a href={`/diario-aprendizaje/?model=${model.id}`}>Ver filtro del Diario</a>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

export function ModelPage({ model }: ModelPageProps) {
  const knowledge = modelKnowledge[model.id];

  return (
    <section className="model-page" id={`modelo-${model.id}`}>
      <div className="model-page-head">
        <div>
          <p className="section-kicker">Modelo en la cancha</p>
          <h2>{model.name}</h2>
          <p>{model.question}</p>
          <div className="model-page-actions">
            <a href={`/diario-aprendizaje/?model=${model.id}`}>Ver lecciones del modelo</a>
            <a href="/partidos/">Probarlo en un partido</a>
          </div>
        </div>
        <ModelOrbit variant={model.id} />
      </div>

      <div className="model-detail-grid">
        <article>
          <Zap />
          <h3>Intuicion pambolera</h3>
          <p>{model.intuition}</p>
        </article>
        <article>
          <Database />
          <h3>Datos que pide</h3>
          <ul>
            {model.data_inputs.map((input) => (
              <li key={input}>{input}</li>
            ))}
          </ul>
        </article>
        <article>
          <FlaskConical />
          <h3>Que aprende quien lo usa</h3>
          <p>{model.student_takeaway}</p>
        </article>
      </div>

      <div className="knowledge-house">
        <div className="workflow-title">
          <BrainCircuit />
          <h3>Casa de conocimiento del modelo</h3>
        </div>
        <div className="knowledge-grid">
          <article className="knowledge-card wide">
            <Gauge />
            <h3>Como opera</h3>
            <p>{knowledge.operation}</p>
          </article>
          <article className="knowledge-card wide">
            <Route />
            <h3>Cuando conviene usarlo</h3>
            <p>{knowledge.context}</p>
          </article>
          <article className="knowledge-card">
            <SlidersHorizontal />
            <h3>Perillas conceptuales</h3>
            <ul>
              {knowledge.controls.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article className="knowledge-card">
            <BarChart3 />
            <h3>Como leer la salida</h3>
            <ul>
              {knowledge.outputs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article className="knowledge-card">
            <Database />
            <h3>Graficas que explican el modelo</h3>
            <ul>
              {knowledge.charts.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article className="knowledge-card">
            <ShieldAlert />
            <h3>Errores comunes</h3>
            <ul>
              {knowledge.pitfalls.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </div>
      </div>

      <div className="workflow">
        <div className="workflow-title">
          <Route />
          <h3>Workflow del modulo</h3>
        </div>
        <div className="workflow-steps">
          {model.workflow.map((step, index) => (
            <article key={step.name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h4>{step.name}</h4>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </div>

      <ModelLearningLog model={model} />

      <ModelControls modelId={model.id} />
    </section>
  );
}
