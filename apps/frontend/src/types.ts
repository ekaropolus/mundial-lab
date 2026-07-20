export type ModelName = "elo" | "poisson" | "dixon_coles" | "bayes_live" | "ensemble";

export type Team = {
  id: string;
  name: string;
  confederation: string;
  group: string;
  rating: number;
  attack: number;
  defense: number;
  qualified: boolean;
};

export type TeamProbability = {
  team_id: string;
  team: string;
  group: string;
  champion: number;
  finalist: number;
  semifinalist: number;
  knockout: number;
};

export type SimulationResult = {
  job_id: string;
  model: ModelName;
  simulations: number;
  seed: number;
  summary: TeamProbability[];
  top_upsets: string[];
  methodology: string;
};

export type HouseSimulationResult = {
  job_id: string;
  scenario: string;
  simulations: number;
  seed: number;
  use_stadium: boolean;
  use_fixed_results: boolean;
  use_xg: boolean;
  fixed_results_used: number;
  data_sources: { name: string; maturity: string; role: string }[];
  methodology: string;
  champion: TeamProbability[];
  finalist: TeamProbability[];
  semifinalist: TeamProbability[];
  knockout: TeamProbability[];
  top_upsets: string[];
  pivotal_matches: { match: string; reason: string; weight: number }[];
  stadium_adjustments: { match: string; venue: string; city: string; tempo: number; home_edge: number; note: string }[];
  house_vs_directors: DirectorScore[];
};

export type HouseMatchLine = {
  match_id: string;
  match_number: number;
  slug: string;
  phase: string;
  stage: string;
  status: MatchStatus;
  home_team: string;
  away_team: string;
  home_team_id: string;
  away_team_id: string;
  home_score?: number;
  away_score?: number;
  winner_team_id?: string | null;
  winner_team?: string | null;
  venue: string;
  city: string;
  kickoff: string;
  local_time_label: string;
  home_win: number;
  draw: number;
  away_win: number;
  expected_home_goals: number;
  expected_away_goals: number;
  xg_impact?: {
    delta: number;
    home_games: number;
    away_games: number;
    note: string;
  } | null;
  favorite: string;
  confidence: number;
  top_scores: { label: string; probability: number }[];
  likely_participants: { label: string; probability: number }[];
  likely_home: { label: string; probability: number }[];
  likely_away: { label: string; probability: number }[];
  projected_home?: string;
  projected_away?: string;
  projected_home_id?: string;
  projected_away_id?: string;
  projected_winner?: string;
  projected_winner_id?: string;
};

export type HouseMatchBoard = {
  run_id: string;
  saved_at?: string;
  scenario: string;
  simulations: number;
  seed: number;
  use_stadium: boolean;
  use_fixed_results: boolean;
  use_xg: boolean;
  fixed_results_used: number;
  methodology: string;
  data_sources: { name: string; maturity: string; role: string }[];
  champion: TeamProbability[];
  top_upsets: string[];
  lines: HouseMatchLine[];
};

export type HouseLineEvolutionItem = {
  line_id: number;
  run_id: number;
  match_id: string;
  match_number: number;
  slug: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  status: MatchStatus;
  stage: string;
  phase: string;
  line_stage: "baseline" | "pre_match" | "live" | "post_result" | "official";
  scenario: string;
  created_at: string;
  seed: number;
  simulations: number;
  home_win: number;
  draw: number;
  away_win: number;
  favorite: string;
  confidence: number;
  expected_home_goals?: number | null;
  expected_away_goals?: number | null;
  outcome?: "home" | "draw" | "away" | null;
  outcome_probability?: number | null;
};

export type HouseLineEvolution = {
  match_id: string;
  match_number: number;
  slug: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  status: MatchStatus;
  stage: string;
  phase: string;
  opening: HouseLineEvolutionItem;
  latest: HouseLineEvolutionItem;
  movement?: number | null;
  versions: number;
};

export type HouseDailyEditorial = {
  id: string;
  kind: "daily_groups" | "champion_pulse";
  day: string;
  title: string;
  eyebrow: string;
  subtitle: string;
  detail: string;
  metric: string;
  model_result: string;
  model_signal: string;
  href: string;
  payload: Record<string, unknown>;
};

export type ModelWorkflowStep = {
  name: string;
  description: string;
};

export type ModelModule = {
  id: ModelName;
  name: string;
  short_name: string;
  status: "activo" | "prototipo" | "siguiente";
  question: string;
  intuition: string;
  data_inputs: string[];
  workflow: ModelWorkflowStep[];
  student_takeaway: string;
};

export type MatchStatus = "scheduled" | "live" | "halftime" | "finished";

export type Match = {
  id: string;
  match_number: number;
  slug: string;
  home_team_id: string;
  away_team_id: string;
  home_team: string;
  away_team: string;
  stage: string;
  phase: string;
  kickoff: string;
  local_time_label: string;
  venue: string;
  city: string;
  status: MatchStatus;
  minute: number;
  home_score: number;
  away_score: number;
  result_trust_level?: "real_verificado" | "publico_ingestado" | "manual_admin" | "estimado" | "simulado" | null;
  result_source?: string | null;
};

export type MatchEvent = {
  id?: number;
  match_id: string;
  minute: number;
  event_type: string;
  team_id?: string | null;
  description: string;
  source: string;
  status: "proposed" | "verified";
};

export type LivePrediction = {
  id?: number;
  match_id: string;
  director_name: string;
  model: ModelName;
  minute: number;
  home_win: number;
  draw: number;
  away_win: number;
  notes: string;
};

export type MatchDetail = {
  match: Match;
  events: MatchEvent[];
  predictions: LivePrediction[];
};

export type MatchLineupPlayer = {
  match_id: string;
  team_id: string;
  team_name: string;
  source: string;
  source_player_id: string;
  player_name: string;
  position: string;
  jersey: string;
  starter: boolean | number;
  status: string;
};

export type LiveFeatureRow = {
  match_id: string;
  minute: number;
  source: string;
  home_xg?: number | null;
  away_xg?: number | null;
  home_shots: number;
  away_shots: number;
  home_shots_on_target: number;
  away_shots_on_target: number;
  home_red_cards: number;
  away_red_cards: number;
  home_possession?: number | null;
  away_possession?: number | null;
  event_count: number;
};

export type MatchShot = {
  external_event_id: string;
  match_id: string;
  minute: number;
  team_name: string;
  player_name: string;
  shot_type: string;
  outcome: string;
  x?: number | null;
  y?: number | null;
  end_x?: number | null;
  end_y?: number | null;
  xg?: number | null;
  source: string;
};

export type StadiumCondition = {
  match_id: string;
  venue: string;
  city: string;
  source: string;
  observed_at: string;
  temperature_c?: number | null;
  humidity_pct?: number | null;
  wind_kph?: number | null;
  precipitation_mm?: number | null;
};

export type MatchData = {
  match_id: string;
  features: LiveFeatureRow | null;
  lineups: MatchLineupPlayer[];
  shots: MatchShot[];
  weather: StadiumCondition | null;
  sources: {
    features?: string | null;
    lineups: string[];
    shots: string[];
    weather?: string | null;
  };
};

export type ModelAutopsy = {
  id: number;
  match_id: string;
  original_run_id?: number | null;
  original_line_id?: number | null;
  best_model: ModelName;
  best_parameters_json: string;
  original_error: number;
  best_error: number;
  outcome: "home" | "draw" | "away";
  headline: string;
  lesson: string;
  share_copy: string;
  created_at: string;
};

export type LearningLogEntry = ModelAutopsy & {
  match_number: number;
  slug: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  status: MatchStatus;
  stage: string;
  venue: string;
  city: string;
};

export type DataQualitySummary = {
  totals: {
    matches_total: number;
    verified_results: number;
    with_lineups: number;
    with_live_features: number;
    with_shots: number;
    with_xg: number;
    with_weather: number;
  };
  matches: {
    id: string;
    match_number: number;
    slug: string;
    home_team: string;
    away_team: string;
    kickoff: string;
    status: MatchStatus;
    result_trust_level: string;
    has_lineups: boolean;
    has_live_features: boolean;
    has_shots: boolean;
    has_xg: boolean;
    has_weather: boolean;
    lineup_rows: number;
    shot_rows: number;
    xg_rows: number;
  }[];
  recent_jobs: {
    source: string;
    job_type: string;
    status: string;
    rows_seen: number;
    rows_inserted: number;
    finished_at: string;
    errors_json: string;
  }[];
};

export type SchedulerState = {
  mode: string;
  now: string;
  interval_seconds: number;
  start_date: string;
  end_date: string;
  active_matches: Match[];
  closing_matches: Match[];
  next_match?: Match | null;
};

export type AutopsyQueueStatus = {
  queue_size: number;
  coverage: {
    verified_matches: number;
    calibrated_done: number;
    calibrated_pending: number;
    model_done: number;
    model_pending: number;
  };
  next_jobs: {
    kind: "calibrated" | "model";
    match_id: string;
    model: ModelName;
    match_number: number;
    slug: string;
    home_team: string;
    away_team: string;
    score: string;
    verified_at: string;
  }[];
  recent_autopsies: {
    id: number;
    match_id: string;
    best_model: ModelName;
    best_parameters_json: string;
    headline: string;
    best_error: number;
    created_at: string;
    match_number: number;
    slug: string;
    home_team: string;
    away_team: string;
  }[];
};

export type DirectorScore = {
  director_name: string;
  predictions: number;
  score: number;
};

export type StadiumContext = {
  venue: string;
  city: string;
  altitude_m: number;
  temperature_c: number;
  humidity: number;
  pitch: "natural" | "hybrid" | "artificial";
  pressure: number;
  travel_load: number;
  source: "simulado" | "publico";
};

export type PlayerRole =
  | "portero"
  | "central"
  | "contencion"
  | "creativo"
  | "extremo"
  | "delantero";

export type PlayerStatus =
  | "titular"
  | "tocado"
  | "fatigado"
  | "amarilla"
  | "sustituido";

export type ImpactPlayer = {
  id: string;
  team_id: string;
  name: string;
  role: PlayerRole;
  attack: number;
  defense: number;
  creation: number;
  pressure: number;
  goalkeeping: number;
  stamina: number;
  status: PlayerStatus;
  source: "simulado" | "publico";
};

export type TeamImpact = {
  attack: number;
  defense: number;
  tempo: number;
  volatility: number;
  fatigue: number;
  notes: string[];
};

export type MatchImpactPrediction = {
  home_lambda: number;
  away_lambda: number;
  home_win: number;
  draw: number;
  away_win: number;
  expected_goals: number;
  top_scores: { score: string; probability: number }[];
};

export type OperationalControls = {
  attack_bias: number;
  defense_bias: number;
  tempo_bias: number;
  venue_edge: number;
  elo_k: number;
  form_weight: number;
  low_score_correlation: number;
  recency_decay: number;
  prior_strength: number;
  evidence_weight: number;
  xg_signal: number;
  poisson_weight: number;
  elo_weight: number;
  dixon_weight: number;
  bayes_weight: number;
  calibration: number;
};

export type OperationalPrediction = MatchImpactPrediction & {
  model: ModelName;
  headline: string;
  diagnostics: { label: string; value: string }[];
  traces: { label: string; value: number }[];
};
