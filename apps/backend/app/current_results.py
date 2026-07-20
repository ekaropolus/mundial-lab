from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from html import unescape
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.autopsy import generate_basic_autopsy, list_autopsies, save_result_confirmation, save_verified_result
from app.database import connect, initialize_database
from app.ingestion import normalize_name
from app.models.house_simulator import annex_c_rows
from app.schemas import ResultConfirmation, VerifiedMatchResult


ESPN_SOURCE = "ESPN site.api fifa.world scoreboard"
ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
FOX_SOURCE = "FOX Sports World Cup scores"
FOX_SCORES_URL = "https://www.foxsports.com/soccer/fifa-world-cup/scores"
USER_AGENT = "Mozilla/5.0 MundialLabBot/1.0"

TEAM_ALIASES = {
    "turkiye": "turkey",
    "türkiye": "turkey",
    "czechia": "czech republic",
    "curaçao": "curacao",
    "curacao": "curacao",
    "united states": "united states",
    "usa": "united states",
}


def canonical_team(value: str) -> str:
    key = normalize_name(value)
    return TEAM_ALIASES.get(key, key)


def _parse_day(value: str) -> date:
    return datetime.strptime(value, "%Y%m%d").date()


def _date_range(start_date: str, end_date: str) -> list[str]:
    start = _parse_day(start_date)
    end = _parse_day(end_date)
    if end < start:
        raise ValueError("end_date debe ser igual o posterior a start_date.")
    days = []
    cursor = start
    while cursor <= end:
        days.append(cursor.strftime("%Y%m%d"))
        cursor += timedelta(days=1)
    return days


def fetch_espn_scoreboard(day: str) -> dict[str, Any]:
    query = urlencode({"dates": day})
    request = Request(f"{ESPN_SCOREBOARD_URL}?{query}", headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_fox_scores_page() -> str:
    request = Request(FOX_SCORES_URL, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", "ignore")


def _team_slug(value: str) -> str:
    return canonical_team(value).replace(" ", "-")


def _display_team_name(value: str) -> str:
    aliases = {
        "dr-congo": "DR Congo",
        "ivory-coast": "Ivory Coast",
        "south-africa": "South Africa",
        "south-korea": "South Korea",
        "new-zealand": "New Zealand",
        "united-states": "United States",
        "czech-republic": "Czech Republic",
        "bosnia-and-herzegovina": "Bosnia and Herzegovina",
        "cape-verde": "Cape Verde",
    }
    clean = str(value or "").strip()
    key = clean.lower()
    if key in aliases:
        return aliases[key]
    if "-" in clean and clean == key:
        return " ".join(part.capitalize() for part in clean.split("-"))
    if clean and clean == key:
        return clean.capitalize()
    return clean


def _match_slug(match_number: int, home_team: str, away_team: str) -> str:
    return f"{match_number:03d}-{_team_slug(home_team)}-vs-{_team_slug(away_team)}"


def _group_code(stage: str) -> str:
    return stage.replace("Grupo", "").replace("Group", "").strip().upper()


def _slot_group(slot: str) -> str:
    match = re.match(r"^group-([a-l])-", slot, flags=re.IGNORECASE)
    return match.group(1).upper() if match else ""


def _third_slot_groups(slot: str) -> set[str]:
    raw = slot.replace("group-", "").replace("-third-place", "")
    return {part.upper() for part in raw.split("-") if part}


def _is_group_slot(slot: str) -> bool:
    return slot.startswith("group-") and (
        slot.endswith("-winners") or slot.endswith("-runners-up") or slot.endswith("-third-place")
    )


def _row_team_payload(team_id: str, team_lookup: dict[str, dict[str, Any]]) -> dict[str, Any]:
    payload = dict(team_lookup.get(team_id, {"id": team_id, "name": team_id, "rating": 1500}))
    payload["name"] = _display_team_name(str(payload.get("name") or team_id))
    return payload


def _head_to_head_key(team_id: str, tied: set[str], results: list[tuple[str, str, int, int]]) -> tuple[int, int, int]:
    points = 0
    gf = 0
    ga = 0
    for home_id, away_id, home_goals, away_goals in results:
        if home_id == team_id and away_id in tied:
            gf += home_goals
            ga += away_goals
            points += 3 if home_goals > away_goals else 1 if home_goals == away_goals else 0
        elif away_id == team_id and home_id in tied:
            gf += away_goals
            ga += home_goals
            points += 3 if away_goals > home_goals else 1 if home_goals == away_goals else 0
    return points, gf - ga, gf


def _rank_group(
    rows: dict[str, dict[str, Any]],
    results: list[tuple[str, str, int, int]],
    team_lookup: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    base_sorted = sorted(
        rows.values(),
        key=lambda row: (
            row["points"],
            row["gf"] - row["ga"],
            row["gf"],
            _row_team_payload(row["team_id"], team_lookup).get("rating", 1500),
            _row_team_payload(row["team_id"], team_lookup).get("name", row["team_id"]),
        ),
        reverse=True,
    )
    by_base: dict[tuple[int, int, int], list[dict[str, Any]]] = defaultdict(list)
    for row in base_sorted:
        by_base[(row["points"], row["gf"] - row["ga"], row["gf"])].append(row)

    ranked: list[dict[str, Any]] = []
    for key in sorted(by_base.keys(), reverse=True):
        tied_rows = by_base[key]
        if len(tied_rows) == 1:
            ranked.extend(tied_rows)
            continue
        tied_ids = {row["team_id"] for row in tied_rows}
        ranked.extend(
            sorted(
                tied_rows,
                key=lambda row: (
                    *_head_to_head_key(row["team_id"], tied_ids, results),
                    _row_team_payload(row["team_id"], team_lookup).get("rating", 1500),
                    _row_team_payload(row["team_id"], team_lookup).get("name", row["team_id"]),
                ),
                reverse=True,
            )
        )
    return ranked


def _build_finished_group_rankings() -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, Any]]]:
    with connect() as db:
        teams = [dict(row) for row in db.execute("select id, name, group_code, rating from teams").fetchall()]
        matches = [
            dict(row)
            for row in db.execute(
                """
                select m.*
                from matches m
                left join match_results_verified v on v.match_id = m.id
                where m.phase = 'grupos'
                  and (m.status = 'finished' or v.match_id is not null)
                order by m.match_number
                """
            ).fetchall()
        ]

    team_lookup = {team["id"]: team for team in teams}
    rows_by_group: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    results_by_group: dict[str, list[tuple[str, str, int, int]]] = defaultdict(list)
    played_by_group: dict[str, int] = defaultdict(int)

    for match in matches:
        group = _group_code(str(match["stage"]))
        if not group:
            continue
        home_id = str(match["home_team_id"])
        away_id = str(match["away_team_id"])
        if home_id.startswith("group-") or away_id.startswith("group-"):
            continue
        for team_id in (home_id, away_id):
            team = _row_team_payload(team_id, team_lookup)
            rows_by_group[group].setdefault(
                team_id,
                {"team_id": team_id, "team": team["name"], "points": 0, "gf": 0, "ga": 0},
            )
        home_score = int(match["home_score"])
        away_score = int(match["away_score"])
        home = rows_by_group[group][home_id]
        away = rows_by_group[group][away_id]
        home["gf"] += home_score
        home["ga"] += away_score
        away["gf"] += away_score
        away["ga"] += home_score
        if home_score > away_score:
            home["points"] += 3
        elif away_score > home_score:
            away["points"] += 3
        else:
            home["points"] += 1
            away["points"] += 1
        results_by_group[group].append((home_id, away_id, home_score, away_score))
        played_by_group[group] += 1

    ranked: dict[str, list[dict[str, Any]]] = {}
    for group, rows in rows_by_group.items():
        if played_by_group[group] >= 6 and len(rows) >= 4:
            ranked[group] = _rank_group(rows, results_by_group[group], team_lookup)
    return ranked, team_lookup


def _rank_thirds(ranked_groups: dict[str, list[dict[str, Any]]], team_lookup: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    thirds = []
    for group, rows in ranked_groups.items():
        if len(rows) >= 3:
            item = dict(rows[2])
            item["group"] = group
            thirds.append(item)
    return sorted(
        thirds,
        key=lambda row: (
            row["points"],
            row["gf"] - row["ga"],
            row["gf"],
            _row_team_payload(row["team_id"], team_lookup).get("rating", 1500),
            row["team"],
        ),
        reverse=True,
    )[:8]


def _third_assignments_for_slots(ranked_groups: dict[str, list[dict[str, Any]]], team_lookup: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if len(ranked_groups) < 12:
        return {}
    third_pool = _rank_thirds(ranked_groups, team_lookup)
    third_groups = "".join(sorted(str(item["group"]) for item in third_pool))
    annex_row = annex_c_rows().get(third_groups)
    if not annex_row:
        return {}

    thirds_by_group = {str(item["group"]): item for item in third_pool}
    assignments: dict[str, dict[str, Any]] = {}
    with connect() as db:
        knockout = [
            dict(row)
            for row in db.execute(
                """
                select match_number, home_team_id, away_team_id
                from matches
                where phase = 'eliminacion' and match_number between 73 and 88
                order by match_number
                """
            ).fetchall()
        ]
    for match in knockout:
        slots = [str(match["home_team_id"]), str(match["away_team_id"])]
        third_slot = next((slot for slot in slots if slot.startswith("group-") and slot.endswith("-third-place")), "")
        winner_slot = next((slot for slot in slots if slot.startswith("group-") and slot.endswith("-winners")), "")
        winner_group = _slot_group(winner_slot)
        if not third_slot or not winner_group:
            continue
        selected_group = annex_row.get(f"1{winner_group}")
        if selected_group and selected_group in _third_slot_groups(third_slot) and selected_group in thirds_by_group:
            assignments[third_slot] = thirds_by_group[selected_group]
    return assignments


def _resolve_group_slot(
    slot: str,
    ranked_groups: dict[str, list[dict[str, Any]]],
    third_assignments: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    group = _slot_group(slot)
    if slot.endswith("-winners") and group in ranked_groups and len(ranked_groups[group]) >= 1:
        return ranked_groups[group][0]
    if slot.endswith("-runners-up") and group in ranked_groups and len(ranked_groups[group]) >= 2:
        return ranked_groups[group][1]
    if slot.endswith("-third-place"):
        return third_assignments.get(slot)
    return None


def _team_payload_from_match_side(match: dict[str, Any], side: str, team_lookup: dict[str, dict[str, Any]]) -> dict[str, Any]:
    team_id = str(match[f"{side}_team_id"])
    team_name = str(match[f"{side}_team"])
    payload = _row_team_payload(team_id, team_lookup)
    payload["team_id"] = team_id
    payload["team"] = _display_team_name(team_name)
    return payload


def _resolved_match_winner_loser(
    match: dict[str, Any],
    team_lookup: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if str(match.get("status") or "") != "finished":
        return None, None

    home = _team_payload_from_match_side(match, "home", team_lookup)
    away = _team_payload_from_match_side(match, "away", team_lookup)
    winner_id = str(match.get("winner_team_id") or "")
    if winner_id:
        if winner_id == home["team_id"]:
            return home, away
        if winner_id == away["team_id"]:
            return away, home

    home_score = int(match.get("home_score") or 0)
    away_score = int(match.get("away_score") or 0)
    if home_score > away_score:
        return home, away
    if away_score > home_score:
        return away, home
    return None, None


def _resolve_elimination_reference(
    ref: str,
    resolved_matches: dict[int, dict[str, Any]],
    team_lookup: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    if ref.startswith("winner-match-"):
        match_number = int(ref.replace("winner-match-", ""))
        prior = resolved_matches.get(match_number)
        if not prior:
            return None
        winner, _ = _resolved_match_winner_loser(prior, team_lookup)
        return winner
    if ref.startswith("loser-match-"):
        match_number = int(ref.replace("loser-match-", ""))
        prior = resolved_matches.get(match_number)
        if not prior:
            return None
        _, loser = _resolved_match_winner_loser(prior, team_lookup)
        return loser
    return None


def materialize_knockout_slots() -> dict[str, Any]:
    initialize_database()
    ranked_groups, team_lookup = _build_finished_group_rankings()
    third_assignments = _third_assignments_for_slots(ranked_groups, team_lookup)
    updates: list[dict[str, Any]] = []

    with connect() as db:
        rows = [
            dict(row)
            for row in db.execute(
                """
                select *
                from matches
                where phase = 'eliminacion'
                  and match_number between 73 and 88
                  and (home_team_id like 'group-%%' or away_team_id like 'group-%%')
                order by match_number
                """
            ).fetchall()
        ]

        for match in rows:
            home_slot = str(match["home_team_id"])
            away_slot = str(match["away_team_id"])
            home = _resolve_group_slot(home_slot, ranked_groups, third_assignments) if _is_group_slot(home_slot) else None
            away = _resolve_group_slot(away_slot, ranked_groups, third_assignments) if _is_group_slot(away_slot) else None
            if _is_group_slot(home_slot) and not home:
                continue
            if _is_group_slot(away_slot) and not away:
                continue
            home_id = str(home["team_id"]) if home else home_slot
            away_id = str(away["team_id"]) if away else away_slot
            home_name = str(home["team"]) if home else str(match["home_team"])
            away_name = str(away["team"]) if away else str(match["away_team"])
            slug = _match_slug(int(match["match_number"]), home_name, away_name)
            db.execute(
                """
                update matches
                set home_team_id = ?, away_team_id = ?, home_team = ?, away_team = ?, slug = ?, updated_at = current_timestamp
                where id = ?
                """,
                (home_id, away_id, home_name, away_name, slug, match["id"]),
            )
            updates.append(
                {
                    "match_id": match["id"],
                    "match_number": match["match_number"],
                    "home_team": home_name,
                    "away_team": away_name,
                    "slug": slug,
                }
            )

        resolved_rows = [
            dict(row)
            for row in db.execute(
                """
                select *
                from matches
                where phase = 'eliminacion'
                order by match_number
                """
            ).fetchall()
        ]
        resolved_by_number: dict[int, dict[str, Any]] = {int(row["match_number"]): row for row in resolved_rows}
        for match in resolved_rows:
            match_number = int(match["match_number"])
            if match_number <= 88:
                continue

            home_ref = str(match["home_team_id"])
            away_ref = str(match["away_team_id"])
            home = _resolve_elimination_reference(home_ref, resolved_by_number, team_lookup)
            away = _resolve_elimination_reference(away_ref, resolved_by_number, team_lookup)
            if home_ref.startswith(("winner-match-", "loser-match-")) and not home:
                continue
            if away_ref.startswith(("winner-match-", "loser-match-")) and not away:
                continue
            if not home and not away:
                continue

            home_id = str(home["team_id"]) if home else home_ref
            away_id = str(away["team_id"]) if away else away_ref
            home_name = str(home["team"]) if home else str(match["home_team"])
            away_name = str(away["team"]) if away else str(match["away_team"])
            slug = _match_slug(match_number, home_name, away_name)
            db.execute(
                """
                update matches
                set home_team_id = ?, away_team_id = ?, home_team = ?, away_team = ?, slug = ?, updated_at = current_timestamp
                where id = ?
                """,
                (home_id, away_id, home_name, away_name, slug, match["id"]),
            )
            updated = dict(match)
            updated["home_team_id"] = home_id
            updated["away_team_id"] = away_id
            updated["home_team"] = home_name
            updated["away_team"] = away_name
            updated["slug"] = slug
            resolved_by_number[match_number] = updated
            updates.append(
                {
                    "match_id": match["id"],
                    "match_number": match_number,
                    "home_team": home_name,
                    "away_team": away_name,
                    "slug": slug,
                }
            )

    return {
        "ranked_groups": sorted(ranked_groups.keys()),
        "third_assignments": {slot: item["team"] for slot, item in third_assignments.items()},
        "updated": updates,
    }


def _fox_team_keys(value: str) -> list[str]:
    keys = {normalize_name(value), canonical_team(value)}
    if "czech republic" in keys:
        keys.add("czechia")
    if "turkey" in keys:
        keys.add("turkiye")
    return sorted(keys, key=len, reverse=True)


def _fox_team_slugs(value: str) -> list[str]:
    return [key.replace(" ", "-") for key in _fox_team_keys(value)]


def _strip_html(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", unescape(text)).strip()


def _normalized_score_text(value: str) -> str:
    return normalize_name(value)


def _last_integer(value: str) -> int | None:
    numbers = re.findall(r"\b\d+\b", value)
    return int(numbers[-1]) if numbers else None


def _find_team_at(text: str, candidates: list[str]) -> tuple[int, str]:
    positions = [(text.find(candidate), candidate) for candidate in candidates]
    valid = [(position, candidate) for position, candidate in positions if position >= 0]
    if not valid:
        return -1, ""
    return min(valid, key=lambda item: item[0])


def _extract_fox_final_score(card_text: str, home_team: str, away_team: str) -> tuple[int, int] | None:
    normalized = _normalized_score_text(card_text)
    home_at, home = _find_team_at(normalized, _fox_team_keys(home_team))
    away_at, away = _find_team_at(normalized, _fox_team_keys(away_team))
    final_at = normalized.find(" final")
    if home_at < 0 or away_at < 0 or final_at < 0 or home_at > away_at:
        return None

    home_window = normalized[home_at + len(home) : away_at]
    away_window = normalized[away_at + len(away) : final_at]
    home_score = _last_integer(home_window)
    away_score = _last_integer(away_window)
    if home_score is None or away_score is None:
        return None
    return home_score, away_score


def find_fox_confirmation(item: dict[str, Any], html: str) -> ResultConfirmation | None:
    slug_options = []
    for home_slug in _fox_team_slugs(item["home_team"]):
        for away_slug in _fox_team_slugs(item["away_team"]):
            slug_options.append(f"{home_slug}-vs-{away_slug}")
            slug_options.append(f"{away_slug}-vs-{home_slug}")
    for slug in slug_options:
        for match in re.finditer(re.escape(slug), html):
            start = match.start()
            card_start = html.rfind("<a", 0, start)
            if card_start < 0:
                card_start = start
            card_end = html.find("</a>", start)
            fragment = html[card_start : card_end if card_end > start else start + 3500]
            text = _strip_html(fragment)
            parsed = _extract_fox_final_score(text, item["home_team"], item["away_team"])
            if not parsed:
                continue
            home_score, away_score = parsed
            if home_score != item["home_score"] or away_score != item["away_score"]:
                return None
            href_match = re.search(r'href="([^"]+game-boxscore-[^"]+)"', fragment)
            source_url = FOX_SCORES_URL
            if href_match:
                source_url = f"https://www.foxsports.com{href_match.group(1)}"
            return ResultConfirmation(
                match_id=item["match_id"],
                home_score=home_score,
                away_score=away_score,
                source=FOX_SOURCE,
                source_url=source_url,
                trust_level="publico_ingestado",
                confirmed_by="automation",
                notes="Confirmacion automatica: FOX muestra el mismo marcador final que ESPN.",
            )
    return None


def _fixture_index() -> dict[tuple[str, str], dict[str, Any]]:
    materialize_knockout_slots()
    with connect() as db:
        rows = db.execute("select * from matches").fetchall()
    return {
        (canonical_team(row["home_team"]), canonical_team(row["away_team"])): dict(row)
        for row in rows
    }


def extract_completed_espn_results(scoreboard: dict[str, Any]) -> list[dict[str, Any]]:
    results = []
    for event in scoreboard.get("events", []):
        status = event.get("status", {}).get("type", {})
        if not status.get("completed"):
            continue
        competition = (event.get("competitions") or [{}])[0]
        competitors = competition.get("competitors", [])
        home = next((item for item in competitors if item.get("homeAway") == "home"), None)
        away = next((item for item in competitors if item.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        results.append(
            {
                "espn_id": event.get("id", ""),
                "event_name": event.get("name", ""),
                "event_date": event.get("date", ""),
                "home_team": home.get("team", {}).get("displayName", ""),
                "away_team": away.get("team", {}).get("displayName", ""),
                "home_score": int(home.get("score", 0)),
                "away_score": int(away.get("score", 0)),
                "winner_team": (
                    home.get("team", {}).get("displayName", "")
                    if home.get("winner")
                    else away.get("team", {}).get("displayName", "")
                    if away.get("winner")
                    else ""
                ),
                "winner_side": "home" if home.get("winner") else "away" if away.get("winner") else "",
                "status_detail": status.get("detail") or status.get("description", "FT"),
            }
        )
    return results


def ingest_espn_current_results(
    start_date: str,
    end_date: str,
    generate_autopsies: bool = True,
    confirm_second_source: bool = True,
) -> dict[str, Any]:
    fixture = _fixture_index()
    rows_seen = 0
    rows_inserted = 0
    rows_confirmed = 0
    unmatched: list[dict[str, Any]] = []
    unconfirmed: list[dict[str, Any]] = []
    saved_results: list[dict[str, Any]] = []
    confirmations: list[dict[str, Any]] = []
    autopsies: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    fox_html = ""
    if confirm_second_source:
        try:
            fox_html = fetch_fox_scores_page()
        except Exception as exc:  # pragma: no cover - network volatility is reported in response
            errors.append({"source": FOX_SOURCE, "error": str(exc)})

    for day in _date_range(start_date, end_date):
        scoreboard = fetch_espn_scoreboard(day)
        for item in extract_completed_espn_results(scoreboard):
            rows_seen += 1
            key = (canonical_team(item["home_team"]), canonical_team(item["away_team"]))
            match = fixture.get(key)
            if not match:
                unmatched.append(item)
                continue
            winner_team_id = ""
            winner_team = ""
            if item.get("winner_side") == "home":
                winner_team_id = str(match["home_team_id"])
                winner_team = str(match["home_team"])
            elif item.get("winner_side") == "away":
                winner_team_id = str(match["away_team_id"])
                winner_team = str(match["away_team"])
            item["match_id"] = match["id"]
            try:
                saved = save_verified_result(
                    VerifiedMatchResult(
                        match_id=match["id"],
                        home_score=item["home_score"],
                        away_score=item["away_score"],
                        winner_team_id=winner_team_id,
                        winner_team=winner_team,
                        source=ESPN_SOURCE,
                        source_url=f"{ESPN_SCOREBOARD_URL}?dates={day}",
                        trust_level="publico_ingestado",
                        verified_by="codex",
                        notes=f"ESPN event {item['espn_id']} {item['status_detail']}.",
                    )
                )
                rows_inserted += 1
                saved_results.append(saved)
                if fox_html:
                    confirmation = find_fox_confirmation(item, fox_html)
                    if confirmation:
                        confirmations.append(save_result_confirmation(confirmation))
                        rows_confirmed += 1
                    else:
                        unconfirmed.append(
                            {
                                "match_id": match["id"],
                                "home_team": item["home_team"],
                                "away_team": item["away_team"],
                                "score": f"{item['home_score']}-{item['away_score']}",
                                "source": FOX_SOURCE,
                            }
                        )
                if generate_autopsies and not list_autopsies(match["id"]):
                    try:
                        autopsies.append(generate_basic_autopsy(match["id"]))
                    except ValueError as exc:
                        errors.append({"match_id": match["id"], "error": str(exc)})
            except Exception as exc:  # pragma: no cover - surfaced to admin response
                errors.append({"match_id": match["id"], "error": str(exc)})

    initialize_database()
    with connect() as db:
        snapshot = db.execute(
            """
            insert into data_snapshots (source, label, version, source_url, trust_level, notes)
            values (?, ?, ?, ?, ?, ?)
            """,
            (
                ESPN_SOURCE,
                "Resultados actuales del Mundial desde ESPN",
                f"{start_date}-{end_date}",
                ESPN_SCOREBOARD_URL,
                "publico_ingestado",
                "Solo carga eventos finalizados/completed=true. "
                f"Confirmacion secundaria FOX {'activa' if confirm_second_source else 'apagada'}.",
            ),
        )
        db.execute(
            """
            insert into ingestion_jobs (
                source, job_type, status, source_url, finished_at, rows_seen, rows_inserted, errors_json
            ) values (?, ?, ?, ?, current_timestamp, ?, ?, ?)
            """,
            (
                ESPN_SOURCE,
                "espn_current_results",
                "finished" if not errors and not unmatched else "finished_with_warnings",
                ESPN_SCOREBOARD_URL,
                rows_seen,
                rows_inserted,
                json.dumps({"errors": errors, "unmatched": unmatched, "unconfirmed": unconfirmed}, ensure_ascii=False),
            ),
        )

    return {
        "snapshot_id": snapshot.lastrowid,
        "source": ESPN_SOURCE,
        "start_date": start_date,
        "end_date": end_date,
        "rows_seen": rows_seen,
        "rows_inserted": rows_inserted,
        "rows_confirmed": rows_confirmed,
        "autopsies_created": len(autopsies),
        "unmatched": unmatched,
        "unconfirmed": unconfirmed,
        "errors": errors,
        "results": saved_results,
        "confirmations": confirmations,
    }
