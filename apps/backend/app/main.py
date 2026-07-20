import os
from datetime import date, datetime

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from rq.job import Job

from app.autopsy import (
    autopsy_queue_status,
    house_daily_editorials,
    house_line_evolution_summary,
    latest_house_board_from_saved_lines,
    list_learning_log,
    list_autopsies,
    list_match_lines,
    load_result_confirmations_file,
    load_verified_results_file,
    save_house_board_lines,
    save_match_line,
    save_model_run,
    save_verified_result,
    save_result_confirmation,
)
from app.automation import AutomationConfig, run_automation_cycle, smart_scheduler_state
from app.current_results import ingest_espn_current_results
from app.data import load_teams
from app.database import initialize_database
from app.enrichment import (
    backfill_mundial_lab_xg,
    data_quality_summary,
    ingest_espn_match_enrichment,
    ingest_stadium_weather,
    ingest_statsbomb_open_data,
    match_enrichment,
)
from app.jobs import redis_connection, run_simulation_job
from app.ingestion import ingest_international_results, international_results_status
from app.live import (
    add_match_event,
    add_prediction,
    get_match,
    leaderboard,
    list_match_events,
    list_matches,
    list_predictions,
    register_director,
    update_match_state,
)
from app.models.catalog import get_model_module, list_model_modules
from app.models.house_simulator import run_house_match_board, run_house_simulation
from app.schemas import (
    AutomationCycleRequest,
    DirectorAlias,
    EspnEnrichmentRequest,
    CurrentResultsSyncRequest,
    HouseSimulationRequest,
    LivePrediction,
    MatchEvent,
    MatchModelLineCreate,
    MatchStateUpdate,
    ModelRunCreate,
    ResultConfirmation,
    ResultConfirmationsFileLoad,
    SimulationJob,
    SimulationRequest,
    StadiumWeatherRequest,
    SocialArtworkUpload,
    SocialShareRecord,
    StatsBombOpenDataRequest,
    VerifiedMatchResult,
    VerifiedResultsFileLoad,
)
from app.social_publisher import list_social_publications, mark_social_publications_deleted, publish_pending_house_social, record_social_share, save_social_artwork
from app.storage import load_result


app = FastAPI(
    title="Mundial Lab API",
    description="API de Hadox para simulaciones y modelos del Mundial.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    expected = os.getenv("ADMIN_TOKEN", "")
    if expected and x_admin_token != expected:
        raise HTTPException(status_code=401, detail="Admin no autorizado.")


@app.on_event("startup")
def startup() -> None:
    initialize_database()


SOCIAL_STATIC_DIR = os.path.join(os.getenv("RESULTS_DIR", "/app/results"), "social")
os.makedirs(SOCIAL_STATIC_DIR, exist_ok=True)
app.mount("/social", StaticFiles(directory=SOCIAL_STATIC_DIR), name="social")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/teams")
def teams():
    return load_teams()


@app.get("/models")
def models():
    return list_model_modules()


@app.get("/models/{model_id}")
def model_detail(model_id: str):
    model = get_model_module(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Modelo no encontrado.")
    return model


@app.get("/matches")
def matches():
    return list_matches()


@app.get("/matches/{slug_or_id}")
def match_detail(slug_or_id: str):
    match = get_match(slug_or_id)
    if not match:
        raise HTTPException(status_code=404, detail="Partido no encontrado.")
    return {
        "match": match,
        "events": list_match_events(match.id),
        "predictions": list_predictions(match.id),
    }


@app.post("/directors/alias")
def create_director_alias(payload: DirectorAlias):
    try:
        return register_director(payload.alias)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/matches/{match_id}/state")
def admin_update_match_state(match_id: str, payload: MatchStateUpdate, _: None = Depends(require_admin)):
    match = update_match_state(match_id, payload)
    if not match:
        raise HTTPException(status_code=404, detail="Partido no encontrado.")
    return match


@app.post("/admin/matches/{match_id}/events")
def admin_add_event(match_id: str, payload: MatchEvent, _: None = Depends(require_admin)):
    payload.match_id = match_id
    return add_match_event(payload)


@app.post("/matches/{match_id}/predictions")
def create_live_prediction(match_id: str, payload: LivePrediction):
    if not get_match(match_id):
        raise HTTPException(status_code=404, detail="Partido no encontrado.")
    payload.match_id = match_id
    try:
        return add_prediction(payload)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Alias o prediccion invalida.") from exc


@app.get("/directors/leaderboard")
def directors_leaderboard():
    return leaderboard()


@app.post("/admin/data/ingest-international-results")
def admin_ingest_international_results(_: None = Depends(require_admin)):
    return ingest_international_results()


@app.get("/admin/data/international-results-status")
def admin_international_results_status():
    return international_results_status()


@app.post("/admin/matches/{match_id}/verified-result")
def admin_save_verified_result(match_id: str, payload: VerifiedMatchResult, _: None = Depends(require_admin)):
    payload.match_id = match_id
    try:
        return save_verified_result(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/data/load-verified-results-file")
def admin_load_verified_results_file(payload: VerifiedResultsFileLoad, _: None = Depends(require_admin)):
    try:
        return load_verified_results_file(payload.path)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/matches/{match_id}/result-confirmation")
def admin_save_result_confirmation(match_id: str, payload: ResultConfirmation, _: None = Depends(require_admin)):
    payload.match_id = match_id
    try:
        return save_result_confirmation(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/data/load-result-confirmations-file")
def admin_load_result_confirmations_file(payload: ResultConfirmationsFileLoad, _: None = Depends(require_admin)):
    try:
        return load_result_confirmations_file(payload.path)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/data/sync-current-results")
def admin_sync_current_results(payload: CurrentResultsSyncRequest, _: None = Depends(require_admin)):
    try:
        return ingest_espn_current_results(
            payload.start_date,
            payload.end_date,
            False,
            payload.confirm_second_source,
        )
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/data/ingest-espn-enrichment")
def admin_ingest_espn_enrichment(payload: EspnEnrichmentRequest, _: None = Depends(require_admin)):
    try:
        return ingest_espn_match_enrichment(payload.start_date, payload.end_date)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/data/ingest-statsbomb-open")
def admin_ingest_statsbomb_open(payload: StatsBombOpenDataRequest, _: None = Depends(require_admin)):
    try:
        return ingest_statsbomb_open_data(
            competition_id=payload.competition_id,
            season_id=payload.season_id,
            competition_name=payload.competition_name,
            limit_matches=payload.limit_matches,
        )
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/data/ingest-stadium-weather")
def admin_ingest_stadium_weather(payload: StadiumWeatherRequest, _: None = Depends(require_admin)):
    try:
        return ingest_stadium_weather(payload.start_date, payload.end_date)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/data/backfill-xg")
def admin_backfill_xg(_: None = Depends(require_admin)):
    return backfill_mundial_lab_xg()


@app.post("/admin/automation/run-cycle")
def admin_run_automation_cycle(payload: AutomationCycleRequest, _: None = Depends(require_admin)):
    try:
        today = datetime.strptime(payload.today, "%Y%m%d").date() if payload.today else date.today()
        return run_automation_cycle(
            AutomationConfig(
                today=today,
                lookback_days=payload.lookback_days,
                simulations=payload.simulations,
                seed=payload.seed,
                use_stadium=payload.use_stadium,
                use_fixed_results=payload.use_fixed_results,
                use_xg=payload.use_xg,
                sync_results=payload.sync_results,
                confirm_second_source=payload.confirm_second_source,
                sync_enrichment=payload.sync_enrichment,
                sync_weather=payload.sync_weather,
                generate_autopsies=payload.generate_autopsies,
                autopsy_batch_size=payload.autopsy_batch_size,
                autopsy_simulations=payload.autopsy_simulations,
                publish_social=payload.publish_social,
                social_batch_size=payload.social_batch_size,
            )
        )
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/admin/automation/scheduler-state")
def admin_scheduler_state(_: None = Depends(require_admin)):
    return smart_scheduler_state()


@app.get("/admin/automation/autopsy-queue")
def admin_autopsy_queue(_: None = Depends(require_admin)):
    return autopsy_queue_status()


@app.get("/admin/social/publications")
def admin_social_publications(limit: int = 50, _: None = Depends(require_admin)):
    return list_social_publications(limit=limit)


@app.post("/admin/social/publish-pending")
def admin_publish_pending_social(limit: int = 3, publish: bool = True, _: None = Depends(require_admin)):
    return publish_pending_house_social(limit=limit, publish=publish)


@app.post("/admin/social/share-record")
def admin_record_social_share(payload: SocialShareRecord, _: None = Depends(require_admin)):
    return record_social_share(payload.source_id, payload.model_dump())


@app.post("/admin/social/artwork")
def admin_save_social_artwork(payload: SocialArtworkUpload, _: None = Depends(require_admin)):
    try:
        return save_social_artwork(payload.model_dump())
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/admin/social/mark-deleted")
def admin_mark_social_deleted(source_ids: list[str] | None = None, _: None = Depends(require_admin)):
    return mark_social_publications_deleted(source_ids)


@app.post("/admin/model-runs")
def admin_save_model_run(payload: ModelRunCreate, _: None = Depends(require_admin)):
    return save_model_run(payload)


@app.post("/admin/match-lines")
def admin_save_match_line(payload: MatchModelLineCreate, _: None = Depends(require_admin)):
    try:
        return save_match_line(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/matches/{match_id}/model-lines")
def match_model_lines(match_id: str):
    return list_match_lines(match_id)


@app.get("/matches/{match_id}/autopsies")
def match_autopsies(match_id: str):
    return list_autopsies(match_id)


@app.get("/learning-log")
def learning_log(limit: int = 30, model: str | None = None):
    return list_learning_log(limit, model)


@app.get("/matches/{match_id}/data")
def match_data(match_id: str):
    try:
        return match_enrichment(match_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/data/quality")
def public_data_quality():
    return data_quality_summary()


@app.get("/admin/data/quality")
def admin_data_quality(_: None = Depends(require_admin)):
    return data_quality_summary()


@app.post("/admin/house-simulation/inline")
def create_house_simulation(payload: HouseSimulationRequest, _: None = Depends(require_admin)):
    seed = payload.seed or 2026
    result_id = f"house-{seed}-{payload.simulations}-{int(payload.use_stadium)}-{int(payload.use_fixed_results)}-{int(payload.use_xg)}"
    return run_house_simulation(
        job_id=result_id,
        scenario=payload.scenario,
        simulations=payload.simulations,
        seed=seed,
        use_stadium=payload.use_stadium,
        use_fixed_results=payload.use_fixed_results,
        use_xg=payload.use_xg,
        line_stage=payload.line_stage,
    )


@app.post("/admin/house-simulation/save-match-lines")
def admin_save_house_match_lines(payload: HouseSimulationRequest, _: None = Depends(require_admin)):
    seed = payload.seed or 2026
    return save_house_board_lines(
        scenario=payload.scenario,
        simulations=payload.simulations,
        seed=seed,
        use_stadium=payload.use_stadium,
        use_fixed_results=payload.use_fixed_results,
        use_xg=payload.use_xg,
    )


@app.post("/house-simulation/match-board")
def create_house_match_board(payload: HouseSimulationRequest):
    seed = payload.seed or 2026
    return run_house_match_board(
        scenario=payload.scenario,
        simulations=payload.simulations,
        seed=seed,
        use_stadium=payload.use_stadium,
        use_fixed_results=payload.use_fixed_results,
        use_xg=payload.use_xg,
    )


@app.get("/house-simulation/latest-board")
def latest_house_match_board():
    board = latest_house_board_from_saved_lines()
    if not board:
        raise HTTPException(status_code=404, detail="No hay linea Monte Carlo oficial guardada todavia.")
    return board


@app.get("/house-simulation/evolution")
def house_match_evolution(match_id: str | None = None, limit: int = 500):
    return house_line_evolution_summary(match_id=match_id, limit=limit)


@app.get("/house-simulation/daily-editorials")
def house_daily_editorial_posts(limit_days: int = 5):
    return house_daily_editorials(limit_days=limit_days)


@app.post("/simulations", response_model=SimulationJob)
def create_simulation(payload: SimulationRequest) -> SimulationJob:
    from app.jobs import enqueue_simulation

    job_id = enqueue_simulation(payload)
    return SimulationJob(job_id=job_id, status="queued", result_url=f"/simulations/{job_id}/result")


@app.post("/simulations/inline")
def create_inline_simulation(payload: SimulationRequest):
    if payload.simulations > 5000:
        raise HTTPException(status_code=400, detail="Usa la cola para mas de 5000 simulaciones.")
    seed = payload.seed or 2026
    result_id = f"inline-{payload.model}-{seed}-{payload.simulations}"
    return run_simulation_job(result_id, payload.model, payload.simulations, seed)


@app.get("/simulations/{job_id}", response_model=SimulationJob)
def get_simulation(job_id: str) -> SimulationJob:
    result = load_result(job_id)
    if result:
        return SimulationJob(job_id=job_id, status="finished", result_url=f"/simulations/{job_id}/result")

    try:
        job = Job.fetch(job_id, connection=redis_connection())
    except Exception:
        return SimulationJob(job_id=job_id, status="unknown")

    status = job.get_status(refresh=True)
    return SimulationJob(job_id=job_id, status=status, result_url=f"/simulations/{job_id}/result")


@app.get("/simulations/{job_id}/result")
def get_result(job_id: str):
    result = load_result(job_id)
    if not result:
        raise HTTPException(status_code=404, detail="Resultado no disponible todavia.")
    return result
