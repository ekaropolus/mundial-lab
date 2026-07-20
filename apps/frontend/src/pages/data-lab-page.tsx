import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { Activity, ClipboardCheck, Database, FlaskConical, Radio, Trophy } from "lucide-react";
import { SiteFooter } from "../components/SiteFooter";
import { fetchLearningLog, fetchPublicDataQuality } from "../lib/api";
import { DataQualitySummary, LearningLogEntry } from "../types";
import "../styles.css";

function pct(done: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((done / total) * 100)}%`;
}

function statusClass(value: boolean) {
  return value ? "ok" : "pending";
}

function parseProbability(entry: LearningLogEntry) {
  try {
    const params = JSON.parse(entry.best_parameters_json) as {
      best_contract?: { probability_for_real_outcome?: number };
      probability_for_real_outcome?: number;
    };
    return params.best_contract?.probability_for_real_outcome ?? params.probability_for_real_outcome ?? 1 - entry.best_error;
  } catch {
    return 1 - entry.best_error;
  }
}

function DataLabPage() {
  const [quality, setQuality] = useState<DataQualitySummary | null>(null);
  const [entries, setEntries] = useState<LearningLogEntry[]>([]);
  const [mode, setMode] = useState("cargando");

  useEffect(() => {
    fetchPublicDataQuality()
      .then((item) => {
        setQuality(item);
        setMode("datos conectados");
      })
      .catch(() => setMode("sin API"));
    fetchLearningLog(80)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  const weakMatches = useMemo(() => {
    if (!quality) return [];
    return quality.matches
      .filter((match) => !match.has_shots || !match.has_live_features || !match.has_lineups || !match.has_xg)
      .slice(0, 12);
  }, [quality]);

  const strongestAutopsies = useMemo(
    () => [...entries].sort((a, b) => parseProbability(b) - parseProbability(a)).slice(0, 5),
    [entries],
  );
  const latestJob = quality?.recent_jobs[0];
  const latestCoveredMatch = quality?.matches
    .filter((match) => match.status === "finished")
    .sort((a, b) => b.match_number - a.match_number)[0];

  return (
    <main>
      <nav className="nav page-nav" aria-label="Navegacion principal">
        <a className="brand" href="/">
          <Trophy size={22} />
          <span>Mundial Lab</span>
        </a>
        <div className="nav-links">
          <a href="/montecarlo-casa/">Monte Carlo</a>
          <a href="/partidos/">Partidos</a>
          <a href="/diario-aprendizaje/">Diario</a>
          <a href="/modelos/ensemble/">Modelos</a>
        </div>
      </nav>

      <section className="data-lab-hero">
        <div>
          <p className="section-kicker">Laboratorio de datos - {mode}</p>
          <h1>Antes de creerle al modelo, mira de que esta hecho.</h1>
          <p>
            Esta es la mesa de auditoria: resultados verificados, lineups, tiros, xG, clima y
            cobertura por partido. Si falta una senal, el modelo debe bajar la voz.
          </p>
          <div className="hero-actions">
            <a href="/partidos/">Entrar a un partido</a>
            <a className="ghost" href="/diario-aprendizaje/">Ver autopsias</a>
          </div>
        </div>
        <aside>
          <Database size={28} />
          <strong>{quality ? pct(quality.totals.verified_results, quality.totals.matches_total) : "..."}</strong>
          <span>resultados verificados</span>
        </aside>
      </section>

      <section className="data-now-panel">
        <article>
          <span>Ultima ingesta</span>
          <strong>{latestJob ? latestJob.job_type : "esperando API"}</strong>
          <small>{latestJob ? `${latestJob.source} - ${latestJob.rows_inserted} filas` : "Todavia no hay jobs recientes."}</small>
        </article>
        <article>
          <span>Partido mas reciente en auditoria</span>
          {latestCoveredMatch ? (
            <a href={`/partidos/${latestCoveredMatch.slug}/`}>
              <strong>#{latestCoveredMatch.match_number} {latestCoveredMatch.home_team} vs {latestCoveredMatch.away_team}</strong>
              <small>
                {latestCoveredMatch.has_shots ? "tiros " : "sin tiros "}
                {latestCoveredMatch.has_xg ? "- xG " : "- sin xG "}
                {latestCoveredMatch.has_weather ? "- clima" : "- sin clima"}
              </small>
            </a>
          ) : (
            <p>No hay partido terminado con auditoria todavia.</p>
          )}
        </article>
        <article>
          <span>Autopsia fuerte reciente</span>
          {strongestAutopsies[0] ? (
            <a href={`/diario-aprendizaje/?match=${strongestAutopsies[0].slug}`}>
              <strong>{strongestAutopsies[0].home_team} {strongestAutopsies[0].home_score}-{strongestAutopsies[0].away_score} {strongestAutopsies[0].away_team}</strong>
              <small>{Math.round(parseProbability(strongestAutopsies[0]) * 1000) / 10}% al desenlace real</small>
            </a>
          ) : (
            <p>La cola aun no deja una autopsia fuerte.</p>
          )}
        </article>
      </section>

      {quality && (
        <>
          <section className="data-lab-kpis">
            <article>
              <ClipboardCheck />
              <span>Resultados</span>
              <strong>{quality.totals.verified_results}/{quality.totals.matches_total}</strong>
              <small>{pct(quality.totals.verified_results, quality.totals.matches_total)} cubierto</small>
            </article>
            <article>
              <Radio />
              <span>Tiros y eventos</span>
              <strong>{quality.totals.with_shots}/{quality.totals.matches_total}</strong>
              <small>{pct(quality.totals.with_shots, quality.totals.matches_total)} con mapa</small>
            </article>
            <article>
              <Activity />
              <span>xG v1</span>
              <strong>{quality.totals.with_xg}/{quality.totals.matches_total}</strong>
              <small>{pct(quality.totals.with_xg, quality.totals.matches_total)} calculado</small>
            </article>
            <article>
              <FlaskConical />
              <span>Lineups</span>
              <strong>{quality.totals.with_lineups}/{quality.totals.matches_total}</strong>
              <small>{pct(quality.totals.with_lineups, quality.totals.matches_total)} con jugadores</small>
            </article>
          </section>

          <section className="data-lab-layout">
            <article className="live-panel data-lab-board">
              <div className="workflow-title">
                <Database />
                <h2>Cobertura por partido</h2>
              </div>
              <div className="data-lab-table">
                {quality.matches.slice(0, 32).map((match) => (
                  <a href={`/partidos/${match.slug}/`} key={match.id}>
                    <strong>#{match.match_number} {match.home_team} vs {match.away_team}</strong>
                    <span className={match.result_trust_level === "real_verificado" ? "ok" : "pending"}>resultado</span>
                    <span className={statusClass(match.has_lineups)}>lineup {match.lineup_rows || ""}</span>
                    <span className={statusClass(match.has_live_features)}>stats</span>
                    <span className={statusClass(match.has_shots)}>tiros {match.shot_rows || ""}</span>
                    <span className={statusClass(match.has_xg)}>xG {match.xg_rows || ""}</span>
                    <span className={statusClass(match.has_weather)}>clima</span>
                  </a>
                ))}
              </div>
            </article>

            <aside className="data-lab-side">
              <article>
                <h3>Que falta para subir el nivel</h3>
                {weakMatches.length ? weakMatches.map((match) => (
                  <a href={`/partidos/${match.slug}/`} key={`weak-${match.id}`}>
                    <strong>#{match.match_number} {match.home_team} vs {match.away_team}</strong>
                    <small>
                      {!match.has_lineups && "lineup "}
                      {!match.has_shots && "tiros "}
                      {!match.has_xg && "xG "}
                      {!match.has_weather && "clima "}
                    </small>
                  </a>
                )) : <p>La cobertura critica esta completa en los partidos cargados.</p>}
              </article>
              <article>
                <h3>Autopsias con mas evidencia</h3>
                {strongestAutopsies.map((entry) => (
                  <a href={`/diario-aprendizaje/?match=${entry.slug}`} key={entry.id}>
                    <strong>{entry.home_team} {entry.home_score}-{entry.away_score} {entry.away_team}</strong>
                    <small>{Math.round(parseProbability(entry) * 1000) / 10}% al desenlace real</small>
                  </a>
                ))}
                {!strongestAutopsies.length && <p>Cuando cierre la cola, aqui aparecen las autopsias fuertes.</p>}
              </article>
              <article>
                <h3>Ultimas ingestas</h3>
                {quality.recent_jobs.slice(0, 6).map((job, index) => (
                  <span key={`${job.source}-${job.job_type}-${index}`}>
                    <strong>{job.job_type}</strong>
                    <small>{job.source} - {job.status} - {job.rows_inserted}/{job.rows_seen}</small>
                  </span>
                ))}
              </article>
            </aside>
          </section>
        </>
      )}

      <SiteFooter />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<DataLabPage />);
