import os
from random import randint
from uuid import uuid4

from redis import Redis
from rq import Queue

from app.models.simulator import simulate_tournament
from app.schemas import ModelName, SimulationRequest
from app.storage import save_result


QUEUE_NAME = "mundial-sim"


def redis_connection() -> Redis:
    return Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))


def queue() -> Queue:
    return Queue(QUEUE_NAME, connection=redis_connection())


def run_simulation_job(job_id: str, model: ModelName, simulations: int, seed: int) -> str:
    result = simulate_tournament(model=model, seed=seed, simulations=simulations, job_id=job_id)
    save_result(result)
    return job_id


def enqueue_simulation(payload: SimulationRequest) -> str:
    seed = payload.seed if payload.seed is not None else randint(1, 2_147_483_647)
    job_id = uuid4().hex
    job = queue().enqueue(
        run_simulation_job,
        job_id,
        payload.model,
        payload.simulations,
        seed,
        job_id=job_id,
        job_timeout="30m",
    )
    return job.id
