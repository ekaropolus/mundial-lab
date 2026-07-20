import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Filter, Radio, Search, Trophy } from "lucide-react";
import { SiteFooter } from "../components/SiteFooter";
import { fetchMatches } from "../lib/api";
import { demoMatches } from "../lib/liveDemo";
import { teamFlag } from "../lib/teamVisuals";
import { getTournamentMoment, matchMomentLabel, matchMomentTone, sortByTournamentTime } from "../lib/tournamentMoment";
import { Match, MatchStatus } from "../types";
import "../styles.css";

const statusLabels: Record<"all" | MatchStatus, string> = {
  all: "Todos",
  scheduled: "Por jugar",
  live: "En vivo",
  halftime: "Medio tiempo",
  finished: "Cerrados",
};

function MatchTeams({ match }: { match: Match }) {
  return (
    <div className="match-teams">
      <span>
        <b>{teamFlag(match.home_team_id)}</b>
        {match.home_team}
      </span>
      <strong>{match.home_score} - {match.away_score}</strong>
      <span>
        <b>{teamFlag(match.away_team_id)}</b>
        {match.away_team}
      </span>
    </div>
  );
}

function MatchCard({ match, featured = false }: { match: Match; featured?: boolean }) {
  return (
    <a className={featured ? "match-card match-card-featured" : "match-card"} href={`./${match.slug}/`}>
      <span className={`match-status ${match.status}`}>
        {match.status === "live" ? <Radio size={14} /> : <CalendarDays size={14} />}
        Partido {match.match_number} · {statusLabels[match.status]}
      </span>
      <MatchTeams match={match} />
      <small>
        {match.stage} · {match.status === "live" ? `Minuto ${match.minute}` : match.local_time_label}
      </small>
      <em>{match.venue}, {match.city}</em>
      <strong className="match-open">Abrir sala de control</strong>
    </a>
  );
}

function MatchesPage() {
  const [matches, setMatches] = useState<Match[]>(demoMatches);
  const [mode, setMode] = useState("demo local");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | MatchStatus>("all");
  const [phase, setPhase] = useState("all");

  useEffect(() => {
    fetchMatches()
      .then((items) => {
        setMatches(items);
        setMode("API activa");
      })
      .catch(() => setMode("demo local"));
  }, []);

  const phases = useMemo(() => ["all", ...Array.from(new Set(matches.map((match) => match.phase)))], [matches]);
  const moment = getTournamentMoment(matches);
  const featuredMatch = moment.featuredMatch ?? matches[0];
  const latestFinished = moment.latestFinished;
  const nextMatch = moment.nextMatch;
  const filteredMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...matches].sort(sortByTournamentTime).filter((match) => {
      const text = `${match.home_team} ${match.away_team} ${match.venue} ${match.city} ${match.stage}`.toLowerCase();
      const statusMatch = status === "all" || match.status === status;
      const phaseMatch = phase === "all" || match.phase === phase;
      const queryMatch = !normalizedQuery || text.includes(normalizedQuery);
      return statusMatch && phaseMatch && queryMatch;
    });
  }, [matches, phase, query, status]);

  return (
    <main>
      <nav className="nav page-nav" aria-label="Navegación principal">
        <a className="brand" href="/">
          <Trophy size={22} />
          <span>Mundial Lab</span>
        </a>
        <div className="nav-links">
          <a href="/">Tablero</a>
          <a href="/montecarlo-casa/">Monte Carlo</a>
          <a href="/laboratorio-datos/">Datos</a>
          <a href="/directores/">Directores</a>
        </div>
      </nav>

      <section className="matches-hero">
        <div>
          <p className="section-kicker">Partidos · {mode}</p>
          <h1>Elige la cancha que vas a dirigir.</h1>
          <p>
            Filtra el calendario, detecta partidos vivos y entra a la sala de control donde los
            modelos, jugadores y eventos cambian la lectura.
          </p>
          <div className="matches-now-strip">
            {latestFinished && (
              <a href={`./${latestFinished.slug}/`}>
                <span>Ultimo cierre</span>
                <strong>{latestFinished.home_team} {latestFinished.home_score}-{latestFinished.away_score} {latestFinished.away_team}</strong>
                <small>{latestFinished.result_trust_level === "real_verificado" ? "resultado verificado" : "ingestado por automatizacion"}</small>
              </a>
            )}
            {nextMatch && (
              <a href={`./${nextMatch.slug}/`}>
                <span>Siguiente silbatazo</span>
                <strong>{nextMatch.home_team} vs {nextMatch.away_team}</strong>
                <small>{nextMatch.local_time_label} - {nextMatch.venue}</small>
              </a>
            )}
          </div>
        </div>
        <MatchCard match={featuredMatch} featured />
      </section>

      <section className="matches-workbench">
        <div className="matches-toolbar" aria-label="Controles de partidos">
          <label className="search-box">
            <Search size={18} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar equipo, sede, ciudad o grupo"
              type="search"
              value={query}
            />
          </label>

          <label>
            <Filter size={16} />
            <select onChange={(event) => setStatus(event.target.value as "all" | MatchStatus)} value={status}>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <CalendarDays size={16} />
            <select onChange={(event) => setPhase(event.target.value)} value={phase}>
              {phases.map((item) => (
                <option key={item} value={item}>
                  {item === "all" ? "Todas las fases" : item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="matches-summary">
          <article>
            <strong>{matches.length}</strong>
            <span>partidos cargados</span>
          </article>
          <article>
            <strong>{moment.finishedCount}</strong>
            <span>cerrados</span>
          </article>
          <article>
            <strong>{moment.verifiedCount}</strong>
            <span>verificados</span>
          </article>
          <article>
            <strong>{moment.ingestedCount}</strong>
            <span>ingestados por confirmar</span>
          </article>
        </div>

        <div className="match-grid enhanced-match-grid">
          {filteredMatches.map((match) => (
            <MatchCard match={match} key={match.id} />
          ))}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<MatchesPage />);
