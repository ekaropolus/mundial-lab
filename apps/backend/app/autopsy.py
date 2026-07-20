from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from datetime import datetime

from app.database import connect, initialize_database
from app.models.catalog import list_model_modules
from app.models.house_simulator import teams_from_matches
from app.models.simulator import expected_goals
from app.live import list_matches
from app.models.house_simulator import run_house_match_board
from app.schemas import MatchModelLineCreate, ModelAutopsyCreate, ModelRunCreate, ResultConfirmation, VerifiedMatchResult


MONTHS = {
    "jan": "01",
    "ene": "01",
    "feb": "02",
    "mar": "03",
    "apr": "04",
    "abr": "04",
    "may": "05",
    "jun": "06",
    "jul": "07",
    "aug": "08",
    "ago": "08",
    "sep": "09",
    "oct": "10",
    "nov": "11",
    "dec": "12",
    "dic": "12",
}


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row else {}


def _outcome(home_score: int, away_score: int) -> str:
    if home_score > away_score:
        return "home"
    if home_score < away_score:
        return "away"
    return "draw"


def _prob_for_outcome(line: dict[str, Any], outcome: str) -> float:
    if outcome == "home":
        return float(line["home_win"])
    if outcome == "away":
        return float(line["away_win"])
    return float(line["draw"])


def _favorite_label(line: dict[str, Any]) -> str:
    values = {
        "home": float(line["home_win"]),
        "draw": float(line["draw"]),
        "away": float(line["away_win"]),
    }
    return max(values, key=values.get)


def _line_outcome_label(match: dict[str, Any], outcome: str) -> str:
    if outcome == "home":
        return str(match["home_team"])
    if outcome == "away":
        return str(match["away_team"])
    return "Empate"


def _candidate_error(line: dict[str, Any], outcome: str) -> float:
    return round(1 - _prob_for_outcome(line, outcome), 6)


def _score_probabilities(home_lambda: float, away_lambda: float, dixon_boost: float = 0.0) -> dict[str, float]:
    from math import exp, factorial

    home = draw = away = 0.0
    for h in range(8):
        for a in range(8):
            probability = (exp(-home_lambda) * home_lambda**h / factorial(h)) * (exp(-away_lambda) * away_lambda**a / factorial(a))
            if h <= 1 and a <= 1:
                probability *= 1 + dixon_boost
            if h > a:
                home += probability
            elif h < a:
                away += probability
            else:
                draw += probability
    total = max(0.001, home + draw + away)
    return {"home": home / total, "draw": draw / total, "away": away / total}


def _model_match_line(match_id: str, model: str) -> dict[str, Any]:
    matches = list_matches()
    match = next((item for item in matches if item.id == match_id or item.slug == match_id), None)
    if not match:
        raise ValueError("Partido no encontrado.")
    teams = teams_from_matches(matches)
    if match.home_team_id not in teams or match.away_team_id not in teams:
        raise ValueError("El modelo educativo solo audita partidos con equipos concretos.")
    home_team = teams[match.home_team_id]
    away_team = teams[match.away_team_id]
    model_name = model  # pydantic validates before this path through public callers.
    home_lambda, away_lambda = expected_goals(home_team, away_team, model_name)  # type: ignore[arg-type]
    if model == "elo":
        rating_probability = 1 / (1 + 10 ** ((away_team.rating - home_team.rating) / 400))
        draw = max(0.16, min(0.34, 0.31 - abs(rating_probability - 0.5) * 0.22))
        remaining = 1 - draw
        probs = {"home": rating_probability * remaining, "draw": draw, "away": (1 - rating_probability) * remaining}
    elif model == "dixon_coles":
        probs = _score_probabilities(home_lambda, away_lambda, dixon_boost=0.16)
    elif model == "bayes_live":
        score_signal = 0.0
        base = _score_probabilities(home_lambda, away_lambda)
        probs = {
            "home": max(0.01, base["home"] + max(0, score_signal)),
            "draw": max(0.01, base["draw"] + (1 - abs(score_signal)) * 0.02),
            "away": max(0.01, base["away"] + max(0, -score_signal)),
        }
        total = sum(probs.values())
        probs = {key: value / total for key, value in probs.items()}
    elif model == "ensemble":
        poisson = _score_probabilities(*expected_goals(home_team, away_team, "poisson"))
        elo = _model_match_line(match_id, "elo")
        dixon = _score_probabilities(*expected_goals(home_team, away_team, "dixon_coles"), dixon_boost=0.16)
        bayes = _model_match_line(match_id, "bayes_live")
        probs = {
            "home": poisson["home"] * 0.32 + float(elo["home_win"]) * 0.22 + dixon["home"] * 0.24 + float(bayes["home_win"]) * 0.22,
            "draw": poisson["draw"] * 0.32 + float(elo["draw"]) * 0.22 + dixon["draw"] * 0.24 + float(bayes["draw"]) * 0.22,
            "away": poisson["away"] * 0.32 + float(elo["away_win"]) * 0.22 + dixon["away"] * 0.24 + float(bayes["away_win"]) * 0.22,
        }
    else:
        probs = _score_probabilities(home_lambda, away_lambda)

    options = {
        match.home_team: probs["home"],
        "Empate": probs["draw"],
        match.away_team: probs["away"],
    }
    favorite, confidence = max(options.items(), key=lambda item: item[1])
    return {
        "match_id": match.id,
        "home_win": round(probs["home"], 6),
        "draw": round(probs["draw"], 6),
        "away_win": round(probs["away"], 6),
        "expected_home_goals": round(home_lambda, 4),
        "expected_away_goals": round(away_lambda, 4),
        "favorite": favorite,
        "confidence": round(confidence, 6),
    }


def save_verified_result(payload: VerifiedMatchResult) -> dict[str, Any]:
    initialize_database()
    with connect() as db:
        match = db.execute("select * from matches where id = ? or slug = ?", (payload.match_id, payload.match_id)).fetchone()
        if not match:
            raise ValueError("Partido no encontrado.")
        match_id = match["id"]
        db.execute(
            """
            insert into match_results_verified (
                match_id, home_score, away_score, winner_team_id, winner_team, status, source, source_url,
                trust_level, verified_by, notes
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(match_id) do update set
                home_score = excluded.home_score,
                away_score = excluded.away_score,
                winner_team_id = excluded.winner_team_id,
                winner_team = excluded.winner_team,
                status = excluded.status,
                source = excluded.source,
                source_url = excluded.source_url,
                trust_level = excluded.trust_level,
                verified_by = excluded.verified_by,
                notes = excluded.notes,
                verified_at = current_timestamp
            """,
            (
                match_id,
                payload.home_score,
                payload.away_score,
                payload.winner_team_id or "",
                payload.winner_team or "",
                payload.status,
                payload.source,
                payload.source_url,
                payload.trust_level,
                payload.verified_by,
                payload.notes,
            ),
        )
        db.execute(
            """
            update matches
            set status = ?, minute = ?, home_score = ?, away_score = ?,
                winner_team_id = ?, winner_team = ?, updated_at = current_timestamp
            where id = ?
            """,
            (
                payload.status,
                90 if payload.status == "finished" else 0,
                payload.home_score,
                payload.away_score,
                payload.winner_team_id or "",
                payload.winner_team or "",
                match_id,
            ),
        )
        saved = db.execute("select * from match_results_verified where match_id = ?", (match_id,)).fetchone()
    return _row_to_dict(saved)


def _promote_verified_result_if_confirmed(match_id: str) -> dict[str, Any] | None:
    with connect() as db:
        verified = db.execute("select * from match_results_verified where match_id = ?", (match_id,)).fetchone()
        if not verified:
            return None
        confirmations = db.execute(
            """
            select *
            from match_result_confirmations
            where match_id = ? and home_score = ? and away_score = ?
            order by confirmed_at desc, id desc
            """,
            (match_id, verified["home_score"], verified["away_score"]),
        ).fetchall()
        if not confirmations:
            return _row_to_dict(verified)
        sources = [verified["source"], *[row["source"] for row in confirmations]]
        source_urls = [verified["source_url"], *[row["source_url"] for row in confirmations if row["source_url"]]]
        source_label = " + ".join(dict.fromkeys(source for source in sources if source))
        source_url_label = " | ".join(dict.fromkeys(url for url in source_urls if url))
        db.execute(
            """
            update match_results_verified
            set trust_level = 'real_verificado',
                source = ?,
                source_url = ?,
                notes = ?
            where match_id = ?
            """,
            (
                source_label,
                source_url_label,
                f"Marcador confirmado por {len(confirmations) + 1} fuentes coincidentes.",
                match_id,
            ),
        )
        updated = db.execute("select * from match_results_verified where match_id = ?", (match_id,)).fetchone()
    return _row_to_dict(updated)


def save_result_confirmation(payload: ResultConfirmation) -> dict[str, Any]:
    initialize_database()
    with connect() as db:
        match = db.execute("select * from matches where id = ? or slug = ?", (payload.match_id, payload.match_id)).fetchone()
        if not match:
            raise ValueError("Partido no encontrado.")
        match_id = match["id"]
        db.execute(
            """
            insert into match_result_confirmations (
                match_id, home_score, away_score, source, source_url, trust_level, confirmed_by, notes
            ) values (?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(match_id, source) do update set
                home_score = excluded.home_score,
                away_score = excluded.away_score,
                source_url = excluded.source_url,
                trust_level = excluded.trust_level,
                confirmed_by = excluded.confirmed_by,
                notes = excluded.notes,
                confirmed_at = current_timestamp
            """,
            (
                match_id,
                payload.home_score,
                payload.away_score,
                payload.source,
                payload.source_url,
                payload.trust_level,
                payload.confirmed_by,
                payload.notes,
            ),
        )
        saved = db.execute(
            "select * from match_result_confirmations where match_id = ? and source = ?",
            (match_id, payload.source),
        ).fetchone()

    promoted = _promote_verified_result_if_confirmed(match_id)
    result = _row_to_dict(saved)
    result["verified_result"] = promoted
    return result


def load_result_confirmations_file(path: str | Path) -> dict[str, Any]:
    source_path = Path(path)
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    snapshot = payload.get("snapshot", {})
    confirmations = payload.get("confirmations", [])
    saved: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for item in confirmations:
        merged = {
            "source": snapshot.get("source", "secondary_file"),
            "source_url": snapshot.get("source_url", ""),
            "trust_level": snapshot.get("trust_level", "publico_ingestado"),
            "confirmed_by": "codex",
            "notes": "",
            **item,
        }
        try:
            saved.append(save_result_confirmation(ResultConfirmation(**merged)))
        except Exception as exc:  # pragma: no cover - surfaced to admin response
            errors.append({"match_id": str(item.get("match_id", "")), "error": str(exc)})

    initialize_database()
    with connect() as db:
        cursor = db.execute(
            """
            insert into data_snapshots (source, label, version, source_url, trust_level, notes)
            values (?, ?, ?, ?, ?, ?)
            """,
            (
                snapshot.get("source", source_path.name),
                "Confirmaciones secundarias de resultados",
                snapshot.get("source_version", source_path.name),
                snapshot.get("source_url", ""),
                snapshot.get("trust_level", "publico_ingestado"),
                snapshot.get("notes", ""),
            ),
        )
        db.execute(
            """
            insert into ingestion_jobs (
                source, job_type, status, source_url, finished_at, rows_seen, rows_inserted, errors_json
            ) values (?, ?, ?, ?, current_timestamp, ?, ?, ?)
            """,
            (
                snapshot.get("source", source_path.name),
                "result_confirmations_file",
                "finished" if not errors else "finished_with_errors",
                snapshot.get("source_url", ""),
                len(confirmations),
                len(saved),
                json.dumps(errors, ensure_ascii=False),
            ),
        )

    return {
        "snapshot_id": cursor.lastrowid,
        "rows_seen": len(confirmations),
        "rows_inserted": len(saved),
        "errors": errors,
        "confirmations": saved,
    }


def load_verified_results_file(path: str | Path) -> dict[str, Any]:
    source_path = Path(path)
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    snapshot = payload.get("snapshot", {})
    results = payload.get("results", [])
    saved: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for item in results:
        merged = {
            "source": snapshot.get("source", "manual_file"),
            "source_url": snapshot.get("source_url", ""),
            "trust_level": snapshot.get("trust_level", "publico_ingestado"),
            "verified_by": "codex",
            "notes": "",
            **item,
        }
        try:
            saved.append(save_verified_result(VerifiedMatchResult(**merged)))
        except Exception as exc:  # pragma: no cover - surfaced to admin response
            errors.append({"match_id": str(item.get("match_id", "")), "error": str(exc)})

    initialize_database()
    with connect() as db:
        cursor = db.execute(
            """
            insert into data_snapshots (source, label, version, source_url, trust_level, notes)
            values (?, ?, ?, ?, ?, ?)
            """,
            (
                snapshot.get("source", source_path.name),
                "Resultados verificados del Mundial",
                snapshot.get("source_version", source_path.name),
                snapshot.get("source_url", ""),
                snapshot.get("trust_level", "publico_ingestado"),
                snapshot.get("notes", ""),
            ),
        )
        db.execute(
            """
            insert into ingestion_jobs (
                source, job_type, status, source_url, finished_at, rows_seen, rows_inserted, errors_json
            ) values (?, ?, ?, ?, current_timestamp, ?, ?, ?)
            """,
            (
                snapshot.get("source", source_path.name),
                "verified_results_file",
                "finished" if not errors else "finished_with_errors",
                snapshot.get("source_url", ""),
                len(results),
                len(saved),
                json.dumps(errors, ensure_ascii=False),
            ),
        )

    return {
        "snapshot_id": cursor.lastrowid,
        "rows_seen": len(results),
        "rows_inserted": len(saved),
        "errors": errors,
        "results": saved,
    }


def save_model_run(payload: ModelRunCreate) -> dict[str, Any]:
    initialize_database()
    with connect() as db:
        cursor = db.execute(
            """
            insert into model_runs (
                run_type, model, scenario, seed, simulations, parameters_json,
                data_snapshot_id, notes
            ) values (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.run_type,
                payload.model,
                payload.scenario,
                payload.seed,
                payload.simulations,
                json.dumps(payload.parameters, ensure_ascii=False, sort_keys=True),
                payload.data_snapshot_id,
                payload.notes,
            ),
        )
        saved = db.execute("select * from model_runs where id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_dict(saved)


def _house_result_signature() -> str:
    initialize_database()
    with connect() as db:
        rows = db.execute(
            """
            select id, status, home_score, away_score, updated_at
            from matches
            where status in ('finished', 'live', 'halftime')
            order by match_number, id
            """
        ).fetchall()
    parts = [
        f"{row['id']}:{row['status']}:{row['home_score']}-{row['away_score']}:{row['updated_at']}"
        for row in rows
    ]
    return "|".join(parts) or "no-active-results"


def _infer_house_line_stage(board: dict[str, Any], use_fixed_results: bool) -> str:
    if not use_fixed_results:
        return "baseline"
    lines = board.get("lines", [])
    if any(line.get("status") in {"live", "halftime"} for line in lines):
        return "live"
    if int(board.get("fixed_results_used") or 0) > 0:
        return "post_result"
    return "pre_match"


def save_house_board_lines(
    scenario: str,
    simulations: int,
    seed: int,
    use_stadium: bool,
    use_fixed_results: bool,
    use_xg: bool = True,
    run_type: str = "house",
    line_stage: str | None = None,
) -> dict[str, Any]:
    board = run_house_match_board(
        scenario=scenario,
        simulations=simulations,
        seed=seed,
        use_stadium=use_stadium,
        use_fixed_results=use_fixed_results,
        use_xg=use_xg,
    )
    resolved_stage = line_stage or _infer_house_line_stage(board, use_fixed_results)
    run = save_model_run(
        ModelRunCreate(
            run_type=run_type,  # type: ignore[arg-type]
            model="ensemble",
            scenario=scenario,
            seed=seed,
            simulations=simulations,
            parameters={
                "use_stadium": use_stadium,
                "use_fixed_results": use_fixed_results,
                "use_xg": use_xg,
                "source": "run_house_match_board",
                "line_stage": resolved_stage,
                "champion": board.get("champion", []),
                "top_upsets": board.get("top_upsets", []),
                "fixed_results_used": board.get("fixed_results_used", 0),
                "result_signature": _house_result_signature(),
            },
            notes="Snapshot persistente de lineas Monte Carlo por partido.",
        )
    )
    saved = []
    errors = []
    for line in board["lines"]:
        try:
            saved.append(
                save_match_line(
                    MatchModelLineCreate(
                        run_id=run["id"],
                        match_id=line["match_id"],
                        minute=0,
                        home_win=line["home_win"],
                        draw=line["draw"],
                        away_win=line["away_win"],
                        expected_home_goals=line.get("expected_home_goals"),
                        expected_away_goals=line.get("expected_away_goals"),
                        favorite=line["favorite"],
                        confidence=line["confidence"],
                        top_scores=line.get("top_scores", []),
                        line_payload={
                            "xg_impact": line.get("xg_impact"),
                            "likely_participants": line.get("likely_participants", []),
                            "likely_home": line.get("likely_home", []),
                            "likely_away": line.get("likely_away", []),
                            "projected_home": line.get("projected_home"),
                            "projected_away": line.get("projected_away"),
                            "projected_home_id": line.get("projected_home_id"),
                            "projected_away_id": line.get("projected_away_id"),
                            "projected_winner": line.get("projected_winner"),
                            "projected_winner_id": line.get("projected_winner_id"),
                            "stage": line.get("stage", ""),
                            "phase": line.get("phase", ""),
                            "line_stage": resolved_stage,
                        },
                    )
                )
            )
        except Exception as exc:  # pragma: no cover - surfaced to admin response
            errors.append({"match_id": str(line.get("match_id", "")), "error": str(exc)})
    return {
        "run": run,
        "lines_seen": len(board["lines"]),
        "lines_inserted": len(saved),
        "errors": errors,
        "line_stage": resolved_stage,
    }


def save_house_board_lines_once(
    scenario: str,
    simulations: int,
    seed: int,
    use_stadium: bool,
    use_fixed_results: bool,
    use_xg: bool = True,
    run_type: str = "house",
    line_stage: str | None = None,
) -> dict[str, Any]:
    initialize_database()
    result_signature = _house_result_signature()
    with connect() as db:
        candidates = db.execute(
            """
            select *
            from model_runs
            where run_type = ? and scenario = ? and seed = ? and simulations = ?
            order by id desc
            """,
            (run_type, scenario, seed, simulations),
        ).fetchall()
    for existing in candidates:
        existing_dict = _row_to_dict(existing)
        try:
            params = json.loads(existing_dict.get("parameters_json") or "{}")
        except json.JSONDecodeError:
            params = {}
        if params.get("result_signature") == result_signature:
            return {
                "skipped": True,
                "reason": "Ya existe una corrida con ese escenario, seed, simulaciones y firma de resultados.",
                "run": existing_dict,
                "lines_seen": 0,
                "lines_inserted": 0,
                "errors": [],
            }
    result = save_house_board_lines(
        scenario=scenario,
        simulations=simulations,
        seed=seed,
        use_stadium=use_stadium,
        use_fixed_results=use_fixed_results,
        use_xg=use_xg,
        run_type=run_type,
        line_stage=line_stage,
    )
    result["skipped"] = False
    return result


def save_match_line(payload: MatchModelLineCreate) -> dict[str, Any]:
    total = payload.home_win + payload.draw + payload.away_win
    if abs(total - 1) > 0.02:
        raise ValueError("Las probabilidades deben sumar 1.")
    initialize_database()
    with connect() as db:
        if not db.execute("select id from model_runs where id = ?", (payload.run_id,)).fetchone():
            raise ValueError("Corrida no encontrada.")
        match = db.execute("select id from matches where id = ? or slug = ?", (payload.match_id, payload.match_id)).fetchone()
        if not match:
            raise ValueError("Partido no encontrado.")
        cursor = db.execute(
            """
            insert into match_model_lines (
                run_id, match_id, minute, home_win, draw, away_win,
                expected_home_goals, expected_away_goals, favorite, confidence, top_scores_json,
                line_payload_json
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.run_id,
                match["id"],
                payload.minute,
                payload.home_win,
                payload.draw,
                payload.away_win,
                payload.expected_home_goals,
                payload.expected_away_goals,
                payload.favorite,
                payload.confidence,
                json.dumps(payload.top_scores, ensure_ascii=False),
                json.dumps(payload.line_payload, ensure_ascii=False, sort_keys=True),
            ),
        )
        saved = db.execute("select * from match_model_lines where id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_dict(saved)


def list_match_lines(match_id: str) -> list[dict[str, Any]]:
    initialize_database()
    with connect() as db:
        rows = db.execute(
            """
            select l.*, r.run_type, r.model, r.scenario, r.seed, r.simulations
            from match_model_lines l
            join model_runs r on r.id = l.run_id
            where l.match_id = ?
            order by l.created_at desc, l.id desc
            """,
            (match_id,),
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def latest_house_board_from_saved_lines() -> dict[str, Any] | None:
    initialize_database()
    with connect() as db:
        run = db.execute(
            """
            select r.*, count(l.id) as line_count
            from model_runs r
            join match_model_lines l on l.run_id = r.id
            where r.run_type = 'house'
            group by r.id
            order by
                case when count(l.id) >= 70 then 0 else 1 end,
                r.created_at desc,
                r.id desc
            limit 1
            """
        ).fetchone()
        if not run:
            return None
        run_dict = _row_to_dict(run)
        rows = db.execute(
            """
            select
                l.*,
                m.match_number,
                m.slug,
                m.phase,
                m.stage,
                m.status,
                m.home_team,
                m.away_team,
                m.home_team_id,
                m.away_team_id,
                m.home_score,
                m.away_score,
                m.venue,
                m.city,
                m.kickoff,
                m.local_time_label
            from match_model_lines l
            join matches m on m.id = l.match_id
            where l.run_id = ?
            order by m.match_number
            """,
            (run_dict["id"],),
        ).fetchall()
        fixed_results = db.execute("select count(*) as count from matches where status = 'finished'").fetchone()["count"]

    try:
        parameters = json.loads(run_dict.get("parameters_json") or "{}")
    except json.JSONDecodeError:
        parameters = {}

    lines = []
    for row in rows:
        item = _row_to_dict(row)
        try:
            top_scores = json.loads(item.get("top_scores_json") or "[]")
        except json.JSONDecodeError:
            top_scores = []
        try:
            line_payload = json.loads(item.get("line_payload_json") or "{}")
        except json.JSONDecodeError:
            line_payload = {}
        lines.append(
            {
                "match_id": item["match_id"],
                "match_number": item["match_number"],
                "slug": item["slug"],
                "phase": item["phase"],
                "stage": item["stage"],
                "status": item["status"],
                "home_team": item["home_team"],
                "away_team": item["away_team"],
                "home_team_id": item["home_team_id"],
                "away_team_id": item["away_team_id"],
                "home_score": item["home_score"],
                "away_score": item["away_score"],
                "venue": item["venue"],
                "city": item["city"],
                "kickoff": item["kickoff"],
                "local_time_label": item["local_time_label"],
                "home_win": item["home_win"],
                "draw": item["draw"],
                "away_win": item["away_win"],
                "expected_home_goals": item["expected_home_goals"] or 0,
                "expected_away_goals": item["expected_away_goals"] or 0,
                "xg_impact": line_payload.get("xg_impact"),
                "favorite": item["favorite"],
                "confidence": item["confidence"],
                "top_scores": top_scores,
                "likely_participants": line_payload.get("likely_participants", []),
                "likely_home": line_payload.get("likely_home", []),
                "likely_away": line_payload.get("likely_away", []),
                "projected_home": line_payload.get("projected_home"),
                "projected_away": line_payload.get("projected_away"),
                "projected_home_id": line_payload.get("projected_home_id"),
                "projected_away_id": line_payload.get("projected_away_id"),
                "projected_winner": line_payload.get("projected_winner"),
                "projected_winner_id": line_payload.get("projected_winner_id"),
            }
        )

    return {
        "run_id": f"saved-house-{run_dict['id']}",
        "saved_at": run_dict.get("created_at"),
        "scenario": run_dict["scenario"],
        "simulations": run_dict["simulations"],
        "seed": run_dict.get("seed") or 2026,
        "use_stadium": bool(parameters.get("use_stadium", True)),
        "use_fixed_results": bool(parameters.get("use_fixed_results", True)),
        "use_xg": bool(parameters.get("use_xg", True)),
        "fixed_results_used": int(parameters.get("fixed_results_used") or fixed_results),
        "methodology": "Ultima linea Monte Carlo oficial guardada en base. No recalcula al abrir la pagina.",
        "data_sources": [
            {"name": "model_runs", "maturity": "persistido", "role": "corrida oficial"},
            {"name": "match_model_lines", "maturity": "persistido", "role": "linea por partido"},
            {"name": "matches", "maturity": "fixture/resultados actuales", "role": "metadatos y estado"},
        ],
        "champion": parameters.get("champion", []),
        "top_upsets": parameters.get("top_upsets", []),
        "lines": lines,
    }


def _match_day_key(match: dict[str, Any]) -> str:
    label = str(match.get("local_time_label") or "").strip()
    if label:
        head = label.split("-")[0].strip()
        parts = head.split()
        if len(parts) >= 2:
            day = "".join(char for char in parts[0] if char.isdigit())
            month = MONTHS.get(parts[1].lower()[:3])
            if day and month:
                return f"2026-{month}-{int(day):02d}"
    kickoff = str(match.get("kickoff") or "")
    if len(kickoff) >= 10:
        return kickoff[:10]
    return "unknown"


def _finished_groups_for_day(matches: list[dict[str, Any]], day_key: str) -> list[str]:
    return sorted(
        {
            str(match["stage"])
            for match in matches
            if _match_day_key(match) == day_key
            and match.get("phase") == "grupos"
            and match.get("status") == "finished"
            and str(match.get("stage") or "").startswith("Grupo")
        }
    )


def _group_table_from_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    table: dict[str, dict[str, Any]] = {}

    def ensure(team_id: str, team: str) -> dict[str, Any]:
        if team_id not in table:
            table[team_id] = {
                "team_id": team_id,
                "team": team,
                "played": 0,
                "points": 0,
                "projected_points": 0.0,
                "goals_for": 0,
                "goals_against": 0,
                "signal": 0.0,
            }
        return table[team_id]

    for line in lines:
        home = ensure(str(line["home_team_id"]), str(line["home_team"]))
        away = ensure(str(line["away_team_id"]), str(line["away_team"]))
        home_score = int(line.get("home_score") or 0)
        away_score = int(line.get("away_score") or 0)
        if line.get("status") == "finished":
            home["played"] += 1
            away["played"] += 1
            home["goals_for"] += home_score
            home["goals_against"] += away_score
            away["goals_for"] += away_score
            away["goals_against"] += home_score
            if home_score > away_score:
                home["points"] += 3
            elif home_score < away_score:
                away["points"] += 3
            else:
                home["points"] += 1
                away["points"] += 1

        if line.get("status") == "finished":
            home_expected = 3 if home_score > away_score else 1 if home_score == away_score else 0
            away_expected = 3 if away_score > home_score else 1 if home_score == away_score else 0
        else:
            home_expected = float(line["home_win"]) * 3 + float(line["draw"])
            away_expected = float(line["away_win"]) * 3 + float(line["draw"])
        home["projected_points"] += home_expected
        away["projected_points"] += away_expected
        home["signal"] = max(float(home["signal"]), float(line["home_win"]))
        away["signal"] = max(float(away["signal"]), float(line["away_win"]))

    rows = list(table.values())
    rows.sort(key=lambda item: (float(item["projected_points"]), int(item["points"]), float(item["signal"])), reverse=True)
    for row in rows:
        row["projected_points"] = round(float(row["projected_points"]), 1)
    return rows


def _latest_house_runs(limit: int = 2) -> list[dict[str, Any]]:
    initialize_database()
    with connect() as db:
        rows = db.execute(
            """
            select r.*, count(l.id) as line_count
            from model_runs r
            join match_model_lines l on l.run_id = r.id
            where r.run_type = 'house'
            group by r.id
            having count(l.id) >= 70
            order by r.created_at desc, r.id desc
            limit ?
            """,
            (limit,),
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def _run_champion(run: dict[str, Any]) -> dict[str, Any] | None:
    try:
        params = json.loads(run.get("parameters_json") or "{}")
    except json.JSONDecodeError:
        params = {}
    champion = params.get("champion") or []
    if not champion:
        return None
    top = champion[0]
    return {
        "team": top.get("team"),
        "team_id": top.get("team_id"),
        "probability": round(float(top.get("champion") or 0), 4),
        "run_id": run.get("id"),
        "scenario": run.get("scenario"),
        "created_at": run.get("created_at"),
        "simulations": run.get("simulations"),
    }


def house_daily_editorials(limit_days: int = 5) -> list[dict[str, Any]]:
    board = latest_house_board_from_saved_lines()
    if not board:
        return []

    matches = board["lines"]
    by_day: dict[str, list[dict[str, Any]]] = {}
    for match in matches:
        by_day.setdefault(_match_day_key(match), []).append(match)

    closed_days = [
        day
        for day, day_matches in by_day.items()
        if day != "unknown"
        and any(match.get("status") == "finished" for match in day_matches)
        and all(match.get("status") == "finished" for match in day_matches)
    ]
    closed_days.sort(reverse=True)

    editorials: list[dict[str, Any]] = []
    for day in closed_days[: max(1, min(15, limit_days))]:
        touched_groups = _finished_groups_for_day(matches, day)
        if touched_groups:
            groups = []
            for group in touched_groups:
                group_lines = [line for line in matches if line.get("stage") == group and line.get("phase") == "grupos"]
                rows = _group_table_from_lines(group_lines)
                groups.append(
                    {
                        "group": group,
                        "top_real": sorted(rows, key=lambda item: (int(item["points"]), float(item["projected_points"])), reverse=True)[:4],
                        "top_projected": rows[:4],
                        "matches_finished_today": [
                            {
                                "match_number": line["match_number"],
                                "home_team": line["home_team"],
                                "away_team": line["away_team"],
                                "home_score": line.get("home_score"),
                                "away_score": line.get("away_score"),
                            }
                            for line in group_lines
                            if _match_day_key(line) == day and line.get("status") == "finished"
                        ],
                    }
                )
            top_lines = []
            for group in groups[:3]:
                projected = group["top_projected"][:2]
                if len(projected) >= 2:
                    top_lines.append(
                        f"{group['group']}: {projected[0]['team']} {projected[0]['projected_points']} pts proj, {projected[1]['team']} {projected[1]['projected_points']} pts proj"
                    )
            editorials.append(
                {
                    "id": f"daily-groups-{day}",
                    "kind": "daily_groups",
                    "day": day,
                    "title": f"Cierre de grupos {day}",
                    "eyebrow": "Cierre de jornada",
                    "subtitle": f"{len(touched_groups)} grupos movidos",
                    "detail": "La tabla real ya cuenta los marcadores cerrados; la proyeccion suma lo que Monte Carlo espera para el cierre del grupo.",
                    "metric": f"{len(touched_groups)} grupos",
                    "model_result": " / ".join(top_lines) if top_lines else "Tablas actualizadas",
                    "model_signal": f"{board['run_id']} con {board['simulations']} simulaciones y {board['fixed_results_used']} resultados fijos.",
                    "href": "/montecarlo-casa/",
                    "payload": {"groups": groups, "run_id": board["run_id"], "saved_at": board.get("saved_at")},
                }
            )

    runs = _latest_house_runs(2)
    if runs:
        latest = _run_champion(runs[0])
        previous = _run_champion(runs[1]) if len(runs) > 1 else None
        if latest:
            pulse_day = str(latest.get("created_at") or "")[:10]
            previous_probability = float(previous["probability"]) if previous and previous.get("team") == latest.get("team") else None
            movement = round(float(latest["probability"]) - previous_probability, 4) if previous_probability is not None else None
            if previous and previous.get("team") == latest.get("team"):
                reason = (
                    f"Repite en la cima. Paso de {round(previous_probability * 100, 1)}% a {round(float(latest['probability']) * 100, 1)}%; "
                    "nadie lo alcanzo porque los caminos simulados siguen abriendole mas rutas al titulo."
                )
            elif previous:
                reason = (
                    f"Cambio de lider: venia {previous['team']} con {round(float(previous['probability']) * 100, 1)}%, "
                    f"ahora manda {latest['team']} con {round(float(latest['probability']) * 100, 1)}%."
                )
            else:
                reason = f"Primera lectura guardada: {latest['team']} aparece arriba con {round(float(latest['probability']) * 100, 1)}%."
            editorials.insert(
                0,
                {
                    "id": f"champion-pulse-{pulse_day}",
                    "kind": "champion_pulse",
                    "day": pulse_day,
                    "title": f"{latest['team']} pinta para campeon",
                    "eyebrow": "Pulso al titulo",
                    "subtitle": f"{round(float(latest['probability']) * 100, 1)}% campeon",
                    "detail": reason,
                    "metric": f"{round(float(latest['probability']) * 100, 1)}%",
                    "model_result": f"{latest['team']} {round(float(latest['probability']) * 100, 1)}% al titulo",
                    "model_signal": reason,
                    "href": "/montecarlo-casa/",
                    "payload": {"latest": latest, "previous": previous, "movement": movement},
                },
            )

    return editorials


def list_house_line_evolution(match_id: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
    initialize_database()
    filters = ""
    params: list[Any] = []
    if match_id:
        filters = "where m.id = ? or m.slug = ?"
        params.extend([match_id, match_id])
    params.append(limit)
    with connect() as db:
        rows = db.execute(
            f"""
            select
                l.*,
                r.scenario,
                r.seed,
                r.simulations,
                r.parameters_json,
                r.created_at as run_created_at,
                m.match_number,
                m.slug,
                m.home_team,
                m.away_team,
                m.home_score,
                m.away_score,
                m.status,
                m.stage,
                m.phase
            from match_model_lines l
            join model_runs r on r.id = l.run_id
            join matches m on m.id = l.match_id
            {filters}
            order by r.created_at asc, r.id asc, l.id asc
            limit ?
            """,
            tuple(params),
        ).fetchall()

    items: list[dict[str, Any]] = []
    for row in rows:
        item = _row_to_dict(row)
        try:
            parameters = json.loads(item.get("parameters_json") or "{}")
        except json.JSONDecodeError:
            parameters = {}
        try:
            payload = json.loads(item.get("line_payload_json") or "{}")
        except json.JSONDecodeError:
            payload = {}
        outcome = None
        outcome_probability = None
        if item["status"] == "finished":
            outcome = _outcome(int(item["home_score"]), int(item["away_score"]))
            outcome_probability = _prob_for_outcome(item, outcome)
        items.append(
            {
                "line_id": item["id"],
                "run_id": item["run_id"],
                "match_id": item["match_id"],
                "match_number": item["match_number"],
                "slug": item["slug"],
                "home_team": item["home_team"],
                "away_team": item["away_team"],
                "home_score": item["home_score"],
                "away_score": item["away_score"],
                "status": item["status"],
                "stage": item["stage"],
                "phase": item["phase"],
                "line_stage": parameters.get("line_stage") or payload.get("line_stage") or "official",
                "scenario": item["scenario"],
                "created_at": item["run_created_at"],
                "seed": item["seed"],
                "simulations": item["simulations"],
                "home_win": item["home_win"],
                "draw": item["draw"],
                "away_win": item["away_win"],
                "favorite": item["favorite"],
                "confidence": item["confidence"],
                "expected_home_goals": item["expected_home_goals"],
                "expected_away_goals": item["expected_away_goals"],
                "outcome": outcome,
                "outcome_probability": outcome_probability,
            }
        )
    return items


def house_line_evolution_summary(match_id: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
    items = list_house_line_evolution(match_id, limit)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        grouped.setdefault(str(item["match_id"]), []).append(item)

    summaries: list[dict[str, Any]] = []
    for match_items in grouped.values():
        match_items.sort(key=lambda item: (str(item["created_at"]), int(item["run_id"]), int(item["line_id"])))
        first = match_items[0]
        latest = match_items[-1]
        first_prob = first.get("outcome_probability")
        latest_prob = latest.get("outcome_probability")
        movement = None
        if isinstance(first_prob, (int, float)) and isinstance(latest_prob, (int, float)):
            movement = round(float(latest_prob) - float(first_prob), 6)
        summaries.append(
            {
                "match_id": first["match_id"],
                "match_number": first["match_number"],
                "slug": first["slug"],
                "home_team": first["home_team"],
                "away_team": first["away_team"],
                "home_score": latest["home_score"],
                "away_score": latest["away_score"],
                "status": latest["status"],
                "stage": latest["stage"],
                "phase": latest["phase"],
                "opening": first,
                "latest": latest,
                "movement": movement,
                "versions": len(match_items),
            }
        )
    summaries.sort(key=lambda item: int(item["match_number"]))
    return summaries


def list_autopsies(match_id: str) -> list[dict[str, Any]]:
    initialize_database()
    with connect() as db:
        rows = db.execute(
            """
            select *
            from model_autopsies
            where match_id = ?
            order by created_at desc, id desc
            """,
            (match_id,),
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def _existing_autopsy(match_id: str, stage: str, model: str | None = None) -> dict[str, Any] | None:
    model_filter = "and best_model = ?" if model else ""
    params: list[Any] = [match_id, f"%{stage}%"]
    if model:
        params.append(model)
    with connect() as db:
        row = db.execute(
            f"""
            select *
            from model_autopsies
            where match_id = ?
            and best_parameters_json like ?
            {model_filter}
            order by created_at desc, id desc
            limit 1
            """,
            tuple(params),
        ).fetchone()
    return _row_to_dict(row) if row else None


def list_learning_log(limit: int = 30, model: str | None = None) -> list[dict[str, Any]]:
    initialize_database()
    bounded_limit = max(1, min(500, limit))
    filters = ""
    params: list[Any] = []
    if model:
        filters = "where a.best_model = ?"
        params.append(model)
    params.append(bounded_limit)
    with connect() as db:
        rows = db.execute(
            f"""
            select
                a.*,
                m.match_number,
                m.slug,
                m.home_team,
                m.away_team,
                m.home_score,
                m.away_score,
                m.status,
                m.stage,
                m.venue,
                m.city
            from model_autopsies a
            join matches m on m.id = a.match_id
            {filters}
            order by a.created_at desc, a.id desc
            limit ?
            """,
            tuple(params),
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def save_autopsy(payload: ModelAutopsyCreate) -> dict[str, Any]:
    initialize_database()
    with connect() as db:
        match = db.execute("select id from matches where id = ? or slug = ?", (payload.match_id, payload.match_id)).fetchone()
        if not match:
            raise ValueError("Partido no encontrado.")
        cursor = db.execute(
            """
            insert into model_autopsies (
                match_id, original_run_id, original_line_id, best_model, best_parameters_json,
                original_error, best_error, outcome, headline, lesson, share_copy
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                match["id"],
                payload.original_run_id,
                payload.original_line_id,
                payload.best_model,
                json.dumps(payload.best_parameters, ensure_ascii=False, sort_keys=True),
                payload.original_error,
                payload.best_error,
                payload.outcome,
                payload.headline,
                payload.lesson,
                payload.share_copy,
            ),
        )
        saved = db.execute("select * from model_autopsies where id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_dict(saved)


def generate_basic_autopsy(match_id: str) -> dict[str, Any]:
    initialize_database()
    with connect() as db:
        match = db.execute("select * from matches where id = ? or slug = ?", (match_id, match_id)).fetchone()
        if not match:
            raise ValueError("Partido no encontrado.")
        existing = _existing_autopsy(str(match["id"]), "basic_autopsy")
        if existing:
            return existing
        verified = db.execute("select * from match_results_verified where match_id = ?", (match["id"],)).fetchone()
        if not verified:
            raise ValueError("Primero carga el resultado verificado.")
        line = db.execute(
            """
            select l.*, r.model, r.scenario
            from match_model_lines l
            join model_runs r on r.id = l.run_id
            where l.match_id = ?
            order by l.created_at asc, l.id asc
            limit 1
            """,
            (match["id"],),
        ).fetchone()
        if not line:
            raise ValueError("Primero guarda una linea original del modelo.")

    line_dict = _row_to_dict(line)
    result = _row_to_dict(verified)
    outcome = _outcome(int(result["home_score"]), int(result["away_score"]))
    original_probability = _prob_for_outcome(line_dict, outcome)
    original_error = round(1 - original_probability, 6)
    favorite = _favorite_label(line_dict)
    was_surprise = favorite != outcome
    home = match["home_team"]
    away = match["away_team"]
    score = f"{result['home_score']}-{result['away_score']}"
    headline = (
        f"Autopsia: la cancha contradijo a la linea en {home} vs {away}"
        if was_surprise
        else f"Autopsia: la linea leyo bien el {home} vs {away}"
    )
    lesson = (
        "La primera lectura subestimo el desenlace real; toca revisar ritmo, empate y senales vivas."
        if was_surprise
        else "La primera lectura estuvo alineada con el resultado; ahora hay que medir si estaba bien calibrada."
    )
    share_copy = (
        f"La autopsia del modelo ya tiene veredicto.\n\n"
        f"{home} {score} {away}\n"
        f"La linea original daba {round(original_probability * 100)}% al desenlace real.\n"
        f"Leccion: {lesson}\n\n"
        "#MundialLab #DataScience #FootballAnalytics"
    )
    payload = ModelAutopsyCreate(
        match_id=match["id"],
        original_run_id=line_dict["run_id"],
        original_line_id=line_dict["id"],
        best_model=line_dict["model"],
        best_parameters={"stage": "basic_autopsy", "needs_parameter_search": True},
        original_error=original_error,
        best_error=original_error,
        outcome=outcome,
        headline=headline,
        lesson=lesson,
        share_copy=share_copy,
    )
    return save_autopsy(payload)


def generate_calibrated_autopsy(match_id: str, simulations: int = 1200, seed: int = 2026) -> dict[str, Any]:
    initialize_database()
    with connect() as db:
        match = db.execute("select * from matches where id = ? or slug = ?", (match_id, match_id)).fetchone()
        if not match:
            raise ValueError("Partido no encontrado.")
        existing = _existing_autopsy(str(match["id"]), "calibrated_autopsy")
        if existing:
            return existing
        verified = db.execute("select * from match_results_verified where match_id = ?", (match["id"],)).fetchone()
        if not verified:
            raise ValueError("Primero carga el resultado verificado.")
        original = db.execute(
            """
            select l.*, r.model, r.scenario, r.parameters_json
            from match_model_lines l
            join model_runs r on r.id = l.run_id
            where l.match_id = ?
            order by l.created_at asc, l.id asc
            limit 1
            """,
            (match["id"],),
        ).fetchone()

    match_dict = _row_to_dict(match)
    result = _row_to_dict(verified)
    outcome = _outcome(int(result["home_score"]), int(result["away_score"]))
    contracts = [
        {"name": "Base sin estadio ni xG", "use_stadium": False, "use_xg": False, "seed_shift": 0},
        {"name": "Estadio activo", "use_stadium": True, "use_xg": False, "seed_shift": 11},
        {"name": "xG v1 activo", "use_stadium": False, "use_xg": True, "seed_shift": 23},
        {"name": "Estadio + xG v1", "use_stadium": True, "use_xg": True, "seed_shift": 37},
    ]
    candidates: list[dict[str, Any]] = []
    for contract in contracts:
        board = run_house_match_board(
            scenario=f"Autopsia {contract['name']}",
            simulations=simulations,
            seed=seed + int(contract["seed_shift"]),
            use_stadium=bool(contract["use_stadium"]),
            use_fixed_results=True,
            use_xg=bool(contract["use_xg"]),
            exclude_fixed_match_id=str(match["id"]),
        )
        line = next((item for item in board["lines"] if item["match_id"] == match["id"]), None)
        if not line:
            continue
        candidates.append(
            {
                "contract": contract["name"],
                "use_stadium": contract["use_stadium"],
                "use_xg": contract["use_xg"],
                "seed": seed + int(contract["seed_shift"]),
                "home_win": line["home_win"],
                "draw": line["draw"],
                "away_win": line["away_win"],
                "expected_home_goals": line["expected_home_goals"],
                "expected_away_goals": line["expected_away_goals"],
                "favorite": line["favorite"],
                "confidence": line["confidence"],
                "probability_for_real_outcome": round(_prob_for_outcome(line, outcome), 6),
                "error": _candidate_error(line, outcome),
                "xg_impact": line.get("xg_impact"),
            }
        )
    if not candidates:
        raise ValueError("No se pudo reconstruir la linea del partido.")

    candidates.sort(key=lambda item: float(item["probability_for_real_outcome"]), reverse=True)
    best = candidates[0]
    original_dict = _row_to_dict(original) if original else {}
    if original_dict:
        original_probability = _prob_for_outcome(original_dict, outcome)
        original_error = round(1 - original_probability, 6)
        original_line_id = original_dict["id"]
        original_run_id = original_dict["run_id"]
    else:
        original_probability = float(candidates[-1]["probability_for_real_outcome"])
        original_error = float(candidates[-1]["error"])
        original_line_id = None
        original_run_id = None

    home = match_dict["home_team"]
    away = match_dict["away_team"]
    score = f"{result['home_score']}-{result['away_score']}"
    outcome_label = _line_outcome_label(match_dict, outcome)
    lift = round(float(best["probability_for_real_outcome"]) - original_probability, 6)
    headline = f"Autopsia calibrada: {outcome_label} era la lectura que habia que escuchar"
    lesson = (
        f"El contrato ganador fue {best['contract']}: daba {round(float(best['probability_for_real_outcome']) * 100, 1)}% "
        f"al desenlace real de {home} {score} {away}. "
        f"Mejoro {round(lift * 100, 1)} puntos contra la primera linea guardada."
    )
    share_copy = (
        "Autopsia del modelo.\n\n"
        f"{home} {score} {away}\n"
        f"Resultado real: {outcome_label}\n"
        f"Primera linea: {round(original_probability * 100, 1)}% al desenlace real.\n"
        f"Mejor contrato: {best['contract']} con {round(float(best['probability_for_real_outcome']) * 100, 1)}%.\n"
        f"Leccion: {lesson}\n\n"
        "No es magia: es calibracion con datos, estadio, xG v1 y autopsia posterior.\n"
        "#MundialLab #DataScience #FootballAnalytics #WorldCup"
    )
    payload = ModelAutopsyCreate(
        match_id=str(match["id"]),
        original_run_id=original_run_id,
        original_line_id=original_line_id,
        best_model="ensemble",
        best_parameters={
            "stage": "calibrated_autopsy",
            "simulations": simulations,
            "seed": seed,
            "outcome_probability_lift": lift,
            "best_contract": best,
            "candidates": candidates,
            "no_leakage_rule": "El partido auditado se reabre como scheduled durante la simulacion.",
        },
        original_error=original_error,
        best_error=float(best["error"]),
        outcome=outcome,
        headline=headline,
        lesson=lesson,
        share_copy=share_copy,
    )
    return save_autopsy(payload)


MODEL_LESSONS = {
    "elo": "Elo aprende si la jerarquia historica fue suficiente o si el partido exigia una senal mas fresca.",
    "poisson": "Poisson aprende si sus lambdas de gol explicaron el marcador o si el partido se salio del volumen esperado.",
    "dixon_coles": "Dixon-Coles aprende si la correccion de marcador bajo ayudo o estorbo en un partido cerrado.",
    "bayes_live": "Bayes aprende cuanto habria necesitado evidencia viva para mover una creencia inicial.",
    "ensemble": "El ensamble aprende que familia de senales merecia mas voz antes del silbatazo.",
}


def generate_model_autopsy(match_id: str, model: str) -> dict[str, Any]:
    valid_models = {item.id for item in list_model_modules()}
    if model not in valid_models:
        raise ValueError("Modelo no encontrado.")
    initialize_database()
    with connect() as db:
        match = db.execute("select * from matches where id = ? or slug = ?", (match_id, match_id)).fetchone()
        if not match:
            raise ValueError("Partido no encontrado.")
        existing = _existing_autopsy(str(match["id"]), "model_autopsy", model)
        if existing:
            return existing
        verified = db.execute("select * from match_results_verified where match_id = ?", (match["id"],)).fetchone()
        if not verified:
            raise ValueError("Primero carga el resultado verificado.")

    match_dict = _row_to_dict(match)
    result = _row_to_dict(verified)
    line = _model_match_line(str(match["id"]), model)
    outcome = _outcome(int(result["home_score"]), int(result["away_score"]))
    probability = _prob_for_outcome(line, outcome)
    error = round(1 - probability, 6)
    outcome_name = _line_outcome_label(match_dict, outcome)
    score = f"{result['home_score']}-{result['away_score']}"
    model_label = next(item.short_name for item in list_model_modules() if item.id == model)
    headline = f"{model_label}: autopsia de {match_dict['home_team']} vs {match_dict['away_team']}"
    lesson = (
        f"{MODEL_LESSONS.get(model, 'El modelo deja una lectura auditable.')} "
        f"Le dio {round(probability * 100, 1)}% al desenlace real: {outcome_name} en el {score}."
    )
    share_copy = (
        f"Autopsia de {model_label}.\n\n"
        f"{match_dict['home_team']} {score} {match_dict['away_team']}\n"
        f"Resultado real: {outcome_name}\n"
        f"Lectura del modelo: {round(line['home_win'] * 100, 1)}% local · {round(line['draw'] * 100, 1)}% empate · {round(line['away_win'] * 100, 1)}% visita.\n"
        f"Probabilidad al desenlace real: {round(probability * 100, 1)}%.\n"
        f"Leccion: {lesson}\n\n"
        "#MundialLab #DataScience #FootballAnalytics"
    )
    payload = ModelAutopsyCreate(
        match_id=str(match["id"]),
        original_run_id=None,
        original_line_id=None,
        best_model=model,  # type: ignore[arg-type]
        best_parameters={
            "stage": "model_autopsy",
            "model": model,
            "line": line,
            "probability_for_real_outcome": round(probability, 6),
            "no_leakage_rule": "La lectura del modelo se calcula sin usar el marcador final como evidencia del mismo partido.",
        },
        original_error=error,
        best_error=error,
        outcome=outcome,
        headline=headline,
        lesson=lesson,
        share_copy=share_copy,
    )
    return save_autopsy(payload)


def generate_all_model_autopsies(match_id: str) -> dict[str, Any]:
    created = []
    errors = []
    for model in [item.id for item in list_model_modules()]:
        try:
            created.append(generate_model_autopsy(match_id, model))
        except ValueError as exc:
            errors.append({"model": model, "error": str(exc)})
    return {"created": len(created), "errors": errors, "autopsies": created}


def generate_pending_basic_autopsies() -> dict[str, Any]:
    initialize_database()
    with connect() as db:
        rows = db.execute(
            """
            select v.match_id
            from match_results_verified v
            where exists (
                select 1 from match_model_lines l where l.match_id = v.match_id
            )
            and not exists (
                select 1 from model_autopsies a where a.match_id = v.match_id
            )
            order by v.verified_at, v.match_id
            """
        ).fetchall()

    created = []
    errors = []
    for row in rows:
        match_id = row["match_id"]
        try:
            created.append(generate_basic_autopsy(match_id))
        except ValueError as exc:
            errors.append({"match_id": match_id, "error": str(exc)})

    return {
        "pending_seen": len(rows),
        "created": len(created),
        "errors": errors,
        "autopsies": created,
    }


def generate_pending_autopsies(max_jobs: int = 3, simulations: int = 1200, seed: int = 2026) -> dict[str, Any]:
    initialize_database()
    limit = max(1, min(25, max_jobs))
    model_ids = [item.id for item in list_model_modules()]
    with connect() as db:
        rows = db.execute(
            """
            select v.match_id, v.verified_at
            from match_results_verified v
            join matches m on m.id = v.match_id
            order by v.verified_at, m.kickoff, v.match_id
            """
        ).fetchall()

    queue: list[dict[str, str]] = []
    for row in rows:
        match_id = str(row["match_id"])
        if not _existing_autopsy(match_id, "calibrated_autopsy"):
            queue.append({"kind": "calibrated", "match_id": match_id})
        for model in model_ids:
            if not _existing_autopsy(match_id, "model_autopsy", model):
                queue.append({"kind": "model", "match_id": match_id, "model": model})
        if len(queue) >= limit:
            break

    selected = queue[:limit]
    created = []
    errors = []
    for index, job in enumerate(selected):
        try:
            if job["kind"] == "calibrated":
                created.append(generate_calibrated_autopsy(job["match_id"], simulations=simulations, seed=seed + index))
            else:
                created.append(generate_model_autopsy(job["match_id"], job["model"]))
        except ValueError as exc:
            errors.append({**job, "error": str(exc)})

    return {
        "queue_size": len(queue),
        "selected": selected,
        "created": len(created),
        "errors": errors,
        "autopsies": created,
    }


def autopsy_queue_status(limit: int = 20) -> dict[str, Any]:
    initialize_database()
    bounded_limit = max(1, min(100, limit))
    model_ids = [item.id for item in list_model_modules()]
    with connect() as db:
        verified_rows = db.execute(
            """
            select
                v.match_id,
                v.verified_at,
                m.match_number,
                m.slug,
                m.home_team,
                m.away_team,
                m.home_score,
                m.away_score,
                m.kickoff
            from match_results_verified v
            join matches m on m.id = v.match_id
            order by v.verified_at, m.kickoff, v.match_id
            """
        ).fetchall()
        recent_rows = db.execute(
            """
            select
                a.id,
                a.match_id,
                a.best_model,
                a.best_parameters_json,
                a.headline,
                a.best_error,
                a.created_at,
                m.match_number,
                m.slug,
                m.home_team,
                m.away_team
            from model_autopsies a
            join matches m on m.id = a.match_id
            order by a.created_at desc, a.id desc
            limit ?
            """,
            (bounded_limit,),
        ).fetchall()

    pending: list[dict[str, Any]] = []
    coverage = {
        "verified_matches": len(verified_rows),
        "calibrated_done": 0,
        "calibrated_pending": 0,
        "model_done": 0,
        "model_pending": 0,
    }
    for row in verified_rows:
        match = _row_to_dict(row)
        match_id = str(match["match_id"])
        if _existing_autopsy(match_id, "calibrated_autopsy"):
            coverage["calibrated_done"] += 1
        else:
            coverage["calibrated_pending"] += 1
            pending.append(
                {
                    "kind": "calibrated",
                    "match_id": match_id,
                    "model": "ensemble",
                    "match_number": match["match_number"],
                    "slug": match["slug"],
                    "home_team": match["home_team"],
                    "away_team": match["away_team"],
                    "score": f"{match['home_score']}-{match['away_score']}",
                    "verified_at": match["verified_at"],
                }
            )
        for model in model_ids:
            if _existing_autopsy(match_id, "model_autopsy", model):
                coverage["model_done"] += 1
            else:
                coverage["model_pending"] += 1
                pending.append(
                    {
                        "kind": "model",
                        "match_id": match_id,
                        "model": model,
                        "match_number": match["match_number"],
                        "slug": match["slug"],
                        "home_team": match["home_team"],
                        "away_team": match["away_team"],
                        "score": f"{match['home_score']}-{match['away_score']}",
                        "verified_at": match["verified_at"],
                    }
                )

    return {
        "queue_size": len(pending),
        "coverage": coverage,
        "next_jobs": pending[:bounded_limit],
        "recent_autopsies": [_row_to_dict(row) for row in recent_rows],
    }
