from __future__ import annotations

import json
import os
import time
from datetime import date

from app.automation import AutomationConfig, SmartSchedulerConfig, run_automation_cycle, smart_scheduler_state


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def main() -> None:
    interval = int(os.getenv("AUTOMATION_INTERVAL_SECONDS", "1800"))
    live_interval = int(os.getenv("AUTOMATION_LIVE_INTERVAL_SECONDS", "60"))
    closing_interval = int(os.getenv("AUTOMATION_CLOSING_INTERVAL_SECONDS", "180"))
    upcoming_interval = int(os.getenv("AUTOMATION_UPCOMING_INTERVAL_SECONDS", "600"))
    smart_scheduler = env_bool("AUTOMATION_SMART_SCHEDULER", True)
    lookback_days = int(os.getenv("AUTOMATION_LOOKBACK_DAYS", "3"))
    simulations = int(os.getenv("AUTOMATION_SIMULATIONS", "2500"))
    use_stadium = env_bool("AUTOMATION_USE_STADIUM", True)
    use_fixed_results = env_bool("AUTOMATION_USE_FIXED_RESULTS", True)
    sync_results = env_bool("AUTOMATION_SYNC_RESULTS", True)
    confirm_second_source = env_bool("AUTOMATION_CONFIRM_SECOND_SOURCE", True)
    sync_enrichment = env_bool("AUTOMATION_SYNC_ENRICHMENT", True)
    sync_weather = env_bool("AUTOMATION_SYNC_WEATHER", True)
    generate_autopsies = env_bool("AUTOMATION_GENERATE_AUTOPSIES", True)
    autopsy_batch_size = int(os.getenv("AUTOMATION_AUTOPSY_BATCH_SIZE", "3"))
    autopsy_simulations = int(os.getenv("AUTOMATION_AUTOPSY_SIMULATIONS", "1200"))
    publish_social = env_bool("AUTOMATION_PUBLISH_SOCIAL", False)
    social_batch_size = int(os.getenv("AUTOMATION_SOCIAL_BATCH_SIZE", "2"))
    scheduler_config = SmartSchedulerConfig(
        default_interval_seconds=interval,
        live_interval_seconds=live_interval,
        closing_interval_seconds=closing_interval,
        upcoming_interval_seconds=upcoming_interval,
        lookback_days=lookback_days,
    )

    while True:
        scheduler = None
        sleep_seconds = interval
        try:
            if smart_scheduler:
                scheduler = smart_scheduler_state(config=scheduler_config)
                sleep_seconds = scheduler["interval_seconds"]
            result = run_automation_cycle(
                AutomationConfig(
                    today=date.today(),
                    lookback_days=lookback_days,
                    start_date=scheduler["start_date"] if scheduler else None,
                    end_date=scheduler["end_date"] if scheduler else None,
                    simulations=simulations,
                    use_stadium=use_stadium,
                    use_fixed_results=use_fixed_results,
                    sync_results=sync_results,
                    confirm_second_source=confirm_second_source,
                    sync_enrichment=sync_enrichment,
                    sync_weather=sync_weather,
                    generate_autopsies=generate_autopsies,
                    autopsy_batch_size=autopsy_batch_size,
                    autopsy_simulations=autopsy_simulations,
                    publish_social=publish_social,
                    social_batch_size=social_batch_size,
                )
            )
            result["scheduler"] = scheduler or {
                "mode": "fixed_interval",
                "interval_seconds": interval,
            }
            print(json.dumps(result, ensure_ascii=False), flush=True)
        except Exception as exc:  # pragma: no cover - operational script
            print(json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False), flush=True)
        time.sleep(sleep_seconds)


if __name__ == "__main__":
    main()
