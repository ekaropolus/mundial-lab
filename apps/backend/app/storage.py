import json
import os
from pathlib import Path

from app.schemas import SimulationResult


def results_dir() -> Path:
    path = Path(os.getenv("RESULTS_DIR", "./results"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_result(result: SimulationResult) -> None:
    target = results_dir() / f"{result.job_id}.json"
    target.write_text(result.model_dump_json(indent=2), encoding="utf-8")


def load_result(job_id: str) -> SimulationResult | None:
    target = results_dir() / f"{job_id}.json"
    if not target.exists():
        return None
    return SimulationResult.model_validate(json.loads(target.read_text(encoding="utf-8")))

