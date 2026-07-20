from __future__ import annotations

import argparse
import json
from datetime import date

from app.enrichment import ingest_espn_match_enrichment


def main() -> None:
    today = date.today().strftime("%Y%m%d")
    parser = argparse.ArgumentParser(description="Ingiere rosters, stats y eventos desde ESPN summary.")
    parser.add_argument("--start-date", default=today, help="Formato YYYYMMDD.")
    parser.add_argument("--end-date", default=today, help="Formato YYYYMMDD.")
    args = parser.parse_args()

    result = ingest_espn_match_enrichment(args.start_date, args.end_date)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
