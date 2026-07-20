import { useEffect, useState } from "react";
import {
  BarChart3,
  BrainCircuit,
  CalendarDays,
  ClipboardCheck,
  Cpu,
  Database,
  Film,
  Menu,
  Radio,
  Trophy,
  UploadCloud,
} from "lucide-react";
import { ModelOrbit } from "./components/ModelOrbit";
import { SiteFooter } from "./components/SiteFooter";
import { fetchLeaderboard, fetchLearningLog, fetchMatches, fetchPublicDataQuality } from "./lib/api";
import { demoLeaderboard, demoMatches } from "./lib/liveDemo";
import { fallbackModels } from "./lib/modelContent";
import { featuredMomentCopy, getTournamentMoment, matchMomentLabel, matchMomentTone, sortByTournamentTime } from "./lib/tournamentMoment";
import { DataQualitySummary, DirectorScore, LearningLogEntry, Match } from "./types";
import "./styles.css";

const initialFeaturedMatch = demoMatches[0];

const editorialPillars = [
  {
    icon: Cpu,
    title: "Simulacion Monte Carlo",
    text: "Miles de Mundiales antes del silbatazo: grupos, llaves, favoritos, sorpresas y caminos al titulo.",
    href: "/montecarlo-casa/",
  },
  {
    icon: Film,
    title: "Replay 3D narrado",
    text: "La prediccion se vuelve escena: cancha, momentum, xG, zonas calientes y relato pambolero.",
    href: "/simulador-partido/",
  },
  {
    icon: Radio,
    title: "Sala de control del partido",
    text: "Entra a la cabina, ajusta la lectura y defiende una prediccion con datos.",
    href: "/partidos/",
  },
  {
    icon: BrainCircuit,
    title: "Casa de conocimiento",
    text: "Cada modelo explica como lee la cancha, cuando creerle y cuando dudar.",
    href: "/modelos/ensemble/",
  },
];

const userFlow = [
  "Mira primero la linea Monte Carlo del torneo.",
  "Elige un partido y entra a su sala de analisis.",
  "Revisa datos, estadio, jugadores y probabilidad viva.",
  "Opera como Data Director o sube tu lectura desde notebook.",
  "Guarda tu postura, comparte tarjeta y espera la autopsia.",
];

function autopsySignal(entry: LearningLogEntry) {
  try {
    const params = JSON.parse(entry.best_parameters_json) as {
      best_contract?: { probability_for_real_outcome?: number; contract?: string };
      probability_for_real_outcome?: number;
    };
    return {
      contract: params.best_contract?.contract ?? entry.best_model,
      probability: params.best_contract?.probability_for_real_outcome ?? params.probability_for_real_outcome ?? 1 - entry.best_error,
    };
  } catch {
    return { contract: entry.best_model, probability: 1 - entry.best_error };
  }
}

export default function App() {
  const [leaderboard, setLeaderboard] = useState<DirectorScore[]>(demoLeaderboard);
  const [leaderboardMode, setLeaderboardMode] = useState("demo");
  const [matches, setMatches] = useState<Match[]>(demoMatches);
  const [matchesMode, setMatchesMode] = useState("demo");
  const [featuredAutopsy, setFeaturedAutopsy] = useState<LearningLogEntry | null>(null);
  const [quality, setQuality] = useState<DataQualitySummary | null>(null);

  const moment = getTournamentMoment(matches);
  const featuredMatch = moment.featuredMatch ?? initialFeaturedMatch;
  const scheduledMatches = matches.filter((match) => match.status === "scheduled").sort(sortByTournamentTime);
  const recentFinished = matches
    .filter((match) => match.status === "finished")
    .sort((a, b) => b.match_number - a.match_number)
    .slice(0, 3);
  const nextMatches = scheduledMatches.slice(0, 5);
  const replayHref = `/simulador-partido/?match=${featuredMatch.slug}`;
  const matchHref = `/partidos/${featuredMatch.slug}/`;
  const featuredLabel = featuredMomentCopy(moment);
  const featuredMeta = `${matchMomentLabel(featuredMatch)} - ${featuredMatch.venue}`;
  const featuredSourceLabel =
    featuredMatch.result_trust_level === "real_verificado"
      ? "Two-source verified result."
      : matchesMode === "api"
        ? "Actualizado desde la API local de Mundial Lab."
        : "Demo local: API no disponible.";
  const featuredAutopsySignal = featuredAutopsy ? autopsySignal(featuredAutopsy) : null;
  const autopsyHref = featuredAutopsy ? `/diario-aprendizaje/?match=${featuredAutopsy.slug}` : "/diario-aprendizaje/";
  const autopsyReplayHref = featuredAutopsy ? `/simulador-partido/?match=${featuredAutopsy.slug}` : replayHref;
  const autopsyMatchHref = featuredAutopsy ? `/partidos/${featuredAutopsy.slug}/` : matchHref;

  useEffect(() => {
    fetchLeaderboard()
      .then((items) => {
        setLeaderboard(items.length ? items : demoLeaderboard);
        setLeaderboardMode(items.length ? "live" : "demo");
      })
      .catch(() => setLeaderboardMode("demo"));
  }, []);

  useEffect(() => {
    fetchMatches()
      .then((items) => {
        setMatches(items.length ? items : demoMatches);
        setMatchesMode(items.length ? "api" : "demo");
      })
      .catch(() => setMatchesMode("demo"));
  }, []);

  useEffect(() => {
    fetchLearningLog(100)
      .then((items) => {
        const ranked = [...items].sort((a, b) => {
          const aLift = (1 - a.best_error) - (1 - a.original_error);
          const bLift = (1 - b.best_error) - (1 - b.original_error);
          return bLift - aLift || (1 - b.best_error) - (1 - a.best_error);
        });
        setFeaturedAutopsy(ranked[0] ?? null);
      })
      .catch(() => setFeaturedAutopsy(null));
  }, []);

  useEffect(() => {
    fetchPublicDataQuality()
      .then(setQuality)
      .catch(() => setQuality(null));
  }, []);

  return (
    <main>
      <section className="hero director-hero editorial-home">
        <nav className="nav" aria-label="Navegacion principal">
          <a className="brand" href="/">
            <Trophy size={22} />
            <span>Mundial Lab</span>
          </a>
          <div className="nav-links">
            <a href="#tablero">Tablero</a>
            <a href="/partidos/">Partidos</a>
            <a href="/montecarlo-casa/">Monte Carlo</a>
            <a href="/diario-aprendizaje/">Diario</a>
            <a href="/laboratorio-datos/">Datos</a>
            <a href={replayHref}>Replay 3D</a>
            <a href="/directores/">Directores</a>
            <a href="/modelos/ensemble/">Modelos</a>
          </div>
          <button className="menu-button" aria-label="Abrir menu">
            <Menu size={18} />
          </button>
        </nav>

        <div className="home-hero-grid" id="inicio">
          <div className="hero-copy">
            <p className="eyebrow">Futbol contra algoritmo</p>
            <h1>¿Le puedes ganar a las IAs más finas del Mundial?</h1>
            <p>
              Monte Carlo pone la línea. El replay la convierte en película. Tú entras como Data
              Director a mover datos, defender una predicción y publicar la autopsia cuando cae el marcador.
            </p>
            <div className="hero-actions">
              <a href="montecarlo-casa/">Ver línea Monte Carlo</a>
              <a className="ghost" href={replayHref}>Ver replay 3D</a>
              <a className="ghost" href={matchHref}>Entrar al partido</a>
            </div>
          </div>

          <aside className="home-broadcast-card" aria-label="Lectura destacada">
            <span>La máquina calcula</span>
            <strong>La cancha contesta</strong>
            <p>
              Cada partido deja una tarjeta, una autopsia y una lección para el siguiente tiro.
            </p>
            <div>
              <b>{matches.length}</b>
              <small>partidos</small>
              <b>{fallbackModels.length}</b>
              <small>modelos</small>
            </div>
          </aside>
        </div>
      </section>

      <section className="score-strip home-score-strip" aria-label="Resumen del laboratorio">
        <article>
          <strong>{moment.finishedCount}</strong>
          <span>partidos cerrados</span>
        </article>
        <article>
          <strong>{moment.verifiedCount}</strong>
          <span>resultados verificados</span>
        </article>
        <article>
          <strong>{quality?.totals.with_xg ?? 0}</strong>
          <span>partidos con xG v1</span>
        </article>
        <article>
          <strong>{moment.scheduledCount}</strong>
          <span>partidos por tomar</span>
        </article>
      </section>

      <section className="home-now-panel" aria-label="Momento actual del Mundial Lab">
        <article className={`now-main ${matchMomentTone(featuredMatch)}`}>
          <span>{featuredLabel}</span>
          <h2>{featuredMatch.home_team} vs {featuredMatch.away_team}</h2>
          <p>{featuredMeta}. {featuredSourceLabel}</p>
          <div>
            <a href={matchHref}>Abrir sala</a>
            <a href={replayHref}>Replay 3D</a>
          </div>
        </article>
        <article>
          <span>Ultimos cierres</span>
          {recentFinished.map((match) => (
            <a href={`/partidos/${match.slug}/`} key={match.id}>
              <strong>{match.home_team} {match.home_score}-{match.away_score} {match.away_team}</strong>
              <small>{match.result_trust_level === "real_verificado" ? "verificado por dos fuentes" : "ingestado por automatizacion"}</small>
            </a>
          ))}
        </article>
        <article>
          <span>Siguiente silbatazo</span>
          {moment.nextMatch ? (
            <a href={`/partidos/${moment.nextMatch.slug}/`}>
              <strong>{moment.nextMatch.home_team} vs {moment.nextMatch.away_team}</strong>
              <small>{moment.nextMatch.local_time_label} - {moment.nextMatch.venue}</small>
            </a>
          ) : (
            <p>No hay siguiente partido programado en la API.</p>
          )}
          <span>Ingesta reciente</span>
          <small>{quality?.recent_jobs[0] ? `${quality.recent_jobs[0].job_type}: ${quality.recent_jobs[0].rows_inserted} filas` : "esperando API de datos"}</small>
        </article>
      </section>

      <section className="home-data-cta">
        <div>
          <p className="section-kicker">Datos antes que humo</p>
          <h2>La prediccion tambien trae etiqueta de calidad.</h2>
          <p>
            Revisa que partidos tienen resultado verificado, tiros, xG, clima y lineups. Si una senal
            falta, el modelo debe explicarlo en vez de vender seguridad falsa.
          </p>
        </div>
        <a href="laboratorio-datos/">
          <Database size={20} />
          Abrir laboratorio de datos
        </a>
      </section>

      <section className="home-fast-challenge">
        <div>
          <p className="section-kicker">Empieza rápido</p>
          <h2>Un partido. Una lectura. Una tarjeta para presumir.</h2>
          <p>
            El flujo ya no es perderse en el laboratorio: abres partido, eliges modelo, subes o ajustas
            tu predicción y luego comparas contra la autopsia.
          </p>
        </div>
        <div className="challenge-actions">
          <a href={matchHref}>
            <strong>{featuredMatch.home_team} vs {featuredMatch.away_team}</strong>
            <span>Hacer mi primera lectura</span>
          </a>
          <a href="directores/">
            <strong>Leaderboard {leaderboardMode}</strong>
            <span>Ver quién reta la línea</span>
          </a>
        </div>
      </section>

      <section className="home-live-stories">
        <div>
          <p className="section-kicker">Lo que ya esta pasando</p>
          <h2>Partidos reales, autopsias reales y Data Directors dejando huella.</h2>
          <p>
            Mundial Lab no se queda en promesa: cada resultado cerrado alimenta el diario,
            cada alias entra al ranking y cada partido deja una historia publicable para aprender.
          </p>
        </div>
        <div className="home-live-story-grid">
          <a href={autopsyHref}>
            <span>Autopsia destacada</span>
            <strong>{featuredAutopsy ? featuredAutopsy.headline : "La siguiente autopsia cae al cerrar marcador."}</strong>
            <small>{featuredAutopsy ? `${featuredAutopsy.home_team} vs ${featuredAutopsy.away_team}` : "Scheduler activo"}</small>
          </a>
          <a href="directores/">
            <span>Director arriba</span>
            <strong>{leaderboard[0]?.director_name ?? "Primer alias disponible"}</strong>
            <small>{leaderboard[0] ? `${Math.round(leaderboard[0].score * 100)} pts en ${leaderboard[0].predictions} lecturas` : "Guarda tu lectura y aparece aqui"}</small>
          </a>
          <a href={matchHref}>
            <span>Partido para tomar postura</span>
            <strong>{featuredMatch.home_team} vs {featuredMatch.away_team}</strong>
            <small>Datos, modelo, notebook y replay 3D</small>
          </a>
        </div>
      </section>

      <section className="home-autopsy-cta">
        <div>
          <p className="section-kicker">Autopsia + kit publicable</p>
          <h2>{featuredAutopsy ? featuredAutopsy.headline : "Cada silbatazo final deja evidencia."}</h2>
          {featuredAutopsy ? (
            <p>
              {featuredAutopsy.home_team} {featuredAutopsy.home_score}-{featuredAutopsy.away_score}{" "}
              {featuredAutopsy.away_team}. El modelo encontro{" "}
              {featuredAutopsySignal ? `${Math.round(featuredAutopsySignal.probability * 1000) / 10}%` : "una nueva lectura"}{" "}
              al desenlace real con {featuredAutopsySignal?.contract ?? "su mejor contrato"}.
            </p>
          ) : (
            <p>
              Cuando un partido cierra, Mundial Lab audita los modelos: que vio la linea base,
              que senal peso y que debe robarse un Data Director para la siguiente prediccion.
            </p>
          )}
        </div>
        <div>
          <a href={autopsyHref}>
            <ClipboardCheck size={20} />
            Abrir autopsia y kit
          </a>
          <a href={autopsyReplayHref}>
            <Film size={20} />
            Ver replay conectado
          </a>
          <a href={autopsyMatchHref}>
            <Radio size={20} />
            Retar este partido
          </a>
        </div>
      </section>

      <section className="home-manifest">
        <div className="section-heading">
          <p className="section-kicker">Monte Carlo público</p>
          <h2>La línea está puesta. Ahora hay que romperla.</h2>
          <p>
            El tablero corre miles de Mundiales y deja una postura por partido. No es profecía:
            es el rival público que los Data Directors tienen que superar.
          </p>
          <div className="section-actions">
            <a href="montecarlo-casa/">Abrir simulación</a>
            <a href="diario-aprendizaje/">Ver autopsias</a>
          </div>
        </div>
        <div className="manifest-grid">
          {editorialPillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <a className="manifest-card" href={pillar.href} key={pillar.title}>
                <Icon size={24} />
                <strong>{pillar.title}</strong>
                <p>{pillar.text}</p>
              </a>
            );
          })}
        </div>
      </section>

      <section className="home-flow">
        <div>
          <p className="section-kicker">Replay 3D</p>
          <h2>Una película corta de datos, no un videojuego falso.</h2>
          <p>
            El replay toma la línea Monte Carlo, momentum, xG y eventos para narrar por qué el modelo
            vio lo que vio.
          </p>
          <div className="section-actions">
            <a href={replayHref}>Ver replay 3D</a>
          </div>
        </div>
        <ol>
          {userFlow.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="director-board home-board" id="tablero">
        <div className="section-heading">
          <p className="section-kicker">Match room</p>
          <h2>Toma la cabina: aqui mandas como Data Director.</h2>
          <p>
            Entra a cada partido como si estuvieras en la mesa de analisis: contexto, jugadores,
            estadio, probabilidad viva e interpretacion del modelo. No vienes a mirar: vienes a
            tomar postura.
          </p>
        </div>

        <div className="board-grid">
          <a className="command-card featured-command home-featured-command" href={matchHref}>
            <span>
              <Radio size={16} />
              {featuredLabel}
            </span>
            <strong>
              {featuredMatch.home_team} {featuredMatch.home_score} - {featuredMatch.away_score}{" "}
              {featuredMatch.away_team}
            </strong>
            <small>{featuredMeta}</small>
            <em>{featuredSourceLabel}</em>
          </a>

          <a className="command-card house-command" href="montecarlo-casa/">
            <span>
              <Cpu size={16} />
              Simulacion del torneo
            </span>
            <strong>El Mundial completo, jugado miles de veces.</strong>
            <small>Llaves, favoritos, historial de corridas y caminos al titulo.</small>
          </a>

          <section className="command-card">
            <span>
              <CalendarDays size={16} />
              Proximos partidos
            </span>
            <div className="compact-list">
              {nextMatches.length ? (
                nextMatches.map((match) => (
                  <a href={`/partidos/${match.slug}/`} key={match.id}>
                    <strong>{match.home_team} vs {match.away_team}</strong>
                    <small>{match.local_time_label} - {match.stage}</small>
                  </a>
                ))
              ) : (
                <small>No hay partidos programados en la API local ahora.</small>
              )}
            </div>
          </section>

          <section className="command-card">
            <span>
              <BrainCircuit size={16} />
              Casas de conocimiento
            </span>
            <div className="model-pills">
              {fallbackModels.map((model) => (
                <a href={`modelos/${model.id}/`} key={model.id}>
                  {model.short_name}
                  <small>{model.status}</small>
                </a>
              ))}
            </div>
          </section>

          <section className="command-card">
            <span>
              <BarChart3 size={16} />
              Public ranking - {leaderboardMode}
            </span>
            <div className="leaderboard-mini">
              {leaderboard.slice(0, 5).map((director, index) => (
                <div key={director.director_name}>
                  <b>{index + 1}</b>
                  <strong>{director.director_name}</strong>
                  <small>{director.predictions} readings - {Math.round(director.score * 100)} pts</small>
                </div>
              ))}
            </div>
          </section>

          <a className="command-card" href={replayHref}>
            <span>
              <Film size={16} />
              Replay 3D narrado
            </span>
            <strong>La prediccion convertida en una pelicula corta del partido.</strong>
            <small>Cancha 3D, xG, momentum, subtitulos y narracion continua.</small>
          </a>
        </div>
      </section>

      <section className="home-lab-stack">
        <div className="lab-stack-copy">
          <p className="section-kicker">Dos formas de competir</p>
          <h2>Juega rapido o vete full notebook.</h2>
          <p>
            Puedes entrar como Data Director y mover la lectura desde la sala del partido. O, si
            quieres ponerte tecnico, descargar datos, trabajar en tu notebook y subir una prediccion validada.
          </p>
        </div>
        <div className="lab-stack-grid">
          <article>
            <Radio size={22} />
            <strong>Modo director</strong>
            <span>Usa controles visuales, mueve supuestos y guarda tu lectura sin friccion.</span>
          </article>
          <article>
            <UploadCloud size={22} />
            <strong>Modo cientifico de datos</strong>
            <span>Descarga datos, trabaja en tu notebook y sube una prediccion validada.</span>
          </article>
          <article>
            <ClipboardCheck size={22} />
            <strong>Prediccion defendible</strong>
            <span>Tu numero se compara contra el partido, la linea base y la comunidad.</span>
          </article>
        </div>
      </section>

      <section className="home-showcase">
        <div>
          <p className="section-kicker">Conocimiento de modelos</p>
          <h2>Aprende como piensa cada modelo.</h2>
          <p>
            Poisson, Elo, Dixon-Coles, Bayes en vivo y Ensamble no son botones magicos: cada uno lee
            el futbol distinto. Entra a sus casas y aprende cuando confiar, cuando dudar y cuando ajustar.
          </p>
          <div className="hero-actions">
            <a href="modelos/ensemble/">Explorar modelos</a>
            <a className="ghost" href="partidos/">Ver partidos</a>
          </div>
        </div>
        <ModelOrbit variant="home" />
      </section>

      <section className="home-about-lab">
        <div>
          <p className="section-kicker">Que es Mundial Lab</p>
          <h2>Detras del reto: futbol, datos y simulacion.</h2>
        </div>
        <p>
          Mundial Lab es un laboratorio abierto para mezclar futbol, datos y modelos. Creamos una
          linea base, publicamos el tablero y dejamos que estudiantes, analistas, ingenieros y
          cientificos de datos intenten superarla partido por partido.
        </p>
        <strong>La maquina pone el reto. La cancha dice la verdad. Tu traes la lectura.</strong>
      </section>

      <SiteFooter />
    </main>
  );
}
