import {
  ImpactPlayer,
  Match,
  MatchImpactPrediction,
  ModelName,
  OperationalControls,
  OperationalPrediction,
  PlayerRole,
  PlayerStatus,
  StadiumContext,
  TeamImpact,
} from "../types";

const roleTemplates: { role: PlayerRole; label: string; attack: number; defense: number; creation: number; pressure: number; goalkeeping: number; stamina: number }[] = [
  { role: "portero", label: "guardián del área", attack: 0.08, defense: 0.72, creation: 0.12, pressure: 0.2, goalkeeping: 0.9, stamina: 0.82 },
  { role: "central", label: "central corrector", attack: 0.2, defense: 0.86, creation: 0.22, pressure: 0.55, goalkeeping: 0, stamina: 0.78 },
  { role: "contencion", label: "ancla de presión", attack: 0.34, defense: 0.72, creation: 0.52, pressure: 0.82, goalkeeping: 0, stamina: 0.84 },
  { role: "creativo", label: "cerebro interior", attack: 0.58, defense: 0.32, creation: 0.9, pressure: 0.48, goalkeeping: 0, stamina: 0.74 },
  { role: "extremo", label: "ruptura por banda", attack: 0.78, defense: 0.28, creation: 0.66, pressure: 0.62, goalkeeping: 0, stamina: 0.7 },
  { role: "delantero", label: "nueve de impacto", attack: 0.9, defense: 0.18, creation: 0.42, pressure: 0.46, goalkeeping: 0, stamina: 0.68 },
];

const statusWeight: Record<PlayerStatus, { attack: number; defense: number; tempo: number; fatigue: number; volatility: number }> = {
  titular: { attack: 1, defense: 1, tempo: 1, fatigue: 0, volatility: 0 },
  tocado: { attack: 0.88, defense: 0.9, tempo: 0.92, fatigue: 0.09, volatility: 0.04 },
  fatigado: { attack: 0.78, defense: 0.82, tempo: 0.84, fatigue: 0.16, volatility: 0.06 },
  amarilla: { attack: 0.94, defense: 0.78, tempo: 0.9, fatigue: 0.04, volatility: 0.08 },
  sustituido: { attack: 0.48, defense: 0.5, tempo: 0.58, fatigue: 0.02, volatility: 0.12 },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeOutcome(home: number, draw: number, away: number) {
  const total = Math.max(0.001, home + draw + away);
  return {
    home_win: home / total,
    draw: draw / total,
    away_win: away / total,
  };
}

function hash(value: string) {
  return [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

export function stadiumContext(match: Match): StadiumContext {
  const city = match.city.toLowerCase();
  const altitude = city.includes("mexico") ? 2240 : city.includes("guadalajara") ? 1566 : city.includes("denver") ? 1609 : 120;
  const humidity = city.includes("houston") || city.includes("miami") ? 0.72 : city.includes("vancouver") ? 0.64 : 0.48;
  const temperature = city.includes("mexico") ? 24 : city.includes("houston") || city.includes("miami") ? 30 : 22;

  return {
    venue: match.venue,
    city: match.city,
    altitude_m: altitude,
    temperature_c: temperature,
    humidity,
    pitch: "natural",
    pressure: clamp(0.54 + altitude / 8000 + humidity * 0.14, 0.45, 0.9),
    travel_load: clamp(0.2 + Math.abs(hash(match.home_team) - hash(match.away_team)) / 3000, 0.18, 0.76),
    source: "simulado",
  };
}

export function impactPlayers(match: Match): ImpactPlayer[] {
  return [match.home_team_id, match.away_team_id].flatMap((teamId) => {
    const teamName = teamId === match.home_team_id ? match.home_team : match.away_team;
    const seed = hash(teamName);

    return roleTemplates.map((template, index) => {
      const modifier = ((seed + index * 17) % 13) / 100;
      return {
        id: `${teamId}-${template.role}`,
        team_id: teamId,
        name: `${teamName} ${template.label}`,
        role: template.role,
        attack: clamp(template.attack + modifier, 0, 1),
        defense: clamp(template.defense + modifier / 2, 0, 1),
        creation: clamp(template.creation + modifier, 0, 1),
        pressure: clamp(template.pressure + modifier / 2, 0, 1),
        goalkeeping: template.goalkeeping,
        stamina: clamp(template.stamina - modifier / 2, 0, 1),
        status: "titular",
        source: "simulado",
      };
    });
  });
}

export function applyPlayerStatuses(players: ImpactPlayer[], statuses: Record<string, PlayerStatus>) {
  return players.map((player) => ({ ...player, status: statuses[player.id] ?? player.status }));
}

export function teamImpact(players: ImpactPlayer[]): TeamImpact {
  const total = Math.max(1, players.length);

  const raw = players.reduce(
    (sum, player) => {
      const status = statusWeight[player.status];
      sum.attack += (player.attack * 0.58 + player.creation * 0.32 + player.pressure * 0.1) * status.attack;
      sum.defense += (player.defense * 0.62 + player.goalkeeping * 0.28 + player.pressure * 0.1) * status.defense;
      sum.tempo += (player.stamina * 0.5 + player.pressure * 0.3 + player.creation * 0.2) * status.tempo;
      sum.fatigue += status.fatigue + (1 - player.stamina) * 0.05;
      sum.volatility += status.volatility;
      return sum;
    },
    { attack: 0, defense: 0, tempo: 0, fatigue: 0, volatility: 0 },
  );

  const notes = players
    .filter((player) => player.status !== "titular")
    .map((player) => `${player.name}: ${player.status}`);

  return {
    attack: clamp(raw.attack / total, 0.15, 0.95),
    defense: clamp(raw.defense / total, 0.15, 0.95),
    tempo: clamp(raw.tempo / total, 0.2, 0.95),
    fatigue: clamp(raw.fatigue / players.length, 0, 0.35),
    volatility: clamp(0.12 + raw.volatility / players.length, 0.08, 0.38),
    notes,
  };
}

function poisson(k: number, lambda: number) {
  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial *= i;
  return (Math.exp(-lambda) * lambda ** k) / factorial;
}

export const defaultOperationalControls: OperationalControls = {
  attack_bias: 0,
  defense_bias: 0,
  tempo_bias: 0,
  venue_edge: 0.06,
  elo_k: 32,
  form_weight: 0.5,
  low_score_correlation: 0.12,
  recency_decay: 0.65,
  prior_strength: 0.62,
  evidence_weight: 0.55,
  xg_signal: 0,
  poisson_weight: 0.32,
  elo_weight: 0.22,
  dixon_weight: 0.24,
  bayes_weight: 0.22,
  calibration: 1,
};

export function predictMatchImpact(
  match: Match,
  stadium: StadiumContext,
  home: TeamImpact,
  away: TeamImpact,
  controls: OperationalControls = defaultOperationalControls,
): MatchImpactPrediction {
  const minuteFactor = clamp((90 - match.minute) / 90, 0.05, 1);
  const scorePressure = clamp((match.away_score - match.home_score) * 0.09, -0.18, 0.18);
  const stadiumTempo = clamp(1 - stadium.humidity * 0.08 - stadium.altitude_m / 24000, 0.82, 1.05);
  const homeVenueEdge =
    match.venue.toLowerCase().includes("azteca") && match.home_team_id === "mexico"
      ? controls.venue_edge + 0.1
      : controls.venue_edge;

  const homeLambda =
    match.home_score +
    minuteFactor *
      clamp(
        1.05 +
          (home.attack + controls.attack_bias) * 0.95 -
          (away.defense + controls.defense_bias) * 0.54 +
          (home.tempo + controls.tempo_bias) * 0.22 -
          home.fatigue * 0.32 +
          homeVenueEdge +
          scorePressure,
        0.12,
        3.9,
      ) *
      stadiumTempo;
  const awayLambda =
    match.away_score +
    minuteFactor *
      clamp(
        0.95 +
          away.attack * 0.92 -
          home.defense * 0.56 +
          away.tempo * 0.2 -
          away.fatigue * 0.34 -
          homeVenueEdge -
          scorePressure,
        0.1,
        3.8,
      ) *
      stadiumTempo;

  const scores: { score: string; probability: number; home: number; away: number }[] = [];
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let h = 0; h <= 6; h += 1) {
    for (let a = 0; a <= 6; a += 1) {
      const probability = poisson(h, homeLambda) * poisson(a, awayLambda);
      scores.push({ score: `${h}-${a}`, probability, home: h, away: a });
      if (h > a) homeWin += probability;
      else if (h === a) draw += probability;
      else awayWin += probability;
    }
  }

  const total = homeWin + draw + awayWin;

  return {
    home_lambda: homeLambda,
    away_lambda: awayLambda,
    home_win: homeWin / total,
    draw: draw / total,
    away_win: awayWin / total,
    expected_goals: homeLambda + awayLambda,
    top_scores: scores.sort((a, b) => b.probability - a.probability).slice(0, 4),
  };
}

function withOutcome(base: MatchImpactPrediction, model: ModelName, home: number, draw: number, away: number, headline: string, diagnostics: OperationalPrediction["diagnostics"], traces: OperationalPrediction["traces"]): OperationalPrediction {
  return {
    ...base,
    ...normalizeOutcome(home, draw, away),
    model,
    headline,
    diagnostics,
    traces,
  };
}

function eloPrediction(match: Match, stadium: StadiumContext, homeImpact: TeamImpact, awayImpact: TeamImpact, base: MatchImpactPrediction, controls: OperationalControls): OperationalPrediction {
  const ratingDelta =
    (homeImpact.attack - awayImpact.attack) * 260 +
    (homeImpact.defense - awayImpact.defense) * 180 +
    controls.form_weight * 90 +
    controls.venue_edge * 380 -
    stadium.travel_load * 34;
  const expected = 1 / (1 + 10 ** (-ratingDelta / 400));
  const draw = clamp(0.31 - Math.abs(expected - 0.5) * 0.22 + (1 - controls.form_weight) * 0.04, 0.16, 0.34);
  const remaining = 1 - draw;
  const home = expected * remaining;
  const away = (1 - expected) * remaining;

  return withOutcome(base, "elo", home, draw, away, "Rating dinámico ajustado por forma, sede e impacto agregado.", [
    { label: "Delta rating", value: `${Math.round(ratingDelta)}` },
    { label: "K-factor", value: `${Math.round(controls.elo_k)}` },
    { label: "Forma reciente", value: `${Math.round(controls.form_weight * 100)}%` },
  ], [
    { label: "rating local", value: clamp(expected, 0, 1) },
    { label: "draw band", value: draw },
    { label: "volatilidad", value: (homeImpact.volatility + awayImpact.volatility) / 2 },
  ]);
}

function dixonColesPrediction(base: MatchImpactPrediction, controls: OperationalControls): OperationalPrediction {
  const lowScoreMass = base.top_scores
    .filter((item) => ["0-0", "1-0", "0-1", "1-1"].includes(item.score))
    .reduce((sum, item) => sum + item.probability, 0);
  const correction = clamp(controls.low_score_correlation * 0.9 + lowScoreMass * controls.recency_decay, 0.02, 0.32);
  const draw = base.draw + correction * 0.55;
  const home = base.home_win - correction * 0.28;
  const away = base.away_win - correction * 0.27;

  return withOutcome(base, "dixon_coles", home, draw, away, "Corrección de marcadores bajos sobre una base Poisson.", [
    { label: "Correlación baja", value: `${controls.low_score_correlation.toFixed(2)}` },
    { label: "Decaimiento", value: `${controls.recency_decay.toFixed(2)}` },
    { label: "Masa 0-0/1-0/0-1/1-1", value: `${Math.round(lowScoreMass * 100)}%` },
  ], [
    { label: "masa baja", value: clamp(lowScoreMass * 3, 0, 1) },
    { label: "corrección", value: correction },
    { label: "empate", value: draw },
  ]);
}

function bayesPrediction(match: Match, base: MatchImpactPrediction, controls: OperationalControls): OperationalPrediction {
  const scoreEvidence = clamp((match.home_score - match.away_score) * 0.18 + controls.xg_signal * 0.22, -0.28, 0.28);
  const priorHome = base.home_win * controls.prior_strength;
  const priorAway = base.away_win * controls.prior_strength;
  const evidence = controls.evidence_weight;
  const home = priorHome + base.home_win * (1 - controls.prior_strength) + Math.max(0, scoreEvidence) * evidence;
  const away = priorAway + base.away_win * (1 - controls.prior_strength) + Math.max(0, -scoreEvidence) * evidence;
  const draw = base.draw + (1 - Math.abs(scoreEvidence)) * (1 - evidence) * 0.08;

  return withOutcome(base, "bayes_live", home, draw, away, "Prior inicial actualizado con marcador, xG simulado y peso de evidencia.", [
    { label: "Prior", value: `${Math.round(controls.prior_strength * 100)}%` },
    { label: "Evidencia", value: `${Math.round(controls.evidence_weight * 100)}%` },
    { label: "Señal xG", value: `${controls.xg_signal.toFixed(2)}` },
  ], [
    { label: "prior", value: controls.prior_strength },
    { label: "evidencia", value: controls.evidence_weight },
    { label: "señal viva", value: clamp((scoreEvidence + 0.28) / 0.56, 0, 1) },
  ]);
}

function calibrated(value: number, temperature: number) {
  return value ** (1 / clamp(temperature, 0.45, 1.8));
}

export function predictOperationalModel(
  model: ModelName,
  match: Match,
  stadium: StadiumContext,
  homeImpact: TeamImpact,
  awayImpact: TeamImpact,
  controls: OperationalControls,
): OperationalPrediction {
  const base = predictMatchImpact(match, stadium, homeImpact, awayImpact, controls);
  const poisson = withOutcome(base, "poisson", base.home_win, base.draw, base.away_win, "Lambdas de gol esperadas con estadio y jugadores de impacto.", [
    { label: "Lambda local", value: base.home_lambda.toFixed(2) },
    { label: "Lambda visita", value: base.away_lambda.toFixed(2) },
    { label: "Goles esperados", value: base.expected_goals.toFixed(2) },
  ], [
    { label: "ataque local", value: homeImpact.attack },
    { label: "defensa visita", value: awayImpact.defense },
    { label: "ritmo estadio", value: clamp(1 - stadium.humidity * 0.08 - stadium.altitude_m / 24000, 0, 1) },
  ]);

  if (model === "poisson") return poisson;

  const elo = eloPrediction(match, stadium, homeImpact, awayImpact, base, controls);
  if (model === "elo") return elo;

  const dixon = dixonColesPrediction(base, controls);
  if (model === "dixon_coles") return dixon;

  const bayes = bayesPrediction(match, base, controls);
  if (model === "bayes_live") return bayes;

  const weights = {
    poisson: controls.poisson_weight,
    elo: controls.elo_weight,
    dixon: controls.dixon_weight,
    bayes: controls.bayes_weight,
  };
  const totalWeight = Math.max(0.001, weights.poisson + weights.elo + weights.dixon + weights.bayes);
  const home =
    (poisson.home_win * weights.poisson + elo.home_win * weights.elo + dixon.home_win * weights.dixon + bayes.home_win * weights.bayes) /
    totalWeight;
  const draw = (poisson.draw * weights.poisson + elo.draw * weights.elo + dixon.draw * weights.dixon + bayes.draw * weights.bayes) / totalWeight;
  const away =
    (poisson.away_win * weights.poisson + elo.away_win * weights.elo + dixon.away_win * weights.dixon + bayes.away_win * weights.bayes) /
    totalWeight;
  const calibratedHome = calibrated(home, controls.calibration);
  const calibratedDraw = calibrated(draw, controls.calibration);
  const calibratedAway = calibrated(away, controls.calibration);

  return withOutcome(base, "ensemble", calibratedHome, calibratedDraw, calibratedAway, "Mezcla calibrada de Poisson, Elo, Dixon-Coles y Bayes Live.", [
    { label: "Peso Poisson", value: `${Math.round((weights.poisson / totalWeight) * 100)}%` },
    { label: "Peso Elo", value: `${Math.round((weights.elo / totalWeight) * 100)}%` },
    { label: "Temperatura", value: controls.calibration.toFixed(2) },
  ], [
    { label: "Poisson", value: weights.poisson / totalWeight },
    { label: "Elo", value: weights.elo / totalWeight },
    { label: "Dixon-Coles", value: weights.dixon / totalWeight },
    { label: "Bayes", value: weights.bayes / totalWeight },
  ]);
}
