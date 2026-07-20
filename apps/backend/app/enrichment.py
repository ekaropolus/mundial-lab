from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from app.current_results import ESPN_SCOREBOARD_URL, canonical_team, extract_completed_espn_results, fetch_espn_scoreboard
from app.database import connect, initialize_database
from app.ingestion import normalize_name


USER_AGENT = "MundialLabBot/1.0 (+educational data audit; contact: admin@hadox.org)"
ESPN_SUMMARY_SOURCE = "ESPN site.api fifa.world summary"
ESPN_SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary"
STATSBOMB_SOURCE = "StatsBomb Open Data"
STATSBOMB_RAW = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
OPEN_METEO_SOURCE = "Open-Meteo"
OPEN_METEO_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"


CITY_ALIASES = {
    "Mexico City": (19.4326, -99.1332),
    "Guadalajara": (20.6597, -103.3496),
    "Toronto": (43.6532, -79.3832),
    "Los Angeles": (34.0522, -118.2437),
    "Houston": (29.7604, -95.3698),
    "Vancouver": (49.2827, -123.1207),
    "New York/New Jersey": (40.8128, -74.0742),
    "New York / New Jersey": (40.8128, -74.0742),
    "Miami": (25.7617, -80.1918),
    "Dallas": (32.7767, -96.797),
    "Atlanta": (33.749, -84.388),
    "Seattle": (47.6062, -122.3321),
    "Boston": (42.3601, -71.0589),
    "Kansas City": (39.0997, -94.5786),
    "Philadelphia": (39.9526, -75.1652),
    "San Francisco Bay Area": (37.7749, -122.4194),
}


def _json_request(url: str) -> Any:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8", "ignore"))


def cached_json(source: str, url: str, ttl_seconds: int = 300) -> Any:
    initialize_database()
    now = datetime.now(timezone.utc)
    cache_key = f"{source}:{url}"
    with connect() as db:
        row = db.execute("select payload_text, expires_at from external_data_cache where cache_key = ?", (cache_key,)).fetchone()
        if row and row["expires_at"]:
            expires_at = datetime.fromisoformat(str(row["expires_at"]).replace("Z", "+00:00"))
            if expires_at > now:
                return json.loads(row["payload_text"])

    payload = _json_request(url)
    expires_at = datetime.fromtimestamp(now.timestamp() + ttl_seconds, timezone.utc).isoformat()
    with connect() as db:
        db.execute(
            """
            insert into external_data_cache (cache_key, source, source_url, payload_text, fetched_at, expires_at)
            values (?, ?, ?, ?, current_timestamp, ?)
            on conflict(cache_key) do update set
                payload_text = excluded.payload_text,
                fetched_at = current_timestamp,
                expires_at = excluded.expires_at
            """,
            (cache_key, source, url, json.dumps(payload, ensure_ascii=False), expires_at),
        )
    time.sleep(0.25)
    return payload


def _fixture_index() -> dict[tuple[str, str], dict[str, Any]]:
    initialize_database()
    with connect() as db:
        rows = db.execute("select * from matches").fetchall()
    return {
        (canonical_team(row["home_team"]), canonical_team(row["away_team"])): dict(row)
        for row in rows
    }


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).replace("%", "").replace(",", "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _to_int(value: Any) -> int:
    number = _to_float(value)
    return int(number) if number is not None else 0


def _stat_map(stats: list[dict[str, Any]]) -> dict[str, Any]:
    return {item.get("name", ""): item.get("displayValue", item.get("value")) for item in stats}


def _event_minute(play: dict[str, Any]) -> int:
    clock = play.get("clock") or {}
    value = clock.get("value")
    if value is not None:
        return max(0, int(float(value) // 60))
    display = str(clock.get("displayValue", "")).replace("'", "")
    return _to_int(display)


def estimate_mundial_lab_xg(shot: dict[str, Any]) -> float | None:
    x = _to_float(shot.get("x"))
    y = _to_float(shot.get("y"))

    shot_type = str(shot.get("shot_type", "")).lower()
    outcome = str(shot.get("outcome", "")).lower()
    if "penalty" in shot_type or "penalty" in outcome:
        return 0.76
    if x is None or y is None:
        if "goal" in shot_type or "goal" in outcome:
            return 0.18
        if "saved" in shot_type or "saved" in outcome or "on target" in outcome:
            return 0.08
        if "blocked" in shot_type or "blocked" in outcome:
            return 0.04
        if "shot" in shot_type or "shot" in outcome or "miss" in outcome:
            return 0.03
        return None

    distance = ((100 - x) ** 2 + (50 - y) ** 2) ** 0.5
    centrality = max(0.0, 1 - abs(50 - y) / 50)
    close_goal = max(0.0, 1 - min(distance, 80) / 80)
    box_bonus = 0.06 if x >= 82 and 22 <= y <= 78 else 0
    six_yard_bonus = 0.08 if x >= 93 and 36 <= y <= 64 else 0
    long_shot_penalty = -0.05 if x < 72 else 0
    header_penalty = -0.04 if "header" in shot_type or "header" in outcome else 0
    blocked_penalty = -0.02 if "blocked" in shot_type or "blocked" in outcome else 0

    xg = 0.02 + close_goal * 0.18 + centrality * 0.04 + box_bonus + six_yard_bonus + long_shot_penalty + header_penalty + blocked_penalty
    return round(max(0.01, min(0.45, xg)), 4)


def _source_snapshot(source: str, label: str, version: str, source_url: str, notes: str) -> int | None:
    with connect() as db:
        cursor = db.execute(
            """
            insert into data_snapshots (source, label, version, source_url, trust_level, notes)
            values (?, ?, ?, ?, ?, ?)
            """,
            (source, label, version, source_url, "publico_ingestado", notes),
        )
        return cursor.lastrowid


def _log_job(source: str, job_type: str, status: str, source_url: str, rows_seen: int, rows_inserted: int, errors: list[Any]) -> None:
    with connect() as db:
        db.execute(
            """
            insert into ingestion_jobs (
                source, job_type, status, source_url, finished_at, rows_seen, rows_inserted, errors_json
            ) values (?, ?, ?, ?, current_timestamp, ?, ?, ?)
            """,
            (source, job_type, status, source_url, rows_seen, rows_inserted, json.dumps(errors, ensure_ascii=False)),
        )


def _save_player(source: str, source_player_id: str, player_name: str, country: str = "", position: str = "") -> None:
    if not source_player_id:
        return
    with connect() as db:
        db.execute(
            """
            insert into players (source, source_player_id, player_name, country, position)
            values (?, ?, ?, ?, ?)
            on conflict(source, source_player_id) do update set
                player_name = excluded.player_name,
                country = excluded.country,
                position = excluded.position
            """,
            (source, source_player_id, player_name, country, position),
        )


def _save_match_lineup(row: dict[str, Any]) -> None:
    with connect() as db:
        db.execute(
            """
            insert into match_lineups (
                match_id, team_id, team_name, source, source_player_id, player_name,
                position, jersey, starter, status, raw_json
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(match_id, source, source_player_id) do update set
                team_id = excluded.team_id,
                team_name = excluded.team_name,
                player_name = excluded.player_name,
                position = excluded.position,
                jersey = excluded.jersey,
                starter = excluded.starter,
                status = excluded.status,
                raw_json = excluded.raw_json
            """,
            (
                row["match_id"],
                row["team_id"],
                row["team_name"],
                row["source"],
                row["source_player_id"],
                row["player_name"],
                row.get("position", ""),
                row.get("jersey", ""),
                1 if row.get("starter") else 0,
                row.get("status", ""),
                json.dumps(row.get("raw", {}), ensure_ascii=False),
            ),
        )


def _save_live_features(row: dict[str, Any]) -> None:
    with connect() as db:
        db.execute(
            """
            insert into live_features (
                match_id, minute, source, home_xg, away_xg, home_shots, away_shots,
                home_shots_on_target, away_shots_on_target, home_red_cards, away_red_cards,
                home_possession, away_possession, event_count, raw_json
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(match_id, minute, source) do update set
                home_xg = excluded.home_xg,
                away_xg = excluded.away_xg,
                home_shots = excluded.home_shots,
                away_shots = excluded.away_shots,
                home_shots_on_target = excluded.home_shots_on_target,
                away_shots_on_target = excluded.away_shots_on_target,
                home_red_cards = excluded.home_red_cards,
                away_red_cards = excluded.away_red_cards,
                home_possession = excluded.home_possession,
                away_possession = excluded.away_possession,
                event_count = excluded.event_count,
                raw_json = excluded.raw_json
            """,
            (
                row["match_id"],
                row.get("minute", 0),
                row["source"],
                row.get("home_xg"),
                row.get("away_xg"),
                row.get("home_shots", 0),
                row.get("away_shots", 0),
                row.get("home_shots_on_target", 0),
                row.get("away_shots_on_target", 0),
                row.get("home_red_cards", 0),
                row.get("away_red_cards", 0),
                row.get("home_possession"),
                row.get("away_possession"),
                row.get("event_count", 0),
                json.dumps(row.get("raw", {}), ensure_ascii=False),
            ),
        )


def _save_shot(row: dict[str, Any]) -> None:
    with connect() as db:
        db.execute(
            """
            insert into match_shots (
                external_event_id, match_id, minute, team_name, player_name, shot_type,
                outcome, x, y, end_x, end_y, xg, source, raw_json
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(source, external_event_id) do update set
                match_id = excluded.match_id,
                minute = excluded.minute,
                team_name = excluded.team_name,
                player_name = excluded.player_name,
                shot_type = excluded.shot_type,
                outcome = excluded.outcome,
                x = excluded.x,
                y = excluded.y,
                end_x = excluded.end_x,
                end_y = excluded.end_y,
                xg = excluded.xg,
                raw_json = excluded.raw_json
            """,
            (
                row["external_event_id"],
                row["match_id"],
                row.get("minute", 0),
                row.get("team_name", ""),
                row.get("player_name", ""),
                row.get("shot_type", ""),
                row.get("outcome", ""),
                row.get("x"),
                row.get("y"),
                row.get("end_x"),
                row.get("end_y"),
                row.get("xg"),
                row["source"],
                json.dumps(row.get("raw", {}), ensure_ascii=False),
            ),
        )


def _completed_espn_events(start_date: str, end_date: str) -> list[dict[str, Any]]:
    fixture = _fixture_index()
    start = datetime.strptime(start_date, "%Y%m%d").date()
    end = datetime.strptime(end_date, "%Y%m%d").date()
    events: list[dict[str, Any]] = []
    cursor = start
    while cursor <= end:
        day = cursor.strftime("%Y%m%d")
        scoreboard = fetch_espn_scoreboard(day)
        for item in extract_completed_espn_results(scoreboard):
            match = fixture.get((canonical_team(item["home_team"]), canonical_team(item["away_team"])))
            if match:
                item["match_id"] = match["id"]
                item["home_team_id"] = match["home_team_id"]
                item["away_team_id"] = match["away_team_id"]
                item["day"] = day
                events.append(item)
        cursor = cursor.fromordinal(cursor.toordinal() + 1)
    return events


def ingest_espn_match_enrichment(start_date: str, end_date: str) -> dict[str, Any]:
    initialize_database()
    events = _completed_espn_events(start_date, end_date)
    rows_seen = 0
    rows_inserted = 0
    errors: list[Any] = []
    for event in events:
        url = f"{ESPN_SUMMARY_URL}?{urlencode({'event': event['espn_id']})}"
        try:
            summary = cached_json(ESPN_SUMMARY_SOURCE, url, ttl_seconds=180)
            rows_seen += 1
            rows_inserted += _ingest_espn_summary(event, summary)
        except Exception as exc:  # pragma: no cover - surfaced in admin response
            errors.append({"match_id": event.get("match_id"), "espn_id": event.get("espn_id"), "error": str(exc)})
    snapshot_id = _source_snapshot(
        ESPN_SUMMARY_SOURCE,
        "Enriquecimiento ESPN: rosters, stats y eventos",
        f"{start_date}-{end_date}",
        ESPN_SCOREBOARD_URL,
        "Datos de summary ESPN. No contiene xG oficial confiable; xG v1 es estimado por Mundial Lab con ubicacion y tipo de tiro.",
    )
    _log_job(
        ESPN_SUMMARY_SOURCE,
        "espn_match_enrichment",
        "finished" if not errors else "finished_with_warnings",
        ESPN_SUMMARY_URL,
        rows_seen,
        rows_inserted,
        errors,
    )
    return {
        "snapshot_id": snapshot_id,
        "source": ESPN_SUMMARY_SOURCE,
        "start_date": start_date,
        "end_date": end_date,
        "matches_seen": rows_seen,
        "rows_inserted": rows_inserted,
        "errors": errors,
    }


def _ingest_espn_summary(event: dict[str, Any], summary: dict[str, Any]) -> int:
    inserted = 0
    home_id = event["home_team_id"]
    away_id = event["away_team_id"]
    team_ids_by_name = {
        normalize_name(event["home_team"]): home_id,
        normalize_name(event["away_team"]): away_id,
    }
    team_ids_by_side = {"home": home_id, "away": away_id}

    for roster_group in summary.get("rosters", []) or []:
        team = roster_group.get("team", {})
        team_id = team_ids_by_side.get(roster_group.get("homeAway", ""), normalize_name(team.get("displayName", "")))
        team_name = team.get("displayName", "")
        for player in roster_group.get("roster", []) or []:
            athlete = player.get("athlete", {})
            source_player_id = str(athlete.get("id", ""))
            position = (player.get("position") or {}).get("displayName", "")
            player_name = athlete.get("displayName") or athlete.get("fullName", "")
            _save_player(ESPN_SUMMARY_SOURCE, source_player_id, player_name, team_name, position)
            _save_match_lineup(
                {
                    "match_id": event["match_id"],
                    "team_id": team_id,
                    "team_name": team_name,
                    "source": ESPN_SUMMARY_SOURCE,
                    "source_player_id": source_player_id,
                    "player_name": player_name,
                    "position": position,
                    "jersey": player.get("jersey", ""),
                    "starter": bool(player.get("starter")),
                    "status": "active" if player.get("active") else "inactive",
                    "raw": player,
                }
            )
            inserted += 1

    teams = summary.get("boxscore", {}).get("teams", []) or []
    stats_by_side: dict[str, dict[str, Any]] = {}
    for team_box in teams:
        team_name = team_box.get("team", {}).get("displayName", "")
        key = "home" if normalize_name(team_name) == normalize_name(event["home_team"]) else "away"
        stats_by_side[key] = _stat_map(team_box.get("statistics", []) or [])
    home = stats_by_side.get("home", {})
    away = stats_by_side.get("away", {})
    shots: list[dict[str, Any]] = []
    xg_by_side = {"home": 0.0, "away": 0.0}
    for item in summary.get("commentary", []) or []:
        play = item.get("play") or {}
        play_type = (play.get("type") or {}).get("type", "")
        if "shot" not in play_type and "goal" not in play_type:
            continue
        participants = play.get("participants") or []
        player_name = ""
        if participants:
            player_name = (participants[0].get("athlete") or {}).get("displayName", "")
        shot = {
            "external_event_id": str(play.get("id") or f"{event['espn_id']}-{item.get('sequence')}"),
            "match_id": event["match_id"],
            "minute": _event_minute(play),
            "team_name": (play.get("team") or {}).get("displayName", ""),
            "player_name": player_name,
            "shot_type": (play.get("type") or {}).get("text", play_type),
            "outcome": play.get("text", ""),
            "x": _to_float(play.get("fieldPositionX")),
            "y": _to_float(play.get("fieldPositionY")),
            "end_x": _to_float(play.get("fieldPosition2X")),
            "end_y": _to_float(play.get("fieldPosition2Y")),
            "source": ESPN_SUMMARY_SOURCE,
            "raw": play,
        }
        shot["xg"] = estimate_mundial_lab_xg(shot)
        side = "home" if normalize_name(shot["team_name"]) == normalize_name(event["home_team"]) else "away"
        xg_by_side[side] += float(shot["xg"] or 0)
        shots.append(shot)

    max_minute = max((_event_minute(item.get("play", item)) for item in summary.get("commentary", []) or []), default=90)
    _save_live_features(
        {
            "match_id": event["match_id"],
            "minute": max(90, max_minute),
            "source": ESPN_SUMMARY_SOURCE,
            "home_xg": round(xg_by_side["home"], 4),
            "away_xg": round(xg_by_side["away"], 4),
            "home_shots": _to_int(home.get("totalShots")),
            "away_shots": _to_int(away.get("totalShots")),
            "home_shots_on_target": _to_int(home.get("shotsOnTarget")),
            "away_shots_on_target": _to_int(away.get("shotsOnTarget")),
            "home_red_cards": _to_int(home.get("redCards")),
            "away_red_cards": _to_int(away.get("redCards")),
            "home_possession": _to_float(home.get("possessionPct")),
            "away_possession": _to_float(away.get("possessionPct")),
            "event_count": len(summary.get("commentary", []) or []),
            "raw": {"home": home, "away": away},
        }
    )
    inserted += 1

    for shot in shots:
        _save_shot(shot)
        inserted += 1
    return inserted


def ingest_statsbomb_open_data(
    competition_id: int | None = None,
    season_id: int | None = None,
    competition_name: str | None = "FIFA World Cup",
    limit_matches: int = 20,
) -> dict[str, Any]:
    initialize_database()
    competitions = cached_json(STATSBOMB_SOURCE, f"{STATSBOMB_RAW}/competitions.json", ttl_seconds=86400)
    selected = []
    for row in competitions:
        if competition_id and int(row["competition_id"]) != competition_id:
            continue
        if season_id and int(row["season_id"]) != season_id:
            continue
        if competition_name and competition_name.lower() not in str(row["competition_name"]).lower():
            continue
        selected.append(row)
    if not selected:
        selected = [row for row in competitions if row.get("competition_international") and row.get("competition_gender") == "male"][:1]

    rows_seen = 0
    rows_inserted = 0
    errors: list[Any] = []
    for comp in selected[:3]:
        if rows_seen >= limit_matches:
            break
        matches_url = f"{STATSBOMB_RAW}/matches/{comp['competition_id']}/{comp['season_id']}.json"
        try:
            matches = cached_json(STATSBOMB_SOURCE, matches_url, ttl_seconds=86400)
        except Exception as exc:
            errors.append({"competition": comp, "error": str(exc)})
            continue
        for match in matches:
            if rows_seen >= limit_matches:
                break
            rows_seen += 1
            match_id = f"statsbomb-{match['match_id']}"
            try:
                rows_inserted += _ingest_statsbomb_match(match_id, match)
            except Exception as exc:
                errors.append({"match_id": match.get("match_id"), "error": str(exc)})

    snapshot_id = _source_snapshot(
        STATSBOMB_SOURCE,
        "StatsBomb Open Data historico",
        f"{competition_name or competition_id}:{season_id or 'all'}:{limit_matches}",
        "https://github.com/statsbomb/open-data",
        "Uso educativo; requiere atribucion a StatsBomb Open Data.",
    )
    _log_job(
        STATSBOMB_SOURCE,
        "statsbomb_open_data",
        "finished" if not errors else "finished_with_warnings",
        "https://github.com/statsbomb/open-data",
        rows_seen,
        rows_inserted,
        errors,
    )
    return {
        "snapshot_id": snapshot_id,
        "source": STATSBOMB_SOURCE,
        "matches_seen": rows_seen,
        "rows_inserted": rows_inserted,
        "errors": errors,
    }


def _ingest_statsbomb_match(match_id: str, match: dict[str, Any]) -> int:
    source_match_id = match["match_id"]
    inserted = 0
    lineups = cached_json(STATSBOMB_SOURCE, f"{STATSBOMB_RAW}/lineups/{source_match_id}.json", ttl_seconds=86400)
    for team in lineups:
        team_name = team.get("team_name", "")
        team_id = normalize_name(team_name).replace(" ", "-")
        for player in team.get("lineup", []) or []:
            player_id = str(player.get("player_id", ""))
            player_name = player.get("player_name", "")
            position = ""
            positions = player.get("positions") or []
            starter = False
            if positions:
                position = positions[0].get("position", "")
                starter = positions[0].get("start_reason") == "Starting XI"
            _save_player(STATSBOMB_SOURCE, player_id, player_name, team_name, position)
            _save_match_lineup(
                {
                    "match_id": match_id,
                    "team_id": team_id,
                    "team_name": team_name,
                    "source": STATSBOMB_SOURCE,
                    "source_player_id": player_id,
                    "player_name": player_name,
                    "position": position,
                    "starter": starter,
                    "status": "historical",
                    "raw": player,
                }
            )
            inserted += 1

    events = cached_json(STATSBOMB_SOURCE, f"{STATSBOMB_RAW}/events/{source_match_id}.json", ttl_seconds=86400)
    xg_by_team: dict[str, float] = {}
    shots_by_team: dict[str, int] = {}
    sot_by_team: dict[str, int] = {}
    for event in events:
        if event.get("type", {}).get("name") != "Shot":
            continue
        shot = event.get("shot", {})
        team_name = event.get("team", {}).get("name", "")
        xg = _to_float(shot.get("statsbomb_xg")) or 0.0
        xg_by_team[team_name] = xg_by_team.get(team_name, 0.0) + xg
        shots_by_team[team_name] = shots_by_team.get(team_name, 0) + 1
        outcome = (shot.get("outcome") or {}).get("name", "")
        if outcome in {"Goal", "Saved", "Saved To Post"}:
            sot_by_team[team_name] = sot_by_team.get(team_name, 0) + 1
        location = event.get("location") or [None, None]
        end_location = (shot.get("end_location") or [None, None])
        _save_shot(
            {
                "external_event_id": str(event.get("id")),
                "match_id": match_id,
                "minute": int(event.get("minute", 0)),
                "team_name": team_name,
                "player_name": event.get("player", {}).get("name", ""),
                "shot_type": (shot.get("type") or {}).get("name", ""),
                "outcome": outcome,
                "x": _to_float(location[0]),
                "y": _to_float(location[1]),
                "end_x": _to_float(end_location[0]),
                "end_y": _to_float(end_location[1]),
                "xg": xg,
                "source": STATSBOMB_SOURCE,
                "raw": event,
            }
        )
        inserted += 1

    home = match.get("home_team", {}).get("home_team_name", "")
    away = match.get("away_team", {}).get("away_team_name", "")
    _save_live_features(
        {
            "match_id": match_id,
            "minute": 90,
            "source": STATSBOMB_SOURCE,
            "home_xg": round(xg_by_team.get(home, 0.0), 4),
            "away_xg": round(xg_by_team.get(away, 0.0), 4),
            "home_shots": shots_by_team.get(home, 0),
            "away_shots": shots_by_team.get(away, 0),
            "home_shots_on_target": sot_by_team.get(home, 0),
            "away_shots_on_target": sot_by_team.get(away, 0),
            "event_count": len(events),
            "raw": {"statsbomb_match": match},
        }
    )
    inserted += 1
    return inserted


def _match_rows_for_weather(start_date: str, end_date: str) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute(
            """
            select id, venue, city, kickoff
            from matches
            where substr(kickoff, 1, 10) between ? and ?
            order by kickoff
            """,
            (f"{start_date[:4]}-{start_date[4:6]}-{start_date[6:8]}", f"{end_date[:4]}-{end_date[4:6]}-{end_date[6:8]}"),
        ).fetchall()
    return [dict(row) for row in rows]


def _city_coordinates(city: str) -> tuple[float, float] | None:
    if city in CITY_ALIASES:
        return CITY_ALIASES[city]
    payload = cached_json(OPEN_METEO_SOURCE, f"{OPEN_METEO_GEOCODE}?{urlencode({'name': city, 'count': 1})}", ttl_seconds=86400)
    results = payload.get("results") or []
    if not results:
        return None
    return float(results[0]["latitude"]), float(results[0]["longitude"])


def ingest_stadium_weather(start_date: str, end_date: str) -> dict[str, Any]:
    initialize_database()
    rows = _match_rows_for_weather(start_date, end_date)
    inserted = 0
    errors: list[Any] = []
    for match in rows:
        coords = _city_coordinates(match["city"])
        if not coords:
            errors.append({"match_id": match["id"], "city": match["city"], "error": "Sin coordenadas"})
            continue
        lat, lon = coords
        kickoff = datetime.fromisoformat(match["kickoff"].replace("Z", "+00:00"))
        date_key = kickoff.date().isoformat()
        query = urlencode(
            {
                "latitude": lat,
                "longitude": lon,
                "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation",
                "start_date": date_key,
                "end_date": date_key,
                "timezone": "UTC",
            }
        )
        url = f"{OPEN_METEO_FORECAST}?{query}"
        try:
            payload = cached_json(OPEN_METEO_SOURCE, url, ttl_seconds=1800)
            index = _nearest_weather_hour(payload.get("hourly", {}), kickoff)
            if index is None:
                errors.append({"match_id": match["id"], "error": "Open-Meteo sin hora cercana"})
                continue
            hourly = payload["hourly"]
            with connect() as db:
                db.execute(
                    """
                    insert into stadium_conditions (
                        match_id, venue, city, source, observed_at, temperature_c,
                        humidity_pct, wind_kph, precipitation_mm, raw_json
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict(match_id, source, observed_at) do update set
                        temperature_c = excluded.temperature_c,
                        humidity_pct = excluded.humidity_pct,
                        wind_kph = excluded.wind_kph,
                        precipitation_mm = excluded.precipitation_mm,
                        raw_json = excluded.raw_json
                    """,
                    (
                        match["id"],
                        match["venue"],
                        match["city"],
                        OPEN_METEO_SOURCE,
                        hourly["time"][index],
                        _to_float(hourly.get("temperature_2m", [None])[index]),
                        _to_float(hourly.get("relative_humidity_2m", [None])[index]),
                        _to_float(hourly.get("wind_speed_10m", [None])[index]),
                        _to_float(hourly.get("precipitation", [None])[index]),
                        json.dumps(payload, ensure_ascii=False),
                    ),
                )
            inserted += 1
        except Exception as exc:
            errors.append({"match_id": match["id"], "error": str(exc)})

    snapshot_id = _source_snapshot(
        OPEN_METEO_SOURCE,
        "Clima por sede y kickoff",
        f"{start_date}-{end_date}",
        OPEN_METEO_FORECAST,
        "Pronostico/observacion horaria por ciudad del partido. Usar como contexto, no como verdad táctica fuerte.",
    )
    _log_job(
        OPEN_METEO_SOURCE,
        "stadium_weather",
        "finished" if not errors else "finished_with_warnings",
        OPEN_METEO_FORECAST,
        len(rows),
        inserted,
        errors,
    )
    return {
        "snapshot_id": snapshot_id,
        "source": OPEN_METEO_SOURCE,
        "matches_seen": len(rows),
        "rows_inserted": inserted,
        "errors": errors,
    }


def _nearest_weather_hour(hourly: dict[str, Any], kickoff: datetime) -> int | None:
    times = hourly.get("time") or []
    if not times:
        return None
    kickoff = kickoff.astimezone(timezone.utc)
    best_index = 0
    best_delta = float("inf")
    for index, value in enumerate(times):
        parsed = datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
        delta = abs((parsed - kickoff).total_seconds())
        if delta < best_delta:
            best_delta = delta
            best_index = index
    return best_index


def backfill_mundial_lab_xg() -> dict[str, Any]:
    initialize_database()
    updated_shots = 0
    updated_features = 0
    with connect() as db:
        shot_rows = db.execute(
            """
            select external_event_id, match_id, team_name, shot_type, outcome, x, y, source
            from match_shots
            where source = ?
            """,
            (ESPN_SUMMARY_SOURCE,),
        ).fetchall()
        for row in shot_rows:
            xg = estimate_mundial_lab_xg(dict(row))
            if xg is None:
                continue
            db.execute(
                "update match_shots set xg = ? where source = ? and external_event_id = ?",
                (xg, row["source"], row["external_event_id"]),
            )
            updated_shots += 1

        matches = db.execute("select id, home_team, away_team from matches").fetchall()
        for match in matches:
            rows = db.execute(
                """
                select team_name, xg
                from match_shots
                where match_id = ? and source = ? and xg is not null
                """,
                (match["id"], ESPN_SUMMARY_SOURCE),
            ).fetchall()
            if not rows:
                continue
            home_xg = 0.0
            away_xg = 0.0
            for row in rows:
                if normalize_name(row["team_name"]) == normalize_name(match["home_team"]):
                    home_xg += float(row["xg"] or 0)
                elif normalize_name(row["team_name"]) == normalize_name(match["away_team"]):
                    away_xg += float(row["xg"] or 0)
            feature_exists = db.execute(
                """
                select 1
                from live_features
                where match_id = ? and source = ?
                limit 1
                """,
                (match["id"], ESPN_SUMMARY_SOURCE),
            ).fetchone()
            db.execute(
                """
                update live_features
                set home_xg = ?, away_xg = ?
                where match_id = ? and source = ?
                """,
                (round(home_xg, 4), round(away_xg, 4), match["id"], ESPN_SUMMARY_SOURCE),
            )
            if feature_exists:
                updated_features += 1

    _log_job(
        "Mundial Lab xG v1",
        "backfill_xg",
        "finished",
        "local:model/estimate_mundial_lab_xg",
        updated_shots,
        updated_features,
        [],
    )
    return {
        "source": "Mundial Lab xG v1",
        "shots_updated": updated_shots,
        "features_updated": updated_features,
        "note": "xG estimado con ubicacion/tipo de tiro; no es xG oficial de proveedor.",
    }


def data_quality_summary() -> dict[str, Any]:
    initialize_database()
    with connect() as db:
        totals = db.execute(
            """
            select
                count(*) as matches_total,
                sum(case when v.trust_level = 'real_verificado' then 1 else 0 end) as verified_results,
                sum(case when exists(select 1 from match_lineups l where l.match_id = m.id) then 1 else 0 end) as with_lineups,
                sum(case when exists(select 1 from live_features f where f.match_id = m.id) then 1 else 0 end) as with_live_features,
                sum(case when exists(select 1 from match_shots s where s.match_id = m.id) then 1 else 0 end) as with_shots,
                sum(case when exists(select 1 from match_shots s where s.match_id = m.id and s.xg is not null) then 1 else 0 end) as with_xg,
                sum(case when exists(select 1 from stadium_conditions c where c.match_id = m.id) then 1 else 0 end) as with_weather
            from matches m
            left join match_results_verified v on v.match_id = m.id
            """
        ).fetchone()
        rows = db.execute(
            """
            select
                m.id, m.match_number, m.slug, m.home_team, m.away_team, m.kickoff, m.status,
                coalesce(v.trust_level, '') as result_trust_level,
                exists(select 1 from match_lineups l where l.match_id = m.id) as has_lineups,
                exists(select 1 from live_features f where f.match_id = m.id) as has_live_features,
                exists(select 1 from match_shots s where s.match_id = m.id) as has_shots,
                exists(select 1 from match_shots s where s.match_id = m.id and s.xg is not null) as has_xg,
                exists(select 1 from stadium_conditions c where c.match_id = m.id) as has_weather,
                (select count(*) from match_lineups l where l.match_id = m.id) as lineup_rows,
                (select count(*) from match_shots s where s.match_id = m.id) as shot_rows,
                (select count(*) from match_shots s where s.match_id = m.id and s.xg is not null) as xg_rows
            from matches m
            left join match_results_verified v on v.match_id = m.id
            order by m.kickoff
            """
        ).fetchall()
        jobs = db.execute(
            """
            select source, job_type, status, rows_seen, rows_inserted, finished_at, errors_json
            from ingestion_jobs
            order by id desc
            limit 12
            """
        ).fetchall()
    return {
        "totals": dict(totals),
        "matches": [dict(row) for row in rows],
        "recent_jobs": [dict(row) for row in jobs],
    }


def match_enrichment(match_id: str) -> dict[str, Any]:
    initialize_database()
    with connect() as db:
        match = db.execute("select * from matches where id = ? or slug = ?", (match_id, match_id)).fetchone()
        if not match:
            raise ValueError("Partido no encontrado.")
        resolved_id = match["id"]
        latest_features = db.execute(
            """
            select * from live_features
            where match_id = ?
            order by minute desc, created_at desc
            limit 1
            """,
            (resolved_id,),
        ).fetchone()
        lineups = db.execute(
            """
            select match_id, team_id, team_name, source, source_player_id, player_name,
                   position, jersey, starter, status
            from match_lineups
            where match_id = ?
            order by team_name, starter desc, position, player_name
            """,
            (resolved_id,),
        ).fetchall()
        shots = db.execute(
            """
            select external_event_id, match_id, minute, team_name, player_name, shot_type,
                   outcome, x, y, end_x, end_y, xg, source
            from match_shots
            where match_id = ?
            order by minute, external_event_id
            """,
            (resolved_id,),
        ).fetchall()
        weather = db.execute(
            """
            select match_id, venue, city, source, observed_at, temperature_c,
                   humidity_pct, wind_kph, precipitation_mm
            from stadium_conditions
            where match_id = ?
            order by observed_at desc
            limit 1
            """,
            (resolved_id,),
        ).fetchone()
    return {
        "match_id": resolved_id,
        "features": dict(latest_features) if latest_features else None,
        "lineups": [dict(row) for row in lineups],
        "shots": [dict(row) for row in shots],
        "weather": dict(weather) if weather else None,
        "sources": {
            "features": latest_features["source"] if latest_features else None,
            "lineups": sorted({row["source"] for row in lineups}),
            "shots": sorted({row["source"] for row in shots}),
            "weather": weather["source"] if weather else None,
        },
    }
