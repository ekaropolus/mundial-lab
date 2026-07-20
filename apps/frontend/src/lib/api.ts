import {
  DataQualitySummary,
  DirectorScore,
  HouseDailyEditorial,
  HouseMatchBoard,
  HouseLineEvolution,
  HouseSimulationResult,
  LearningLogEntry,
  LivePrediction,
  Match,
  ModelAutopsy,
  MatchData,
  MatchDetail,
  ModelModule,
  ModelName,
  AutopsyQueueStatus,
  SchedulerState,
  SimulationResult,
  Team,
} from "../types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

function adminHeaders(): Record<string, string> {
  const token = window.localStorage.getItem("mundial_lab_admin_token");
  return token ? { "X-Admin-Token": token } : {};
}

export async function fetchTeams(): Promise<Team[]> {
  const response = await fetch(`${API_URL}/teams`);
  if (!response.ok) throw new Error("No se pudieron cargar los equipos.");
  return response.json();
}

export async function fetchModels(): Promise<ModelModule[]> {
  const response = await fetch(`${API_URL}/models`);
  if (!response.ok) throw new Error("No se pudieron cargar los modelos.");
  return response.json();
}

export async function runInlineSimulation(model: ModelName, simulations: number): Promise<SimulationResult> {
  const create = await fetch(`${API_URL}/simulations/inline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, simulations, seed: 2026 }),
  });
  if (!create.ok) throw new Error("No se pudo ejecutar la simulacion.");
  const jobId = await create.json();
  const result = await fetch(`${API_URL}/simulations/${jobId}/result`);
  if (!result.ok) throw new Error("La simulacion termino sin resultado disponible.");
  return result.json();
}

export async function enqueueSimulation(model: ModelName, simulations: number, email?: string) {
  const response = await fetch(`${API_URL}/simulations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, simulations, email: email || undefined }),
  });
  if (!response.ok) throw new Error("No se pudo crear el job.");
  return response.json();
}

export async function fetchMatches(): Promise<Match[]> {
  const response = await fetch(`${API_URL}/matches`);
  if (!response.ok) throw new Error("No se pudieron cargar los partidos.");
  return response.json();
}

export async function fetchMatch(slug: string): Promise<MatchDetail> {
  const response = await fetch(`${API_URL}/matches/${slug}`);
  if (!response.ok) throw new Error("No se pudo cargar el partido.");
  return response.json();
}

export async function fetchMatchData(slug: string): Promise<MatchData> {
  const response = await fetch(`${API_URL}/matches/${slug}/data`);
  if (!response.ok) throw new Error("No se pudieron cargar los datos enriquecidos del partido.");
  return response.json();
}

export async function fetchMatchAutopsies(matchId: string): Promise<ModelAutopsy[]> {
  const response = await fetch(`${API_URL}/matches/${matchId}/autopsies`);
  if (!response.ok) throw new Error("No se pudieron cargar las autopsias del partido.");
  return response.json();
}

export async function fetchLearningLog(limit = 30, model?: ModelName): Promise<LearningLogEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (model) params.set("model", model);
  const response = await fetch(`${API_URL}/learning-log?${params.toString()}`);
  if (!response.ok) throw new Error("No se pudo cargar el diario de aprendizaje.");
  return response.json();
}

export async function fetchLeaderboard(): Promise<DirectorScore[]> {
  const response = await fetch(`${API_URL}/directors/leaderboard`);
  if (!response.ok) throw new Error("No se pudo cargar el leaderboard.");
  return response.json();
}

export async function registerAlias(alias: string): Promise<{ alias: string }> {
  const response = await fetch(`${API_URL}/directors/alias`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias }),
  });
  if (!response.ok) throw new Error("No se pudo registrar el alias.");
  return response.json();
}

export async function createPrediction(matchId: string, prediction: LivePrediction): Promise<LivePrediction> {
  const response = await fetch(`${API_URL}/matches/${matchId}/predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prediction),
  });
  if (!response.ok) throw new Error("No se pudo guardar la lectura.");
  return response.json();
}

export async function runHouseSimulation(options: {
  simulations: number;
  seed: number;
  use_stadium: boolean;
  use_fixed_results: boolean;
  use_xg?: boolean;
  scenario: string;
}): Promise<HouseSimulationResult> {
  const response = await fetch(`${API_URL}/admin/house-simulation/inline`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders() },
    body: JSON.stringify({ use_xg: true, ...options }),
  });
  if (!response.ok) throw new Error("No se pudo correr el Monte Carlo de la casa.");
  return response.json();
}

export async function saveHouseMatchLines(options: {
  simulations: number;
  seed: number;
  use_stadium: boolean;
  use_fixed_results: boolean;
  use_xg?: boolean;
  scenario: string;
  line_stage?: "baseline" | "pre_match" | "live" | "post_result" | "official";
}): Promise<{
  run: { id: number; scenario: string; simulations: number; seed: number; created_at: string };
  lines_seen: number;
  lines_inserted: number;
  errors: { match_id: string; error: string }[];
}> {
  const response = await fetch(`${API_URL}/admin/house-simulation/save-match-lines`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders() },
    body: JSON.stringify({ use_xg: true, ...options }),
  });
  if (!response.ok) throw new Error("No se pudo guardar la linea Monte Carlo oficial.");
  return response.json();
}

export async function runHouseMatchBoard(options: {
  simulations: number;
  seed: number;
  use_stadium: boolean;
  use_fixed_results: boolean;
  use_xg?: boolean;
  scenario: string;
}): Promise<HouseMatchBoard> {
  const response = await fetch(`${API_URL}/house-simulation/match-board`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ use_xg: true, ...options }),
  });
  if (!response.ok) throw new Error("No se pudo correr el tablero Monte Carlo de la casa.");
  return response.json();
}

export async function fetchLatestHouseBoard(): Promise<HouseMatchBoard | null> {
  const response = await fetch(`${API_URL}/house-simulation/latest-board`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("No se pudo cargar la linea Monte Carlo oficial.");
  return response.json();
}

export async function fetchHouseEvolution(matchId?: string): Promise<HouseLineEvolution[]> {
  const params = new URLSearchParams({ limit: "800" });
  if (matchId) params.set("match_id", matchId);
  const response = await fetch(`${API_URL}/house-simulation/evolution?${params.toString()}`);
  if (!response.ok) throw new Error("No se pudo cargar la evolucion Monte Carlo.");
  return response.json();
}

export async function fetchHouseDailyEditorials(): Promise<HouseDailyEditorial[]> {
  const response = await fetch(`${API_URL}/house-simulation/daily-editorials?limit_days=8`);
  if (!response.ok) throw new Error("No se pudieron cargar los cierres editoriales de la casa.");
  return response.json();
}

export async function ingestInternationalResults(): Promise<{
  source: string;
  source_version: string;
  rows_ingested: number;
  teams_updated: number;
  snapshot_id: number;
  unmatched: string[];
}> {
  const response = await fetch(`${API_URL}/admin/data/ingest-international-results`, {
    method: "POST",
    headers: adminHeaders(),
  });
  if (!response.ok) throw new Error("No se pudo ingerir el historico internacional.");
  return response.json();
}

export async function fetchInternationalResultsStatus(): Promise<{
  source: string;
  source_version: string;
  rows_ingested: number;
  teams_updated: number;
  snapshot_id: number | null;
  loaded_at: string | null;
  unmatched: string[];
}> {
  const response = await fetch(`${API_URL}/admin/data/international-results-status`);
  if (!response.ok) throw new Error("No se pudo leer el estado del historico internacional.");
  return response.json();
}

export async function fetchDataQuality(): Promise<DataQualitySummary> {
  const response = await fetch(`${API_URL}/admin/data/quality`, {
    headers: adminHeaders(),
  });
  if (!response.ok) throw new Error("No se pudo leer la calidad de datos.");
  return response.json();
}

export async function fetchPublicDataQuality(): Promise<DataQualitySummary> {
  const response = await fetch(`${API_URL}/data/quality`);
  if (!response.ok) throw new Error("No se pudo leer la calidad publica de datos.");
  return response.json();
}

export async function fetchSchedulerState(): Promise<SchedulerState> {
  const response = await fetch(`${API_URL}/admin/automation/scheduler-state`, {
    headers: adminHeaders(),
  });
  if (!response.ok) throw new Error("No se pudo leer el scheduler.");
  return response.json();
}

export async function fetchAutopsyQueue(): Promise<AutopsyQueueStatus> {
  const response = await fetch(`${API_URL}/admin/automation/autopsy-queue`, {
    headers: adminHeaders(),
  });
  if (!response.ok) throw new Error("No se pudo leer la cola de autopsias.");
  return response.json();
}

export type SocialPublication = {
  source_id: string;
  source_kind: string;
  title: string;
  status: string;
  share_count?: number;
  last_shared_at?: string | null;
};

export async function fetchSocialPublications(limit = 500): Promise<SocialPublication[]> {
  const response = await fetch(`${API_URL}/admin/social/publications?limit=${limit}`, {
    headers: adminHeaders(),
  });
  if (!response.ok) throw new Error("No se pudo leer el historial social.");
  return response.json();
}

export async function recordSocialShare(payload: {
  source_id: string;
  source_kind: string;
  title: string;
  caption: string;
  image_url?: string;
}): Promise<SocialPublication> {
  const response = await fetch(`${API_URL}/admin/social/share-record`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders() },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("No se pudo guardar el compartido.");
  return response.json();
}

export async function saveSocialArtwork(payload: {
  source_id: string;
  source_kind: string;
  title: string;
  caption: string;
  image_data: string;
  publish?: boolean;
}): Promise<SocialPublication & { image_url?: string; instagram_post_id?: string }> {
  const response = await fetch(`${API_URL}/admin/social/artwork`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders() },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("No se pudo guardar o publicar la obra social.");
  return response.json();
}

export async function backfillXg(): Promise<{
  source: string;
  shots_updated: number;
  features_updated: number;
  note: string;
}> {
  const response = await fetch(`${API_URL}/admin/data/backfill-xg`, {
    method: "POST",
    headers: adminHeaders(),
  });
  if (!response.ok) throw new Error("No se pudo recalcular el xG v1.");
  return response.json();
}
