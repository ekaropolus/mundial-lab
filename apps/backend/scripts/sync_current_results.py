from __future__ import annotations

import argparse
import json
from datetime import date

from app.current_results import ingest_espn_current_results


def main() -> None:
    today = date.today().strftime("%Y%m%d")
    parser = argparse.ArgumentParser(description="Sincroniza resultados finales actuales desde ESPN.")
    parser.add_argument("--start-date", default=today, help="Formato YYYYMMDD.")
    parser.add_argument("--end-date", default=today, help="Formato YYYYMMDD.")
    parser.add_argument("--no-autopsies", action="store_true", help="No genera autopsias basicas.")
    parser.add_argument("--no-second-source", action="store_true", help="No confirma contra FOX Sports.")
    args = parser.parse_args()

    result = ingest_espn_current_results(
        start_date=args.start_date,
        end_date=args.end_date,
        generate_autopsies=not args.no_autopsies,
        confirm_second_source=not args.no_second_source,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
