from app.enrichment import estimate_mundial_lab_xg


def test_estimated_xg_rewards_close_central_shots_over_long_shots():
    close = estimate_mundial_lab_xg({"x": 94, "y": 50, "shot_type": "Shot", "outcome": "Saved"})
    long = estimate_mundial_lab_xg({"x": 45, "y": 8, "shot_type": "Shot", "outcome": "Missed"})

    assert close is not None
    assert long is not None
    assert close > long


def test_estimated_xg_handles_penalties_as_high_value_shots():
    assert estimate_mundial_lab_xg({"x": 88, "y": 50, "shot_type": "Penalty", "outcome": "Goal"}) == 0.76


def test_estimated_xg_uses_conservative_fallback_without_coordinates():
    assert estimate_mundial_lab_xg({"shot_type": "Shot", "outcome": "Blocked"}) == 0.04
    assert estimate_mundial_lab_xg({"shot_type": "Substitution", "outcome": "Tactical change"}) is None
