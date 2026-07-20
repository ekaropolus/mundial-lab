import { ModelName, SimulationResult, TeamProbability } from "../types";

const baseTeams = [
  ["arg", "Argentina", "A", 0.19],
  ["fra", "Francia", "A", 0.17],
  ["bra", "Brasil", "B", 0.13],
  ["eng", "Inglaterra", "C", 0.12],
  ["esp", "España", "B", 0.1],
  ["por", "Portugal", "C", 0.09],
  ["ned", "Países Bajos", "D", 0.07],
  ["ger", "Alemania", "D", 0.06],
] as const;

const modelBias: Record<ModelName, number[]> = {
  elo: [1.08, 1.04, 0.98, 1.03, 0.95, 0.94, 0.92, 0.93],
  poisson: [0.98, 1.02, 1.08, 0.96, 1.05, 1.0, 0.94, 0.97],
  dixon_coles: [0.96, 1.0, 0.98, 1.02, 1.03, 0.99, 1.04, 1.01],
  bayes_live: [1.0, 0.98, 0.96, 1.0, 0.97, 1.05, 1.02, 0.99],
  ensemble: [1.03, 1.03, 1.02, 1.0, 1.0, 0.98, 0.96, 0.97],
};

const methodology: Record<ModelName, string> = {
  elo: "Demo local: Elo estima fuerza relativa con ratings y una curva logística.",
  poisson: "Demo local: Poisson convierte ataque y defensa en marcadores esperados.",
  dixon_coles: "Demo local: Dixon-Coles corrige marcadores bajos y partidos cerrados.",
  bayes_live: "Demo local: Bayes en vivo actualiza creencias con evidencia nueva.",
  ensemble: "Demo local: el ensamble mezcla señales para comparar escenarios.",
};

export function localSimulation(model: ModelName, simulations: number): SimulationResult {
  const weights = baseTeams.map((team, index) => team[3] * modelBias[model][index]);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const summary: TeamProbability[] = baseTeams.map((team, index) => {
    const champion = weights[index] / total;
    return {
      team_id: team[0],
      team: team[1],
      group: team[2],
      champion,
      finalist: Math.min(0.78, champion * 1.85),
      semifinalist: Math.min(0.92, champion * 2.85),
      knockout: Math.min(0.98, champion * 4.2),
    };
  });

  return {
    job_id: `demo-${model}`,
    model,
    simulations,
    seed: 2026,
    summary: summary.sort((a, b) => b.champion - a.champion),
    top_upsets: ["Demo local sin servidor activo"],
    methodology: methodology[model],
  };
}

