import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Beaker, BookOpen, BrainCircuit, CheckCircle2, ClipboardCheck, Database, Download, FileJson, Gauge, ImageDown, PlayCircle, Radio, Save, Share2, SlidersHorizontal, Trophy, Upload, UsersRound } from "lucide-react";
import { SiteFooter } from "../components/SiteFooter";
import { createPrediction, fetchMatch, fetchMatchAutopsies, fetchMatchData, registerAlias } from "../lib/api";
import { demoMatch } from "../lib/liveDemo";
import {
  applyPlayerStatuses,
  defaultOperationalControls,
  impactPlayers,
  predictOperationalModel,
  stadiumContext,
  teamImpact,
} from "../lib/impactModel";
import { fallbackModels } from "../lib/modelContent";
import { teamFlag } from "../lib/teamVisuals";
import { matchMomentLabel, matchMomentTone } from "../lib/tournamentMoment";
import {
  ImpactPlayer,
  LivePrediction,
  MatchDetail,
  MatchData,
  MatchShot,
  ModelAutopsy,
  ModelName,
  OperationalControls,
  OperationalPrediction,
  PlayerStatus,
  PlayerRole,
  StadiumContext,
  TeamImpact,
} from "../types";
import "../styles.css";

type MatchOutcome = "home" | "draw" | "away";

const statusLabels: Record<PlayerStatus, string> = {
  titular: "Titular",
  tocado: "Tocado",
  fatigado: "Fatigado",
  amarilla: "Con amarilla",
  sustituido: "Sustituido",
};

function ProbabilityBars({ home, draw, away }: { home: number; draw: number; away: number }) {
  return (
    <div className="prob-bars">
      <span style={{ width: `${home * 100}%` }}>Local {Math.round(home * 100)}%</span>
      <span style={{ width: `${draw * 100}%` }}>Empate {Math.round(draw * 100)}%</span>
      <span style={{ width: `${away * 100}%` }}>Visita {Math.round(away * 100)}%</span>
    </div>
  );
}

function sourceLabel(value?: string | null) {
  if (!value) return "pendiente";
  if (value.includes("ESPN")) return "ESPN summary";
  if (value.includes("Open-Meteo")) return "Open-Meteo";
  if (value.includes("StatsBomb")) return "StatsBomb Open";
  return value;
}

function finishedOutcome(detail: MatchDetail): MatchOutcome | null {
  if (detail.match.status !== "finished") return null;
  if (detail.match.home_score > detail.match.away_score) return "home";
  if (detail.match.home_score < detail.match.away_score) return "away";
  return "draw";
}

function outcomeProbability(prediction: LivePrediction, outcome: MatchOutcome | null) {
  if (outcome === "home") return prediction.home_win;
  if (outcome === "away") return prediction.away_win;
  if (outcome === "draw") return prediction.draw;
  return Math.max(prediction.home_win, prediction.draw, prediction.away_win);
}

function predictedSide(prediction: LivePrediction, detail: MatchDetail) {
  const options = [
    { label: detail.match.home_team, value: prediction.home_win },
    { label: "Empate", value: prediction.draw },
    { label: detail.match.away_team, value: prediction.away_win },
  ];
  return options.sort((a, b) => b.value - a.value)[0];
}

function directorTag(prediction: LivePrediction, outcome: MatchOutcome | null) {
  const probability = outcomeProbability(prediction, outcome);
  if (outcome && probability >= 0.5) return "leyó el marcador";
  if (outcome && probability < 0.34) return "se fue contra la jugada";
  const confidence = Math.max(prediction.home_win, prediction.draw, prediction.away_win);
  if (confidence >= 0.62) return "apuesta fuerte";
  if (confidence <= 0.42) return "lectura fría";
  return "en la pelea";
}

function shotDanger(shot: MatchShot) {
  if (shot.xg != null) return clampMetric(shot.xg * 3.5);
  const x = Number(shot.x ?? 50);
  const y = Number(shot.y ?? 50);
  const distanceToGoal = Math.hypot(100 - x, 50 - y);
  const centrality = 1 - Math.min(1, Math.abs(50 - y) / 50);
  const outcomeBoost = shot.shot_type.toLowerCase().includes("goal")
    ? 0.4
    : shot.shot_type.toLowerCase().includes("on target")
      ? 0.22
      : shot.shot_type.toLowerCase().includes("woodwork")
        ? 0.28
        : 0;
  return clampMetric(0.08 + (1 - Math.min(distanceToGoal, 70) / 70) * 0.58 + centrality * 0.18 + outcomeBoost);
}

function shotPressure(data: MatchData | null, teamName: string) {
  return (data?.shots ?? [])
    .filter((shot) => shot.team_name === teamName)
    .reduce((sum, shot) => sum + shotDanger(shot), 0);
}

function liveShotSignal(data: MatchData | null, detail: MatchDetail) {
  const homePressure = shotPressure(data, detail.match.home_team);
  const awayPressure = shotPressure(data, detail.match.away_team);
  const total = homePressure + awayPressure;
  if (total <= 0) return 0;
  return Math.max(-1, Math.min(1, (homePressure - awayPressure) / total));
}

function ShotMapPanel({ data, detail }: { data: MatchData | null; detail: MatchDetail }) {
  const shots = data?.shots ?? [];
  const homePressure = shotPressure(data, detail.match.home_team);
  const awayPressure = shotPressure(data, detail.match.away_team);
  const totalPressure = Math.max(0.01, homePressure + awayPressure);
  const homeShare = homePressure / totalPressure;
  const awayShare = awayPressure / totalPressure;
  const signal = liveShotSignal(data, detail);
  const dominant = homeShare >= awayShare ? detail.match.home_team : detail.match.away_team;
  const hasShots = shots.length > 0;

  return (
    <article className="live-panel shot-map-panel">
      <div className="workflow-title">
        <Radio />
        <h3>Mapa de tiros real</h3>
      </div>
      <div className="shot-map-summary">
        <span>
          <small>Presion de tiro</small>
          <strong>{hasShots ? dominant : "pendiente"}</strong>
        </span>
        <span>
          <small>Indice local</small>
          <strong>{hasShots ? `${Math.round(homePressure * 10) / 10}` : "pendiente"}</strong>
        </span>
        <span>
          <small>Indice visita</small>
          <strong>{hasShots ? `${Math.round(awayPressure * 10) / 10}` : "pendiente"}</strong>
        </span>
        <span>
          <small>Senal viva</small>
          <strong>{hasShots ? `${signal >= 0 ? "+" : ""}${signal.toFixed(2)}` : "pendiente"}</strong>
        </span>
      </div>
      <div className="shot-pitch" role="img" aria-label="Mapa de tiros con coordenadas reales">
        <div className="shot-pitch-midline" />
        <div className="shot-pitch-circle" />
        {shots.map((shot) => {
          const isHome = shot.team_name === detail.match.home_team;
          const danger = shotDanger(shot);
          const size = 8 + danger * 20;
          return (
            <span
              className={`shot-dot ${isHome ? "home" : "away"} ${shot.shot_type.toLowerCase().includes("goal") ? "goal" : ""}`}
              key={`${shot.source}-${shot.external_event_id}`}
              style={{
                left: `${Math.max(2, Math.min(98, shot.x ?? 50))}%`,
                top: `${Math.max(4, Math.min(96, shot.y ?? 50))}%`,
                width: `${size}px`,
                height: `${size}px`,
              }}
              title={`${shot.minute}' ${shot.team_name} · ${shot.player_name} · ${shot.shot_type}`}
            />
          );
        })}
      </div>
      <div className="shot-pressure-bars">
        <label>
          <span>{detail.match.home_team}</span>
          <i style={{ width: `${Math.round(homeShare * 100)}%` }} />
        </label>
        <label>
          <span>{detail.match.away_team}</span>
          <i style={{ width: `${Math.round(awayShare * 100)}%` }} />
        </label>
      </div>
      <small>
        No es xG oficial: es un indice visual de peligro construido con ubicacion, centralidad y resultado del tiro.
      </small>
    </article>
  );
}

function RealMatchDataPanel({ data, detail, error }: { data: MatchData | null; detail: MatchDetail; error: string }) {
  const features = data?.features;
  const weather = data?.weather;
  const homeLineup = (data?.lineups ?? []).filter((player) => player.team_id === detail.match.home_team_id);
  const awayLineup = (data?.lineups ?? []).filter((player) => player.team_id === detail.match.away_team_id);
  const starters = [...homeLineup, ...awayLineup].filter((player) => Boolean(player.starter));
  const hasRealData = Boolean(features || weather || data?.lineups.length || data?.shots.length);

  return (
    <article className="live-panel real-data-panel">
      <div className="workflow-title">
        <Database />
        <h3>Datos reales del partido</h3>
      </div>
      <div className="data-source-ribbon">
        <span className={hasRealData ? "ok" : "pending"}>
          {hasRealData ? "datos conectados" : error ? "revision requerida" : "sin enriquecimiento todavia"}
        </span>
        <small>
          {error || `Stats: ${sourceLabel(data?.sources.features)} · Clima: ${sourceLabel(data?.sources.weather)}`}
        </small>
      </div>

      <div className="real-data-grid">
        <span>
          <small>Tiros</small>
          <strong>{features ? `${features.home_shots} - ${features.away_shots}` : "pendiente"}</strong>
        </span>
        <span>
          <small>A puerta</small>
          <strong>{features ? `${features.home_shots_on_target} - ${features.away_shots_on_target}` : "pendiente"}</strong>
        </span>
        <span>
          <small>Posesion</small>
          <strong>
            {features?.home_possession != null ? `${Math.round(features.home_possession)}% - ${Math.round(features.away_possession ?? 0)}%` : "pendiente"}
          </strong>
        </span>
        <span>
          <small>xG</small>
          <strong>
            {features?.home_xg != null ? `${features.home_xg.toFixed(2)} - ${features.away_xg?.toFixed(2)}` : "no disponible"}
          </strong>
        </span>
        <span>
          <small>Clima</small>
          <strong>{weather?.temperature_c != null ? `${weather.temperature_c.toFixed(1)}°C` : "pendiente"}</strong>
        </span>
        <span>
          <small>Titulares</small>
          <strong>{starters.length ? `${starters.length} detectados` : "pendiente"}</strong>
        </span>
      </div>

      <div className="lineup-preview">
        <div>
          <strong>{detail.match.home_team}</strong>
          {(homeLineup.filter((player) => Boolean(player.starter)).slice(0, 5)).map((player) => (
            <span key={`${player.source}-${player.source_player_id}`}>
              {player.jersey && <b>{player.jersey}</b>}
              {player.player_name}
              <small>{player.position || "sin posicion"}</small>
            </span>
          ))}
          {!homeLineup.length && <em>Sin lineup real cargado.</em>}
        </div>
        <div>
          <strong>{detail.match.away_team}</strong>
          {(awayLineup.filter((player) => Boolean(player.starter)).slice(0, 5)).map((player) => (
            <span key={`${player.source}-${player.source_player_id}`}>
              {player.jersey && <b>{player.jersey}</b>}
              {player.player_name}
              <small>{player.position || "sin posicion"}</small>
            </span>
          ))}
          {!awayLineup.length && <em>Sin lineup real cargado.</em>}
        </div>
      </div>
      <small>
        Los xG actuales solo aparecen si la fuente los trae. Si no, usamos tiros/eventos reales y dejamos xG sin inventar.
      </small>
    </article>
  );
}

function dataStatus(value: boolean, source?: string | null) {
  if (value && source && source !== "estimado") return "real";
  if (value) return "estimado";
  return "faltante";
}

function ModelDataEvidencePanel({
  activeModel,
  data,
  detail,
  evidenceSignal,
  stadium,
}: {
  activeModel: ModelName;
  data: MatchData | null;
  detail: MatchDetail;
  evidenceSignal: number;
  stadium: StadiumContext;
}) {
  const features = data?.features;
  const lineupCount = data?.lineups.filter((player) => Boolean(player.starter)).length ?? 0;
  const shotCount = data?.shots.length ?? 0;
  const inputs = [
    {
      name: "xG",
      value: features?.home_xg != null ? `${features.home_xg.toFixed(2)} - ${features.away_xg?.toFixed(2)}` : "sin xG real",
      status: dataStatus(features?.home_xg != null, data?.sources.features),
      usedBy: ["poisson", "bayes_live", "ensemble"],
    },
    {
      name: "Tiros",
      value: features ? `${features.home_shots} - ${features.away_shots}` : shotCount ? `${shotCount} eventos` : "pendiente",
      status: dataStatus(Boolean(features || shotCount), data?.sources.features || data?.sources.shots[0]),
      usedBy: ["poisson", "bayes_live", "ensemble"],
    },
    {
      name: "Lineup",
      value: lineupCount ? `${lineupCount} titulares detectados` : "pendiente",
      status: dataStatus(lineupCount > 0, data?.sources.lineups[0]),
      usedBy: ["bayes_live", "ensemble"],
    },
    {
      name: "Estadio",
      value: `${detail.match.venue} · ${Math.round(stadium.pressure * 100)} presion`,
      status: dataStatus(true, stadium.source),
      usedBy: ["elo", "poisson", "ensemble"],
    },
    {
      name: "Clima",
      value: data?.weather?.temperature_c != null ? `${data.weather.temperature_c.toFixed(1)}C` : "estimado por sede",
      status: dataStatus(Boolean(data?.weather), data?.sources.weather),
      usedBy: ["bayes_live", "ensemble"],
    },
    {
      name: "Forma/Elo",
      value: "rating base del torneo",
      status: "estimado",
      usedBy: ["elo", "ensemble"],
    },
  ];
  const activeInputs = inputs.filter((input) => input.usedBy.includes(activeModel));

  return (
    <article className="live-panel model-data-evidence">
      <div className="workflow-title">
        <Database />
        <h3>Datos que esta usando el modelo</h3>
      </div>
      <p>
        No todos los modelos comen lo mismo. Aqui se ve que senales entran a {fallbackModels.find((model) => model.id === activeModel)?.short_name}
        {" "}y si vienen reales, estimadas o faltantes.
      </p>
      <div className="model-data-grid">
        {activeInputs.map((input) => (
          <span className={`is-${input.status}`} key={input.name}>
            <small>{input.status}</small>
            <strong>{input.name}</strong>
            <em>{input.value}</em>
          </span>
        ))}
      </div>
      <div className="model-impact-note">
        <strong>Senal viva</strong>
        <span>{evidenceSignal > 0.08 ? "El partido empuja al local." : evidenceSignal < -0.08 ? "El partido empuja a la visita." : "La evidencia viva sigue pareja."}</span>
      </div>
    </article>
  );
}

function autopsyParameters(autopsy: ModelAutopsy | null) {
  if (!autopsy) return null;
  try {
    return JSON.parse(autopsy.best_parameters_json) as {
      best_contract?: {
        contract?: string;
        probability_for_real_outcome?: number;
        home_win?: number;
        draw?: number;
        away_win?: number;
      };
      candidates?: {
        contract: string;
        probability_for_real_outcome: number;
        home_win: number;
        draw: number;
        away_win: number;
      }[];
      outcome_probability_lift?: number;
      no_leakage_rule?: string;
    };
  } catch {
    return null;
  }
}

function modelImpactExplanation(
  model: ModelName,
  prediction: OperationalPrediction,
  stadium: StadiumContext,
  homeImpact: TeamImpact,
  awayImpact: TeamImpact,
  evidenceSignal: number,
) {
  const favorite = prediction.home_win >= prediction.away_win ? "local" : "visita";
  const attackGap = homeImpact.attack - awayImpact.attack;
  const defenseGap = homeImpact.defense - awayImpact.defense;
  const tempoGap = homeImpact.tempo - awayImpact.tempo;
  const explanations: Record<ModelName, { title: string; bullets: string[] }> = {
    poisson: {
      title: "Poisson movio la lambda de goles.",
      bullets: [
        `Ataque relativo: ${attackGap >= 0 ? "+" : ""}${Math.round(attackGap * 100)} pts para el local.`,
        `Defensa relativa: ${defenseGap >= 0 ? "+" : ""}${Math.round(defenseGap * 100)} pts para el local.`,
        `La salida favorece al ${favorite} porque cambia el volumen esperado de gol.`,
      ],
    },
    elo: {
      title: "Elo movio jerarquia y contexto.",
      bullets: [
        `El estadio agrega ${Math.round(stadium.pressure * 100)} pts de presion contextual.`,
        `Elo usa fuerza base; no promete marcador, separa jerarquias.`,
        `Si la forma reciente pesa poco, puede quedarse viejo.`,
      ],
    },
    dixon_coles: {
      title: "Dixon-Coles ajusto el peligro de marcador bajo.",
      bullets: [
        `Si el partido se cierra, el empate gana valor.`,
        `La defensa relativa mueve la masa de 0-0, 1-0 y 1-1.`,
        `Ahora el empate vive en ${Math.round(prediction.draw * 100)}%.`,
      ],
    },
    bayes_live: {
      title: "Bayes actualizo el prior con evidencia viva.",
      bullets: [
        `Senal de tiros/xG: ${evidenceSignal >= 0 ? "+" : ""}${Math.round(evidenceSignal * 100)} pts local.`,
        `Ritmo relativo: ${tempoGap >= 0 ? "+" : ""}${Math.round(tempoGap * 100)} pts local.`,
        `Si el partido cambia, Bayes debe cambiar sin fingir certeza.`,
      ],
    },
    ensemble: {
      title: "Ensamble mezclo jerarquia, goles y evidencia.",
      bullets: [
        `Poisson aporta volumen, Elo jerarquia, Bayes reaccion y Dixon-Coles prudencia.`,
        `Confianza actual: ${Math.round(Math.max(prediction.home_win, prediction.draw, prediction.away_win) * 100)}%.`,
        `Si las senales chocan, el ensamble debe bajar la voz.`,
      ],
    },
  };
  return explanations[model];
}

function ModelImpactPanel({
  activeModel,
  prediction,
  stadium,
  homeImpact,
  awayImpact,
  evidenceSignal,
}: {
  activeModel: ModelName;
  prediction: OperationalPrediction;
  stadium: StadiumContext;
  homeImpact: TeamImpact;
  awayImpact: TeamImpact;
  evidenceSignal: number;
}) {
  const explanation = modelImpactExplanation(activeModel, prediction, stadium, homeImpact, awayImpact, evidenceSignal);
  return (
    <article className="live-panel model-impact-panel">
      <div className="workflow-title">
        <BrainCircuit />
        <h3>Que movio la prediccion</h3>
      </div>
      <strong>{explanation.title}</strong>
      <ul>
        {explanation.bullets.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

function DataDirectorFlowPanel({ detail, activeModel }: { detail: MatchDetail; activeModel: ModelName }) {
  const modelName = fallbackModels.find((model) => model.id === activeModel)?.short_name ?? activeModel;
  return (
    <article className="live-panel director-flow-panel">
      <div className="workflow-title">
        <ClipboardCheck />
        <h3>Como operar esta sala</h3>
      </div>
      <div className="director-flow-steps">
        <span>
          <b>1</b>
          <strong>Lee datos</strong>
          <small>Revisa cobertura real, faltantes y contexto.</small>
        </span>
        <span>
          <b>2</b>
          <strong>Elige modelo</strong>
          <small>Ahora esta activo {modelName}.</small>
        </span>
        <span>
          <b>3</b>
          <strong>Guarda lectura</strong>
          <small>Tu alias entra al ranking sin pedir datos privados.</small>
        </span>
        <span>
          <b>4</b>
          <strong>Publica autopsia</strong>
          <small>Cuando cierre {detail.match.home_team} vs {detail.match.away_team}, compara contra el marcador.</small>
        </span>
      </div>
      <div className="director-flow-actions">
        <a href="/laboratorio-datos/">Ver laboratorio de datos</a>
        <a href={`/diario-aprendizaje/?match=${detail.match.slug}`}>Ver autopsias del partido</a>
      </div>
    </article>
  );
}

function TrainingModePanel({
  activeModel,
  autopsies,
  data,
  detail,
  evidenceSignal,
  prediction,
}: {
  activeModel: ModelName;
  autopsies: ModelAutopsy[];
  data: MatchData | null;
  detail: MatchDetail;
  evidenceSignal: number;
  prediction: OperationalPrediction;
}) {
  const modelName = fallbackModels.find((model) => model.id === activeModel)?.short_name ?? activeModel;
  const hasData = Boolean(data?.features || data?.shots.length || data?.lineups.length || data?.weather);
  const hasAutopsy = autopsies.length > 0;
  const confidence = Math.max(prediction.home_win, prediction.draw, prediction.away_win);
  const favorite =
    prediction.home_win >= prediction.draw && prediction.home_win >= prediction.away_win
      ? detail.match.home_team
      : prediction.away_win >= prediction.draw
        ? detail.match.away_team
        : "Empate";
  const steps = [
    {
      label: "1. Revisa datos",
      status: hasData ? "listo" : "pendiente",
      text: hasData
        ? "Hay cobertura para alimentar la lectura."
        : "Trabaja con demo o espera enriquecimiento.",
      href: "#datos-del-partido",
    },
    {
      label: "2. Elige modelo",
      status: "activo",
      text: `${modelName} esta operando la sala.`,
      href: "#modelo-operativo",
    },
    {
      label: "3. Defiende lectura",
      status: confidence >= 0.45 ? "fuerte" : "abierta",
      text: `${favorite} aparece con ${Math.round(confidence * 100)}% de confianza.`,
      href: "#guardar-lectura",
    },
    {
      label: "4. Cierra aprendizaje",
      status: hasAutopsy ? "listo" : detail.match.status === "finished" ? "en-cola" : "despues",
      text: hasAutopsy
        ? "Ya existe autopsia para comparar modelos."
        : detail.match.status === "finished"
          ? "Resultado cerrado: la cola debe publicar la autopsia."
          : "Vuelve despues del silbatazo.",
      href: `/diario-aprendizaje/?match=${detail.match.slug}`,
    },
  ];

  return (
    <section className="training-mode-panel" aria-label="Modo entrenamiento de Data Director">
      <div className="training-mode-head">
        <div>
          <p className="section-kicker">Modo entrenamiento</p>
          <h2>Lee, mueve, guarda y vuelve por la autopsia.</h2>
          <p>
            Esta sala no es para mirar numeritos: es para tomar postura como Data Director,
            dejar parametros guardados y luego ver si el marcador real te dio la razon.
          </p>
        </div>
        <div className="training-mode-call">
          <small>Lectura actual</small>
          <strong>{favorite}</strong>
          <span>{Math.round(prediction.home_win * 100)}% L · {Math.round(prediction.draw * 100)}% E · {Math.round(prediction.away_win * 100)}% V</span>
          <em>Senal viva {evidenceSignal >= 0 ? "+" : ""}{evidenceSignal.toFixed(2)}</em>
        </div>
      </div>
      <div className="training-steps">
        {steps.map((step) => (
          <a className={`is-${step.status}`} href={step.href} key={step.label}>
            <span>{step.label}</span>
            <strong>{step.text}</strong>
          </a>
        ))}
      </div>
      <div className="training-mode-actions">
        <a href={`/modelos/${activeModel}/`}>
          <BookOpen size={16} />
          Casa de conocimiento
        </a>
        <a href={`/simulador-partido/?match=${detail.match.slug}`}>
          <PlayCircle size={16} />
          Replay 3D
        </a>
        <a href={`/diario-aprendizaje/?match=${detail.match.slug}`}>
          <BrainCircuit size={16} />
          Autopsia del partido
        </a>
      </div>
    </section>
  );
}

function ModelAutopsyPanel({
  autopsies,
  detail,
}: {
  autopsies: ModelAutopsy[];
  detail: MatchDetail;
}) {
  const autopsy = autopsies.find((item) => item.best_parameters_json.includes("calibrated_autopsy")) ?? autopsies[0] ?? null;
  const params = autopsyParameters(autopsy);
  const best = params?.best_contract;
  const candidates = params?.candidates ?? [];
  const originalSignal = autopsy ? Math.round((1 - autopsy.original_error) * 1000) / 10 : null;
  const bestSignal = autopsy ? Math.round((1 - autopsy.best_error) * 1000) / 10 : null;
  const lift = params?.outcome_probability_lift != null ? Math.round(params.outcome_probability_lift * 1000) / 10 : null;
  const isClosed = detail.match.status === "finished";
  const diaryHref = `/diario-aprendizaje/?match=${detail.match.slug}${autopsy ? `&model=${autopsy.best_model}` : ""}`;
  const kitHref = `/diario-aprendizaje/?match=${detail.match.slug}&kit=1`;

  const copyAutopsy = async () => {
    if (!autopsy?.share_copy) return;
    await navigator.clipboard?.writeText(autopsy.share_copy);
  };

  return (
    <article className="live-panel autopsy-panel">
      <div className="workflow-title">
        <BrainCircuit />
        <h3>Autopsia + kit publicable</h3>
      </div>
      <p>
        Cuando el marcador queda fijo, el partido se vuelve leccion: modelo ganador, senales que pesaron,
        copy sugerido y tarjeta lista para publicar.
      </p>
      {!autopsy ? (
        <div className="autopsy-empty">
          <strong>{isClosed ? "Listo para autopsia calibrada." : "Aun no hay marcador final para auditar."}</strong>
          <span>
            {isClosed
              ? "El scheduler la pone en cola y la publica aqui sin que el admin apriete nada."
              : "Cuando el admin cierre el resultado, aqui aparece la comparacion contra la linea original."}
          </span>
          <a href={kitHref}>Abrir kit del partido</a>
        </div>
      ) : (
        <>
          <div className="autopsy-scoreline">
            <span>
              <small>Primera linea</small>
              <strong>{originalSignal}%</strong>
              <em>al resultado real</em>
            </span>
            <span>
              <small>Mejor contrato</small>
              <strong>{bestSignal}%</strong>
              <em>{best?.contract ?? autopsy.best_model}</em>
            </span>
            <span>
              <small>Mejora</small>
              <strong>{lift != null && lift >= 0 ? "+" : ""}{lift ?? 0} pts</strong>
              <em>calibracion posterior</em>
            </span>
          </div>
          <h4>{autopsy.headline}</h4>
          <p>{autopsy.lesson}</p>
          <div className="autopsy-candidates">
            {candidates.slice(0, 4).map((candidate) => (
              <span key={candidate.contract}>
                <strong>{candidate.contract}</strong>
                <b>{Math.round(candidate.probability_for_real_outcome * 1000) / 10}%</b>
                <small>
                  {Math.round(candidate.home_win * 100)} L / {Math.round(candidate.draw * 100)} E / {Math.round(candidate.away_win * 100)} V
                </small>
              </span>
            ))}
          </div>
          <label className="suggested-copy autopsy-copy">
            <span>Copy sugerido</span>
            <textarea readOnly value={autopsy.share_copy} />
          </label>
          <div className="autopsy-actions">
            <button onClick={copyAutopsy} type="button">Copiar copy</button>
            <a href={kitHref}>Autopsia + kit</a>
            <a href={diaryHref}>Ver modelo</a>
            <a href={`/simulador-partido/?match=${detail.match.slug}`}>Ver replay 3D</a>
          </div>
        </>
      )}
      <small>Automatico: resultados verificados, cola de autopsias y diario del modelo.</small>
      {params?.no_leakage_rule && <small>{params.no_leakage_rule}</small>}
    </article>
  );
}

function MatchClosedInsightPanel({
  autopsies,
  detail,
}: {
  autopsies: ModelAutopsy[];
  detail: MatchDetail;
}) {
  const outcome = finishedOutcome(detail);
  const autopsy = autopsies.find((item) => item.best_parameters_json.includes("calibrated_autopsy")) ?? autopsies[0] ?? null;
  const params = autopsyParameters(autopsy);
  const best = params?.best_contract;
  const bestLabel = best?.contract ?? autopsy?.best_model ?? "modelo pendiente";
  const probability = best?.probability_for_real_outcome ?? (autopsy ? 1 - autopsy.best_error : null);
  const lift = params?.outcome_probability_lift;

  if (!outcome && !autopsy) return null;

  return (
    <section className="match-closed-insight">
      <div>
        <p className="section-kicker">{outcome ? "Autopsia del marcador" : "Autopsia en cola"}</p>
        <h2>
          {autopsy
            ? autopsy.headline
            : `Cuando cierre ${detail.match.home_team} vs ${detail.match.away_team}, el laboratorio audita la lectura.`}
        </h2>
        <p>
          {autopsy
            ? autopsy.lesson
            : "El scheduler toma el resultado verificado, compara contratos de modelo y publica que lectura hubiera pesado mas sin cambiar el pasado."}
        </p>
      </div>
      <div className="match-closed-stats">
        <span>
          <small>Resultado</small>
          <strong>{detail.match.home_score}-{detail.match.away_score}</strong>
        </span>
        <span>
          <small>Mejor lectura</small>
          <strong>{bestLabel}</strong>
        </span>
        <span>
          <small>Prob. real</small>
          <strong>{probability == null ? "pend." : `${Math.round(probability * 1000) / 10}%`}</strong>
        </span>
        <span>
          <small>Aprendizaje</small>
          <strong>{lift == null ? "en cola" : `${lift >= 0 ? "+" : ""}${Math.round(lift * 1000) / 10} pts`}</strong>
        </span>
      </div>
      <div className="match-closed-actions">
        <a href={`/diario-aprendizaje/?match=${detail.match.slug}&kit=1`}>
          <BrainCircuit size={17} />
          Ver autopsia completa
        </a>
        <a href={`/simulador-partido/?match=${detail.match.slug}`}>
          <PlayCircle size={17} />
          Replay narrado
        </a>
      </div>
    </section>
  );
}

function MatchDirectorRankingPanel({ detail }: { detail: MatchDetail }) {
  const outcome = finishedOutcome(detail);
  const ranked = [...detail.predictions]
    .sort((a, b) => outcomeProbability(b, outcome) - outcomeProbability(a, outcome))
    .slice(0, 6);

  return (
    <article className="live-panel match-director-ranking">
      <div className="workflow-title">
        <Trophy />
        <h3>Data Directors del partido</h3>
      </div>
      <p>
        {outcome
          ? "Ranking contra el resultado real: gana quien le dio mas probabilidad al desenlace que si ocurrio."
          : "Ranking vivo: mientras no cierre el partido, se ordena por claridad de postura y se reevalua al silbatazo final."}
      </p>
      {ranked.length === 0 ? (
        <div className="ranking-empty">
          <strong>Aun nadie firmo lectura.</strong>
          <span>Guarda tu prediccion con alias y entra al tablero del partido.</span>
        </div>
      ) : (
        <ol>
          {ranked.map((item, index) => {
            const side = predictedSide(item, detail);
            const score = outcomeProbability(item, outcome);
            return (
              <li key={`${item.id ?? index}-${item.director_name}`}>
                <b>#{index + 1}</b>
                <span>
                  <strong>{item.director_name}</strong>
                  <small>{item.model} - {directorTag(item, outcome)}</small>
                </span>
                <em>{side.label}</em>
                <i>{Math.round(score * 100)} pts</i>
              </li>
            );
          })}
        </ol>
      )}
      <a className="ranking-full-link" href="/directores/">Ver ranking global</a>
    </article>
  );
}

function clampMetric(value: number) {
  return Math.min(1, Math.max(0, value));
}

function roleFromPosition(position?: string | null): PlayerRole {
  const value = (position ?? "").toLowerCase();
  if (value.includes("goalkeeper")) return "portero";
  if (value.includes("defender") || value.includes("back")) return "central";
  if (value.includes("defensive")) return "contencion";
  if (value.includes("midfielder")) return value.includes("left") || value.includes("right") ? "extremo" : "creativo";
  if (value.includes("forward") || value.includes("striker")) return "delantero";
  return "creativo";
}

function impactTemplate(role: PlayerRole) {
  const templates: Record<PlayerRole, Omit<ImpactPlayer, "id" | "team_id" | "name" | "status" | "source">> = {
    portero: { role, attack: 0.08, defense: 0.74, creation: 0.12, pressure: 0.22, goalkeeping: 0.92, stamina: 0.82 },
    central: { role, attack: 0.22, defense: 0.84, creation: 0.24, pressure: 0.58, goalkeeping: 0, stamina: 0.78 },
    contencion: { role, attack: 0.36, defense: 0.72, creation: 0.5, pressure: 0.82, goalkeeping: 0, stamina: 0.84 },
    creativo: { role, attack: 0.58, defense: 0.34, creation: 0.88, pressure: 0.5, goalkeeping: 0, stamina: 0.76 },
    extremo: { role, attack: 0.78, defense: 0.28, creation: 0.66, pressure: 0.64, goalkeeping: 0, stamina: 0.72 },
    delantero: { role, attack: 0.9, defense: 0.18, creation: 0.42, pressure: 0.46, goalkeeping: 0, stamina: 0.7 },
  };
  return templates[role];
}

function lineupImpactPlayers(data: MatchData | null): ImpactPlayer[] {
  const starters = (data?.lineups ?? []).filter((player) => Boolean(player.starter));
  if (!starters.length) return [];

  return starters.map((player) => {
    const role = roleFromPosition(player.position);
    const template = impactTemplate(role);
    const jerseySignal = Number.parseInt(player.jersey || "0", 10) || 0;
    const modifier = (jerseySignal % 7) / 100;

    return {
      ...template,
      id: `${player.match_id}-${player.team_id}-${player.source_player_id}`,
      team_id: player.team_id,
      name: player.jersey ? `${player.jersey} · ${player.player_name}` : player.player_name,
      attack: clampMetric(template.attack + modifier),
      defense: clampMetric(template.defense + modifier / 2),
      creation: clampMetric(template.creation + modifier),
      pressure: clampMetric(template.pressure + modifier / 2),
      stamina: clampMetric(template.stamina - modifier / 2),
      status: "titular",
      source: "publico",
    };
  });
}

function MatchScoreHeader({
  detail,
  mode,
}: {
  detail: MatchDetail;
  mode: string;
}) {
  const { match } = detail;

  return (
    <div className={`match-scoreboard ${matchMomentTone(match)}`}>
      <div className="scoreboard-meta">
        <span className={`match-status ${match.status}`}>
          <Radio size={15} />
          {mode}
        </span>
        <span>Partido {match.match_number}</span>
        <span>{match.stage}</span>
        <span>{match.result_trust_level === "real_verificado" ? "resultado verificado" : match.result_trust_level === "publico_ingestado" ? "ingestado por automatizacion" : "sin cierre real"}</span>
      </div>
      <div className="scoreboard-teams">
        <div className="scoreboard-team">
          <b>{teamFlag(match.home_team_id)}</b>
          <strong>{match.home_team}</strong>
        </div>
        <div className="scoreboard-score">
          <strong>{match.home_score}</strong>
          <span>-</span>
          <strong>{match.away_score}</strong>
        </div>
        <div className="scoreboard-team away">
          <b>{teamFlag(match.away_team_id)}</b>
          <strong>{match.away_team}</strong>
        </div>
      </div>
      <div className="scoreboard-context">
        <span>{matchMomentLabel(match)}</span>
        <span>{match.local_time_label}</span>
        <span>{match.venue}, {match.city}</span>
      </div>
    </div>
  );
}

function poissonMass(k: number, lambda: number) {
  let factorial = 1;
  for (let index = 2; index <= k; index += 1) factorial *= index;
  return (Math.exp(-lambda) * lambda ** k) / factorial;
}

function scoreMatrix(homeLambda: number, awayLambda: number, dixonBoost = 0) {
  return Array.from({ length: 36 }, (_, index) => {
    const home = Math.floor(index / 6);
    const away = index % 6;
    const lowScore = home <= 1 && away <= 1;
    const raw = poissonMass(home, homeLambda) * poissonMass(away, awayLambda);
    return {
      score: `${home}-${away}`,
      home,
      away,
      probability: raw * (lowScore ? 1 + dixonBoost : 1),
    };
  });
}

function MiniHeatmap({
  title,
  homeLambda,
  awayLambda,
  dixonBoost = 0,
}: {
  title: string;
  homeLambda: number;
  awayLambda: number;
  dixonBoost?: number;
}) {
  const matrix = scoreMatrix(homeLambda, awayLambda, dixonBoost);
  const max = Math.max(...matrix.map((cell) => cell.probability));

  return (
    <div className="science-card">
      <div className="science-title">
        <strong>{title}</strong>
        <small>Marcador 0-0 a 5-5</small>
      </div>
      <div className="heatmap-grid" role="img" aria-label={title}>
        {matrix.map((cell) => (
          <span
            key={cell.score}
            style={{ backgroundColor: `rgba(13, 135, 107, ${0.12 + (cell.probability / max) * 0.82})` }}
            title={`${cell.score}: ${Math.round(cell.probability * 100)}%`}
          >
            {cell.score}
          </span>
        ))}
      </div>
    </div>
  );
}

function EloCurve({ controls, prediction }: { controls: OperationalControls; prediction: OperationalPrediction }) {
  const points = Array.from({ length: 17 }, (_, index) => {
    const delta = -400 + index * 50;
    const probability = 1 / (1 + 10 ** (-delta / 400));
    return `${20 + index * 20},${150 - probability * 120}`;
  }).join(" ");
  const currentX = 180 + (prediction.home_win - prediction.away_win) * 160;

  return (
    <div className="science-card">
      <div className="science-title">
        <strong>Curva logística Elo</strong>
        <small>K={Math.round(controls.elo_k)} · forma {Math.round(controls.form_weight * 100)}%</small>
      </div>
      <svg className="science-svg" viewBox="0 0 360 170" role="img" aria-label="Curva logística Elo">
        <line x1="20" x2="340" y1="150" y2="150" />
        <line x1="20" x2="20" y1="20" y2="150" />
        <polyline points={points} />
        <circle cx={Math.max(28, Math.min(332, currentX))} cy={150 - prediction.home_win * 120} r="6" />
        <text x="22" y="18">P(local)</text>
        <text x="264" y="164">rating delta</text>
      </svg>
    </div>
  );
}

function BayesPosteriorChart({ controls, prediction }: { controls: OperationalControls; prediction: OperationalPrediction }) {
  const priorHome = prediction.home_win * controls.prior_strength;
  const posteriorHome = prediction.home_win;
  const evidence = controls.evidence_weight;

  return (
    <div className="science-card">
      <div className="science-title">
        <strong>Prior vs posterior</strong>
        <small>evidencia {Math.round(evidence * 100)}% · xG {controls.xg_signal.toFixed(2)}</small>
      </div>
      <div className="posterior-bars">
        <label>
          <span>Prior local</span>
          <i style={{ width: `${Math.round(priorHome * 100)}%` }} />
          <b>{Math.round(priorHome * 100)}%</b>
        </label>
        <label>
          <span>Posterior local</span>
          <i style={{ width: `${Math.round(posteriorHome * 100)}%` }} />
          <b>{Math.round(posteriorHome * 100)}%</b>
        </label>
        <label>
          <span>Incertidumbre</span>
          <i style={{ width: `${Math.round((1 - evidence) * 100)}%` }} />
          <b>{Math.round((1 - evidence) * 100)}%</b>
        </label>
      </div>
    </div>
  );
}

function EnsembleWeightsChart({ prediction }: { prediction: OperationalPrediction }) {
  return (
    <div className="science-card">
      <div className="science-title">
        <strong>Pesos y desacuerdo</strong>
        <small>Mezcla activa del comité</small>
      </div>
      <div className="ensemble-bars">
        {prediction.traces.map((trace) => (
          <label key={trace.label}>
            <span>{trace.label}</span>
            <i style={{ width: `${Math.round(trace.value * 100)}%` }} />
            <b>{Math.round(trace.value * 100)}%</b>
          </label>
        ))}
      </div>
    </div>
  );
}

function SensitivityChart({
  activeModel,
  controls,
  detail,
  stadium,
  homeImpact,
  awayImpact,
  baseHomeWin,
}: {
  activeModel: ModelName;
  controls: OperationalControls;
  detail: MatchDetail;
  stadium: StadiumContext;
  homeImpact: TeamImpact;
  awayImpact: TeamImpact;
  baseHomeWin: number;
}) {
  const sensitivity = controlConfig[activeModel].slice(0, 4).map((control) => {
    const range = control.max - control.min;
    const shifted = {
      ...controls,
      [control.key]: Math.min(control.max, Number(controls[control.key]) + range * 0.12),
    };
    const next = predictOperationalModel(activeModel, detail.match, stadium, homeImpact, awayImpact, shifted);
    return {
      label: control.label,
      value: Math.min(1, Math.abs(next.home_win - baseHomeWin) * 6),
      direction: next.home_win >= baseHomeWin ? "+" : "-",
    };
  });

  return (
    <div className="science-card">
      <div className="science-title">
        <strong>Sensibilidad local</strong>
        <small>Cambio relativo en P(local)</small>
      </div>
      <div className="sensitivity-bars">
        {sensitivity.map((item) => (
          <label key={item.label}>
            <span>{item.direction} {item.label}</span>
            <i style={{ width: `${Math.round(item.value * 100)}%` }} />
          </label>
        ))}
      </div>
    </div>
  );
}

function ModelScienceCharts({
  activeModel,
  controls,
  prediction,
  detail,
  stadium,
  homeImpact,
  awayImpact,
}: {
  activeModel: ModelName;
  controls: OperationalControls;
  prediction: OperationalPrediction;
  detail: MatchDetail;
  stadium: StadiumContext;
  homeImpact: TeamImpact;
  awayImpact: TeamImpact;
}) {
  return (
    <article className="live-panel science-panel">
      <div className="science-header">
        <h3>Gráficas del modelo</h3>
        <span>{fallbackModels.find((model) => model.id === activeModel)?.short_name}</span>
      </div>
      <div className="science-grid">
        {activeModel === "elo" ? (
          <EloCurve controls={controls} prediction={prediction} />
        ) : activeModel === "bayes_live" ? (
          <BayesPosteriorChart controls={controls} prediction={prediction} />
        ) : activeModel === "ensemble" ? (
          <EnsembleWeightsChart prediction={prediction} />
        ) : (
          <MiniHeatmap
            dixonBoost={activeModel === "dixon_coles" ? controls.low_score_correlation * 2 : 0}
            homeLambda={prediction.home_lambda}
            awayLambda={prediction.away_lambda}
            title={activeModel === "dixon_coles" ? "Heatmap Dixon-Coles" : "Heatmap Poisson"}
          />
        )}
        <SensitivityChart
          activeModel={activeModel}
          baseHomeWin={prediction.home_win}
          controls={controls}
          detail={detail}
          homeImpact={homeImpact}
          awayImpact={awayImpact}
          stadium={stadium}
        />
      </div>
    </article>
  );
}

const controlConfig: Record<
  ModelName,
  { key: keyof OperationalControls; label: string; min: number; max: number; step: number }[]
> = {
  poisson: [
    { key: "attack_bias", label: "Sesgo ataque local", min: -0.2, max: 0.25, step: 0.01 },
    { key: "defense_bias", label: "Sesgo defensa visitante", min: -0.2, max: 0.25, step: 0.01 },
    { key: "tempo_bias", label: "Ritmo esperado", min: -0.2, max: 0.25, step: 0.01 },
    { key: "venue_edge", label: "Ventaja de sede", min: 0, max: 0.22, step: 0.01 },
  ],
  elo: [
    { key: "elo_k", label: "K-factor", min: 8, max: 64, step: 1 },
    { key: "form_weight", label: "Peso forma reciente", min: 0, max: 1, step: 0.01 },
    { key: "venue_edge", label: "Ventaja de sede", min: 0, max: 0.22, step: 0.01 },
  ],
  dixon_coles: [
    { key: "low_score_correlation", label: "Correlación marcador bajo", min: 0, max: 0.35, step: 0.01 },
    { key: "recency_decay", label: "Decaimiento temporal", min: 0.15, max: 1, step: 0.01 },
    { key: "tempo_bias", label: "Ritmo esperado", min: -0.2, max: 0.2, step: 0.01 },
  ],
  bayes_live: [
    { key: "prior_strength", label: "Fuerza del prior", min: 0.1, max: 0.95, step: 0.01 },
    { key: "evidence_weight", label: "Peso de evidencia viva", min: 0.05, max: 0.95, step: 0.01 },
    { key: "xg_signal", label: "Señal xG local-visita", min: -1, max: 1, step: 0.01 },
  ],
  ensemble: [
    { key: "poisson_weight", label: "Peso Poisson", min: 0, max: 1, step: 0.01 },
    { key: "elo_weight", label: "Peso Elo", min: 0, max: 1, step: 0.01 },
    { key: "dixon_weight", label: "Peso Dixon-Coles", min: 0, max: 1, step: 0.01 },
    { key: "bayes_weight", label: "Peso Bayes", min: 0, max: 1, step: 0.01 },
    { key: "calibration", label: "Temperatura", min: 0.55, max: 1.6, step: 0.01 },
  ],
};

const modelUseCases: Record<ModelName, { short: string; when: string; warning: string }> = {
  poisson: {
    short: "Goles esperados y marcadores probables.",
    when: "Antes del partido, si tienes ataque, defensa, tiros o xG para estimar volumen de gol.",
    warning: "Se puede pasar de optimista si el partido se cierra tacticamente.",
  },
  elo: {
    short: "Jerarquia historica y fuerza base.",
    when: "Antes del kickoff, cuando necesitas una linea sobria aunque falten datos finos.",
    warning: "Puede llegar viejo si la plantilla, forma o contexto cambiaron fuerte.",
  },
  dixon_coles: {
    short: "Partidos cerrados, empates y marcadores bajos.",
    when: "Cuando Poisson huele a mucho gol pero el partido pide cautela.",
    warning: "Si exageras rho, ve empates por todos lados.",
  },
  bayes_live: {
    short: "Actualizar creencias con evidencia viva.",
    when: "Durante el partido, con tiros, xG, tarjetas, momentum o cambios claros.",
    warning: "Con evidencia ruidosa sobrerreacciona.",
  },
  ensemble: {
    short: "Comite de modelos para no casarte con una sola lectura.",
    when: "Cuando hay senales mezcladas o quieres una postura robusta.",
    warning: "Puede esconder errores si todos los modelos comparten el mismo sesgo.",
  },
};

function recommendModelForMatch(
  detail: MatchDetail,
  data: MatchData | null,
  evidenceSignal: number,
  allPredictions: Array<{ model: ModelName; prediction: OperationalPrediction }>,
) {
  const hasLiveEvidence = Boolean(data?.shots.length || data?.features?.home_shots || data?.features?.away_shots);
  const hasXg = data?.features?.home_xg != null || data?.shots.some((shot) => shot.xg != null);
  const ensemble = allPredictions.find((item) => item.model === "ensemble")?.prediction;
  const poisson = allPredictions.find((item) => item.model === "poisson")?.prediction;
  const dixon = allPredictions.find((item) => item.model === "dixon_coles")?.prediction;
  const expectedGoals = poisson?.expected_goals ?? 2.4;
  const dixonDrawLift = dixon && poisson ? dixon.draw - poisson.draw : 0;

  if (detail.match.status === "finished") {
    return {
      model: "ensemble" as ModelName,
      reason: "El partido ya cerro. Conviene comparar familias y preparar autopsia, no operar una sola voz.",
    };
  }
  if (detail.match.status === "live" && hasLiveEvidence && Math.abs(evidenceSignal) > 0.08) {
    return {
      model: "bayes_live" as ModelName,
      reason: "Ya hay evidencia viva moviendo la cancha. Bayes es el modelo para cambiar de opinion con disciplina.",
    };
  }
  if (expectedGoals < 2.25 || dixonDrawLift > 0.025) {
    return {
      model: "dixon_coles" as ModelName,
      reason: "La lectura huele a partido cerrado. Dixon-Coles escucha mejor empates y marcadores bajos.",
    };
  }
  if (hasXg || hasLiveEvidence) {
    return {
      model: "poisson" as ModelName,
      reason: "Hay senales de tiros/gol para hablar de volumen y marcador. Poisson es la base mas transparente.",
    };
  }
  if (ensemble && Math.max(ensemble.home_win, ensemble.draw, ensemble.away_win) < 0.48) {
    return {
      model: "ensemble" as ModelName,
      reason: "La confianza esta abierta. El ensamble ayuda a no vender seguridad cuando los modelos no gritan.",
    };
  }
  return {
    model: "elo" as ModelName,
    reason: "Faltan datos finos: empieza con jerarquia y fuerza base antes de mover controles delicados.",
  };
}

function ModelControlPanel({
  activeModel,
  controls,
  data,
  detail,
  evidenceSignal,
  awayImpact,
  homeImpact,
  onModelChange,
  onControlChange,
  prediction,
  stadium,
}: {
  activeModel: ModelName;
  controls: OperationalControls;
  data: MatchData | null;
  detail: MatchDetail;
  evidenceSignal: number;
  awayImpact: TeamImpact;
  homeImpact: TeamImpact;
  onModelChange: (model: ModelName) => void;
  onControlChange: (key: keyof OperationalControls, value: number) => void;
  prediction: OperationalPrediction;
  stadium: StadiumContext;
}) {
  const model = fallbackModels.find((item) => item.id === activeModel);
  const [operatorMode, setOperatorMode] = useState<"director" | "cientifico">("director");
  const [uploadMessage, setUploadMessage] = useState("Sube un JSON o CSV con el formato oficial.");
  const [uploadState, setUploadState] = useState<"idle" | "ok" | "error">("idle");
  const activeControls = controlConfig[activeModel];
  const modelComparisons = useMemo(
    () => fallbackModels.map((item) => ({
      model: item.id,
      label: item.short_name,
      prediction: predictOperationalModel(item.id, detail.match, stadium, homeImpact, awayImpact, controls),
    })),
    [detail.match, stadium, homeImpact, awayImpact, controls],
  );
  const recommended = useMemo(
    () => recommendModelForMatch(detail, data, evidenceSignal, modelComparisons),
    [detail, data, evidenceSignal, modelComparisons],
  );
  const recommendedMeta = fallbackModels.find((item) => item.id === recommended.model);
  const runManifest = {
    model: activeModel,
    mode: operatorMode,
    seed: `${activeModel}-match-live-001`,
    data_window: "ultimos_24_meses",
    data_sources: [
      { name: "matches_seed", kind: "fixture", maturity: "estructurado" },
      { name: "teams_seed", kind: "rating/attack/defense", maturity: "seed" },
      { name: "stadium_context", kind: "altitud/humedad/temperatura", maturity: "derivado" },
      { name: "impact_players", kind: "jugadores/estado", maturity: "simulado" },
      { name: "live_features", kind: "xG/eventos/minuto", maturity: "pendiente_admin" },
    ],
    simulation_runs: activeModel === "ensemble" ? 25000 : 10000,
    controls: activeControls.reduce<Record<string, number>>((acc, control) => {
      acc[control.key] = Number(controls[control.key].toFixed(control.step >= 1 ? 0 : 3));
      return acc;
    }, {}),
  };

  const sampleSubmission = {
    alias: "MiAliasData",
    match_id: detail.match.id,
    model: activeModel,
    minute: detail.match.minute,
    home_win: Number(prediction.home_win.toFixed(4)),
    draw: Number(prediction.draw.toFixed(4)),
    away_win: Number(prediction.away_win.toFixed(4)),
    notes: "Modelo entrenado en notebook externo. Version v1.",
  };

  const downloadDataPackage = () => {
    const payload = {
      package_version: "mundial-lab-match-v1",
      match: detail.match,
      events: detail.events,
      active_model: activeModel,
      baseline_prediction: prediction,
      stadium,
      home_impact: homeImpact,
      required_submission_schema: {
        alias: "string, 3 a 32 caracteres",
        match_id: `debe ser ${detail.match.id}`,
        model: "elo | poisson | dixon_coles | bayes_live | ensemble",
        minute: "entero 0 a 130",
        home_win: "numero 0 a 1",
        draw: "numero 0 a 1",
        away_win: "numero 0 a 1",
        notes: "string opcional",
      },
      sample_submission: sampleSubmission,
      csv_header: "alias,match_id,model,minute,home_win,draw,away_win,notes",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${detail.match.slug}-data-package.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const parseSubmission = (text: string) => {
    if (text.trim().startsWith("{")) return JSON.parse(text);
    const [headerLine, valueLine] = text.trim().split(/\r?\n/);
    const headers = headerLine.split(",").map((item) => item.trim());
    const values = valueLine.split(",").map((item) => item.trim());
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = values[index] ?? "";
      return acc;
    }, {});
  };

  const validateSubmission = (raw: Record<string, unknown>) => {
    const submitted = {
      alias: String(raw.alias ?? "").trim(),
      match_id: String(raw.match_id ?? "").trim(),
      model: String(raw.model ?? "").trim() as ModelName,
      minute: Number(raw.minute),
      home_win: Number(raw.home_win),
      draw: Number(raw.draw),
      away_win: Number(raw.away_win),
      notes: String(raw.notes ?? ""),
    };
    const errors: string[] = [];
    if (submitted.alias.length < 3 || submitted.alias.length > 32) errors.push("alias debe tener 3 a 32 caracteres");
    if (submitted.match_id !== detail.match.id && submitted.match_id !== detail.match.slug) errors.push(`match_id debe ser ${detail.match.id}`);
    if (!fallbackModels.some((item) => item.id === submitted.model)) errors.push("model no existe en el catalogo");
    if (!Number.isInteger(submitted.minute) || submitted.minute < 0 || submitted.minute > 130) errors.push("minute debe ser entero 0 a 130");
    [submitted.home_win, submitted.draw, submitted.away_win].forEach((value, index) => {
      if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(["home_win", "draw", "away_win"][index] + " debe estar entre 0 y 1");
    });
    if (Math.abs(submitted.home_win + submitted.draw + submitted.away_win - 1) > 0.02) errors.push("home_win + draw + away_win debe sumar 1.00");
    if (errors.length) throw new Error(errors.join("; "));
    return submitted;
  };

  const uploadSubmission = async (file: File | null) => {
    if (!file) return;
    setUploadState("idle");
    setUploadMessage("Validando archivo...");
    try {
      const submitted = validateSubmission(parseSubmission(await file.text()));
      const director = await registerAlias(submitted.alias);
      await createPrediction(detail.match.id, {
        ...submitted,
        director_name: director.alias,
        match_id: detail.match.id,
        notes: JSON.stringify({ source: "notebook_upload", file: file.name, notes: submitted.notes }),
      });
      setUploadState("ok");
      setUploadMessage(`Archivo valido. Lectura guardada para ${director.alias}.`);
    } catch (error) {
      setUploadState("error");
      setUploadMessage(error instanceof Error ? error.message : "Formato invalido.");
    }
  };

  return (
    <article className="live-panel model-ops-panel">
      <div className="workflow-title">
        <BrainCircuit />
        <h3>Banco de modelos</h3>
      </div>
      <p>{model?.question}</p>
      <div className="model-advisor">
        <div className="advisor-head">
          <div>
            <small>Modelo sugerido para este contexto</small>
            <strong>{recommendedMeta?.short_name ?? recommended.model}</strong>
            <p>{recommended.reason}</p>
          </div>
          <button
            disabled={activeModel === recommended.model}
            onClick={() => onModelChange(recommended.model)}
            type="button"
          >
            {activeModel === recommended.model ? "Ya esta activo" : "Usar sugerido"}
          </button>
        </div>
        <div className="advisor-model-grid">
          {modelComparisons.map((item) => {
            const favorite =
              item.prediction.home_win >= item.prediction.draw && item.prediction.home_win >= item.prediction.away_win
                ? detail.match.home_team
                : item.prediction.away_win >= item.prediction.draw
                  ? detail.match.away_team
                  : "Empate";
            const confidence = Math.max(item.prediction.home_win, item.prediction.draw, item.prediction.away_win);
            const useCase = modelUseCases[item.model];
            return (
              <button
                className={`${activeModel === item.model ? "active" : ""} ${recommended.model === item.model ? "recommended" : ""}`}
                key={`advisor-${item.model}`}
                onClick={() => onModelChange(item.model)}
                type="button"
              >
                <span>
                  <strong>{item.label}</strong>
                  {recommended.model === item.model && <em>sugerido</em>}
                </span>
                <b>{favorite}</b>
                <small>{Math.round(confidence * 100)}% confianza · xG {item.prediction.expected_goals.toFixed(2)}</small>
                <i>{useCase.short}</i>
              </button>
            );
          })}
        </div>
        <div className="advisor-use-case">
          <span>
            <strong>Cuando usar {model?.short_name}</strong>
            {modelUseCases[activeModel].when}
          </span>
          <span>
            <strong>Alerta</strong>
            {modelUseCases[activeModel].warning}
          </span>
        </div>
      </div>
      <div className="model-tabs" role="tablist" aria-label="Modelos operables">
        {fallbackModels.map((model) => (
          <button
            className={activeModel === model.id ? "active" : ""}
            key={model.id}
            onClick={() => onModelChange(model.id)}
            type="button"
          >
            {model.short_name}
          </button>
        ))}
      </div>
      <a className="knowledge-link" href={`/modelos/${activeModel}/`}>
        <BookOpen size={17} />
        Abrir casa de conocimiento
      </a>
      <div className="mode-switch dark" aria-label="Modo de operacion">
        <button className={operatorMode === "director" ? "active" : ""} onClick={() => setOperatorMode("director")} type="button">
          Director
        </button>
        <button className={operatorMode === "cientifico" ? "active" : ""} onClick={() => setOperatorMode("cientifico")} type="button">
          Cientifico
        </button>
      </div>
      {operatorMode === "director" ? (
        <div className="technical-controls">
          {activeControls.map((control) => (
            <label key={control.key}>
              <span>
                {control.label}
                <strong>{controls[control.key].toFixed(control.step >= 1 ? 0 : 2)}</strong>
              </span>
              <input
                max={control.max}
                min={control.min}
                onChange={(event) => onControlChange(control.key, Number(event.target.value))}
                step={control.step}
                type="range"
                value={controls[control.key]}
              />
            </label>
          ))}
        </div>
      ) : (
        <div className="notebook-upload">
          <div className="notebook-head">
            <FileJson />
            <div>
              <strong>Flujo científico: notebook externo</strong>
              <small>Descarga datos, corre tu modelo afuera y sube una predicción validable.</small>
            </div>
          </div>
          <button className="notebook-action" onClick={downloadDataPackage} type="button">
            <Download size={16} />
            Descargar paquete de datos
          </button>
          <label className="upload-box">
            <Upload size={17} />
            <span>Subir predicción JSON o CSV</span>
            <input accept=".json,.csv,text/csv,application/json" onChange={(event) => uploadSubmission(event.target.files?.[0] ?? null)} type="file" />
          </label>
          <div className={`upload-message ${uploadState}`}>
            {uploadState === "ok" ? <CheckCircle2 size={16} /> : uploadState === "error" ? <AlertTriangle size={16} /> : <Beaker size={16} />}
            <span>{uploadMessage}</span>
          </div>
          <div className="schema-card">
            <strong>Formato requerido</strong>
            <code>alias,match_id,model,minute,home_win,draw,away_win,notes</code>
            <small>Las probabilidades deben estar entre 0 y 1 y sumar 1.00.</small>
          </div>
        </div>
      )}
      <div className="model-operation-note">
        <strong>Operación</strong>
        <span>{model?.student_takeaway}</span>
      </div>
      {operatorMode === "cientifico" && (
        <div className="scientist-lab">
          <div className="manifest-card">
            <div>
              <FileJson />
              <strong>Manifiesto para reproducir</strong>
            </div>
            <pre>{JSON.stringify(runManifest, null, 2)}</pre>
          </div>
          <div className="model-operation-note">
            <Beaker size={17} />
            <span>La validacion automatica revisa formato, partido, modelo, minuto y suma de probabilidades antes de guardar.</span>
          </div>
        </div>
      )}
    </article>
  );
}

function StadiumScene({
  detail,
  homeImpact,
  awayImpact,
}: {
  detail: MatchDetail;
  homeImpact: TeamImpact;
  awayImpact: TeamImpact;
}) {
  const homePlayers = [
    ["14%", "50%"],
    ["25%", "28%"],
    ["30%", "70%"],
    ["42%", "42%"],
    ["48%", "62%"],
    ["55%", "50%"],
  ];
  const awayPlayers = [
    ["86%", "50%"],
    ["75%", "30%"],
    ["70%", "70%"],
    ["58%", "42%"],
    ["52%", "62%"],
    ["45%", "50%"],
  ];

  return (
    <div className="stadium-scene" aria-label="Estadio y jugadores de impacto">
      <div className="stadium-meta">
        <span>{detail.match.venue}</span>
        <strong>{detail.match.city}</strong>
      </div>
      <div className="pitch">
        <div className="midline" />
        <div className="center-circle" />
        {homePlayers.map(([left, top], index) => (
          <span
            className="player-dot home-dot"
            key={`home-${left}-${top}`}
            style={{ left, top, opacity: 0.62 + homeImpact.attack * 0.34 + index * 0.005 }}
          />
        ))}
        {awayPlayers.map(([left, top], index) => (
          <span
            className="player-dot away-dot"
            key={`away-${left}-${top}`}
            style={{ left, top, opacity: 0.62 + awayImpact.attack * 0.34 + index * 0.005 }}
          />
        ))}
      </div>
    </div>
  );
}

function PlayerImpactPanel({
  title,
  flag,
  players,
  onStatusChange,
}: {
  title: string;
  flag: string;
  players: ImpactPlayer[];
  onStatusChange: (playerId: string, status: PlayerStatus) => void;
}) {
  const realLineup = players.some((player) => player.source === "publico");

  return (
    <article className="live-panel player-impact-panel">
      <div className="workflow-title">
        <UsersRound />
        <h3><span className="panel-flag">{flag}</span>{title}</h3>
      </div>
      <p>
        {realLineup
          ? "Titulares reales detectados por fuente publica. Cada estado modifica ataque, defensa, ritmo o volatilidad del modelo."
          : "Datos simulados para prototipo. Cada estado modifica ataque, defensa, ritmo o volatilidad del Poisson de impacto."}
      </p>
      <div className="player-list">
        {players.map((player) => (
          <label className="player-card" key={player.id}>
            <span>
              <strong>{player.name}</strong>
              <small>{player.role}</small>
            </span>
            <div className="player-metrics">
              <i style={{ width: `${Math.round(player.attack * 100)}%` }} />
              <i style={{ width: `${Math.round(player.defense * 100)}%` }} />
            </div>
            <select value={player.status} onChange={(event) => onStatusChange(player.id, event.target.value as PlayerStatus)}>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </article>
  );
}

const controlLabels: Record<keyof OperationalControls, string> = {
  attack_bias: "Ataque",
  defense_bias: "Defensa",
  tempo_bias: "Ritmo",
  venue_edge: "Estadio",
  elo_k: "Elo K",
  form_weight: "Forma",
  low_score_correlation: "Marcador corto",
  recency_decay: "Recencia",
  prior_strength: "Prior",
  evidence_weight: "Evidencia",
  xg_signal: "xG",
  poisson_weight: "Poisson",
  elo_weight: "Elo",
  dixon_weight: "Dixon-Coles",
  bayes_weight: "Bayes",
  calibration: "Calibracion",
};

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function topControlMoves(controls: OperationalControls) {
  return (Object.entries(controls) as Array<[keyof OperationalControls, number]>)
    .map(([key, value]) => ({ key, value, delta: Math.abs(value - defaultOperationalControls[key]) }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 6);
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo generar la imagen."));
    }, "image/png", 0.96);
  });
}

function drawWrappedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  let currentY = y;
  for (const word of words) {
    const testLine = `${line}${word} `;
    if (context.measureText(testLine).width > maxWidth && line) {
      context.fillText(line.trim(), x, currentY);
      line = `${word} `;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) context.fillText(line.trim(), x, currentY);
  return currentY;
}

function generatePredictionShareCanvas({
  alias,
  detail,
  activeModel,
  prediction,
  controls,
  favorite,
  shareUrl,
}: {
  alias: string;
  detail: MatchDetail;
  activeModel: ModelName;
  prediction: OperationalPrediction;
  controls: OperationalControls;
  favorite: string;
  shareUrl: string;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas no disponible.");

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#061416");
  gradient.addColorStop(0.42, "#0b3b35");
  gradient.addColorStop(1, "#101820");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const glow = context.createRadialGradient(820, 230, 10, 820, 230, 580);
  glow.addColorStop(0, "rgba(126, 226, 168, 0.58)");
  glow.addColorStop(0.4, "rgba(14, 165, 156, 0.24)");
  glow.addColorStop(1, "rgba(14, 165, 156, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.translate(95, 515);
  context.rotate(-0.05);
  context.fillStyle = "rgba(126, 226, 168, 0.12)";
  context.strokeStyle = "rgba(214, 255, 235, 0.48)";
  context.lineWidth = 5;
  context.beginPath();
  context.roundRect(0, 0, 890, 470, 26);
  context.fill();
  context.stroke();
  context.strokeStyle = "rgba(214, 255, 235, 0.32)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(445, 0);
  context.lineTo(445, 470);
  context.stroke();
  context.beginPath();
  context.arc(445, 235, 72, 0, Math.PI * 2);
  context.stroke();
  context.strokeRect(0, 125, 118, 220);
  context.strokeRect(772, 125, 118, 220);
  context.restore();

  context.strokeStyle = "rgba(126, 226, 168, 0.28)";
  context.lineWidth = 2;
  for (let index = 0; index < 18; index += 1) {
    const y = 500 + index * 25;
    context.beginPath();
    context.moveTo(110 + index * 8, y);
    context.bezierCurveTo(330, y - 90, 720, y + 120, 970 - index * 7, y - 10);
    context.stroke();
  }

  context.fillStyle = "#ffffff";
  context.font = "900 44px Inter, Arial, sans-serif";
  context.fillText("MUNDIAL LAB", 82, 95);
  context.fillStyle = "#7ee2a8";
  context.font = "900 32px Inter, Arial, sans-serif";
  context.fillText("DATA DIRECTOR CARD", 82, 142);

  context.fillStyle = "#ffffff";
  context.font = "950 78px Inter, Arial, sans-serif";
  drawWrappedText(context, `${detail.match.home_team} vs ${detail.match.away_team}`, 82, 255, 920, 84);
  context.fillStyle = "rgba(255,255,255,0.78)";
  context.font = "800 30px Inter, Arial, sans-serif";
  context.fillText(`${detail.match.stage} - Partido ${detail.match.match_number} - ${detail.match.venue}`, 84, 365);

  context.fillStyle = "#ffffff";
  context.font = "950 76px Inter, Arial, sans-serif";
  context.fillText(`${alias || "Data Director"} va con`, 84, 455);
  context.fillStyle = "#7ee2a8";
  context.font = "950 108px Inter, Arial, sans-serif";
  drawWrappedText(context, favorite, 84, 570, 860, 110);

  context.fillStyle = "rgba(6, 20, 22, 0.78)";
  context.beginPath();
  context.roundRect(82, 780, 916, 180, 28);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "900 46px Inter, Arial, sans-serif";
  context.fillText(`${pct(prediction.home_win)} local`, 122, 850);
  context.fillText(`${pct(prediction.draw)} empate`, 405, 850);
  context.fillText(`${pct(prediction.away_win)} visita`, 715, 850);
  context.fillStyle = "rgba(255,255,255,0.72)";
  context.font = "800 28px Inter, Arial, sans-serif";
  context.fillText(`Modelo: ${activeModel} - xG total ${prediction.expected_goals.toFixed(2)}`, 122, 910);

  const barX = 90;
  const barY = 1020;
  const barW = 900;
  const barH = 38;
  context.fillStyle = "rgba(255,255,255,0.12)";
  context.beginPath();
  context.roundRect(barX, barY, barW, barH, 19);
  context.fill();
  context.fillStyle = "#7ee2a8";
  context.fillRect(barX, barY, barW * prediction.home_win, barH);
  context.fillStyle = "#f5d547";
  context.fillRect(barX + barW * prediction.home_win, barY, barW * prediction.draw, barH);
  context.fillStyle = "#4dabf7";
  context.fillRect(barX + barW * (prediction.home_win + prediction.draw), barY, barW * prediction.away_win, barH);

  context.fillStyle = "#ffffff";
  context.font = "900 34px Inter, Arial, sans-serif";
  context.fillText("Parametros que movieron la lectura", 82, 1135);
  context.font = "800 26px Inter, Arial, sans-serif";
  context.fillStyle = "rgba(255,255,255,0.82)";
  topControlMoves(controls).forEach((item, index) => {
    const x = 82 + (index % 2) * 465;
    const y = 1190 + Math.floor(index / 2) * 48;
    context.fillText(`${controlLabels[item.key]} ${Math.round(item.value * 100)}%`, x, y);
  });

  context.fillStyle = "rgba(255,255,255,0.74)";
  context.font = "800 25px Inter, Arial, sans-serif";
  context.fillText("Challenge the line. Then watch replay + autopsy.", 82, 1300);
  context.fillStyle = "#7ee2a8";
  context.fillText(shareUrl.replace("https://", ""), 535, 1300);

  return canvas;
}

function DirectorSavePanel({
  detail,
  activeModel,
  prediction,
  controls,
}: {
  detail: MatchDetail;
  activeModel: ModelName;
  prediction: OperationalPrediction;
  controls: OperationalControls;
}) {
  const [alias, setAlias] = useState(() => window.localStorage.getItem("mundial_lab_alias") ?? "");
  const [robotCheck, setRobotCheck] = useState("");
  const [message, setMessage] = useState("Guarda tu lectura cuando tus parametros ya digan algo.");
  const [shareText, setShareText] = useState("");
  const [shareImage, setShareImage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const canSave = alias.trim().length >= 3 && robotCheck.trim().toLowerCase() === "gol";
  const canGenerateShare = alias.trim().length >= 3;
  const favorite =
    prediction.home_win >= prediction.draw && prediction.home_win >= prediction.away_win
      ? detail.match.home_team
      : prediction.away_win >= prediction.draw
        ? detail.match.away_team
        : "Empate";
  const shareUrl = `https://mundial.hadox.org/partidos/${detail.match.slug}/`;
  const replayUrl = `https://mundial.hadox.org/simulador-partido/?match=${detail.match.slug}`;
  const autopsyUrl = `https://mundial.hadox.org/diario-aprendizaje/?match=${detail.match.slug}`;

  const buildShareText = (director: string) => {
    const readableControlCopy = topControlMoves(controls)
      .slice(0, 3)
      .map((item) => `${controlLabels[item.key]} ${Math.round(item.value * 100)}%`)
      .join(" - ");
    return `Ya rete la linea Monte Carlo de Mundial Lab.

${detail.match.home_team} vs ${detail.match.away_team}
Mi lectura: ${favorite}
Modelo: ${activeModel}
Linea: ${Math.round(prediction.home_win * 100)}% local - ${Math.round(prediction.draw * 100)}% empate - ${Math.round(prediction.away_win * 100)}% visita
Controles clave: ${readableControlCopy}

Le ganas a mi lectura?
${shareUrl}

Replay 3D: ${replayUrl}
Autopsia despues del silbatazo: ${autopsyUrl}

#MundialLab #Mundial #DataScience #FootballAnalytics`;
  };

  const buildShareCanvas = (director = alias.trim() || "Data Director") =>
    generatePredictionShareCanvas({
      alias: director,
      detail,
      activeModel,
      prediction,
      controls,
      favorite,
      shareUrl,
    });

  const refreshShareImage = (director?: string) => {
    const canvas = buildShareCanvas(director);
    const image = canvas.toDataURL("image/png");
    setShareImage(image);
    return { canvas, image };
  };

  const saveReading = async () => {
    if (!canSave || isSaving) return;
    setIsSaving(true);
    setMessage("Guardando lectura...");
    try {
      const director = await registerAlias(alias);
      window.localStorage.setItem("mundial_lab_alias", director.alias);
      const saved = await createPrediction(detail.match.id, {
        match_id: detail.match.id,
        director_name: director.alias,
        model: activeModel,
        minute: detail.match.minute,
        home_win: prediction.home_win,
        draw: prediction.draw,
        away_win: prediction.away_win,
        notes: JSON.stringify({
          source: "sala_control",
          controls,
          expected_goals: prediction.expected_goals,
          headline: prediction.headline,
        }),
      });
      setMessage(`Lectura guardada para ${saved.director_name}. Si alguien usa tu alias, pues hay espias como en el futbol real.`);
      setShareText(buildShareText(saved.director_name));
      refreshShareImage(saved.director_name);
    } catch {
      setMessage("No se pudo guardar. Si la API esta apagada, conserva tu alias y vuelve a intentar.");
    } finally {
      setIsSaving(false);
    }
  };

  const createShareCard = () => {
    if (!canGenerateShare) {
      setMessage("Pon un alias de al menos 3 caracteres para firmar tu tarjeta.");
      return;
    }
    const director = alias.trim();
    setShareText(buildShareText(director));
    refreshShareImage(director);
    setMessage("Tarjeta generada con tu prediccion y parametros actuales.");
  };

  const copyShare = async () => {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setMessage("Texto de reto copiado. Ahora si, a presumir o a que te lo tumben.");
    } catch {
      setMessage("No pude copiar automaticamente, pero ya tienes la tarjeta abajo.");
    }
  };

  const downloadShareImage = (image = shareImage) => {
    if (!image) return;
    const link = document.createElement("a");
    link.href = image;
    link.download = `${detail.match.slug}-${alias.trim() || "data-director"}-prediction.png`;
    link.click();
  };

  const sharePredictionImage = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      const text = shareText || buildShareText(alias.trim() || "Data Director");
      const { canvas, image } = refreshShareImage();
      const blob = await canvasBlob(canvas);
      const file = new File([blob], `${detail.match.slug}-mundial-lab.png`, { type: "image/png" });

      if ("canShare" in navigator && navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({
          title: "Mundial Lab prediction",
          text,
          url: shareUrl,
          files: [file],
        });
        setMessage("Tarjeta compartida. Ahora que venga quien quiera a retar tu lectura.");
        return;
      }

      downloadShareImage(image);
      await navigator.clipboard?.writeText(text);
      setMessage("Tu tarjeta PNG se descargo y el texto del reto quedo copiado.");
    } catch {
      if (shareImage) downloadShareImage();
      setMessage("No se pudo abrir compartir. Te deje la tarjeta lista para descargar.");
    } finally {
      setIsSharing(false);
    }
  };

  const nativeShare = async () => {
    if (!shareText || !navigator.share) {
      copyShare();
      return;
    }
    await navigator.share({
      title: "Mundial Lab prediction",
      text: shareText,
      url: shareUrl,
    });
  };

  return (
    <article className="live-panel director-save-panel">
      <div className="workflow-title">
        <Save />
        <h3>Guardar mi lectura</h3>
      </div>
      <p>
        No pedimos correo ni datos privados. Usa un alias publico; si alguien lo copia, queda como
        espia del vestidor.
      </p>
      <label>
        Alias de Data Director
        <input
          maxLength={32}
          onChange={(event) => setAlias(event.target.value)}
          placeholder="Ej. PoissonDelBarrio"
          value={alias}
        />
      </label>
      <label>
        Anti robots: escribe GOL
        <input
          autoComplete="off"
          onChange={(event) => setRobotCheck(event.target.value)}
          placeholder="GOL"
          value={robotCheck}
        />
      </label>
      <button disabled={!canSave || isSaving} onClick={saveReading} type="button">
        Guardar parametros y prediccion
      </button>
      <button className="share-build-button" disabled={!canGenerateShare} onClick={createShareCard} type="button">
        <ImageDown size={16} />
        Crear tarjeta social
      </button>
      <small>{message}</small>
      {shareText && (
        <div className="prediction-share-card">
          <span>Tarjeta instagrameable para retar a otros</span>
          <strong>{alias || "Data Director"} va con {favorite}</strong>
          <p>
            {detail.match.home_team} vs {detail.match.away_team}: {Math.round(prediction.home_win * 100)}%
            {" "}local, {Math.round(prediction.draw * 100)}% empate, {Math.round(prediction.away_win * 100)}% visita.
          </p>
          <label className="suggested-copy">
            <span>Copy sugerido</span>
            <textarea readOnly value={shareText} />
          </label>
          {shareImage && (
            <img
              alt={`Tarjeta de prediccion de ${alias || "Data Director"} para ${detail.match.home_team} vs ${detail.match.away_team}`}
              src={shareImage}
            />
          )}
          <div>
            <button disabled={isSharing} onClick={sharePredictionImage} type="button">
              <Share2 size={16} />
              Compartir imagen
            </button>
            <button onClick={() => downloadShareImage()} type="button">
              <ImageDown size={16} />
              Descargar PNG
            </button>
            <button onClick={copyShare} type="button">Copiar texto</button>
            <button onClick={nativeShare} type="button">Compartir</button>
          </div>
        </div>
      )}
    </article>
  );
}

function MatchLivePage() {
  const slug =
    document.documentElement.dataset.matchSlug ??
    window.location.pathname.match(/\/partidos\/([^/]+)/)?.[1] ??
    "001-mexico-vs-south-africa";
  const [detail, setDetail] = useState<MatchDetail>(demoMatch(slug));
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [matchDataError, setMatchDataError] = useState("");
  const [autopsies, setAutopsies] = useState<ModelAutopsy[]>([]);
  const [mode, setMode] = useState("demo local");
  const [statuses, setStatuses] = useState<Record<string, PlayerStatus>>({});
  const [activeModel, setActiveModel] = useState<ModelName>("poisson");
  const [controls, setControls] = useState<OperationalControls>(defaultOperationalControls);

  useEffect(() => {
    let cancelled = false;
    const loadMatchRoom = async () => {
      try {
        const data = await fetchMatch(slug);
        if (cancelled) return;
        setDetail(data);
        setMode("API activa");
        fetchMatchAutopsies(data.match.id)
          .then((items) => {
            if (!cancelled) setAutopsies(items);
          })
          .catch(() => undefined);
        try {
          const enrichment = await fetchMatchData(data.match.id);
          if (!cancelled) {
            setMatchData(enrichment);
            setMatchDataError("");
          }
        } catch (idError) {
          const enrichment = await fetchMatchData(slug);
          if (!cancelled) {
            setMatchData(enrichment);
            setMatchDataError("");
          }
        }
      } catch (error) {
        if (cancelled) return;
        setMode("demo local");
        fetchMatchAutopsies(slug)
          .then((items) => {
            if (!cancelled) setAutopsies(items);
          })
          .catch(() => undefined);
        fetchMatchData(slug)
          .then((data) => {
            if (!cancelled) {
              setMatchData(data);
              setMatchDataError("");
            }
          })
          .catch((fallbackError) => {
            if (!cancelled) {
              setMatchData(null);
              setMatchDataError(fallbackError instanceof Error ? fallbackError.message : "No se pudieron cargar los datos reales.");
            }
          });
      }
    };

    loadMatchRoom();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const stadium = useMemo(() => {
    const base = stadiumContext(detail.match);
    if (!matchData?.weather) return base;
    const humidity = matchData.weather.humidity_pct != null ? matchData.weather.humidity_pct / 100 : base.humidity;
    return {
      ...base,
      temperature_c: matchData.weather.temperature_c ?? base.temperature_c,
      humidity,
      pressure: clampMetric(0.54 + base.altitude_m / 8000 + humidity * 0.14),
      source: "publico" as const,
    };
  }, [detail.match, matchData]);
  const players = useMemo(() => {
    const realPlayers = lineupImpactPlayers(matchData);
    return applyPlayerStatuses(realPlayers.length ? realPlayers : impactPlayers(detail.match), statuses);
  }, [detail.match, matchData, statuses]);
  const homePlayers = players.filter((player) => player.team_id === detail.match.home_team_id);
  const awayPlayers = players.filter((player) => player.team_id === detail.match.away_team_id);
  const homeImpact = useMemo(() => teamImpact(homePlayers), [homePlayers]);
  const awayImpact = useMemo(() => teamImpact(awayPlayers), [awayPlayers]);
  const evidenceSignal = useMemo(() => liveShotSignal(matchData, detail), [matchData, detail]);
  const effectiveControls = useMemo(
    () => ({
      ...controls,
      xg_signal: Math.max(-1, Math.min(1, controls.xg_signal + evidenceSignal * 0.65)),
    }),
    [controls, evidenceSignal],
  );
  const prediction = useMemo(
    () => predictOperationalModel(activeModel, detail.match, stadium, homeImpact, awayImpact, effectiveControls),
    [activeModel, detail.match, stadium, homeImpact, awayImpact, effectiveControls],
  );

  const onStatusChange = (playerId: string, status: PlayerStatus) => {
    setStatuses((current) => ({ ...current, [playerId]: status }));
  };

  const onControlChange = (key: keyof OperationalControls, value: number) => {
    setControls((current) => ({ ...current, [key]: value }));
  };

  return (
    <main>
      <nav className="nav page-nav" aria-label="Navegación principal">
        <a className="brand" href="/">
          <Trophy size={22} />
          <span>Mundial Lab</span>
        </a>
        <div className="nav-links">
          <a href="/partidos/">Partidos</a>
          <a href={`/simulador-partido/?match=${detail.match.slug}`}>Replay 3D</a>
          <a href="/laboratorio-datos/">Datos</a>
          <a href="/directores/">Directores</a>
        </div>
      </nav>

      <section className="control-room">
        <header className="control-hero">
          <MatchScoreHeader detail={detail} mode={mode} />
          <div className="control-status">
            <span>
              <Radio size={16} />
              Modelo activo: {fallbackModels.find((model) => model.id === activeModel)?.short_name}
            </span>
            <strong>{prediction.expected_goals.toFixed(2)}</strong>
            <small>{prediction.headline}</small>
            <a className="control-replay-link" href={`/simulador-partido/?match=${detail.match.slug}`}>
              <PlayCircle size={17} />
              Abrir replay 3D narrado
            </a>
            <a className="control-replay-link secondary" href={`/diario-aprendizaje/?match=${detail.match.slug}&kit=1`}>
              <BookOpen size={17} />
              Autopsia + kit
            </a>
            <a className="control-replay-link secondary" href="/laboratorio-datos/">
              <Database size={17} />
              Datos reales
            </a>
          </div>
        </header>

        <TrainingModePanel
          activeModel={activeModel}
          autopsies={autopsies}
          data={matchData}
          detail={detail}
          evidenceSignal={evidenceSignal}
          prediction={prediction}
        />

        <MatchClosedInsightPanel autopsies={autopsies} detail={detail} />

        <div className="control-layout">
          <section className="field-column">
            <StadiumScene detail={detail} homeImpact={homeImpact} awayImpact={awayImpact} />
            <article className="live-panel">
              <div className="workflow-title">
                <Activity />
                <h3>Probabilidad viva</h3>
              </div>
              <ProbabilityBars home={prediction.home_win} draw={prediction.draw} away={prediction.away_win} />
              <div className="score-chips">
                {prediction.top_scores.map((item) => (
                  <span key={item.score}>
                    {item.score} · {Math.round(item.probability * 100)}%
                  </span>
                ))}
              </div>
              <div className="diagnostic-grid">
                {prediction.diagnostics.map((item) => (
                  <span key={item.label}>
                    <small>{item.label}</small>
                    <strong>{item.value}</strong>
                  </span>
                ))}
              </div>
            </article>
            <DataDirectorFlowPanel detail={detail} activeModel={activeModel} />
            <div id="datos-del-partido">
              <RealMatchDataPanel data={matchData} detail={detail} error={matchDataError} />
            </div>
            <ModelDataEvidencePanel activeModel={activeModel} data={matchData} detail={detail} evidenceSignal={evidenceSignal} stadium={stadium} />
            <ModelImpactPanel
              activeModel={activeModel}
              awayImpact={awayImpact}
              evidenceSignal={evidenceSignal}
              homeImpact={homeImpact}
              prediction={prediction}
              stadium={stadium}
            />
            <ShotMapPanel data={matchData} detail={detail} />
            <ModelAutopsyPanel
              autopsies={autopsies}
              detail={detail}
            />
            <article className="live-panel data-viz-panel">
              <h3>Lectura técnica</h3>
              <p className="live-evidence-note">
                Senal viva de tiros: <strong>{evidenceSignal >= 0 ? "+" : ""}{evidenceSignal.toFixed(2)}</strong>
                <span>Se suma a Bayes/Ensemble como evidencia, no como xG oficial.</span>
              </p>
              <div className="trace-bars">
                {prediction.traces.map((item) => (
                  <label key={item.label}>
                    <span>{item.label}</span>
                    <i style={{ width: `${Math.round(item.value * 100)}%` }} />
                  </label>
                ))}
              </div>
            </article>
            <ModelScienceCharts
              activeModel={activeModel}
              controls={effectiveControls}
              detail={detail}
              homeImpact={homeImpact}
              awayImpact={awayImpact}
              prediction={prediction}
              stadium={stadium}
            />
          </section>

          <aside className="control-sidebar">
            <div id="modelo-operativo">
              <ModelControlPanel
                activeModel={activeModel}
                controls={controls}
                data={matchData}
                detail={detail}
                evidenceSignal={evidenceSignal}
                awayImpact={awayImpact}
                homeImpact={homeImpact}
                onControlChange={onControlChange}
                onModelChange={setActiveModel}
                prediction={prediction}
                stadium={stadium}
              />
            </div>
            <div id="guardar-lectura">
              <DirectorSavePanel
                activeModel={activeModel}
                controls={effectiveControls}
                detail={detail}
                prediction={prediction}
              />
            </div>
            <MatchDirectorRankingPanel detail={detail} />
            <article className="live-panel context-panel">
              <div className="workflow-title">
                <Gauge />
                <h3>Estadio</h3>
              </div>
              <dl>
                <div>
                  <dt>Altitud</dt>
                  <dd>{stadium.altitude_m} m</dd>
                </div>
                <div>
                  <dt>Temperatura</dt>
                  <dd>{stadium.temperature_c} °C</dd>
                </div>
                <div>
                  <dt>Humedad</dt>
                  <dd>{Math.round(stadium.humidity * 100)}%</dd>
                </div>
                <div>
                  <dt>Presión</dt>
                  <dd>{Math.round(stadium.pressure * 100)}%</dd>
                </div>
              </dl>
              <small>{stadium.source === "publico" ? "Clima real conectado desde Open-Meteo." : "Contexto simulado hasta conectar fuentes publicas."}</small>
            </article>

            <article className="live-panel">
              <div className="workflow-title">
                <SlidersHorizontal />
                <h3>Impacto agregado de jugadores</h3>
              </div>
              <div className="impact-meters">
                <span>Local ataque <b>{Math.round(homeImpact.attack * 100)}</b></span>
                <span>Local defensa <b>{Math.round(homeImpact.defense * 100)}</b></span>
                <span>Visita ataque <b>{Math.round(awayImpact.attack * 100)}</b></span>
                <span>Visita defensa <b>{Math.round(awayImpact.defense * 100)}</b></span>
              </div>
            </article>

            <article className="live-panel">
              <h3>Timeline</h3>
              <ol className="timeline">
                {detail.events.map((event) => (
                  <li key={event.id}>
                    <strong>{event.minute}'</strong>
                    <span>{event.description}</span>
                  </li>
                ))}
              </ol>
            </article>
          </aside>
        </div>

        <div className="impact-grid">
          <PlayerImpactPanel
            flag={teamFlag(detail.match.home_team_id)}
            title={detail.match.home_team}
            players={homePlayers}
            onStatusChange={onStatusChange}
          />
          <PlayerImpactPanel
            flag={teamFlag(detail.match.away_team_id)}
            title={detail.match.away_team}
            players={awayPlayers}
            onStatusChange={onStatusChange}
          />
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<MatchLivePage />);
