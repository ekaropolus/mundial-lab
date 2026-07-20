from app.database import initialize_database
from app.live import get_match, list_matches


def test_seed_matches_are_available():
    initialize_database()
    matches = list_matches()
    assert len(matches) == 104
    opening_match = get_match("001-mexico-vs-south-africa")
    final = get_match("104-winner-match-101-vs-winner-match-102")
    assert opening_match is not None
    assert opening_match.match_number == 1
    assert opening_match.venue == "Estadio Azteca"
    assert final is not None
    assert final.stage == "Final"
