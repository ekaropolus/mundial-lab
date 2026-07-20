from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.autopsy import generate_pending_autopsies, save_house_board_lines_once
from app.current_results import ingest_espn_current_results
from app.database import connect, initialize_database
from app.enrichment import backfill_mundial_lab_xg, ingest_espn_match_enrichment, ingest_stadium_weather
from app.social_publisher import publish_pending_house_social


@dataclass
class AutomationConfig:
    today: date
    lookback_days: int = 3
    start_date: str | None = None
    end_date: str | None = None
    simulations: int = 2500
    seed: int | None = None
    use_stadium: bool = True
    use_fixed_results: bool = True
    use_xg: bool = True
    sync_results: bool = True
    confirm_second_source: bool = True
    sync_enrichment: bool = True
    sync_weather: bool = True
    generate_autopsies: bool = True
    autopsy_batch_size: int = 3
    autopsy_simulations: int = 1200
    publish_social: bool = False
    social_batch_size: int = 3


@dataclass
class SmartSchedulerConfig:
    default_interval_seconds: int = 1800
    live_interval_seconds: int = 60
    closing_interval_seconds: int = 180
    upcoming_interval_seconds: int = 600
    pre_match_minutes: int = 45
    live_match_minutes: int = 135
    closing_match_minutes: int = 360
    upcoming_hours: int = 12
    lookback_days: int = 3


def _parse_kickoff(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _now_utc(now: datetime | None = None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def _scheduler_matches() -> list[dict[str, Any]]:
    initialize_database()
    with connect() as db:
        rows = db.execute(
            """
            select
                m.id, m.match_number, m.home_team, m.away_team, m.kickoff, m.status,
                coalesce(v.trust_level, '') as result_trust_level
            from matches m
            left join match_results_verified v on v.match_id = m.id
            order by m.kickoff
            """
        ).fetchall()
    return [dict(row) for row in rows]


def smart_scheduler_state(now: datetime | None = None, config: SmartSchedulerConfig | None = None) -> dict[str, Any]:
    cfg = config or SmartSchedulerConfig()
    current = _now_utc(now)
    matches = _scheduler_matches()
    active: list[dict[str, Any]] = []
    closing: list[dict[str, Any]] = []
    next_match: dict[str, Any] | None = None

    for match in matches:
        kickoff = _parse_kickoff(match["kickoff"])
        verified = match.get("status") == "finished" or match.get("result_trust_level") in {
            "real_verificado",
            "publico_ingestado",
            "manual_admin",
        }
        live_start = kickoff - timedelta(minutes=cfg.pre_match_minutes)
        live_end = kickoff + timedelta(minutes=cfg.live_match_minutes)
        close_end = kickoff + timedelta(minutes=cfg.closing_match_minutes)
        item = {
            "id": match["id"],
            "match_number": match["match_number"],
            "home_team": match["home_team"],
            "away_team": match["away_team"],
            "kickoff": kickoff.isoformat(),
            "status": match["status"],
            "result_trust_level": match.get("result_trust_level") or None,
        }
        if not verified and live_start <= current <= live_end:
            active.append(item)
        elif not verified and live_end < current <= close_end:
            closing.append(item)
        elif not verified and kickoff > current and next_match is None:
            next_match = item

    if active:
        mode = "live_window"
        interval = cfg.live_interval_seconds
    elif closing:
        mode = "closing_window"
        interval = cfg.closing_interval_seconds
    elif next_match:
        kickoff = _parse_kickoff(next_match["kickoff"])
        seconds_to_live_window = max(0, int((kickoff - timedelta(minutes=cfg.pre_match_minutes) - current).total_seconds()))
        seconds_to_kickoff = max(0, int((kickoff - current).total_seconds()))
        if seconds_to_kickoff <= cfg.upcoming_hours * 3600:
            mode = "upcoming_window"
            interval = min(cfg.upcoming_interval_seconds, max(30, seconds_to_live_window or cfg.live_interval_seconds))
        else:
            mode = "idle"
            interval = min(cfg.default_interval_seconds, max(300, seconds_to_live_window))
    else:
        mode = "idle"
        interval = cfg.default_interval_seconds

    start_date = (current - timedelta(days=cfg.lookback_days)).strftime("%Y%m%d")
    end_date = current.strftime("%Y%m%d")
    return {
        "mode": mode,
        "now": current.isoformat(),
        "interval_seconds": interval,
        "start_date": start_date,
        "end_date": end_date,
        "active_matches": active,
        "closing_matches": closing,
        "next_match": next_match,
    }


def run_automation_cycle(config: AutomationConfig) -> dict[str, Any]:
    day_key = config.today.strftime("%Y%m%d")
    seed = config.seed if config.seed is not None else int(day_key)
    scenario = f"Auto linea casa {day_key}"
    start_date = config.start_date or (config.today - timedelta(days=config.lookback_days)).strftime("%Y%m%d")
    end_date = config.end_date or day_key

    current_results = None
    espn_enrichment = None
    xg_backfill = None
    stadium_weather = None
    if config.sync_results:
        current_results = ingest_espn_current_results(
            start_date=start_date,
            end_date=end_date,
            generate_autopsies=False,
            confirm_second_source=config.confirm_second_source,
        )
    if config.sync_enrichment:
        espn_enrichment = ingest_espn_match_enrichment(start_date=start_date, end_date=end_date)
        xg_backfill = backfill_mundial_lab_xg()
    if config.sync_weather:
        stadium_weather = ingest_stadium_weather(start_date=start_date, end_date=end_date)

    house_lines = save_house_board_lines_once(
        scenario=scenario,
        simulations=config.simulations,
        seed=seed,
        use_stadium=config.use_stadium,
        use_fixed_results=config.use_fixed_results,
        use_xg=config.use_xg,
    )

    pending_autopsies = None
    if config.generate_autopsies:
        pending_autopsies = generate_pending_autopsies(
            max_jobs=config.autopsy_batch_size,
            simulations=config.autopsy_simulations,
            seed=seed,
        )
    social_publications = None
    if config.publish_social:
        social_publications = publish_pending_house_social(limit=config.social_batch_size)

    return {
        "date": day_key,
        "scenario": scenario,
        "house_lines": house_lines,
        "current_results": current_results,
        "espn_enrichment": espn_enrichment,
        "xg_backfill": xg_backfill,
        "stadium_weather": stadium_weather,
        "pending_autopsies": pending_autopsies,
        "social_publications": social_publications,
        "use_xg": config.use_xg,
    }
