from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field


ModelName = Literal["elo", "poisson", "dixon_coles", "bayes_live", "ensemble"]
JobStatus = Literal["queued", "started", "finished", "failed", "unknown"]
MatchStatus = Literal["scheduled", "live", "halftime", "finished"]
TrustLevel = Literal["real_verificado", "publico_ingestado", "manual_admin", "estimado", "simulado"]


class Team(BaseModel):
    id: str
    name: str
    confederation: str
    group: str
    rating: float
    attack: float
    defense: float
    qualified: bool = True


class SimulationRequest(BaseModel):
    model: ModelName = "ensemble"
    simulations: int = Field(default=1000, ge=100, le=100000)
    email: EmailStr | None = None
    seed: int | None = None


class HouseSimulationRequest(BaseModel):
    simulations: int = Field(default=5000, ge=100, le=50000)
    seed: int | None = None
    use_stadium: bool = True
    use_fixed_results: bool = True
    use_xg: bool = True
    scenario: str = "Base Hadox"
    line_stage: Literal["baseline", "pre_match", "live", "post_result", "official"] | None = None


class SimulationJob(BaseModel):
    job_id: str
    status: JobStatus
    result_url: str | None = None


class TeamProbability(BaseModel):
    team_id: str
    team: str
    group: str
    champion: float
    finalist: float
    semifinalist: float
    knockout: float


class ModelWorkflowStep(BaseModel):
    name: str
    description: str


class ModelModule(BaseModel):
    id: ModelName
    name: str
    short_name: str
    status: Literal["activo", "prototipo", "siguiente"]
    question: str
    intuition: str
    data_inputs: list[str]
    workflow: list[ModelWorkflowStep]
    student_takeaway: str


class SimulationResult(BaseModel):
    job_id: str
    model: ModelName
    simulations: int
    seed: int
    summary: list[TeamProbability]
    top_upsets: list[str]
    methodology: str


class HouseSimulationResult(BaseModel):
    job_id: str
    scenario: str
    simulations: int
    seed: int
    use_stadium: bool
    use_fixed_results: bool
    use_xg: bool = True
    fixed_results_used: int
    data_sources: list[dict[str, str]]
    methodology: str
    champion: list[TeamProbability]
    finalist: list[TeamProbability]
    semifinalist: list[TeamProbability]
    knockout: list[TeamProbability]
    top_upsets: list[str]
    pivotal_matches: list[dict[str, str | float]]
    stadium_adjustments: list[dict[str, str | float]]
    house_vs_directors: list[dict[str, str | int | float]]


class Match(BaseModel):
    id: str
    match_number: int
    slug: str
    home_team_id: str
    away_team_id: str
    home_team: str
    away_team: str
    stage: str
    phase: str
    kickoff: str
    local_time_label: str
    venue: str
    city: str
    status: MatchStatus
    minute: int
    home_score: int
    away_score: int
    result_trust_level: TrustLevel | None = None
    result_source: str | None = None
    winner_team_id: str | None = None
    winner_team: str | None = None


class MatchEvent(BaseModel):
    id: int | None = None
    match_id: str
    minute: int = Field(ge=0, le=130)
    event_type: str
    team_id: str | None = None
    description: str
    source: str = "admin"
    status: Literal["proposed", "verified"] = "verified"


class MatchStateUpdate(BaseModel):
    status: MatchStatus
    minute: int = Field(ge=0, le=130)
    home_score: int = Field(ge=0)
    away_score: int = Field(ge=0)


class LivePrediction(BaseModel):
    id: int | None = None
    match_id: str
    director_name: str
    model: ModelName
    minute: int = Field(ge=0, le=130)
    home_win: float = Field(ge=0, le=1)
    draw: float = Field(ge=0, le=1)
    away_win: float = Field(ge=0, le=1)
    notes: str = ""


class DirectorAlias(BaseModel):
    alias: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_ .-]+$")


class DirectorScore(BaseModel):
    director_name: str
    predictions: int
    score: float


class VerifiedMatchResult(BaseModel):
    match_id: str
    home_score: int = Field(ge=0)
    away_score: int = Field(ge=0)
    status: MatchStatus = "finished"
    winner_team_id: str | None = None
    winner_team: str | None = None
    source: str = "admin"
    source_url: str = ""
    trust_level: TrustLevel = "manual_admin"
    verified_by: str = "admin"
    notes: str = ""


class VerifiedResultsFileLoad(BaseModel):
    path: str = "data/verified_results_2026-06-14.json"


class ResultConfirmation(BaseModel):
    match_id: str
    home_score: int = Field(ge=0)
    away_score: int = Field(ge=0)
    source: str
    source_url: str = ""
    trust_level: TrustLevel = "publico_ingestado"
    confirmed_by: str = "codex"
    notes: str = ""


class ResultConfirmationsFileLoad(BaseModel):
    path: str = "data/secondary_results_2026-06-14.json"


class CurrentResultsSyncRequest(BaseModel):
    start_date: str = Field(pattern=r"^\d{8}$")
    end_date: str = Field(pattern=r"^\d{8}$")
    generate_autopsies: bool = True
    confirm_second_source: bool = True


class AutomationCycleRequest(BaseModel):
    today: str | None = Field(default=None, pattern=r"^\d{8}$")
    lookback_days: int = Field(default=3, ge=0, le=14)
    simulations: int = Field(default=2500, ge=100, le=50000)
    seed: int | None = None
    use_stadium: bool = True
    use_fixed_results: bool = True
    use_xg: bool = True
    sync_results: bool = True
    confirm_second_source: bool = True
    sync_enrichment: bool = True
    sync_weather: bool = True
    generate_autopsies: bool = True
    autopsy_batch_size: int = Field(default=3, ge=1, le=25)
    autopsy_simulations: int = Field(default=1200, ge=50, le=20000)
    publish_social: bool = False
    social_batch_size: int = Field(default=2, ge=1, le=10)


class SocialShareRecord(BaseModel):
    source_id: str = Field(min_length=1, max_length=160)
    source_kind: str = "social_room"
    title: str = ""
    caption: str = ""
    image_url: str = ""


class SocialArtworkUpload(BaseModel):
    source_id: str = Field(min_length=1, max_length=160)
    source_kind: str = "social_room"
    title: str = ""
    caption: str = ""
    image_data: str = Field(min_length=20)
    publish: bool = False


class EspnEnrichmentRequest(BaseModel):
    start_date: str = Field(pattern=r"^\d{8}$")
    end_date: str = Field(pattern=r"^\d{8}$")


class StatsBombOpenDataRequest(BaseModel):
    competition_id: int | None = None
    season_id: int | None = None
    competition_name: str | None = "FIFA World Cup"
    limit_matches: int = Field(default=20, ge=1, le=200)


class StadiumWeatherRequest(BaseModel):
    start_date: str = Field(pattern=r"^\d{8}$")
    end_date: str = Field(pattern=r"^\d{8}$")


class ModelRunCreate(BaseModel):
    run_type: Literal["house", "backtest", "autopsy", "live", "director"] = "house"
    model: ModelName = "ensemble"
    scenario: str = "Linea original"
    seed: int | None = None
    simulations: int = Field(default=0, ge=0)
    parameters: dict[str, Any] = Field(default_factory=dict)
    data_snapshot_id: int | None = None
    notes: str = ""


class MatchModelLineCreate(BaseModel):
    run_id: int
    match_id: str
    minute: int = Field(default=0, ge=0, le=130)
    home_win: float = Field(ge=0, le=1)
    draw: float = Field(ge=0, le=1)
    away_win: float = Field(ge=0, le=1)
    expected_home_goals: float | None = None
    expected_away_goals: float | None = None
    favorite: str
    confidence: float = Field(default=0, ge=0, le=1)
    top_scores: list[dict[str, Any]] = Field(default_factory=list)
    line_payload: dict[str, Any] = Field(default_factory=dict)


class ModelAutopsyCreate(BaseModel):
    match_id: str
    original_run_id: int | None = None
    original_line_id: int | None = None
    best_model: ModelName = "ensemble"
    best_parameters: dict[str, Any] = Field(default_factory=dict)
    original_error: float = Field(ge=0)
    best_error: float = Field(ge=0)
    outcome: Literal["home", "draw", "away"]
    headline: str
    lesson: str
    share_copy: str
