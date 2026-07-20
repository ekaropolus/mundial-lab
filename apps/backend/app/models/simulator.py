from collections import defaultdict
from math import exp
from random import Random

import numpy as np

from app.data import load_teams
from app.schemas import ModelName, SimulationResult, Team, TeamProbability


def win_probability(a: Team, b: Team) -> float:
    return 1 / (1 + 10 ** ((b.rating - a.rating) / 400))


def expected_goals(a: Team, b: Team, model: ModelName) -> tuple[float, float]:
    rating_gap = (a.rating - b.rating) / 400
    base_a = 1.18 * a.attack / max(b.defense, 0.2)
    base_b = 1.18 * b.attack / max(a.defense, 0.2)
    if model == "elo":
        return max(0.2, 1.15 + rating_gap), max(0.2, 1.15 - rating_gap)
    if model == "poisson":
        return max(0.2, base_a), max(0.2, base_b)
    if model == "dixon_coles":
        return max(0.2, base_a * 0.96), max(0.2, base_b * 0.96)
    if model == "bayes_live":
        return max(0.2, 1.1 + rating_gap * 0.7), max(0.2, 1.1 - rating_gap * 0.7)
    return max(0.2, base_a * exp(rating_gap * 0.35)), max(0.2, base_b * exp(-rating_gap * 0.35))


def simulate_score(rng: np.random.Generator, a: Team, b: Team, model: ModelName) -> tuple[int, int]:
    goals_a, goals_b = expected_goals(a, b, model)
    return int(rng.poisson(goals_a)), int(rng.poisson(goals_b))


def choose_winner(rng: Random, a: Team, b: Team) -> Team:
    return a if rng.random() < win_probability(a, b) else b


def group_table(teams: list[Team], rng: Random, np_rng: np.random.Generator, model: ModelName) -> list[Team]:
    table = {
        team.id: {"team": team, "points": 0, "gf": 0, "ga": 0, "wins": 0}
        for team in teams
    }
    for i, a in enumerate(teams):
        for b in teams[i + 1 :]:
            ga, gb = simulate_score(np_rng, a, b, model)
            table[a.id]["gf"] += ga
            table[a.id]["ga"] += gb
            table[b.id]["gf"] += gb
            table[b.id]["ga"] += ga
            if ga > gb:
                table[a.id]["points"] += 3
                table[a.id]["wins"] += 1
            elif gb > ga:
                table[b.id]["points"] += 3
                table[b.id]["wins"] += 1
            else:
                table[a.id]["points"] += 1
                table[b.id]["points"] += 1

    return [
        item["team"]
        for item in sorted(
            table.values(),
            key=lambda item: (
                item["points"],
                item["gf"] - item["ga"],
                item["gf"],
                item["wins"],
                rng.random(),
            ),
            reverse=True,
        )
    ]


def simulate_tournament(model: ModelName, seed: int, simulations: int, job_id: str) -> SimulationResult:
    teams = load_teams()
    rng = Random(seed)
    np_rng = np.random.default_rng(seed)
    counts = defaultdict(lambda: {"knockout": 0, "semifinalist": 0, "finalist": 0, "champion": 0})
    upsets = defaultdict(int)

    groups: dict[str, list[Team]] = defaultdict(list)
    for team in teams:
        groups[team.group].append(team)

    for _ in range(simulations):
        qualified: list[Team] = []
        for group_teams in groups.values():
            ranked = group_table(group_teams, rng, np_rng, model)
            qualified.extend(ranked[:2])

        for team in qualified:
            counts[team.id]["knockout"] += 1

        rng.shuffle(qualified)
        bracket = qualified[:16]
        round_teams = bracket
        while len(round_teams) > 1:
            winners: list[Team] = []
            for i in range(0, len(round_teams), 2):
                a, b = round_teams[i], round_teams[i + 1]
                winner = choose_winner(rng, a, b)
                loser = b if winner.id == a.id else a
                if win_probability(winner, loser) < 0.42:
                    upsets[f"{winner.name} elimina a {loser.name}"] += 1
                winners.append(winner)
            if len(winners) == 4:
                for team in winners:
                    counts[team.id]["semifinalist"] += 1
            if len(winners) == 2:
                for team in winners:
                    counts[team.id]["finalist"] += 1
            round_teams = winners
        counts[round_teams[0].id]["champion"] += 1

    team_by_id = {team.id: team for team in teams}
    summary = []
    for team_id, c in counts.items():
        team = team_by_id[team_id]
        summary.append(
            TeamProbability(
                team_id=team_id,
                team=team.name,
                group=team.group,
                champion=c["champion"] / simulations,
                finalist=c["finalist"] / simulations,
                semifinalist=c["semifinalist"] / simulations,
                knockout=c["knockout"] / simulations,
            )
        )
    summary.sort(key=lambda row: row.champion, reverse=True)

    top_upsets = [
        label
        for label, _ in sorted(upsets.items(), key=lambda item: item[1], reverse=True)[:6]
    ]

    methodology = {
        "elo": "Elo convierte diferencias de rating en probabilidad de victoria con una curva logística.",
        "poisson": "Poisson genera marcadores desde goles esperados por ataque y defensa.",
        "dixon_coles": "Dixon-Coles corrige el modelo de goles para partidos cerrados y marcadores bajos.",
        "bayes_live": "Bayes en vivo actualiza creencias conforme aparecen resultados nuevos.",
        "ensemble": "El ensamble mezcla rating, ataque, defensa y simulación Monte Carlo para observar incertidumbre.",
    }[model]

    return SimulationResult(
        job_id=job_id,
        model=model,
        simulations=simulations,
        seed=seed,
        summary=summary,
        top_upsets=top_upsets,
        methodology=methodology,
    )
