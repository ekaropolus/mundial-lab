from __future__ import annotations

import argparse
import json

from app.enrichment import ingest_statsbomb_open_data


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingiere muestra de StatsBomb Open Data.")
    parser.add_argument("--competition-id", type=int)
    parser.add_argument("--season-id", type=int)
    parser.add_argument("--competition-name", default="FIFA World Cup")
    parser.add_argument("--limit-matches", type=int, default=20)
    args = parser.parse_args()

    result = ingest_statsbomb_open_data(
        competition_id=args.competition_id,
        season_id=args.season_id,
        competition_name=args.competition_name,
        limit_matches=args.limit_matches,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
