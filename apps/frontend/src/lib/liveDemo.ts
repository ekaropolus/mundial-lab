import { DirectorScore, Match, MatchDetail } from "../types";
import { fixtureMatches } from "./fixture";

export const demoMatches: Match[] = fixtureMatches.map((match, index) =>
  index === 0
    ? { ...match, status: "live", minute: 37, home_score: 1, away_score: 1 }
    : match,
);

export function demoMatch(slug: string): MatchDetail {
  const match = demoMatches.find((item) => item.slug === slug) ?? demoMatches[0];
  return {
    match,
    events: [
      {
        id: 1,
        match_id: match.id,
        minute: 12,
        event_type: "goal",
        team_id: match.home_team_id,
        description: `${match.home_team} abre el marcador despues de presion alta.`,
        source: "demo",
        status: "verified",
      },
      {
        id: 2,
        match_id: match.id,
        minute: 31,
        event_type: "goal",
        team_id: match.away_team_id,
        description: `${match.away_team} empata y cambia el momentum.`,
        source: "demo",
        status: "verified",
      },
    ],
    predictions: [
      {
        id: 1,
        match_id: match.id,
        director_name: "IA Mesa Central",
        model: "ensemble",
        minute: match.minute,
        home_win: 0.37,
        draw: 0.34,
        away_win: 0.29,
        notes: "Demo local con marcador vivo.",
      },
    ],
  };
}

export const demoLeaderboard: DirectorScore[] = [
  { director_name: "IA Mesa Central", predictions: 8, score: 0.74 },
  { director_name: "Directora Bayes", predictions: 6, score: 0.69 },
  { director_name: "Poisson FC", predictions: 6, score: 0.64 },
];
