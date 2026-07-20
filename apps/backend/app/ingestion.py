from __future__ import annotations

import csv
import io
import unicodedata
from collections import defaultdict, deque
from datetime import date
from math import exp
from urllib.request import urlopen

from app.database import connect, initialize_database


RESULTS_URL = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv"
SOURCE_NAME = "martj42/international_results"
SOURCE_VERSION = "results.csv@main"


ALIASES = {
    "czechia": "czech republic",
    "czech republic": "czech republic",
    "cote d ivoire": "ivory coast",
    "cote divoire": "ivory coast",
    "curacao": "curacao",
    "dr congo": "dr congo",
    "democratic republic of congo": "dr congo",
    "congo dr": "dr congo",
    "usa": "united states",
    "united states": "united states",
    "south korea": "south korea",
    "korea republic": "south korea",
    "bosnia herzegovina": "bosnia and herzegovina",
}


def normalize_name(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    text = text.lower().replace("&", " and ")
    cleaned = "".join(char if char.isalnum() else " " for char in text)
    key = " ".join(cleaned.split())
    return ALIASES.get(key, key)


def fixture_teams() -> dict[str, dict[str, str]]:
    with connect() as db:
        rows = db.execute(
            """
            select home_team_id as id, home_team as name, stage from matches where phase = 'grupos'
            union
            select away_team_id as id, away_team as name, stage from matches where phase = 'grupos'
            """
        ).fetchall()
    teams: dict[str, dict[str, str]] = {}
    for row in rows:
        group = str(row["stage"]).replace("Grupo ", "").strip()
        teams[row["id"]] = {"name": row["name"], "group": group, "lookup": normalize_name(row["name"])}
    return teams


def fetch_results() -> list[dict[str, str]]:
    with urlopen(RESULTS_URL, timeout=30) as response:
        payload = response.read().decode("utf-8")
    return list(csv.DictReader(io.StringIO(payload)))


def expected_result(rating_a: float, rating_b: float) -> float:
    return 1 / (1 + 10 ** ((rating_b - rating_a) / 400))


def k_factor(tournament: str, match_date: str) -> float:
    year = int(match_date[:4])
    base = 42 if "World Cup" in tournament else 30 if "continental" in tournament.lower() else 24
    if year >= 2022:
        base += 4
    return base


def score_result(home_score: int, away_score: int) -> float:
    if home_score > away_score:
        return 1.0
    if home_score == away_score:
        return 0.5
    return 0.0


def calculate_strengths(rows: list[dict[str, str]], targets: dict[str, dict[str, str]]) -> dict[str, dict[str, float]]:
    target_names = {item["lookup"] for item in targets.values()}
    ratings: defaultdict[str, float] = defaultdict(lambda: 1500.0)
    recent: dict[str, deque[tuple[int, int, float]]] = defaultdict(lambda: deque(maxlen=30))
    latest_date = "1872-01-01"

    for row in sorted(rows, key=lambda item: item["date"]):
        if row["home_score"] == "NA" or row["away_score"] == "NA":
            continue
        home = normalize_name(row["home_team"])
        away = normalize_name(row["away_team"])
        home_score = int(row["home_score"])
        away_score = int(row["away_score"])
        latest_date = max(latest_date, row["date"])

        expected_home = expected_result(ratings[home], ratings[away])
        actual_home = score_result(home_score, away_score)
        margin = max(1, abs(home_score - away_score))
        multiplier = 1 + min(1.2, (margin - 1) * 0.18)
        k = k_factor(row["tournament"], row["date"]) * multiplier
        delta = k * (actual_home - expected_home)
        ratings[home] += delta
        ratings[away] -= delta

        year = int(row["date"][:4])
        if year >= 2018:
            weight = exp(-(date.today().year - year) / 5)
            recent[home].append((home_score, away_score, weight))
            recent[away].append((away_score, home_score, weight))

    global_for = []
    global_against = []
    for team, matches in recent.items():
        if team in target_names and matches:
            weight_total = sum(weight for _, _, weight in matches)
            global_for.append(sum(gf * weight for gf, _, weight in matches) / weight_total)
            global_against.append(sum(ga * weight for _, ga, weight in matches) / weight_total)
    avg_for = sum(global_for) / max(1, len(global_for))
    avg_against = sum(global_against) / max(1, len(global_against))

    strengths: dict[str, dict[str, float]] = {}
    for team_id, meta in targets.items():
        lookup = meta["lookup"]
        matches = recent.get(lookup, deque())
        if matches:
            weight_total = sum(weight for _, _, weight in matches)
            gf = sum(gf * weight for gf, _, weight in matches) / weight_total
            ga = sum(ga * weight for _, ga, weight in matches) / weight_total
            form_points = sum((3 if gf > ga else 1 if gf == ga else 0) * weight for gf, ga, weight in matches)
            form = form_points / max(0.001, weight_total * 3)
            attack = max(0.72, min(1.42, gf / max(0.6, avg_for)))
            defense = max(0.72, min(1.34, ga / max(0.6, avg_against)))
            window = len(matches)
        else:
            form = 0.45
            attack = 0.92
            defense = 1.08
            window = 0
        strengths[team_id] = {
            "rating": round(ratings[lookup], 2),
            "attack": round(attack, 3),
            "defense": round(defense, 3),
            "form": round(form, 3),
            "window": window,
            "as_of": latest_date,
        }
    return strengths


def ingest_international_results() -> dict[str, int | str | list[str]]:
    initialize_database()
    targets = fixture_teams()
    rows = fetch_results()
    available_names = {normalize_name(row["home_team"]) for row in rows} | {normalize_name(row["away_team"]) for row in rows}
    strengths = calculate_strengths(rows, targets)
    source_label = "Historico internacional de resultados para Elo, ataque y defensa"

    with connect() as db:
        db.execute("delete from international_results where source = ?", (SOURCE_NAME,))
        db.executemany(
            """
            insert into international_results (
                match_date, home_team, away_team, home_score, away_score, tournament,
                city, country, neutral, source, source_version
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    row["date"],
                    row["home_team"],
                    row["away_team"],
                    int(row["home_score"]),
                    int(row["away_score"]),
                    row["tournament"],
                    row.get("city", ""),
                    row.get("country", ""),
                    1 if str(row.get("neutral", "")).lower() == "true" else 0,
                    SOURCE_NAME,
                    SOURCE_VERSION,
                )
                for row in rows
                if row["home_score"] != "NA" and row["away_score"] != "NA"
            ],
        )
        cursor = db.execute(
            "insert into data_snapshots (source, label, version) values (?, ?, ?)",
            (SOURCE_NAME, source_label, SOURCE_VERSION),
        )
        snapshot_id = cursor.lastrowid
        db.execute("delete from team_strength_snapshots where source_snapshot_id is not null")
        target_ids = tuple(targets.keys())
        if target_ids:
            placeholders = ",".join("?" for _ in target_ids)
            db.execute(f"delete from teams where id not in ({placeholders})", target_ids)

        for team_id, meta in targets.items():
            strength = strengths[team_id]
            db.execute(
                """
                insert into teams (
                    id, name, confederation, group_code, rating, attack, defense, qualified
                ) values (?, ?, ?, ?, ?, ?, ?, 1)
                on conflict(id) do update set
                    name = excluded.name,
                    group_code = excluded.group_code,
                    rating = excluded.rating,
                    attack = excluded.attack,
                    defense = excluded.defense,
                    qualified = 1
                """,
                (
                    team_id,
                    meta["name"],
                    "FIFA",
                    meta["group"],
                    strength["rating"],
                    strength["attack"],
                    strength["defense"],
                ),
            )
            db.execute(
                """
                insert into team_strength_snapshots (
                    team_id, team_name, as_of_date, rating_elo, attack_strength,
                    defense_strength, recent_form, matches_window, source_snapshot_id
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    team_id,
                    meta["name"],
                    strength["as_of"],
                    strength["rating"],
                    strength["attack"],
                    strength["defense"],
                    strength["form"],
                    strength["window"],
                    snapshot_id,
                ),
            )

    unmatched = sorted(meta["name"] for meta in targets.values() if meta["lookup"] not in available_names)
    return {
        "source": SOURCE_NAME,
        "source_version": SOURCE_VERSION,
        "rows_ingested": sum(1 for row in rows if row["home_score"] != "NA" and row["away_score"] != "NA"),
        "teams_updated": len(strengths),
        "snapshot_id": snapshot_id,
        "unmatched": unmatched,
    }


def international_results_status() -> dict[str, int | str | list[str] | None]:
    initialize_database()
    with connect() as db:
        snapshot = db.execute(
            """
            select id, source, version, loaded_at
            from data_snapshots
            where source = ?
            order by id desc
            limit 1
            """,
            (SOURCE_NAME,),
        ).fetchone()
        rows_ingested = db.execute(
            "select count(*) as total from international_results where source = ?",
            (SOURCE_NAME,),
        ).fetchone()["total"]
        teams_updated = db.execute(
            "select count(*) as total from team_strength_snapshots where source_snapshot_id is not null"
        ).fetchone()["total"]

    if not snapshot:
        return {
            "source": SOURCE_NAME,
            "source_version": SOURCE_VERSION,
            "rows_ingested": 0,
            "teams_updated": 0,
            "snapshot_id": None,
            "loaded_at": None,
            "unmatched": [],
        }

    return {
        "source": snapshot["source"],
        "source_version": snapshot["version"],
        "rows_ingested": rows_ingested,
        "teams_updated": teams_updated,
        "snapshot_id": snapshot["id"],
        "loaded_at": snapshot["loaded_at"],
        "unmatched": [],
    }
