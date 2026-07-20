import { Match, MatchStatus } from "../types";

export type TournamentMoment = {
  liveMatches: Match[];
  latestFinished?: Match;
  nextMatch?: Match;
  featuredMatch?: Match;
  featuredReason: "live" | "latest" | "next" | "fallback";
  verifiedCount: number;
  ingestedCount: number;
  scheduledCount: number;
  finishedCount: number;
};

const statusWeight: Record<MatchStatus, number> = {
  live: 4,
  halftime: 3,
  finished: 2,
  scheduled: 1,
};

function kickoffTime(match: Match) {
  const value = Date.parse(match.kickoff);
  return Number.isNaN(value) ? 0 : value;
}

export function sortByTournamentTime(a: Match, b: Match) {
  return kickoffTime(a) - kickoffTime(b) || a.match_number - b.match_number;
}

export function getTournamentMoment(matches: Match[]): TournamentMoment {
  const ordered = [...matches].sort(sortByTournamentTime);
  const liveMatches = ordered.filter((match) => match.status === "live" || match.status === "halftime");
  const finished = ordered.filter((match) => match.status === "finished");
  const scheduled = ordered.filter((match) => match.status === "scheduled");
  const latestFinished = [...finished].sort((a, b) => kickoffTime(b) - kickoffTime(a) || b.match_number - a.match_number)[0];
  const nextMatch = scheduled[0];
  const featuredMatch = liveMatches[0] ?? latestFinished ?? nextMatch ?? ordered[0];
  const featuredReason = liveMatches[0] ? "live" : latestFinished ? "latest" : nextMatch ? "next" : "fallback";

  return {
    liveMatches,
    latestFinished,
    nextMatch,
    featuredMatch,
    featuredReason,
    verifiedCount: matches.filter((match) => match.result_trust_level === "real_verificado").length,
    ingestedCount: matches.filter((match) => match.result_trust_level === "publico_ingestado").length,
    scheduledCount: scheduled.length,
    finishedCount: finished.length,
  };
}

export function matchMomentLabel(match: Match) {
  if (match.status === "live" || match.status === "halftime") return `Minuto ${match.minute}`;
  if (match.status === "finished") {
    const source = match.result_trust_level === "real_verificado" ? "verificado" : "ingestado";
    return `Final ${match.home_score}-${match.away_score} - ${source}`;
  }
  return match.local_time_label;
}

export function matchMomentTone(match: Match) {
  if (match.status === "live" || match.status === "halftime") return "is-live";
  if (match.status === "finished" && match.result_trust_level === "real_verificado") return "is-verified";
  if (match.status === "finished") return "is-ingested";
  return "is-next";
}

export function featuredMomentCopy(moment: TournamentMoment) {
  if (!moment.featuredMatch) return "Esperando datos del torneo.";
  if (moment.featuredReason === "live") return "La lectura viva esta en cancha.";
  if (moment.featuredReason === "latest") return "Ultimo resultado listo para autopsia.";
  if (moment.featuredReason === "next") return "Siguiente partido para tomar postura.";
  return "Partido destacado del laboratorio.";
}
