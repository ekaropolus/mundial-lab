from app.autopsy import generate_all_model_autopsies, generate_basic_autopsy, generate_calibrated_autopsy, generate_pending_autopsies, list_learning_log, save_match_line, save_model_run, save_result_confirmation, save_verified_result
from app.database import connect, initialize_database
from app.schemas import MatchModelLineCreate, ModelRunCreate, ResultConfirmation, VerifiedMatchResult


def test_basic_autopsy_tracks_line_against_verified_result():
    initialize_database()
    match_id = "001-mexico-vs-south-africa"
    with connect() as db:
        db.execute("delete from model_autopsies where match_id = ?", ("match-001",))
        db.execute("delete from match_model_lines where match_id = ?", ("match-001",))
    result = save_verified_result(
        VerifiedMatchResult(
            match_id=match_id,
            home_score=2,
            away_score=1,
            source="test",
            trust_level="manual_admin",
            verified_by="pytest",
        )
    )
    run = save_model_run(
        ModelRunCreate(
            run_type="house",
            model="ensemble",
            scenario="pytest original line",
            seed=7,
            simulations=100,
            parameters={"poisson_weight": 0.32},
        )
    )
    line = save_match_line(
        MatchModelLineCreate(
            run_id=run["id"],
            match_id=match_id,
            home_win=0.45,
            draw=0.31,
            away_win=0.24,
            expected_home_goals=1.2,
            expected_away_goals=0.8,
            favorite="Mexico",
            confidence=0.45,
        )
    )

    autopsy = generate_basic_autopsy(match_id)

    assert result["home_score"] == 2
    assert line["run_id"] == run["id"]
    assert autopsy["match_id"] == "match-001"
    assert autopsy["original_line_id"] == line["id"]
    assert autopsy["outcome"] == "home"
    assert autopsy["original_error"] == 0.55


def test_matching_second_source_promotes_result_to_real_verified():
    initialize_database()
    match_id = "match-002"
    with connect() as db:
        db.execute("delete from match_result_confirmations where match_id = ?", (match_id,))
    save_verified_result(
        VerifiedMatchResult(
            match_id=match_id,
            home_score=2,
            away_score=1,
            source="primary-test",
            trust_level="publico_ingestado",
            verified_by="pytest",
        )
    )

    confirmation = save_result_confirmation(
        ResultConfirmation(
            match_id=match_id,
            home_score=2,
            away_score=1,
            source="secondary-test",
            source_url="https://example.test/result",
        )
    )

    assert confirmation["verified_result"]["trust_level"] == "real_verificado"
    assert "primary-test" in confirmation["verified_result"]["source"]
    assert "secondary-test" in confirmation["verified_result"]["source"]


def test_calibrated_autopsy_searches_contracts_without_target_leakage():
    initialize_database()
    match_id = "match-001"
    with connect() as db:
        db.execute("delete from model_autopsies")
        db.execute("delete from match_result_confirmations")
        db.execute("delete from match_results_verified where match_id != ?", (match_id,))
        db.execute("delete from match_model_lines where match_id = ?", (match_id,))
    save_verified_result(
        VerifiedMatchResult(
            match_id=match_id,
            home_score=2,
            away_score=0,
            source="test-calibrated",
            trust_level="manual_admin",
            verified_by="pytest",
        )
    )

    autopsy = generate_calibrated_autopsy(match_id, simulations=80, seed=13)

    parameters = autopsy["best_parameters_json"]
    assert autopsy["match_id"] == match_id
    assert autopsy["outcome"] == "home"
    assert autopsy["best_error"] >= 0
    assert "calibrated_autopsy" in parameters
    assert "El partido auditado se reabre como scheduled" in parameters


def test_model_autopsies_exist_for_each_educational_model():
    initialize_database()
    match_id = "match-001"
    with connect() as db:
        db.execute("delete from model_autopsies where match_id = ?", (match_id,))
    save_verified_result(
        VerifiedMatchResult(
            match_id=match_id,
            home_score=2,
            away_score=0,
            source="test-models",
            trust_level="manual_admin",
            verified_by="pytest",
        )
    )

    result = generate_all_model_autopsies(match_id)
    poisson_log = list_learning_log(10, "poisson")

    assert result["created"] == 5
    assert not result["errors"]
    assert {item["best_model"] for item in result["autopsies"]} == {"elo", "poisson", "dixon_coles", "bayes_live", "ensemble"}
    assert poisson_log
    assert "model_autopsy" in poisson_log[0]["best_parameters_json"]


def test_pending_autopsies_are_queued_and_idempotent():
    initialize_database()
    match_id = "match-001"
    with connect() as db:
        db.execute("delete from model_autopsies where match_id = ?", (match_id,))
    save_verified_result(
        VerifiedMatchResult(
            match_id=match_id,
            home_score=2,
            away_score=0,
            source="test-queue",
            trust_level="manual_admin",
            verified_by="pytest",
        )
    )

    first = generate_pending_autopsies(max_jobs=2, simulations=50, seed=21)
    second = generate_pending_autopsies(max_jobs=10, simulations=50, seed=21)
    third = generate_pending_autopsies(max_jobs=10, simulations=50, seed=21)

    assert first["created"] == 2
    assert len(first["selected"]) == 2
    assert second["created"] == 4
    assert third["created"] == 0
