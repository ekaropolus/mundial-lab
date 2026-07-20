import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Activity, BarChart3, ClipboardCheck, Clock3, Database, Gauge, Play, ShieldCheck, Trophy } from "lucide-react";
import { SiteFooter } from "../components/SiteFooter";
import { backfillXg, fetchAutopsyQueue, fetchDataQuality, fetchInternationalResultsStatus, fetchSchedulerState, ingestInternationalResults, runHouseMatchBoard, runHouseSimulation, saveHouseMatchLines } from "../lib/api";
import { saveHouseHistory } from "../lib/houseHistory";
import { AutopsyQueueStatus, DataQualitySummary, HouseSimulationResult, SchedulerState } from "../types";
import "../styles.css";

function pct(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function AdminLiveControlPage() {
  const [simulations, setSimulations] = useState(5000);
  const [seed, setSeed] = useState(2026);
  const [useStadium, setUseStadium] = useState(true);
  const [useFixedResults, setUseFixedResults] = useState(true);
  const [useXg, setUseXg] = useState(true);
  const [result, setResult] = useState<HouseSimulationResult | null>(null);
  const [ingestion, setIngestion] = useState<{
    source: string;
    rows_ingested: number;
    teams_updated: number;
    snapshot_id: number | null;
    loaded_at?: string | null;
    unmatched: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [backfillingXg, setBackfillingXg] = useState(false);
  const [quality, setQuality] = useState<DataQualitySummary | null>(null);
  const [scheduler, setScheduler] = useState<SchedulerState | null>(null);
  const [autopsyQueue, setAutopsyQueue] = useState<AutopsyQueueStatus | null>(null);
  const [error, setError] = useState("");
  const [adminToken, setAdminToken] = useState(() => window.localStorage.getItem("mundial_lab_admin_token") ?? "");

  const saveAdminToken = (value: string) => {
    setAdminToken(value);
    window.localStorage.setItem("mundial_lab_admin_token", value);
  };

  const run = async (overrides?: { useFixedResults?: boolean; useStadium?: boolean; useXg?: boolean }) => {
    const fixedResults = overrides?.useFixedResults ?? useFixedResults;
    const stadium = overrides?.useStadium ?? useStadium;
    const xg = overrides?.useXg ?? useXg;
    setLoading(true);
    setError("");
    try {
      const data = await runHouseSimulation({
        simulations,
        seed,
        use_stadium: stadium,
        use_fixed_results: fixedResults,
        use_xg: xg,
        scenario: xg ? "Casa Hadox con estadio y xG v1" : stadium ? "Casa Hadox con estadio" : "Casa Hadox base",
      });
      setResult(data);
      const board = await runHouseMatchBoard({
        simulations,
        seed,
        use_stadium: stadium,
        use_fixed_results: fixedResults,
        use_xg: xg,
        scenario: xg ? "Línea pública Monte Carlo con xG v1" : stadium ? "Línea pública Monte Carlo de la casa con estadio" : "Línea pública Monte Carlo de la casa base",
      });
      saveHouseHistory(board);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo correr el modelo.");
    } finally {
      setLoading(false);
    }
  };

  const ingest = async () => {
    setIngesting(true);
    setError("");
    try {
      const data = await ingestInternationalResults();
      setIngestion(data);
      await run();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo ingerir el historico.");
    } finally {
      setIngesting(false);
    }
  };

  const preparePublicLine = async () => {
    setUseFixedResults(true);
    setUseStadium(true);
    setUseXg(true);
    setIngesting(true);
    setError("");
    try {
      const data = await ingestInternationalResults();
      setIngestion(data);
      await saveHouseMatchLines({
        simulations,
        seed,
        use_stadium: true,
        use_fixed_results: true,
        use_xg: true,
        line_stage: "post_result",
        scenario: `Linea oficial Monte Carlo ${new Date().toISOString()}`,
      });
      await run({ useFixedResults: true, useStadium: true, useXg: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo preparar la línea pública.");
    } finally {
      setIngesting(false);
    }
  };

  useEffect(() => {
    fetchInternationalResultsStatus()
      .then((data) => setIngestion(data))
      .catch(() => undefined);
    fetchDataQuality()
      .then((data) => setQuality(data))
      .catch(() => undefined);
    refreshAutomationPulse();
    run();
  }, []);

  const refreshAutomationPulse = async () => {
    try {
      const [schedulerState, queueState] = await Promise.all([
        fetchSchedulerState(),
        fetchAutopsyQueue(),
      ]);
      setScheduler(schedulerState);
      setAutopsyQueue(queueState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la automatizacion.");
    }
  };

  const refreshQuality = async () => {
    try {
      setQuality(await fetchDataQuality());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la calidad de datos.");
    }
  };

  const recalculateXg = async () => {
    setBackfillingXg(true);
    setError("");
    try {
      await backfillXg();
      await refreshQuality();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo recalcular el xG v1.");
    } finally {
      setBackfillingXg(false);
    }
  };

  return (
    <main>
      <nav className="nav page-nav" aria-label="Navegacion principal">
        <a className="brand" href="/">
          <Trophy size={22} />
          <span>Mundial Lab</span>
        </a>
        <div className="nav-links">
          <a href="/partidos/">Partidos</a>
          <a href="/montecarlo-casa/">Monte Carlo</a>
          <a href="/admin/social-room/">Cabina social</a>
          <a href="/directores/">Directores</a>
        </div>
      </nav>

      <section className="dashboard house-admin">
        <div className="section-heading">
          <p className="section-kicker">Admin · Monte Carlo de la casa</p>
          <h2>La casa se opera aquí; afuera solo se publica la lectura.</h2>
          <p>
            Esta consola fija la narrativa técnica: toma resultados cerrados capturados por admin,
            refresca la base histórica y produce la línea pública contra la que compiten los Data Directors.
          </p>
        </div>

        <div className="house-control-grid">
          <article className="live-panel house-run-card">
            <div className="workflow-title">
              <Gauge />
              <h3>Corrida admin</h3>
            </div>
            <label>
              <span>Llave admin</span>
              <input
                onChange={(event) => saveAdminToken(event.target.value)}
                placeholder="Solo operadores"
                type="password"
                value={adminToken}
              />
            </label>
            <label>
              <span>Simulaciones</span>
              <input min={500} max={50000} step={500} type="number" value={simulations} onChange={(event) => setSimulations(Number(event.target.value))} />
            </label>
            <label>
              <span>Seed</span>
              <input min={1} step={1} type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
            </label>
            <label className="check-row">
              <input checked={useStadium} onChange={(event) => setUseStadium(event.target.checked)} type="checkbox" />
              <span>Usar ajuste de estadio</span>
            </label>
            <label className="check-row">
              <input checked={useFixedResults} onChange={(event) => setUseFixedResults(event.target.checked)} type="checkbox" />
              <span>Respetar resultados cerrados</span>
            </label>
            <label className="check-row">
              <input checked={useXg} onChange={(event) => setUseXg(event.target.checked)} type="checkbox" />
              <span>Usar xG v1 como forma viva</span>
            </label>
            <button className="primary-action" disabled={loading} onClick={() => run()} type="button">
              <Play size={17} />
              {loading ? "Corriendo..." : "Correr Monte Carlo"}
            </button>
            <button className="secondary-action" disabled={loading || ingesting} onClick={preparePublicLine} type="button">
              <ShieldCheck size={17} />
              {ingesting ? "Preparando..." : "Preparar línea pública con resultados fijos"}
            </button>
            <button className="secondary-action" disabled={ingesting} onClick={ingest} type="button">
              <Database size={17} />
              {ingesting ? "Ingeriendo..." : "Solo refrescar histórico internacional"}
            </button>
            {error && <p className="error-text">{error}</p>}
          </article>

          <article className="live-panel house-method-card">
            <div className="workflow-title">
              <ShieldCheck />
              <h3>Regla v1</h3>
            </div>
            <p>
              V1 usa equipos, fuerza seed, fixture, resultados cerrados por admin, histórico internacional,
              estadio y xG v1 estimado desde tiros públicos cuando existe. Jugadores entran después como escenarios curados.
            </p>
            <div className="diagnostic-grid">
              <span><small>Resultados fijos</small><strong>{result?.fixed_results_used ?? 0}</strong></span>
              <span><small>Estadio</small><strong>{result?.use_stadium ? "activo" : "apagado"}</strong></span>
              <span><small>xG v1</small><strong>{result?.use_xg ? "activo" : "apagado"}</strong></span>
              <span><small>Seed</small><strong>{result?.seed ?? seed}</strong></span>
              <span><small>Historico</small><strong>{ingestion?.rows_ingested ? `${ingestion.teams_updated} equipos` : "pendiente"}</strong></span>
            </div>
            {ingestion?.rows_ingested ? (
              <p>
                Snapshot {ingestion.snapshot_id ?? "pendiente"}: {ingestion.rows_ingested.toLocaleString("es-MX")} partidos
                internacionales ingeridos desde {ingestion.source}.
              </p>
            ) : null}
          </article>
        </div>

        {(scheduler || autopsyQueue) && (
          <section className="live-panel automation-pulse-panel">
            <div className="workflow-title">
              <Clock3 />
              <h3>Pulso automatico</h3>
            </div>
            <div className="automation-pulse-grid">
              <span>
                <small>Modo scheduler</small>
                <strong>{scheduler?.mode ?? "pendiente"}</strong>
                <em>cada {scheduler ? Math.round(scheduler.interval_seconds / 60) : 0} min</em>
              </span>
              <span>
                <small>Ventana de ingesta</small>
                <strong>{scheduler ? `${scheduler.start_date} - ${scheduler.end_date}` : "pendiente"}</strong>
                <em>{scheduler?.active_matches.length ?? 0} activos / {scheduler?.closing_matches.length ?? 0} por cerrar</em>
              </span>
              <span>
                <small>Cola autopsias</small>
                <strong>{autopsyQueue?.queue_size ?? 0}</strong>
                <em>se procesa por lotes, no de golpe</em>
              </span>
              <span>
                <small>Cobertura educativa</small>
                <strong>{autopsyQueue ? `${autopsyQueue.coverage.model_done}/${autopsyQueue.coverage.model_done + autopsyQueue.coverage.model_pending}` : "0/0"}</strong>
                <em>autopsias por modelo</em>
              </span>
            </div>
            <div className="admin-inline-actions">
              <button className="secondary-action compact" onClick={refreshAutomationPulse} type="button">
                Refrescar pulso
              </button>
            </div>
            <div className="automation-queue-layout">
              <div className="automation-queue-list">
                <h4>Proximos trabajos en cola</h4>
                {autopsyQueue?.next_jobs.length ? autopsyQueue.next_jobs.slice(0, 8).map((job) => (
                  <a href={`/partidos/${job.slug}/`} key={`${job.kind}-${job.match_id}-${job.model}`}>
                    <strong>#{job.match_number} {job.home_team} vs {job.away_team}</strong>
                    <small>{job.score} · {job.kind === "calibrated" ? "Casa calibrada" : `Modelo ${job.model}`}</small>
                  </a>
                )) : <p>Sin pendientes: el diario esta al dia con los resultados verificados.</p>}
              </div>
              <div className="automation-queue-list">
                <h4>Ultimas autopsias publicadas</h4>
                {autopsyQueue?.recent_autopsies.length ? autopsyQueue.recent_autopsies.slice(0, 8).map((item) => (
                  <a href={`/partidos/${item.slug}/`} key={item.id}>
                    <strong>{item.headline}</strong>
                    <small>#{item.match_number} · {item.best_model} · {Math.round((1 - item.best_error) * 1000) / 10}% al desenlace real</small>
                  </a>
                )) : <p>Aun no hay autopsias publicadas.</p>}
              </div>
            </div>
          </section>
        )}

        {quality && (
          <section className="live-panel data-quality-panel">
            <div className="workflow-title">
              <ClipboardCheck />
              <h3>Estado de datos del Mundial Lab</h3>
            </div>
            <div className="quality-kpis">
              <span><small>Resultados verificados</small><strong>{quality.totals.verified_results}/{quality.totals.matches_total}</strong></span>
              <span><small>Lineups</small><strong>{quality.totals.with_lineups}/{quality.totals.matches_total}</strong></span>
              <span><small>Stats/eventos</small><strong>{quality.totals.with_live_features}/{quality.totals.matches_total}</strong></span>
              <span><small>Tiros</small><strong>{quality.totals.with_shots}/{quality.totals.matches_total}</strong></span>
              <span><small>xG v1</small><strong>{quality.totals.with_xg}/{quality.totals.matches_total}</strong></span>
              <span><small>Clima</small><strong>{quality.totals.with_weather}/{quality.totals.matches_total}</strong></span>
            </div>
            <div className="admin-inline-actions">
              <button className="secondary-action compact" onClick={refreshQuality} type="button">Refrescar estado</button>
              <button className="secondary-action compact" disabled={backfillingXg} onClick={recalculateXg} type="button">
                {backfillingXg ? "Recalculando..." : "Recalcular xG v1"}
              </button>
            </div>
            <div className="quality-table">
              {quality.matches.slice(0, 20).map((match) => (
                <a href={`/partidos/${match.slug}/`} key={match.id}>
                  <strong>#{match.match_number} {match.home_team} vs {match.away_team}</strong>
                  <span className={match.result_trust_level === "real_verificado" ? "ok" : "pending"}>resultado</span>
                  <span className={match.has_lineups ? "ok" : "pending"}>lineup {match.lineup_rows || ""}</span>
                  <span className={match.has_live_features ? "ok" : "pending"}>stats</span>
                  <span className={match.has_shots ? "ok" : "pending"}>tiros {match.shot_rows || ""}</span>
                  <span className={match.has_xg ? "ok" : "pending"}>xG {match.xg_rows || ""}</span>
                  <span className={match.has_weather ? "ok" : "pending"}>clima</span>
                </a>
              ))}
            </div>
            <div className="jobs-list">
              <h4>Ultimas ingestas</h4>
              {quality.recent_jobs.slice(0, 6).map((job, index) => (
                <span key={`${job.source}-${job.job_type}-${index}`}>
                  <strong>{job.job_type}</strong>
                  <small>{job.source} · {job.status}</small>
                  <b>{job.rows_inserted}/{job.rows_seen}</b>
                </span>
              ))}
            </div>
          </section>
        )}

        {result && (
          <>
            <section className="house-results-grid">
              <article className="live-panel">
                <div className="workflow-title">
                  <Trophy />
                  <h3>Favoritos de la casa</h3>
                </div>
                <div className="house-ranking">
                  {result.champion.slice(0, 8).map((team) => (
                    <span key={team.team_id}>
                      <strong>{team.team}</strong>
                      <b>{pct(team.champion)}</b>
                      <i style={{ width: pct(team.champion) }} />
                    </span>
                  ))}
                </div>
              </article>

              <article className="live-panel">
                <div className="workflow-title">
                  <Activity />
                  <h3>Upsets que vigila Hadox</h3>
                </div>
                <ul className="house-list">
                  {result.top_upsets.length ? result.top_upsets.map((item) => <li key={item}>{item}</li>) : <li>Sin upsets recurrentes en esta corrida.</li>}
                </ul>
              </article>
            </section>

            <section className="house-results-grid">
              <article className="live-panel">
                <div className="workflow-title">
                  <Database />
                  <h3>Fuentes y madurez</h3>
                </div>
                <div className="source-table">
                  {result.data_sources.map((source) => (
                    <span key={source.name}>
                      <strong>{source.name}</strong>
                      <small>{source.maturity}</small>
                      <em>{source.role}</em>
                    </span>
                  ))}
                </div>
              </article>

              <article className="live-panel">
                <div className="workflow-title">
                  <BarChart3 />
                  <h3>Ajustes de estadio</h3>
                </div>
                <div className="stadium-adjustments">
                  {result.stadium_adjustments.slice(0, 6).map((item) => (
                    <span key={`${item.match}-${item.venue}`}>
                      <strong>{item.city}</strong>
                      <small>{item.venue}</small>
                      <b>tempo {item.tempo.toFixed(2)} / edge {item.home_edge.toFixed(2)}</b>
                    </span>
                  ))}
                </div>
              </article>
            </section>

            <article className="live-panel house-methodology">
              <h3>Metodologia</h3>
              <p>{result.methodology}</p>
            </article>
          </>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<AdminLiveControlPage />);
