from app.models.simulator import simulate_tournament
from random import Random

import numpy as np

from app.live import list_matches
from app.models.house_simulator import annex_c_rows, projected_route_with_lines, run_house_match_board, run_house_simulation, simulate_once_with_lines, teams_from_matches


def test_simulation_returns_probabilities():
    result = simulate_tournament(model="ensemble", seed=7, simulations=100, job_id="test")
    assert result.simulations == 100
    assert len(result.summary) > 0
    assert result.summary[0].champion >= 0
    assert result.summary[0].knockout <= 1


def test_house_simulation_uses_full_fixture_and_stadium():
    result = run_house_simulation(
        job_id="house-test",
        scenario="test",
        simulations=100,
        seed=7,
        use_stadium=True,
        use_fixed_results=True,
    )
    assert result.simulations == 100
    assert result.use_stadium is True
    assert len(result.champion) > 0
    assert len(result.stadium_adjustments) > 0
    assert result.data_sources[2]["name"] == "stadium_context"


def test_annex_c_mapping_has_every_third_place_combination():
    rows = annex_c_rows()

    assert len(rows) == 495
    assert rows["EFGHIJKL"]["1A"] == "E"


def test_single_house_run_does_not_duplicate_round_of_32_teams():
    matches = list_matches()
    teams = teams_from_matches(matches)
    _, _, line_events = simulate_once_with_lines(
        matches,
        teams,
        Random(2026),
        np.random.default_rng(2026),
        use_stadium=True,
        use_xg=False,
        xg_profiles={},
    )

    round_of_32 = [event for event in line_events if 73 <= int(event["match_number"]) <= 88]
    participants = [str(event["home_team_id"]) for event in round_of_32] + [str(event["away_team_id"]) for event in round_of_32]
    assert len(participants) == 32
    assert len(set(participants)) == 32


def test_house_board_includes_coherent_projected_team_names():
    board = run_house_match_board(
        scenario="test",
        simulations=50,
        seed=2026,
        use_stadium=True,
        use_fixed_results=True,
        use_xg=False,
    )

    round_of_32 = [line for line in board["lines"] if 73 <= int(line["match_number"]) <= 88]
    projected = [str(line["projected_home_id"]) for line in round_of_32] + [str(line["projected_away_id"]) for line in round_of_32]
    assert len(projected) == 32
    assert len(set(projected)) == 32
    assert not any(name.startswith("Group ") for line in round_of_32 for name in [str(line["projected_home"]), str(line["projected_away"])])


def test_projected_route_is_deterministic_and_respects_current_group_limits():
    matches = list_matches()
    teams = teams_from_matches(matches)
    line_events = projected_route_with_lines(matches, teams, use_stadium=True, use_xg=False, xg_profiles={})

    round_of_32 = [event for event in line_events if 73 <= int(event["match_number"]) <= 88]
    participants = [str(event["home_team_id"]) for event in round_of_32] + [str(event["away_team_id"]) for event in round_of_32]
    assert len(participants) == 32
    assert len(set(participants)) == 32

    match_76 = next(event for event in line_events if int(event["match_number"]) == 76)
    assert match_76["home_team_id"] == "brazil"


def test_projected_knockout_percentages_match_projected_winner():
    board = run_house_match_board(
        scenario="test",
        simulations=50,
        seed=2026,
        use_stadium=True,
        use_fixed_results=True,
        use_xg=False,
    )

    knockout_lines = [line for line in board["lines"] if int(line["match_number"]) >= 73]
    for line in knockout_lines:
        projected_winner_id = str(line["projected_winner_id"])
        if projected_winner_id == str(line["projected_home_id"]):
            assert float(line["home_win"]) >= float(line["away_win"])
        elif projected_winner_id == str(line["projected_away_id"]):
            assert float(line["away_win"]) >= float(line["home_win"])
        assert line["favorite"] == line["projected_winner"]
