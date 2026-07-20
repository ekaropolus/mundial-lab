from datetime import datetime, timezone

from app import automation
from app.automation import SmartSchedulerConfig, smart_scheduler_state


def fake_matches():
    return [
        {
            "id": "match-100",
            "match_number": 100,
            "home_team": "Mexico",
            "away_team": "South Africa",
            "kickoff": "2026-06-14T23:00:00+00:00",
            "status": "scheduled",
            "result_trust_level": "",
        },
        {
            "id": "match-101",
            "match_number": 101,
            "home_team": "Spain",
            "away_team": "France",
            "kickoff": "2026-06-16T23:00:00+00:00",
            "status": "scheduled",
            "result_trust_level": "",
        },
    ]


def test_smart_scheduler_enters_live_window(monkeypatch):
    monkeypatch.setattr(automation, "_scheduler_matches", fake_matches)

    state = smart_scheduler_state(
        now=datetime(2026, 6, 14, 22, 30, tzinfo=timezone.utc),
        config=SmartSchedulerConfig(live_interval_seconds=45),
    )

    assert state["mode"] == "live_window"
    assert state["interval_seconds"] == 45
    assert state["active_matches"][0]["id"] == "match-100"
    assert state["start_date"] <= "20260614"
    assert state["end_date"] >= "20260614"


def test_smart_scheduler_enters_closing_window(monkeypatch):
    monkeypatch.setattr(automation, "_scheduler_matches", fake_matches)

    state = smart_scheduler_state(
        now=datetime(2026, 6, 15, 2, 0, tzinfo=timezone.utc),
        config=SmartSchedulerConfig(closing_interval_seconds=120),
    )

    assert state["mode"] == "closing_window"
    assert state["interval_seconds"] == 120
    assert state["closing_matches"][0]["id"] == "match-100"


def test_smart_scheduler_uses_upcoming_window(monkeypatch):
    monkeypatch.setattr(automation, "_scheduler_matches", fake_matches)

    state = smart_scheduler_state(
        now=datetime(2026, 6, 14, 12, 0, tzinfo=timezone.utc),
        config=SmartSchedulerConfig(upcoming_interval_seconds=600),
    )

    assert state["mode"] == "upcoming_window"
    assert state["interval_seconds"] == 600
    assert state["next_match"]["id"] == "match-100"


def test_smart_scheduler_ignores_verified_match(monkeypatch):
    def matches():
        rows = fake_matches()
        rows[0]["result_trust_level"] = "real_verificado"
        return rows

    monkeypatch.setattr(automation, "_scheduler_matches", matches)

    state = smart_scheduler_state(
        now=datetime(2026, 6, 14, 22, 30, tzinfo=timezone.utc),
        config=SmartSchedulerConfig(),
    )

    assert state["mode"] == "idle"
    assert state["active_matches"] == []
