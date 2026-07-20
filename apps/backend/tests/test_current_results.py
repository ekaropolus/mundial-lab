from app.current_results import canonical_team, extract_completed_espn_results, find_fox_confirmation


def test_espn_parser_only_extracts_completed_matches():
    scoreboard = {
        "events": [
            {
                "id": "760421",
                "name": "Türkiye at Australia",
                "date": "2026-06-14T04:00Z",
                "status": {"type": {"completed": True, "detail": "FT"}},
                "competitions": [
                    {
                        "competitors": [
                            {"homeAway": "home", "score": "2", "team": {"displayName": "Australia"}},
                            {"homeAway": "away", "score": "0", "team": {"displayName": "Türkiye"}},
                        ]
                    }
                ],
            },
            {
                "id": "760425",
                "name": "Japan at Netherlands",
                "status": {"type": {"completed": False, "detail": "68'"}},
                "competitions": [
                    {
                        "competitors": [
                            {"homeAway": "home", "score": "2", "team": {"displayName": "Netherlands"}},
                            {"homeAway": "away", "score": "1", "team": {"displayName": "Japan"}},
                        ]
                    }
                ],
            },
        ]
    }

    results = extract_completed_espn_results(scoreboard)

    assert len(results) == 1
    assert results[0]["home_team"] == "Australia"
    assert results[0]["away_team"] == "Türkiye"
    assert results[0]["home_score"] == 2
    assert canonical_team(results[0]["away_team"]) == "turkey"


def test_fox_confirmation_parses_final_score_without_confusing_records():
    html = """
    <a href="/soccer/fifa-world-cup-men-mexico-vs-south-africa-jun-11-2026-game-boxscore-647616"
      class="score-chip final">
      GROUP A Mexico 1-0-0 MEX 1-0-0 2 South Africa 0-0-1 RSA 0-0-1 0 FINAL
    </a>
    """
    item = {
        "match_id": "match-001",
        "home_team": "Mexico",
        "away_team": "South Africa",
        "home_score": 2,
        "away_score": 0,
    }

    confirmation = find_fox_confirmation(item, html)

    assert confirmation is not None
    assert confirmation.home_score == 2
    assert confirmation.away_score == 0
    assert confirmation.source_url.endswith("game-boxscore-647616")


def test_fox_confirmation_rejects_score_mismatch():
    html = """
    <a href="/soccer/fifa-world-cup-men-netherlands-vs-japan-jun-14-2026-game-boxscore-647625"
      class="score-chip final">
      GROUP F Netherlands 0-1-0 NED 0-1-0 2 Japan 0-1-0 JPN 0-1-0 2 FINAL
    </a>
    """
    item = {
        "match_id": "match-011",
        "home_team": "Netherlands",
        "away_team": "Japan",
        "home_score": 2,
        "away_score": 1,
    }

    assert find_fox_confirmation(item, html) is None


def test_fox_confirmation_accepts_fox_country_aliases():
    html = """
    <a href="/soccer/fifa-world-cup-men-south-korea-vs-czechia-jun-11-2026-game-boxscore-647617"
      class="score-chip final">
      GROUP A South Korea 1-0-0 KOR 1-0-0 2 Czechia 0-0-1 CZE 0-0-1 1 FINAL
    </a>
    <a href="/soccer/fifa-world-cup-men-australia-vs-turkiye-jun-14-2026-game-boxscore-647620"
      class="score-chip final">
      GROUP D Australia 1-0-0 AUS 1-0-0 2 Turkiye 0-0-1 TUR 0-0-1 0 FINAL
    </a>
    """

    czechia = find_fox_confirmation(
        {
            "match_id": "match-002",
            "home_team": "South Korea",
            "away_team": "Czechia",
            "home_score": 2,
            "away_score": 1,
        },
        html,
    )
    turkiye = find_fox_confirmation(
        {
            "match_id": "match-006",
            "home_team": "Australia",
            "away_team": "Türkiye",
            "home_score": 2,
            "away_score": 0,
        },
        html,
    )

    assert czechia is not None
    assert turkiye is not None


def test_fox_confirmation_skips_non_card_slug_occurrences():
    html = """
    <script>{"linkOut":"https://www.foxsports.com/soccer/fifa-world-cup-men-brazil-vs-morocco-jun-13-2026-game-boxscore-647622"}</script>
    <a href="/soccer/fifa-world-cup-men-brazil-vs-morocco-jun-13-2026-game-boxscore-647622"
      class="score-chip final">
      GROUP C Brazil 0-1-0 BRA 0-1-0 1 Morocco 0-1-0 MAR 0-1-0 1 FINAL
    </a>
    """
    item = {
        "match_id": "match-007",
        "home_team": "Brazil",
        "away_team": "Morocco",
        "home_score": 1,
        "away_score": 1,
    }

    assert find_fox_confirmation(item, html) is not None
