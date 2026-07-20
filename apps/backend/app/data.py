import json
from functools import lru_cache
from pathlib import Path

from app.database import connect, initialize_database
from app.schemas import Team


DATA_PATH = Path("/data/teams_seed.json")


def fallback_data_path() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "data" / "teams_seed.json"
        if candidate.exists():
            return candidate
    return Path("data/teams_seed.json")


@lru_cache
def load_teams() -> list[Team]:
    try:
        initialize_database()
        with connect() as db:
            rows = db.execute(
                """
                select id, name, confederation, group_code as "group", rating, attack, defense, qualified
                from teams
                order by group_code, rating desc
                """
            ).fetchall()
        if rows:
            return [Team.model_validate(dict(row)) for row in rows]
    except Exception:
        pass

    path = DATA_PATH if DATA_PATH.exists() else fallback_data_path()
    with path.open("r", encoding="utf-8") as handle:
        return [Team.model_validate(item) for item in json.load(handle)]
