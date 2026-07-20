from app.database import connect
from app.schemas import DirectorAlias, DirectorScore, LivePrediction, Match, MatchEvent, MatchStateUpdate


def clean_alias(alias: str) -> str:
    cleaned = " ".join(alias.strip().split())
    if len(cleaned) < 3:
        raise ValueError("El alias debe tener al menos 3 caracteres.")
    return cleaned[:32]


def register_director(alias: str) -> DirectorAlias:
    director = DirectorAlias(alias=clean_alias(alias))
    with connect() as db:
        if db.is_postgres:
            db.execute(
                """
                insert into directors (alias, last_seen_at)
                values (?, current_timestamp)
                on conflict (alias) do update set last_seen_at = current_timestamp
                """,
                (director.alias,),
            )
        else:
            db.execute(
                """
                insert into directors (alias, last_seen_at)
                values (?, current_timestamp)
                on conflict(alias) do update set last_seen_at = current_timestamp
                """,
                (director.alias,),
            )
    return director


def list_matches() -> list[Match]:
    with connect() as db:
        rows = db.execute(
            """
            select m.*, v.trust_level as result_trust_level, v.source as result_source,
                   coalesce(nullif(v.winner_team_id, ''), nullif(m.winner_team_id, '')) as winner_team_id,
                   coalesce(nullif(v.winner_team, ''), nullif(m.winner_team, '')) as winner_team
            from matches m
            left join match_results_verified v on v.match_id = m.id
            order by m.kickoff
            """
        ).fetchall()
    return [Match.model_validate(dict(row)) for row in rows]


def get_match(slug_or_id: str) -> Match | None:
    with connect() as db:
        row = db.execute(
            """
            select m.*, v.trust_level as result_trust_level, v.source as result_source,
                   coalesce(nullif(v.winner_team_id, ''), nullif(m.winner_team_id, '')) as winner_team_id,
                   coalesce(nullif(v.winner_team, ''), nullif(m.winner_team, '')) as winner_team
            from matches m
            left join match_results_verified v on v.match_id = m.id
            where m.slug = ? or m.id = ?
            """,
            (slug_or_id, slug_or_id),
        ).fetchone()
    return Match.model_validate(dict(row)) if row else None


def list_match_events(match_id: str) -> list[MatchEvent]:
    with connect() as db:
        rows = db.execute(
            "select * from match_events where match_id = ? order by minute, id",
            (match_id,),
        ).fetchall()
    return [MatchEvent.model_validate(dict(row)) for row in rows]


def add_match_event(event: MatchEvent) -> MatchEvent:
    with connect() as db:
        cursor = db.execute(
            """
            insert into match_events (match_id, minute, event_type, team_id, description, source, status)
            values (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.match_id,
                event.minute,
                event.event_type,
                event.team_id,
                event.description,
                event.source,
                event.status,
            ),
        )
        db.execute(
            """
            update matches
            set minute = case when minute > ? then minute else ? end,
                updated_at = current_timestamp
            where id = ?
            """,
            (event.minute, event.minute, event.match_id),
        )
        event.id = cursor.lastrowid
    return event


def update_match_state(match_id: str, update: MatchStateUpdate) -> Match | None:
    with connect() as db:
        db.execute(
            """
            update matches
            set status = ?, minute = ?, home_score = ?, away_score = ?, updated_at = current_timestamp
            where id = ?
            """,
            (update.status, update.minute, update.home_score, update.away_score, match_id),
        )
    return get_match(match_id)


def add_prediction(prediction: LivePrediction) -> LivePrediction:
    director = register_director(prediction.director_name)
    prediction.director_name = director.alias
    total = prediction.home_win + prediction.draw + prediction.away_win
    if total <= 0 or abs(total - 1) > 0.02:
        raise ValueError("Las probabilidades deben sumar 1.00.")
    prediction.home_win /= total
    prediction.draw /= total
    prediction.away_win /= total
    with connect() as db:
        cursor = db.execute(
            """
            insert into live_predictions (
                match_id, director_name, model, minute, home_win, draw, away_win, notes
            ) values (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                prediction.match_id,
                prediction.director_name,
                prediction.model,
                prediction.minute,
                prediction.home_win,
                prediction.draw,
                prediction.away_win,
                prediction.notes,
            ),
        )
        prediction.id = cursor.lastrowid
    return prediction


def list_predictions(match_id: str) -> list[LivePrediction]:
    with connect() as db:
        rows = db.execute(
            "select * from live_predictions where match_id = ? order by created_at desc, id desc",
            (match_id,),
        ).fetchall()
    return [LivePrediction.model_validate(dict(row)) for row in rows]


def leaderboard() -> list[DirectorScore]:
    with connect() as db:
        live_fallback = "1.0 - abs(p.home_win - p.away_win)"
        outcome_expr = """
            case
                when m.status = 'finished' and m.home_score > m.away_score then p.home_win
                when m.status = 'finished' and m.home_score = m.away_score then p.draw
                when m.status = 'finished' and m.home_score < m.away_score then p.away_win
                else {live_fallback}
            end
        """.format(live_fallback=live_fallback)
        score_expr = (
            f"round(avg({outcome_expr})::numeric, 3)"
            if db.is_postgres
            else f"round(avg({outcome_expr}), 3)"
        )
        rows = db.execute(
            f"""
            select director_name, count(*) as predictions,
                   {score_expr} as score
            from live_predictions p
            left join matches m on m.id = p.match_id
            group by p.director_name
            order by score desc, predictions desc
            """
        ).fetchall()
    return [DirectorScore.model_validate(dict(row)) for row in rows]
