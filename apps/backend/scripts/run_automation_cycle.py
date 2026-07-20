from __future__ import annotations

import argparse
import json
from datetime import date, datetime

from app.automation import AutomationConfig, run_automation_cycle


def main() -> None:
    parser = argparse.ArgumentParser(description="Corre un ciclo automatico de Mundial Lab.")
    parser.add_argument("--today", help="Formato YYYYMMDD. Default: fecha del sistema.")
    parser.add_argument("--lookback-days", type=int, default=3)
    parser.add_argument("--simulations", type=int, default=2500)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--no-stadium", action="store_true")
    parser.add_argument("--no-fixed-results", action="store_true")
    parser.add_argument("--no-sync-results", action="store_true")
    parser.add_argument("--no-second-source", action="store_true")
    parser.add_argument("--no-enrichment", action="store_true")
    parser.add_argument("--no-weather", action="store_true")
    parser.add_argument("--no-autopsies", action="store_true")
    parser.add_argument("--autopsy-batch-size", type=int, default=3)
    parser.add_argument("--autopsy-simulations", type=int, default=1200)
    args = parser.parse_args()

    today = datetime.strptime(args.today, "%Y%m%d").date() if args.today else date.today()
    result = run_automation_cycle(
        AutomationConfig(
            today=today,
            lookback_days=args.lookback_days,
            simulations=args.simulations,
            seed=args.seed,
            use_stadium=not args.no_stadium,
            use_fixed_results=not args.no_fixed_results,
            sync_results=not args.no_sync_results,
            confirm_second_source=not args.no_second_source,
            sync_enrichment=not args.no_enrichment,
            sync_weather=not args.no_weather,
            generate_autopsies=not args.no_autopsies,
            autopsy_batch_size=args.autopsy_batch_size,
            autopsy_simulations=args.autopsy_simulations,
        )
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
