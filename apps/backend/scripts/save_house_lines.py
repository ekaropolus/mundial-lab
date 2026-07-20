from __future__ import annotations

import argparse
import json

from app.autopsy import save_house_board_lines


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarda lineas Monte Carlo de la casa por partido.")
    parser.add_argument("--scenario", default="Linea de la casa")
    parser.add_argument("--simulations", type=int, default=2500)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--use-stadium", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--use-fixed-results", action=argparse.BooleanOptionalAction, default=True)
    args = parser.parse_args()

    result = save_house_board_lines(
        scenario=args.scenario,
        simulations=args.simulations,
        seed=args.seed,
        use_stadium=args.use_stadium,
        use_fixed_results=args.use_fixed_results,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
