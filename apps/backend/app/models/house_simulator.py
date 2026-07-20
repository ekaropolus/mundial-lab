from __future__ import annotations

import json
from collections import defaultdict
from math import exp, factorial
from pathlib import Path
from random import Random

import numpy as np

from app.live import leaderboard, list_matches
from app.schemas import HouseSimulationResult, Match, Team, TeamProbability


type XgProfile = dict[str, float]
type GroupRow = dict[str, int | Team]
type MatchResult = tuple[str, str, int, int]


ANNEX_C_COLUMNS = ["1A", "1B", "1D", "1E", "1G", "1I", "1K", "1L"]
_ANNEX_C_ROWS: dict[str, dict[str, str]] | None = None


TEAM_OVERRIDES: dict[str, tuple[float, float, float]] = {
    "argentina": (1886, 1.34, 0.78),
    "france": (1852, 1.32, 0.8),
    "england": (1830, 1.25, 0.82),
    "brazil": (1812, 1.28, 0.84),
    "spain": (1801, 1.23, 0.84),
    "portugal": (1795, 1.2, 0.87),
    "netherlands": (1788, 1.17, 0.88),
    "belgium": (1769, 1.14, 0.91),
    "germany": (1768, 1.17, 0.9),
    "croatia": (1728, 1.08, 0.91),
    "colombia": (1715, 1.1, 0.92),
    "uruguay": (1713, 1.09, 0.9),
    "morocco": (1692, 1.06, 0.92),
    "united-states": (1668, 1.04, 0.98),
    "japan": (1660, 1.05, 0.96),
    "mexico": (1652, 1.02, 0.99),
    "south-korea": (1635, 1.0, 1.02),
    "switzerland": (1630, 1.0, 0.96),
    "ecuador": (1626, 1.0, 0.98),
    "iran": (1615, 0.98, 1.0),
    "senegal": (1608, 1.0, 0.99),
    "austria": (1606, 1.01, 0.98),
    "australia": (1575, 0.96, 1.05),
    "canada": (1565, 0.94, 1.07),
    "qatar": (1536, 0.88, 1.12),
    "south-africa": (1530, 0.9, 1.09),
    "ghana": (1525, 0.91, 1.08),
    "tunisia": (1522, 0.89, 1.07),
    "saudi-arabia": (1518, 0.9, 1.1),
    "new-zealand": (1508, 0.84, 1.14),
}


CITY_CONTEXT: dict[str, dict[str, float | str]] = {
    "Mexico City": {"altitude_m": 2240, "temperature_c": 24, "humidity": 0.46, "note": "Altitud alta"},
    "Guadalajara": {"altitude_m": 1566, "temperature_c": 27, "humidity": 0.48, "note": "Altitud media"},
    "Monterrey": {"altitude_m": 540, "temperature_c": 31, "humidity": 0.55, "note": "Calor seco"},
    "Toronto": {"altitude_m": 76, "temperature_c": 22, "humidity": 0.62, "note": "Sede templada"},
    "Vancouver": {"altitude_m": 2, "temperature_c": 18, "humidity": 0.66, "note": "Sede fresca"},
    "Los Angeles": {"altitude_m": 71, "temperature_c": 24, "humidity": 0.57, "note": "Sede templada"},
    "Santa Clara": {"altitude_m": 22, "temperature_c": 23, "humidity": 0.6, "note": "Sede templada"},
    "Seattle": {"altitude_m": 53, "temperature_c": 18, "humidity": 0.68, "note": "Sede fresca"},
    "Houston": {"altitude_m": 15, "temperature_c": 31, "humidity": 0.74, "note": "Humedad alta"},
    "Dallas": {"altitude_m": 131, "temperature_c": 32, "humidity": 0.56, "note": "Calor"},
    "Kansas City": {"altitude_m": 277, "temperature_c": 28, "humidity": 0.58, "note": "Calor moderado"},
    "Atlanta": {"altitude_m": 320, "temperature_c": 29, "humidity": 0.7, "note": "Humedad alta"},
    "Miami": {"altitude_m": 2, "temperature_c": 30, "humidity": 0.76, "note": "Humedad alta"},
    "Boston": {"altitude_m": 43, "temperature_c": 23, "humidity": 0.63, "note": "Sede templada"},
    "New York New Jersey": {"altitude_m": 7, "temperature_c": 25, "humidity": 0.62, "note": "Sede templada"},
    "New York / New Jersey": {"altitude_m": 7, "temperature_c": 25, "humidity": 0.62, "note": "Sede templada"},
    "Philadelphia": {"altitude_m": 12, "temperature_c": 27, "humidity": 0.64, "note": "Calor moderado"},
    "San Francisco Bay Area": {"altitude_m": 22, "temperature_c": 21, "humidity": 0.6, "note": "Sede templada"},
}


def concrete_group_matches(matches: list[Match]) -> list[Match]:
    return [
        match
        for match in matches
        if match.phase == "grupos"
        and not match.home_team_id.startswith("group-")
        and not match.away_team_id.startswith("group-")
    ]


def team_from_match(team_id: str, name: str, group: str) -> Team:
    rating, attack, defense = TEAM_OVERRIDES.get(team_id, (1500 + (sum(map(ord, team_id)) % 110), 0.9, 1.08))
    return Team(
        id=team_id,
        name=name,
        confederation="seed",
        group=group,
        rating=rating,
        attack=attack,
        defense=defense,
        qualified=True,
    )


def db_team_strengths() -> dict[str, Team]:
    from app.database import connect

    with connect() as db:
        rows = db.execute(
            """
            select id, name, confederation, group_code as "group", rating, attack, defense, qualified
            from teams
            """
        ).fetchall()
    return {row["id"]: Team.model_validate(dict(row)) for row in rows}


def xg_team_profiles() -> dict[str, XgProfile]:
    from app.database import connect

    with connect() as db:
        rows = db.execute(
            """
            select
                m.home_team_id,
                m.away_team_id,
                f.home_xg,
                f.away_xg
              from live_features f
              join matches m on m.id = f.match_id
              where f.home_xg is not null
                and f.away_xg is not null
                and f.source like ?
            """,
            ("%ESPN%",),
        ).fetchall()

    raw: dict[str, dict[str, float]] = defaultdict(lambda: {"games": 0.0, "xg_for": 0.0, "xg_against": 0.0})
    for row in rows:
        home_xg = float(row["home_xg"] or 0)
        away_xg = float(row["away_xg"] or 0)
        home_id = str(row["home_team_id"])
        away_id = str(row["away_team_id"])
        raw[home_id]["games"] += 1
        raw[home_id]["xg_for"] += home_xg
        raw[home_id]["xg_against"] += away_xg
        raw[away_id]["games"] += 1
        raw[away_id]["xg_for"] += away_xg
        raw[away_id]["xg_against"] += home_xg

    profiles: dict[str, XgProfile] = {}
    for team_id, values in raw.items():
        games = max(1.0, values["games"])
        shrink = games / (games + 3.0)
        avg_for = values["xg_for"] / games
        avg_against = values["xg_against"] / games
        attack_index = avg_for / 1.25
        defense_index = avg_against / 1.15
        attack_factor = 1 + max(-0.12, min(0.12, (attack_index - 1) * 0.25 * shrink))
        defense_factor = 1 + max(-0.1, min(0.1, (defense_index - 1) * 0.18 * shrink))
        profiles[team_id] = {
            "games": games,
            "avg_for": avg_for,
            "avg_against": avg_against,
            "attack_factor": attack_factor,
            "defense_factor": defense_factor,
        }
    return profiles


def teams_from_matches(matches: list[Match]) -> dict[str, Team]:
    existing = db_team_strengths()
    teams: dict[str, Team] = {}
    for match in concrete_group_matches(matches):
        group = match.stage.replace("Grupo ", "").strip()
        teams.setdefault(match.home_team_id, existing.get(match.home_team_id, team_from_match(match.home_team_id, match.home_team, group)))
        teams.setdefault(match.away_team_id, existing.get(match.away_team_id, team_from_match(match.away_team_id, match.away_team, group)))
    return teams


def stadium_factor(match: Match, use_stadium: bool) -> tuple[float, float, str]:
    if not use_stadium:
        return 1.0, 0.0, "sin ajuste"
    context = CITY_CONTEXT.get(match.city, {"altitude_m": 120, "temperature_c": 24, "humidity": 0.55, "note": "Sede derivada"})
    altitude = float(context["altitude_m"])
    temperature = float(context["temperature_c"])
    humidity = float(context["humidity"])
    tempo = max(0.86, min(1.04, 1 - altitude / 26000 - max(0, humidity - 0.58) * 0.12 - max(0, temperature - 28) * 0.012))
    home_edge = 0.0
    if match.home_team_id in {"mexico", "canada", "united-states"} and match.city in {"Mexico City", "Guadalajara", "Monterrey", "Toronto", "Vancouver", "Los Angeles", "Santa Clara", "Seattle", "Houston", "Dallas", "Kansas City", "Atlanta", "Miami", "Boston", "New York New Jersey", "Philadelphia"}:
        home_edge = 0.05
    return tempo, home_edge, str(context["note"])


def expected_goals(
    a: Team,
    b: Team,
    match: Match,
    use_stadium: bool,
    use_xg: bool = False,
    xg_profiles: dict[str, XgProfile] | None = None,
) -> tuple[float, float]:
    rating_gap = (a.rating - b.rating) / 400
    tempo, home_edge, _ = stadium_factor(match, use_stadium)
    home_attack = away_attack = 1.0
    home_defense = away_defense = 1.0
    if use_xg and xg_profiles:
        home_profile = xg_profiles.get(a.id, {})
        away_profile = xg_profiles.get(b.id, {})
        home_attack = float(home_profile.get("attack_factor", 1.0))
        home_defense = float(home_profile.get("defense_factor", 1.0))
        away_attack = float(away_profile.get("attack_factor", 1.0))
        away_defense = float(away_profile.get("defense_factor", 1.0))
    base_a = 1.18 * a.attack * home_attack / max(b.defense * away_defense, 0.35)
    base_b = 1.08 * b.attack * away_attack / max(a.defense * home_defense, 0.35)
    home = max(0.15, base_a * exp(rating_gap * 0.28 + home_edge) * tempo)
    away = max(0.15, base_b * exp(-rating_gap * 0.22 - home_edge) * tempo)
    return home, away


def simulate_score(
    rng: np.random.Generator,
    a: Team,
    b: Team,
    match: Match,
    use_stadium: bool,
    use_xg: bool = False,
    xg_profiles: dict[str, XgProfile] | None = None,
) -> tuple[int, int]:
    if match.status == "finished":
        return match.home_score, match.away_score
    home_lambda, away_lambda = expected_goals(a, b, match, use_stadium, use_xg, xg_profiles)
    return int(rng.poisson(home_lambda)), int(rng.poisson(away_lambda))


def most_likely_score(
    a: Team,
    b: Team,
    match: Match,
    use_stadium: bool,
    use_xg: bool = False,
    xg_profiles: dict[str, XgProfile] | None = None,
) -> tuple[int, int]:
    if match.status == "finished":
        return match.home_score, match.away_score

    home_lambda, away_lambda = expected_goals(a, b, match, use_stadium, use_xg, xg_profiles)
    score_probabilities: list[tuple[int, int, float]] = []
    outcome_probabilities = {"home": 0.0, "draw": 0.0, "away": 0.0}
    for home_goals in range(8):
        home_probability = exp(-home_lambda) * home_lambda**home_goals / factorial(home_goals)
        for away_goals in range(8):
            probability = home_probability * exp(-away_lambda) * away_lambda**away_goals / factorial(away_goals)
            score_probabilities.append((home_goals, away_goals, probability))
            if home_goals > away_goals:
                outcome_probabilities["home"] += probability
            elif away_goals > home_goals:
                outcome_probabilities["away"] += probability
            else:
                outcome_probabilities["draw"] += probability

    projected_outcome = max(outcome_probabilities.items(), key=lambda item: item[1])[0]
    return max(
        [
            score
            for score in score_probabilities
            if (
                (projected_outcome == "home" and score[0] > score[1])
                or (projected_outcome == "away" and score[1] > score[0])
                or (projected_outcome == "draw" and score[0] == score[1])
            )
        ],
        key=lambda item: item[2],
    )[:2]


def score_key(home_score: int, away_score: int) -> str:
    return f"{home_score}-{away_score}"


def annex_c_rows() -> dict[str, dict[str, str]]:
    global _ANNEX_C_ROWS
    if _ANNEX_C_ROWS is None:
        current = Path(__file__).resolve()
        annex_path = next((parent / "data" / "third_place_annex_c_2026.json" for parent in current.parents if (parent / "data" / "third_place_annex_c_2026.json").exists()), None)
        if annex_path is None:
            raise FileNotFoundError("data/third_place_annex_c_2026.json")
        with annex_path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
        _ANNEX_C_ROWS = {str(key): dict(value) for key, value in payload["rows"].items()}
    return _ANNEX_C_ROWS


def row_team(row: GroupRow) -> Team:
    team = row["team"]
    if not isinstance(team, Team):
        raise TypeError("group row without Team")
    return team


def add_group_result(
    tables: dict[str, dict[str, GroupRow]],
    results: dict[str, list[MatchResult]],
    a: Team,
    b: Team,
    goals_a: int,
    goals_b: int,
) -> None:
    row_a = tables[a.group][a.id]
    row_b = tables[b.group][b.id]
    row_a["gf"] = int(row_a["gf"]) + goals_a
    row_a["ga"] = int(row_a["ga"]) + goals_b
    row_b["gf"] = int(row_b["gf"]) + goals_b
    row_b["ga"] = int(row_b["ga"]) + goals_a
    if goals_a > goals_b:
        row_a["points"] = int(row_a["points"]) + 3
    elif goals_b > goals_a:
        row_b["points"] = int(row_b["points"]) + 3
    else:
        row_a["points"] = int(row_a["points"]) + 1
        row_b["points"] = int(row_b["points"]) + 1
    results[a.group].append((a.id, b.id, goals_a, goals_b))


def mini_table_key(row: GroupRow, tied_ids: set[str], results: list[MatchResult]) -> tuple[int, int, int]:
    team_id = row_team(row).id
    points = gf = ga = 0
    for home_id, away_id, home_goals, away_goals in results:
        if home_id not in tied_ids or away_id not in tied_ids:
            continue
        if team_id == home_id:
            gf += home_goals
            ga += away_goals
            if home_goals > away_goals:
                points += 3
            elif home_goals == away_goals:
                points += 1
        elif team_id == away_id:
            gf += away_goals
            ga += home_goals
            if away_goals > home_goals:
                points += 3
            elif home_goals == away_goals:
                points += 1
    return points, gf - ga, gf


def official_group_sort_key(row: GroupRow, tied_rows: list[GroupRow], results: list[MatchResult], rng: Random) -> tuple[float, ...]:
    tied_ids = {row_team(item).id for item in tied_rows}
    head_points, head_gd, head_gf = mini_table_key(row, tied_ids, results)
    team = row_team(row)
    return (
        head_points,
        head_gd,
        head_gf,
        int(row["gf"]) - int(row["ga"]),
        int(row["gf"]),
        team.rating,
        rng.random(),
    )


def rank_group_rows(table: dict[str, GroupRow], results: list[MatchResult], rng: Random) -> list[GroupRow]:
    by_points: dict[int, list[GroupRow]] = defaultdict(list)
    for row in table.values():
        by_points[int(row["points"])].append(row)

    ordered: list[GroupRow] = []
    for points in sorted(by_points.keys(), reverse=True):
        tied_rows = by_points[points]
        if len(tied_rows) == 1:
            ordered.extend(tied_rows)
            continue
        ordered.extend(sorted(tied_rows, key=lambda row: official_group_sort_key(row, tied_rows, results, rng), reverse=True))
    return ordered


def third_place_sort_key(team: Team, stats: dict[str, dict[str, GroupRow]], rng: Random) -> tuple[float, ...]:
    row = stats[team.group][team.id]
    return (
        int(row["points"]),
        int(row["gf"]) - int(row["ga"]),
        int(row["gf"]),
        team.rating,
        rng.random(),
    )


def third_pool_from_ranked(
    ranked: dict[str, list[Team]],
    stats: dict[str, dict[str, GroupRow]],
    rng: Random,
) -> list[Team]:
    return sorted(
        [ranked[group][2] for group in ranked if len(ranked[group]) > 2],
        key=lambda team: third_place_sort_key(team, stats, rng),
        reverse=True,
    )[:8]


def group_from_third_slot(slot: str) -> set[str]:
    return {part.upper() for part in slot.replace("group-", "").replace("-third-place", "").split("-")}


def group_winner_code(slot: str) -> str:
    if slot.startswith("group-") and slot.endswith("-winners"):
        return slot.split("-")[1].upper()
    return ""


def official_third_place_assignments(matches: list[Match], ranked: dict[str, list[Team]], third_pool: list[Team]) -> dict[str, Team]:
    third_groups = "".join(sorted(team.group for team in third_pool))
    annexe_row = annex_c_rows().get(third_groups)
    if not annexe_row:
        return {}

    third_by_group = {team.group: team for team in third_pool}
    assignments: dict[str, Team] = {}
    for match in matches:
        if match.phase != "eliminacion" or match.match_number < 73 or match.match_number > 88:
            continue
        slots = [match.home_team_id, match.away_team_id]
        third_slot = next((slot for slot in slots if slot.startswith("group-") and slot.endswith("-third-place")), "")
        winner_slot = next((slot for slot in slots if slot.startswith("group-") and slot.endswith("-winners")), "")
        winner_group = group_winner_code(winner_slot)
        if not third_slot or not winner_group:
            continue
        selected_group = annexe_row.get(f"1{winner_group}")
        if selected_group and selected_group in group_from_third_slot(third_slot) and selected_group in third_by_group:
            assignments[third_slot] = third_by_group[selected_group]
    return assignments


def win_probability(
    a: Team,
    b: Team,
    match: Match,
    use_stadium: bool,
    use_xg: bool = False,
    xg_profiles: dict[str, XgProfile] | None = None,
) -> float:
    home_lambda, away_lambda = expected_goals(a, b, match, use_stadium, use_xg, xg_profiles)
    rating_component = 1 / (1 + 10 ** ((b.rating - a.rating) / 400))
    goal_component = home_lambda / max(0.01, home_lambda + away_lambda)
    return max(0.05, min(0.95, rating_component * 0.58 + goal_component * 0.42))


def rank_groups(
    matches: list[Match],
    teams: dict[str, Team],
    rng: Random,
    np_rng: np.random.Generator,
    use_stadium: bool,
    use_xg: bool = False,
    xg_profiles: dict[str, XgProfile] | None = None,
) -> tuple[dict[str, list[Team]], dict[str, dict[str, int]], dict[str, dict[str, GroupRow]]]:
    tables: dict[str, dict[str, GroupRow]] = defaultdict(dict)
    results: dict[str, list[MatchResult]] = defaultdict(list)
    for team in teams.values():
        tables[team.group][team.id] = {"team": team, "points": 0, "gf": 0, "ga": 0}

    for match in concrete_group_matches(matches):
        a = teams[match.home_team_id]
        b = teams[match.away_team_id]
        ga, gb = simulate_score(np_rng, a, b, match, use_stadium, use_xg, xg_profiles)
        add_group_result(tables, results, a, b, ga, gb)

    ranked: dict[str, list[Team]] = {}
    raw_points: dict[str, dict[str, int]] = {}
    for group, table in tables.items():
        ordered = rank_group_rows(table, results[group], rng)
        ranked[group] = [row_team(row) for row in ordered]
        raw_points[group] = {team_id: int(row["points"]) for team_id, row in table.items()}
    return ranked, raw_points, tables


def resolve_slot(
    slot: str,
    ranked: dict[str, list[Team]],
    third_pool: list[Team],
    used_thirds: set[str],
    third_assignments: dict[str, Team] | None = None,
    teams: dict[str, Team] | None = None,
) -> Team:
    if teams and slot in teams:
        return teams[slot]
    if slot.startswith("group-") and slot.endswith("-winners"):
        group = slot.split("-")[1].upper()
        return ranked[group][0]
    if slot.startswith("group-") and slot.endswith("-runners-up"):
        group = slot.split("-")[1].upper()
        return ranked[group][1]
    if slot.startswith("group-") and slot.endswith("-third-place"):
        assigned = (third_assignments or {}).get(slot)
        if assigned and assigned.id not in used_thirds:
            used_thirds.add(assigned.id)
            return assigned
        eligible = group_from_third_slot(slot)
        for team in third_pool:
            if team.group in eligible and team.id not in used_thirds:
                used_thirds.add(team.id)
                return team
        for team in third_pool:
            if team.id not in used_thirds:
                used_thirds.add(team.id)
                return team
    raise ValueError(f"No se pudo resolver slot {slot}")


def knockout_winner(
    rng: Random,
    a: Team,
    b: Team,
    match: Match,
    use_stadium: bool,
    use_xg: bool = False,
    xg_profiles: dict[str, XgProfile] | None = None,
) -> Team:
    if match.status == "finished":
        if match.winner_team_id and match.winner_team_id in {a.id, b.id}:
            return a if match.winner_team_id == a.id else b
        if match.home_score > match.away_score:
            return a
        if match.away_score > match.home_score:
            return b
    probability = win_probability(a, b, match, use_stadium, use_xg, xg_profiles)
    return a if rng.random() < probability else b


def simulate_once(
    matches: list[Match],
    teams: dict[str, Team],
    rng: Random,
    np_rng: np.random.Generator,
    use_stadium: bool,
    use_xg: bool = False,
    xg_profiles: dict[str, XgProfile] | None = None,
) -> tuple[dict[str, str], list[str]]:
    ranked, _, group_stats = rank_groups(matches, teams, rng, np_rng, use_stadium, use_xg, xg_profiles)
    third_pool = third_pool_from_ranked(ranked, group_stats, rng)
    third_assignments = official_third_place_assignments(matches, ranked, third_pool)
    used_thirds: set[str] = set()
    winners_by_match: dict[int, Team] = {}
    losers_by_match: dict[int, Team] = {}
    stage_marks: dict[str, str] = {}
    upsets: list[str] = []

    for match in sorted([m for m in matches if m.phase == "eliminacion"], key=lambda item: item.match_number):
        if match.home_team_id.startswith("winner-match-"):
            a = winners_by_match[int(match.home_team_id.replace("winner-match-", ""))]
        elif match.home_team_id.startswith("loser-match-"):
            a = losers_by_match[int(match.home_team_id.replace("loser-match-", ""))]
        else:
            a = resolve_slot(match.home_team_id, ranked, third_pool, used_thirds, third_assignments, teams)

        if match.away_team_id.startswith("winner-match-"):
            b = winners_by_match[int(match.away_team_id.replace("winner-match-", ""))]
        elif match.away_team_id.startswith("loser-match-"):
            b = losers_by_match[int(match.away_team_id.replace("loser-match-", ""))]
        else:
            b = resolve_slot(match.away_team_id, ranked, third_pool, used_thirds, third_assignments, teams)

        winner = knockout_winner(rng, a, b, match, use_stadium, use_xg, xg_profiles)
        loser = b if winner.id == a.id else a
        winners_by_match[match.match_number] = winner
        losers_by_match[match.match_number] = loser
        if win_probability(winner, loser, match, use_stadium, use_xg, xg_profiles) < 0.43:
            upsets.append(f"{winner.name} elimina a {loser.name}")

        if match.match_number <= 88:
            stage_marks[winner.id] = "knockout"
        elif match.match_number <= 96:
            stage_marks[winner.id] = "quarterfinalist"
        elif match.match_number <= 100:
            stage_marks[winner.id] = "semifinalist"
        elif match.match_number <= 102:
            stage_marks[winner.id] = "finalist"
        elif match.match_number == 104:
            stage_marks[winner.id] = "champion"

    return stage_marks, upsets


def simulate_once_with_lines(
    matches: list[Match],
    teams: dict[str, Team],
    rng: Random,
    np_rng: np.random.Generator,
    use_stadium: bool,
    use_xg: bool = False,
    xg_profiles: dict[str, XgProfile] | None = None,
) -> tuple[dict[str, str], list[str], list[dict[str, str | int]]]:
    tables: dict[str, dict[str, GroupRow]] = defaultdict(dict)
    results: dict[str, list[MatchResult]] = defaultdict(list)
    line_events: list[dict[str, str | int]] = []
    for team in teams.values():
        tables[team.group][team.id] = {"team": team, "points": 0, "gf": 0, "ga": 0}

    for match in concrete_group_matches(matches):
        a = teams[match.home_team_id]
        b = teams[match.away_team_id]
        ga, gb = simulate_score(np_rng, a, b, match, use_stadium, use_xg, xg_profiles)
        outcome = "draw"
        winner_id = ""
        winner = ""
        if ga > gb:
            outcome = "home"
            winner_id = a.id
            winner = a.name
        elif gb > ga:
            outcome = "away"
            winner_id = b.id
            winner = b.name
        line_events.append(
            {
                "match_number": match.match_number,
                "home_team": a.name,
                "away_team": b.name,
                "home_team_id": a.id,
                "away_team_id": b.id,
                "outcome": outcome,
                "winner_id": winner_id,
                "winner": winner,
                "score": score_key(ga, gb),
            }
        )

        add_group_result(tables, results, a, b, ga, gb)

    ranked: dict[str, list[Team]] = {}
    for group, table in tables.items():
        ranked[group] = [row_team(row) for row in rank_group_rows(table, results[group], rng)]

    third_pool = third_pool_from_ranked(ranked, tables, rng)
    third_assignments = official_third_place_assignments(matches, ranked, third_pool)
    used_thirds: set[str] = set()
    winners_by_match: dict[int, Team] = {}
    losers_by_match: dict[int, Team] = {}
    stage_marks: dict[str, str] = {}
    upsets: list[str] = []

    for match in sorted([m for m in matches if m.phase == "eliminacion"], key=lambda item: item.match_number):
        if match.home_team_id.startswith("winner-match-"):
            a = winners_by_match[int(match.home_team_id.replace("winner-match-", ""))]
        elif match.home_team_id.startswith("loser-match-"):
            a = losers_by_match[int(match.home_team_id.replace("loser-match-", ""))]
        else:
            a = resolve_slot(match.home_team_id, ranked, third_pool, used_thirds, third_assignments, teams)

        if match.away_team_id.startswith("winner-match-"):
            b = winners_by_match[int(match.away_team_id.replace("winner-match-", ""))]
        elif match.away_team_id.startswith("loser-match-"):
            b = losers_by_match[int(match.away_team_id.replace("loser-match-", ""))]
        else:
            b = resolve_slot(match.away_team_id, ranked, third_pool, used_thirds, third_assignments, teams)

        winner = knockout_winner(rng, a, b, match, use_stadium, use_xg, xg_profiles)
        loser = b if winner.id == a.id else a
        winners_by_match[match.match_number] = winner
        losers_by_match[match.match_number] = loser
        line_events.append(
            {
                "match_number": match.match_number,
                "home_team": a.name,
                "away_team": b.name,
                "home_team_id": a.id,
                "away_team_id": b.id,
                "outcome": "home" if winner.id == a.id else "away",
                "winner_id": winner.id,
                "winner": winner.name,
                "score": "avanza",
            }
        )
        if win_probability(winner, loser, match, use_stadium, use_xg, xg_profiles) < 0.43:
            upsets.append(f"{winner.name} elimina a {loser.name}")

        if match.match_number <= 88:
            stage_marks[winner.id] = "knockout"
        elif match.match_number <= 96:
            stage_marks[winner.id] = "quarterfinalist"
        elif match.match_number <= 100:
            stage_marks[winner.id] = "semifinalist"
        elif match.match_number <= 102:
            stage_marks[winner.id] = "finalist"
        elif match.match_number == 104:
            stage_marks[winner.id] = "champion"

    return stage_marks, upsets, line_events


def projected_route_with_lines(
    matches: list[Match],
    teams: dict[str, Team],
    use_stadium: bool,
    use_xg: bool = False,
    xg_profiles: dict[str, XgProfile] | None = None,
) -> list[dict[str, str | int]]:
    tables: dict[str, dict[str, GroupRow]] = defaultdict(dict)
    results: dict[str, list[MatchResult]] = defaultdict(list)
    line_events: list[dict[str, str | int]] = []
    tie_rng = Random(20260622)
    for team in teams.values():
        tables[team.group][team.id] = {"team": team, "points": 0, "gf": 0, "ga": 0}

    for match in concrete_group_matches(matches):
        a = teams[match.home_team_id]
        b = teams[match.away_team_id]
        ga, gb = most_likely_score(a, b, match, use_stadium, use_xg, xg_profiles)
        outcome = "draw"
        winner_id = ""
        winner = ""
        if ga > gb:
            outcome = "home"
            winner_id = a.id
            winner = a.name
        elif gb > ga:
            outcome = "away"
            winner_id = b.id
            winner = b.name
        line_events.append(
            {
                "match_number": match.match_number,
                "home_team": a.name,
                "away_team": b.name,
                "home_team_id": a.id,
                "away_team_id": b.id,
                "outcome": outcome,
                "winner_id": winner_id,
                "winner": winner,
                "score": score_key(ga, gb),
            }
        )
        add_group_result(tables, results, a, b, ga, gb)

    ranked: dict[str, list[Team]] = {}
    for group, table in tables.items():
        ranked[group] = [row_team(row) for row in rank_group_rows(table, results[group], tie_rng)]

    third_pool = third_pool_from_ranked(ranked, tables, tie_rng)
    third_assignments = official_third_place_assignments(matches, ranked, third_pool)
    used_thirds: set[str] = set()
    winners_by_match: dict[int, Team] = {}
    losers_by_match: dict[int, Team] = {}

    for match in sorted([m for m in matches if m.phase == "eliminacion"], key=lambda item: item.match_number):
        if match.home_team_id.startswith("winner-match-"):
            a = winners_by_match[int(match.home_team_id.replace("winner-match-", ""))]
        elif match.home_team_id.startswith("loser-match-"):
            a = losers_by_match[int(match.home_team_id.replace("loser-match-", ""))]
        else:
            a = resolve_slot(match.home_team_id, ranked, third_pool, used_thirds, third_assignments, teams)

        if match.away_team_id.startswith("winner-match-"):
            b = winners_by_match[int(match.away_team_id.replace("winner-match-", ""))]
        elif match.away_team_id.startswith("loser-match-"):
            b = losers_by_match[int(match.away_team_id.replace("loser-match-", ""))]
        else:
            b = resolve_slot(match.away_team_id, ranked, third_pool, used_thirds, third_assignments, teams)

        home_probability = win_probability(a, b, match, use_stadium, use_xg, xg_profiles)
        if match.status == "finished":
            if match.winner_team_id and match.winner_team_id in {a.id, b.id}:
                winner = a if match.winner_team_id == a.id else b
            elif match.home_score > match.away_score:
                winner = a
            elif match.away_score > match.home_score:
                winner = b
            else:
                winner = a if home_probability >= 0.5 else b
        else:
            winner = a if home_probability >= 0.5 else b
        loser = b if winner.id == a.id else a
        winners_by_match[match.match_number] = winner
        losers_by_match[match.match_number] = loser
        line_events.append(
            {
                "match_number": match.match_number,
                "home_team": a.name,
                "away_team": b.name,
                "home_team_id": a.id,
                "away_team_id": b.id,
                "outcome": "home" if winner.id == a.id else "away",
                "winner_id": winner.id,
                "winner": winner.name,
                "score": "avanza",
            }
        )

    return line_events


def summarize(counts: dict[str, dict[str, int]], teams: dict[str, Team], simulations: int, key: str) -> list[TeamProbability]:
    rows = [
        TeamProbability(
            team_id=team_id,
            team=teams[team_id].name,
            group=teams[team_id].group,
            champion=values["champion"] / simulations,
            finalist=values["finalist"] / simulations,
            semifinalist=values["semifinalist"] / simulations,
            knockout=values["knockout"] / simulations,
        )
        for team_id, values in counts.items()
    ]
    rows.sort(key=lambda row: getattr(row, key), reverse=True)
    return rows[:12]


def top_items(values: dict[str, int], simulations: int, limit: int = 4) -> list[dict[str, str | float]]:
    return [
        {"label": label, "probability": count / simulations}
        for label, count in sorted(values.items(), key=lambda item: item[1], reverse=True)[:limit]
    ]


def match_xg_impact(home_id: str, away_id: str, xg_profiles: dict[str, XgProfile]) -> dict[str, float | str]:
    home = xg_profiles.get(home_id, {})
    away = xg_profiles.get(away_id, {})
    home_attack = float(home.get("attack_factor", 1.0))
    away_attack = float(away.get("attack_factor", 1.0))
    home_defense = float(home.get("defense_factor", 1.0))
    away_defense = float(away.get("defense_factor", 1.0))
    home_push = (home_attack - 1) - (away_defense - 1)
    away_push = (away_attack - 1) - (home_defense - 1)
    delta = max(-0.18, min(0.18, home_push - away_push))
    covered = int(float(home.get("games", 0)) > 0) + int(float(away.get("games", 0)) > 0)
    return {
        "delta": round(delta, 4),
        "home_games": float(home.get("games", 0)),
        "away_games": float(away.get("games", 0)),
        "note": "xG v1 activo" if covered else "sin xG reciente",
    }


def run_house_match_board(
    scenario: str,
    simulations: int,
    seed: int,
    use_stadium: bool,
    use_fixed_results: bool,
    use_xg: bool = True,
    exclude_fixed_match_id: str | None = None,
) -> dict[str, object]:
    matches = list_matches()
    if not use_fixed_results:
        matches = [match.model_copy(update={"status": "scheduled", "home_score": 0, "away_score": 0}) for match in matches]
    elif exclude_fixed_match_id:
        matches = [
            match.model_copy(update={"status": "scheduled", "home_score": 0, "away_score": 0})
            if match.id == exclude_fixed_match_id or match.slug == exclude_fixed_match_id
            else match
            for match in matches
        ]
    teams = teams_from_matches(matches)
    xg_profiles = xg_team_profiles() if use_xg else {}
    rng = Random(seed)
    np_rng = np.random.default_rng(seed)
    outcome_counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    score_counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    participant_counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    home_slot_counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    away_slot_counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    winner_counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    winner_names: dict[str, str] = {}

    for _ in range(simulations):
        _, _, line_events = simulate_once_with_lines(matches, teams, rng, np_rng, use_stadium, use_xg, xg_profiles)
        for event in line_events:
            match_number = int(event["match_number"])
            outcome_counts[match_number][str(event["outcome"])] += 1
            score_counts[match_number][str(event["score"])] += 1
            participant_counts[match_number][str(event["home_team"])] += 1
            participant_counts[match_number][str(event["away_team"])] += 1
            home_slot_counts[match_number][str(event["home_team"])] += 1
            away_slot_counts[match_number][str(event["away_team"])] += 1
            winner_id = str(event.get("winner_id", ""))
            if winner_id:
                winner_counts[match_number][winner_id] += 1
                winner_names[winner_id] = str(event.get("winner", event.get("home_team", "")))

    projected_events = projected_route_with_lines(matches, teams, use_stadium, use_xg, xg_profiles)
    projected_by_match = {int(event["match_number"]): event for event in projected_events}

    lines = []
    for match in sorted(matches, key=lambda item: item.match_number):
        home_lambda = away_lambda = 0.0
        favorite = match.home_team
        confidence = 0.0
        if match.phase == "grupos" and match.home_team_id in teams and match.away_team_id in teams:
            home_lambda, away_lambda = expected_goals(
                teams[match.home_team_id],
                teams[match.away_team_id],
                match,
                use_stadium,
                use_xg,
                xg_profiles,
            )
            home_prob = outcome_counts[match.match_number]["home"] / simulations
            draw_prob = outcome_counts[match.match_number]["draw"] / simulations
            away_prob = outcome_counts[match.match_number]["away"] / simulations
            options = [(match.home_team, home_prob), ("Empate", draw_prob), (match.away_team, away_prob)]
            favorite, confidence = max(options, key=lambda item: item[1])
        else:
            winners = winner_counts[match.match_number]
            if winners:
                winner_id, count = max(winners.items(), key=lambda item: item[1])
                favorite = winner_names.get(winner_id, winner_id)
                confidence = count / simulations
            home_prob = outcome_counts[match.match_number]["home"] / simulations
            draw_prob = 0.0
            away_prob = outcome_counts[match.match_number]["away"] / simulations
        projected = projected_by_match.get(match.match_number, {})
        projected_home_id = str(projected.get("home_team_id", match.home_team_id))
        projected_away_id = str(projected.get("away_team_id", match.away_team_id))
        projected_winner = str(projected.get("winner", favorite))
        projected_winner_id = str(projected.get("winner_id", ""))
        if match.phase != "grupos" and match.status != "finished" and projected_home_id in teams and projected_away_id in teams:
            home_prob = win_probability(teams[projected_home_id], teams[projected_away_id], match, use_stadium, use_xg, xg_profiles)
            away_prob = 1 - home_prob
            draw_prob = 0.0
            favorite = teams[projected_home_id].name if home_prob >= away_prob else teams[projected_away_id].name
            confidence = max(home_prob, away_prob)
            projected_winner = favorite
            projected_winner_id = projected_home_id if home_prob >= away_prob else projected_away_id

        lines.append(
            {
                "match_id": match.id,
                "match_number": match.match_number,
                "slug": match.slug,
                "phase": match.phase,
                "stage": match.stage,
                "status": match.status,
                "home_team": match.home_team,
                "away_team": match.away_team,
                "home_team_id": match.home_team_id,
                "away_team_id": match.away_team_id,
                "home_score": match.home_score,
                "away_score": match.away_score,
                "winner_team_id": match.winner_team_id,
                "winner_team": match.winner_team,
                "venue": match.venue,
                "city": match.city,
                "kickoff": match.kickoff,
                "local_time_label": match.local_time_label,
                "home_win": round(home_prob, 4),
                "draw": round(draw_prob, 4),
                "away_win": round(away_prob, 4),
                "expected_home_goals": round(home_lambda, 3),
                "expected_away_goals": round(away_lambda, 3),
                "xg_impact": match_xg_impact(match.home_team_id, match.away_team_id, xg_profiles) if use_xg else None,
                "favorite": favorite,
                "confidence": round(confidence, 4),
                "top_scores": top_items(score_counts[match.match_number], simulations),
                "likely_participants": top_items(participant_counts[match.match_number], simulations, 6),
                "likely_home": top_items(home_slot_counts[match.match_number], simulations, 4),
                "likely_away": top_items(away_slot_counts[match.match_number], simulations, 4),
                "projected_home": str(projected.get("home_team", match.home_team)),
                "projected_away": str(projected.get("away_team", match.away_team)),
                "projected_home_id": projected_home_id,
                "projected_away_id": projected_away_id,
                "projected_winner": projected_winner,
                "projected_winner_id": projected_winner_id,
            }
        )

    house = run_house_simulation(
        job_id=f"house-board-{seed}-{simulations}-{int(use_stadium)}-{int(use_fixed_results)}-{int(use_xg)}-{exclude_fixed_match_id or 'all'}",
        scenario=scenario,
        simulations=simulations,
        seed=seed,
        use_stadium=use_stadium,
        use_fixed_results=use_fixed_results,
        use_xg=use_xg,
        exclude_fixed_match_id=exclude_fixed_match_id,
    )
    return {
        "run_id": house.job_id,
        "scenario": scenario,
        "simulations": simulations,
        "seed": seed,
        "use_stadium": use_stadium,
        "use_fixed_results": use_fixed_results,
        "use_xg": use_xg,
        "fixed_results_used": house.fixed_results_used,
        "methodology": house.methodology,
        "data_sources": house.data_sources,
        "champion": [row.model_dump() for row in house.champion],
        "top_upsets": house.top_upsets,
        "lines": lines,
    }


def run_house_simulation(
    job_id: str,
    scenario: str,
    simulations: int,
    seed: int,
    use_stadium: bool,
    use_fixed_results: bool,
    use_xg: bool = True,
    exclude_fixed_match_id: str | None = None,
) -> HouseSimulationResult:
    matches = list_matches()
    if not use_fixed_results:
        matches = [match.model_copy(update={"status": "scheduled", "home_score": 0, "away_score": 0}) for match in matches]
    elif exclude_fixed_match_id:
        matches = [
            match.model_copy(update={"status": "scheduled", "home_score": 0, "away_score": 0})
            if match.id == exclude_fixed_match_id or match.slug == exclude_fixed_match_id
            else match
            for match in matches
        ]
    teams = teams_from_matches(matches)
    xg_profiles = xg_team_profiles() if use_xg else {}
    rng = Random(seed)
    np_rng = np.random.default_rng(seed)
    counts = defaultdict(lambda: {"knockout": 0, "semifinalist": 0, "finalist": 0, "champion": 0})
    upset_counts: dict[str, int] = defaultdict(int)

    for _ in range(simulations):
        marks, upsets = simulate_once(matches, teams, rng, np_rng, use_stadium, use_xg, xg_profiles)
        for team_id, mark in marks.items():
            counts[team_id]["knockout"] += 1
            if mark in {"semifinalist", "finalist", "champion"}:
                counts[team_id]["semifinalist"] += 1
            if mark in {"finalist", "champion"}:
                counts[team_id]["finalist"] += 1
            if mark == "champion":
                counts[team_id]["champion"] += 1
        for upset in upsets:
            upset_counts[upset] += 1

    stadium_adjustments = []
    for match in sorted(matches, key=lambda item: item.match_number)[:16]:
        tempo, edge, note = stadium_factor(match, use_stadium)
        stadium_adjustments.append(
            {
                "match": f"{match.home_team} vs {match.away_team}",
                "venue": match.venue,
                "city": match.city,
                "tempo": round(tempo, 3),
                "home_edge": round(edge, 3),
                "note": note,
            }
        )

    top_champion = summarize(counts, teams, simulations, "champion")
    return HouseSimulationResult(
        job_id=job_id,
        scenario=scenario,
        simulations=simulations,
        seed=seed,
        use_stadium=use_stadium,
        use_fixed_results=use_fixed_results,
        use_xg=use_xg,
        fixed_results_used=sum(1 for match in matches if match.status == "finished"),
        data_sources=[
            {"name": "matches", "maturity": "fixture oficial/seed estructurado", "role": "bracket y resultados fijos"},
            {"name": "team_strength_snapshots", "maturity": "historico internacional si fue ingerido; seed como fallback", "role": "rating, ataque y defensa"},
            {"name": "stadium_context", "maturity": "derivado por ciudad", "role": "tempo y edge local"},
            {"name": "mundial_lab_xg_v1", "maturity": "estimado desde tiros/eventos publicos", "role": "ajuste conservador de forma ofensiva y defensiva"},
            {"name": "live_predictions", "maturity": "admin/directores", "role": "comparacion contra la casa"},
        ],
        methodology=(
            "Monte Carlo de la casa: simula grupos y eliminatorias con ratings, ataque/defensa, fixture completo, "
            "resultados cerrados, ajuste moderado de estadio y xG v1 cuando hay tiros enriquecidos. "
            "El xG no es oficial de proveedor: es una senal conservadora de Mundial Lab con shrinkage."
        ),
        champion=top_champion,
        finalist=summarize(counts, teams, simulations, "finalist"),
        semifinalist=summarize(counts, teams, simulations, "semifinalist"),
        knockout=summarize(counts, teams, simulations, "knockout"),
        top_upsets=[label for label, _ in sorted(upset_counts.items(), key=lambda item: item[1], reverse=True)[:8]],
        pivotal_matches=[
            {"match": "Final", "reason": "Define campeon y comparacion principal", "weight": 1.0},
            {"match": "Semifinales", "reason": "Mayor cambio de probabilidad de titulo", "weight": 0.82},
            {"match": "Grupo A apertura", "reason": "Primer ajuste con sede y posible localia", "weight": 0.54},
        ],
        stadium_adjustments=stadium_adjustments,
        house_vs_directors=[row.model_dump() for row in leaderboard()],
    )
