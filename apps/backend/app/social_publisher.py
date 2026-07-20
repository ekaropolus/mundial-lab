from __future__ import annotations

import hashlib
import json
import os
import re
import textwrap
import time
import base64
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from PIL import Image, ImageDraw, ImageFont

from app.autopsy import house_daily_editorials, list_learning_log
from app.database import connect, initialize_database


GRAPH_BASE = "https://graph.instagram.com/v23.0"
TERMINAL_STATUSES = {"published", "manual_shared", "deleted", "skipped"}
IN_FLIGHT_STATUSES = {"publishing"}
UNAVAILABLE_STATUSES = TERMINAL_STATUSES | IN_FLIGHT_STATUSES


def _results_dir() -> Path:
    return Path(os.getenv("RESULTS_DIR", "/app/results"))


def _public_base() -> str:
    return os.getenv("INSTAGRAM_IMAGE_PUBLIC_BASE", "https://api-mundial.hadox.org/social/instagram").rstrip("/")


def _pct(value: float) -> str:
    return f"{round(value * 100, 1)}%"


def _safe_slug(value: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return clean[:72] or "social-post"


def _candidate_local_day(candidate: dict[str, Any], publish_tz: str) -> str:
    raw = str(candidate.get("created_at") or "").strip()
    if not raw:
        return ""
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(ZoneInfo(publish_tz)).strftime("%Y-%m-%d")
    except Exception:
        return raw[:10]


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def _parse_json(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _outcome_label(entry: dict[str, Any]) -> str:
    if entry.get("outcome") == "home":
        return str(entry.get("home_team"))
    if entry.get("outcome") == "away":
        return str(entry.get("away_team"))
    return "Draw"


def _entry_probability(entry: dict[str, Any]) -> float:
    params = _parse_json(str(entry.get("best_parameters_json") or "{}"))
    contract = params.get("best_contract") if isinstance(params.get("best_contract"), dict) else {}
    probability = contract.get("probability_for_real_outcome", params.get("probability_for_real_outcome"))
    if isinstance(probability, (int, float)):
        return max(0.0, min(1.0, float(probability)))
    return max(0.0, min(1.0, 1 - float(entry.get("best_error") or 0)))


def _entry_lift(entry: dict[str, Any]) -> float:
    params = _parse_json(str(entry.get("best_parameters_json") or "{}"))
    lift = params.get("outcome_probability_lift")
    if isinstance(lift, (int, float)):
        return float(lift)
    return _entry_probability(entry) - max(0.0, min(1.0, 1 - float(entry.get("original_error") or 0)))


def _candidate_from_autopsy(entry: dict[str, Any]) -> dict[str, Any]:
    score = f"{entry['home_team']} {entry['home_score']}-{entry['away_score']} {entry['away_team']}"
    probability = _entry_probability(entry)
    lift = _entry_lift(entry)
    outcome = _outcome_label(entry)
    title = f"{score}: the house autopsy is in"
    metric = f"{_pct(probability)} on the real outcome"
    caption = "\n".join(
        [
            f"Ufff. The house has a new Monte Carlo autopsy: {score}.",
            "",
            f"The model put {_pct(probability)} on what actually happened: {outcome}.",
            f"Movement vs the first saved line: {lift >= 0 and '+' or '-'}{_pct(abs(lift))}.",
            "",
            "This is the master line learning from the tournament, not a director submission.",
            f"Read it: https://mundial.hadox.org/diario-aprendizaje/?match={entry['slug']}&model={entry['best_model']}",
            "Board: https://mundial.hadox.org/montecarlo-casa/",
            "",
            "#MundialLab #MonteCarlo #FootballAnalytics #WorldCup",
        ]
    )
    return {
        "source_id": f"house-autopsy-{entry['id']}",
        "source_kind": "house_autopsy",
        "title": title,
        "subtitle": str(entry.get("headline") or "Monte Carlo de la casa"),
        "metric": metric,
        "detail": str(entry.get("lesson") or ""),
        "caption": caption,
        "accent": "#ffdd2d",
        "created_at": str(entry.get("created_at") or ""),
    }


def _candidate_from_editorial(item: dict[str, Any]) -> dict[str, Any]:
    kind = str(item.get("kind") or "editorial")
    title = str(item.get("title") or "Monte Carlo update")
    metric = str(item.get("metric") or item.get("subtitle") or "House line")
    detail = str(item.get("model_result") or item.get("detail") or "")
    if kind == "champion_pulse":
        champion = title.split(" pinta", 1)[0].strip() if " pinta" in title else title.strip()
        title = f"{champion} leads the title race"
        detail = f"{champion} is the current Monte Carlo title favorite with {metric}."
        lead = f"The house has a title pulse: {champion} is currently leading the Monte Carlo race."
        signal = f"Current title probability: {metric}."
    elif kind == "daily_groups":
        day = str(item.get("day") or "").strip()
        title = f"Group tables moved{f' on {day}' if day else ''}"
        detail = "Real points and the Monte Carlo projection now share the same board."
        lead = f"End-of-day group check{f' for {day}' if day else ''}: the table moved."
        signal = "Real results are now fixed evidence; Monte Carlo projects what is still alive."
    else:
        lead = str(item.get("detail") or "The house line moved after the latest results.")
        signal = str(item.get("model_signal") or item.get("model_result") or "")
    caption = "\n".join(
        [
            lead,
            "",
            signal,
            "",
            "Board: https://mundial.hadox.org/montecarlo-casa/",
            "",
            "#MundialLab #MonteCarlo #FootballAnalytics #WorldCup",
        ]
    )
    return {
        "source_id": f"{kind}-{item.get('id')}",
        "source_kind": kind,
        "title": title,
        "subtitle": str(item.get("eyebrow") or "Mundial Lab"),
        "metric": metric,
        "detail": detail,
        "caption": caption,
        "accent": "#6cffc2" if kind == "daily_groups" else "#ffdd2d",
        "created_at": str(item.get("day") or item.get("created_at") or ""),
    }


def build_house_social_candidates(limit: int = 12) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    entries = list_learning_log(120)
    for entry in entries:
        params = _parse_json(str(entry.get("best_parameters_json") or "{}"))
        if params.get("stage") == "calibrated_autopsy":
            candidates.append(_candidate_from_autopsy(entry))
    for item in house_daily_editorials(limit_days=4):
        if item.get("kind") in {"daily_groups", "champion_pulse"}:
            candidates.append(_candidate_from_editorial(item))
    return candidates[: max(1, min(50, limit))]


def _draw_wrapped(draw: ImageDraw.ImageDraw, text: str, xy: tuple[int, int], font: ImageFont.ImageFont, fill: str, width: int, line_gap: int = 8) -> int:
    x, y = xy
    lines: list[str] = []
    for paragraph in text.splitlines() or [""]:
        if not paragraph:
            lines.append("")
            continue
        for line in textwrap.wrap(paragraph, width=width):
            lines.append(line)
    _, _, _, line_height = draw.textbbox((0, 0), "Ag", font=font)
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height + line_gap
    return y


COUNTRY_VISUALS: dict[str, tuple[str, str, str]] = {
    "argentina": ("#75aadb", "#ffffff", "#fcbf49"),
    "australia": ("#00205b", "#ffcd00", "#ffffff"),
    "belgium": ("#000000", "#fae042", "#ed2939"),
    "brazil": ("#009b3a", "#ffdf00", "#002776"),
    "canada": ("#ff0000", "#ffffff", "#ff0000"),
    "colombia": ("#fcd116", "#003893", "#ce1126"),
    "croatia": ("#ff0000", "#ffffff", "#171796"),
    "dr congo": ("#007fff", "#f7d618", "#ce1021"),
    "england": ("#ffffff", "#ce1124", "#111827"),
    "france": ("#0055a4", "#ffffff", "#ef4135"),
    "germany": ("#000000", "#dd0000", "#ffce00"),
    "ghana": ("#ce1126", "#fcd116", "#006b3f"),
    "iran": ("#239f40", "#ffffff", "#da0000"),
    "japan": ("#ffffff", "#bc002d", "#111827"),
    "mexico": ("#006847", "#ffffff", "#ce1126"),
    "morocco": ("#c1272d", "#006233", "#f9fafb"),
    "netherlands": ("#ae1c28", "#ffffff", "#21468b"),
    "new zealand": ("#00247d", "#cc142b", "#ffffff"),
    "portugal": ("#006600", "#ff0000", "#ffcc00"),
    "senegal": ("#00853f", "#fdef42", "#e31b23"),
    "south africa": ("#007a4d", "#ffb81c", "#de3831"),
    "south korea": ("#ffffff", "#c60c30", "#003478"),
    "spain": ("#aa151b", "#f1bf00", "#aa151b"),
    "switzerland": ("#d52b1e", "#ffffff", "#d52b1e"),
    "united states": ("#3c3b6e", "#b22234", "#ffffff"),
}


def _hex_to_rgb(value: str, fallback: tuple[int, int, int] = (255, 221, 45)) -> tuple[int, int, int]:
    if re.fullmatch(r"#[0-9a-fA-F]{6}", value or ""):
        return tuple(int(value.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    return fallback


def _split_match_title(title: str) -> tuple[str, str | None]:
    clean = re.sub(r":.*$", "", title).strip()
    match = re.match(r"(.+?)\s+\d+\s*-\s*\d+\s+(.+)$", clean)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    parts = re.split(r"\s+vs\s+", clean, flags=re.IGNORECASE)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return clean, None


def _team_palette(name: str | None, fallback: tuple[str, str, str]) -> tuple[str, str, str]:
    if not name:
        return fallback
    key = name.lower().replace("czech republic", "czechia").strip()
    return COUNTRY_VISUALS.get(key, fallback)


def _wrap_pixels(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = [word for word in re.split(r"\s+", text.strip()) if word]
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        if draw.textbbox((0, 0), trial, font=font)[2] <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _fit_font(draw: ImageDraw.ImageDraw, text: str, max_width: int, max_size: int, min_size: int = 42) -> ImageFont.ImageFont:
    for size in range(max_size, min_size - 1, -3):
        font = _font(size, True)
        if max((draw.textbbox((0, 0), line, font=font)[2] for line in _wrap_pixels(draw, text, font, max_width)), default=0) <= max_width:
            return font
    return _font(min_size, True)


def _draw_wrapped_pixels(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    font: ImageFont.ImageFont,
    fill: str,
    max_width: int,
    max_lines: int = 4,
    line_gap: int = 8,
    stroke_fill: str | None = None,
    stroke_width: int = 0,
) -> int:
    x, y = xy
    lines = _wrap_pixels(draw, text, font, max_width)[:max_lines]
    if len(_wrap_pixels(draw, text, font, max_width)) > max_lines and lines:
        lines[-1] = lines[-1].rstrip(".") + "..."
    _, _, _, line_height = draw.textbbox((0, 0), "Ag", font=font)
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill, stroke_width=stroke_width, stroke_fill=stroke_fill)
        y += line_height + line_gap
    return y


def _artwork_copy(candidate: dict[str, Any]) -> tuple[str, str, str, str]:
    kind = str(candidate.get("source_kind") or "")
    title = str(candidate.get("title") or "Monte Carlo update")
    metric = str(candidate.get("metric") or "House line")
    detail = str(candidate.get("detail") or "The model moved after the latest evidence.")
    clean_title = re.sub(r":.*$", "", title).strip()
    home, away = _split_match_title(title)
    if kind == "house_autopsy":
        headline = "READ THE AUTOPSY"
        matchup = clean_title or (f"{home} vs {away}" if away else home)
        proof = detail or "The house line compares the opening read against the final whistle."
    elif kind == "daily_groups":
        headline = "THE TABLE MOVED"
        matchup = title
        proof = detail or "Group tables now carry real points and Monte Carlo projection."
    elif kind == "champion_pulse":
        headline = "TITLE PULSE"
        matchup = title
        proof = detail or "The title race moved after the latest saved line."
    else:
        headline = "HOUSE LINE"
        matchup = f"{home} vs {away}" if away else title
        proof = detail
    return headline.upper(), matchup.upper(), metric.upper(), proof


def render_square_social_card(candidate: dict[str, Any], output_dir: Path | None = None) -> tuple[Path, str]:
    directory = output_dir or (_results_dir() / "social" / "instagram")
    directory.mkdir(parents=True, exist_ok=True)
    payload_hash = hashlib.sha1(
        json.dumps(candidate, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:10]
    filename = f"{_safe_slug(candidate['source_id'])}-{payload_hash}.png"
    path = directory / filename

    size = 1080
    img = Image.new("RGB", (size, size), "#061019")
    draw = ImageDraw.Draw(img, "RGBA")
    accent = str(candidate.get("accent") or "#ffdd2d")
    accent_rgb = _hex_to_rgb(accent)
    title = str(candidate.get("title") or "")
    home, away = _split_match_title(title)
    home_palette = _team_palette(home, ("#071118", accent, "#67e8f9"))
    away_palette = _team_palette(away, ("#0f766e", "#f8fafc", "#f97316"))
    home_rgb = [_hex_to_rgb(color) for color in home_palette]
    away_rgb = [_hex_to_rgb(color) for color in away_palette]
    digest = hashlib.sha1(str(candidate["source_id"]).encode("utf-8")).hexdigest()
    seed = int(digest[:8], 16)

    for y in range(size):
        shade = int(9 + 24 * (y / size))
        draw.line((0, y, size, y), fill=(3, shade, 24 + shade // 2, 255))

    # Country-led avant-garde base: two palettes collide like a match poster.
    draw.polygon([(0, 0), (size, 0), (size, 255), (0, 405)], fill=(*home_rgb[0], 225))
    draw.polygon([(0, 308), (size, 172), (size, 392), (0, 545)], fill=(*home_rgb[1], 230))
    draw.polygon([(0, 475), (size, 330), (size, 542), (0, 720)], fill=(*away_rgb[0], 215))
    draw.polygon([(0, 632), (size, 520), (size, 750), (0, 900)], fill=(*away_rgb[1], 218))
    draw.polygon([(0, 825), (size, 710), (size, size), (0, size)], fill=(*away_rgb[2], 190))
    draw.rectangle((0, 0, size, size), fill=(0, 0, 0, 78))

    for i in range(26):
        x = (seed + i * 137) % (size + 300) - 150
        y = (seed // (i + 3) + i * 79) % (size + 260) - 130
        r = 80 + (i % 6) * 38
        color = home_rgb[i % 3] if i % 2 else away_rgb[i % 3]
        draw.ellipse((x - r, y - r, x + r, y + r), outline=(*color, 54), width=5)
    for i in range(-260, size + 360, 58):
        draw.line((i, -40, i + 360, size + 40), fill=(255, 255, 255, 35), width=2)
    for i in range(12):
        x = 120 + i * 82
        draw.line((x, 702, x - 150, 1010), fill=(*accent_rgb, 42), width=3)

    # Stadium/data symbols.
    draw.rectangle((115, 448, 965, 688), outline=(255, 255, 255, 145), width=4)
    draw.line((540, 448, 540, 688), fill=(255, 255, 255, 120), width=3)
    draw.ellipse((455, 500, 625, 670), outline=(255, 255, 255, 120), width=3)
    for i in range(16):
        px = 170 + ((seed >> (i % 12)) + i * 57) % 740
        py = 485 + ((seed >> ((i + 4) % 12)) + i * 31) % 168
        color = home_rgb[1] if i < 8 else away_rgb[1]
        draw.rounded_rectangle((px, py, px + 28, py + 50), radius=14, fill=(*color, 205))

    draw.rectangle((50, 50, size - 50, size - 50), outline=accent, width=5)
    draw.rectangle((76, 72, size - 76, 168), fill=(3, 12, 19, 228), outline=(255, 255, 255, 80), width=2)
    draw.text((102, 94), "HADOX / MUNDIAL LAB", font=_font(25, True), fill=accent)
    draw.text((102, 128), "MONTE CARLO HOUSE LINE", font=_font(22, True), fill="#fff4d6")
    draw.text((size - 250, 102), f"WORK {seed % 10000:04d}", font=_font(23, True), fill="#ffffff")

    headline, matchup, metric, proof = _artwork_copy(candidate)
    headline_font = _fit_font(draw, headline, 880, 76, 52)
    y = _draw_wrapped_pixels(draw, headline, (78, 205), headline_font, "#ffffff", 900, 2, 6, "#061019", 5)

    match_font = _fit_font(draw, matchup, 900, 66, 42)
    y = _draw_wrapped_pixels(draw, matchup, (78, y + 18), match_font, accent, 900, 2, 5, "#061019", 4)

    draw.rounded_rectangle((74, 705, 1006, 815), radius=8, fill=(3, 12, 19, 232), outline=accent, width=3)
    draw.text((104, 728), "MODEL RESULT", font=_font(24, True), fill="#fff4d6")
    metric_font = _fit_font(draw, metric, 840, 48, 34)
    _draw_wrapped_pixels(draw, metric, (104, 760), metric_font, "#ffffff", 850, 1, 2, "#061019", 3)

    draw.rounded_rectangle((74, 840, 1006, 965), radius=8, fill=(3, 12, 19, 220), outline=(255, 255, 255, 90), width=2)
    _draw_wrapped_pixels(draw, proof, (104, 866), _font(29, True), "#fffaf0", 835, 3, 6, "#061019", 2)

    draw.rounded_rectangle((104, 988, 782, 1042), radius=0, fill=accent_rgb + (255,))
    draw.text((130, 1003), "READ THE HOUSE LINE", font=_font(29, True), fill="#061019")
    draw.text((800, 1005), "mundial.hadox.org", font=_font(23, True), fill="#fffaf0")

    img.save(path)
    return path, f"{_public_base()}/{filename}"


def render_social_card(candidate: dict[str, Any], output_dir: Path | None = None) -> tuple[Path, str]:
    directory = output_dir or (_results_dir() / "social" / "instagram")
    directory.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(candidate["source_id"].encode("utf-8")).hexdigest()[:8]
    filename = f"{_safe_slug(candidate['source_id'])}-{digest}.png"
    path = directory / filename

    width, height = 1080, 1350
    img = Image.new("RGB", (width, height), "#071118")
    draw = ImageDraw.Draw(img, "RGBA")
    accent = str(candidate.get("accent") or "#ffdd2d")

    for i in range(0, height, 18):
        alpha = int(30 + (i / height) * 70)
        draw.line((0, i, width, i - 180), fill=(0, 180, 150, alpha), width=2)
    for i in range(24):
        x = (i * 97 + int(digest[:2], 16) * 3) % width
        draw.ellipse((x - 180, 120 + i * 42, x + 180, 480 + i * 42), outline=(255, 221, 45, 35), width=4)

    draw.rectangle((54, 54, width - 54, height - 54), outline=accent, width=5)
    draw.rectangle((54, 54, width - 54, 245), fill=(4, 14, 22, 215))
    draw.rectangle((54, 815, width - 54, 1120), fill=(4, 14, 22, 225))
    draw.polygon([(0, 345), (width, 245), (width, 530), (0, 620)], fill=(255, 221, 45, 210))
    draw.polygon([(0, 560), (width, 440), (width, 720), (0, 810)], fill=(26, 199, 143, 165))
    draw.polygon([(0, 720), (width, 620), (width, 845), (0, 980)], fill=(255, 255, 255, 190))

    draw.text((82, 92), "HADOX / MUNDIAL LAB", font=_font(31, True), fill=accent)
    draw.text((82, 134), str(candidate.get("subtitle") or "MONTE CARLO HOUSE").upper(), font=_font(27, True), fill="#ffffff")

    title = str(candidate.get("title") or "Monte Carlo update").upper()
    y = _draw_wrapped(draw, title, (82, 320), _font(74, True), "#ffffff", 18, 8)
    draw.text((82, max(y + 20, 665)), str(candidate.get("metric") or "HOUSE LINE").upper(), font=_font(58, True), fill=accent)

    detail = str(candidate.get("detail") or "The model moved after the latest evidence.")
    _draw_wrapped(draw, detail, (82, 865), _font(34, True), "#ffffff", 41, 9)

    draw.rectangle((82, height - 205, width - 82, height - 118), fill=(255, 221, 45, 255))
    draw.text((112, height - 180), "FOLLOW THE HOUSE LINE", font=_font(38, True), fill="#071118")
    draw.text((112, height - 90), "mundial.hadox.org/montecarlo-casa", font=_font(25, True), fill="#ffffff")

    img.save(path)
    return path, f"{_public_base()}/{filename}"


def _render_auto_card(candidate: dict[str, Any]) -> tuple[Path, str]:
    card_format = os.getenv("SOCIAL_CARD_FORMAT", "square").strip().lower()
    if card_format in {"square", "1:1", "instagram_square"}:
        return render_square_social_card(candidate)
    return render_social_card(candidate)


def _save_publication(candidate: dict[str, Any], image_path: Path, image_url: str) -> dict[str, Any]:
    initialize_database()
    with connect() as db:
        existing = db.execute("select * from social_publications where source_id = ?", (candidate["source_id"],)).fetchone()
        if existing:
            return dict(existing)
        cursor = db.execute(
            """
            insert into social_publications (source_id, source_kind, title, caption, image_path, image_url, status)
            values (?, ?, ?, ?, ?, ?, 'generated')
            """,
            (
                candidate["source_id"],
                candidate["source_kind"],
                candidate["title"],
                candidate["caption"],
                str(image_path),
                image_url,
            ),
        )
        row = db.execute("select * from social_publications where id = ?", (cursor.lastrowid,)).fetchone()
    return dict(row)


def _save_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    initialize_database()
    with connect() as db:
        existing = db.execute("select * from social_publications where source_id = ?", (candidate["source_id"],)).fetchone()
        if existing:
            return dict(existing)
        cursor = db.execute(
            """
            insert into social_publications (source_id, source_kind, title, caption, image_path, image_url, status)
            values (?, ?, ?, ?, '', '', 'candidate')
            """,
            (
                candidate["source_id"],
                candidate["source_kind"],
                candidate["title"],
                candidate["caption"],
            ),
        )
        row = db.execute("select * from social_publications where id = ?", (cursor.lastrowid,)).fetchone()
    return dict(row)


def _save_approved_render(candidate: dict[str, Any]) -> dict[str, Any]:
    image_path, image_url = _render_auto_card(candidate)
    initialize_database()
    with connect() as db:
        existing = db.execute("select * from social_publications where source_id = ?", (candidate["source_id"],)).fetchone()
        if existing and existing["status"] in TERMINAL_STATUSES:
            return dict(existing)
        if existing:
            db.execute(
                """
                update social_publications
                set source_kind = ?,
                    title = ?,
                    caption = ?,
                    image_path = ?,
                    image_url = ?,
                    status = 'approved',
                    error = ''
                where source_id = ?
                """,
                (
                    candidate["source_kind"],
                    candidate["title"],
                    candidate["caption"],
                    str(image_path),
                    image_url,
                    candidate["source_id"],
                ),
            )
        else:
            db.execute(
                """
                insert into social_publications (source_id, source_kind, title, caption, image_path, image_url, status)
                values (?, ?, ?, ?, ?, ?, 'approved')
                """,
                (
                    candidate["source_id"],
                    candidate["source_kind"],
                    candidate["title"],
                    candidate["caption"],
                    str(image_path),
                    image_url,
                ),
            )
        row = db.execute("select * from social_publications where source_id = ?", (candidate["source_id"],)).fetchone()
    return dict(row)


def _claim_publication_for_publish(source_id: str) -> dict[str, Any] | None:
    placeholders = ",".join("?" for _ in UNAVAILABLE_STATUSES)
    with connect() as db:
        cursor = db.execute(
            f"""
            update social_publications
            set status = 'publishing',
                error = ''
            where source_id = ?
              and status not in ({placeholders})
            """,
            (source_id, *tuple(UNAVAILABLE_STATUSES)),
        )
        row = db.execute("select * from social_publications where source_id = ?", (source_id,)).fetchone()
        if cursor.rowcount != 1:
            return None
    return dict(row) if row else None


def _decode_png_data_url(image_data: str) -> bytes:
    prefix = "data:image/png;base64,"
    if not image_data.startswith(prefix):
        raise ValueError("La imagen debe venir como data:image/png;base64.")
    raw = base64.b64decode(image_data[len(prefix):], validate=True)
    if len(raw) < 1000:
        raise ValueError("La imagen recibida esta vacia o incompleta.")
    if len(raw) > 12 * 1024 * 1024:
        raise ValueError("La imagen pesa demasiado para publicacion social.")
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("La imagen no parece ser PNG valido.")
    return raw


def save_social_artwork(payload: dict[str, Any]) -> dict[str, Any]:
    source_id = str(payload["source_id"])
    raw = _decode_png_data_url(str(payload["image_data"]))
    digest = hashlib.sha1(raw + source_id.encode("utf-8")).hexdigest()[:10]
    filename = f"{_safe_slug(source_id)}-{digest}.png"
    directory = _results_dir() / "social" / "instagram"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / filename
    path.write_bytes(raw)
    image_url = f"{_public_base()}/{filename}"

    initialize_database()
    with connect() as db:
        existing = db.execute("select * from social_publications where source_id = ?", (source_id,)).fetchone()
        if existing and existing["status"] in {"published", "deleted", "publishing"}:
            return dict(existing)
        if payload.get("publish") and existing and existing["status"] == "manual_shared":
            return dict(existing)
        if existing:
            db.execute(
                """
                update social_publications
                set source_kind = ?,
                    title = ?,
                    caption = ?,
                    image_path = ?,
                    image_url = ?,
                    status = 'approved',
                    error = ''
                where source_id = ?
                """,
                (
                    str(payload.get("source_kind") or "social_room"),
                    str(payload.get("title") or source_id),
                    str(payload.get("caption") or ""),
                    str(path),
                    image_url,
                    source_id,
                ),
            )
        else:
            db.execute(
                """
                insert into social_publications (
                    source_id, source_kind, title, caption, image_path, image_url, status
                ) values (?, ?, ?, ?, ?, ?, 'approved')
                """,
                (
                    source_id,
                    str(payload.get("source_kind") or "social_room"),
                    str(payload.get("title") or source_id),
                    str(payload.get("caption") or ""),
                    str(path),
                    image_url,
                ),
            )
        row = db.execute("select * from social_publications where source_id = ?", (source_id,)).fetchone()

    publication = dict(row)
    if payload.get("publish"):
        if publication["status"] in UNAVAILABLE_STATUSES:
            return publication
        claimed = _claim_publication_for_publish(source_id)
        if not claimed:
            with connect() as db:
                row = db.execute("select * from social_publications where source_id = ?", (source_id,)).fetchone()
            return dict(row) if row else publication
        try:
            response = _instagram_publish(str(claimed["image_url"]), str(claimed["caption"]))
            _mark_publication(
                source_id,
                "published",
                instagram_container_id=str(response["container"].get("id", "")),
                instagram_post_id=str(response["published"].get("id", "")),
            )
        except Exception as exc:
            _mark_publication(source_id, "error", error=str(exc))
            raise
        with connect() as db:
            row = db.execute("select * from social_publications where source_id = ?", (source_id,)).fetchone()
        publication = dict(row)
    return publication


def record_social_share(source_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    initialize_database()
    with connect() as db:
        existing = db.execute("select * from social_publications where source_id = ?", (source_id,)).fetchone()
        if existing:
            db.execute(
                """
                update social_publications
                set share_count = coalesce(share_count, 0) + 1,
                    last_shared_at = cast(current_timestamp as text),
                    status = case when status in ('generated', 'error') then 'manual_shared' else status end,
                    error = ''
                where source_id = ?
                """,
                (source_id,),
            )
        else:
            db.execute(
                """
                insert into social_publications (
                    source_id, source_kind, title, caption, image_path, image_url,
                    status, share_count, last_shared_at
                ) values (?, ?, ?, ?, ?, ?, 'manual_shared', 1, cast(current_timestamp as text))
                """,
                (
                    source_id,
                    str(data.get("source_kind") or data.get("kind") or "social_room"),
                    str(data.get("title") or source_id),
                    str(data.get("caption") or ""),
                    str(data.get("image_path") or ""),
                    str(data.get("image_url") or ""),
                ),
            )
        row = db.execute("select * from social_publications where source_id = ?", (source_id,)).fetchone()
    return dict(row)


def mark_social_publications_deleted(source_ids: list[str] | None = None) -> dict[str, Any]:
    initialize_database()
    params: tuple[Any, ...] = ()
    where = "where status = 'published'"
    if source_ids:
        placeholders = ",".join("?" for _ in source_ids)
        where = f"where source_id in ({placeholders})"
        params = tuple(source_ids)
    with connect() as db:
        rows = db.execute(f"select source_id from social_publications {where}", params).fetchall()
        db.execute(
            f"""
            update social_publications
            set status = 'deleted',
                error = 'Deleted manually from Instagram',
                share_count = case when coalesce(share_count, 0) < 1 then 1 else share_count end,
                last_shared_at = coalesce(last_shared_at, cast(current_timestamp as text))
            {where}
            """,
            params,
        )
    return {"deleted_marked": len(rows), "source_ids": [row["source_id"] for row in rows]}


def _mark_publication(source_id: str, status: str, **fields: str) -> None:
    allowed = {
        "instagram_container_id": fields.get("instagram_container_id", ""),
        "instagram_post_id": fields.get("instagram_post_id", ""),
        "error": fields.get("error", ""),
    }
    published_sql = ", published_at = current_timestamp" if status == "published" else ""
    shared_sql = (
        ", share_count = case when coalesce(share_count, 0) < 1 then 1 else share_count end,"
        " last_shared_at = coalesce(last_shared_at, cast(current_timestamp as text))"
        if status == "published"
        else ""
    )
    with connect() as db:
        db.execute(
            f"""
            update social_publications
            set status = ?,
                instagram_container_id = ?,
                instagram_post_id = ?,
                error = ?
                {published_sql}
                {shared_sql}
            where source_id = ?
            """,
            (status, allowed["instagram_container_id"], allowed["instagram_post_id"], allowed["error"], source_id),
        )


def _instagram_publish(image_url: str, caption: str) -> dict[str, Any]:
    token = os.getenv("META_IG_ACCESS_TOKEN", "").strip()
    ig_user_id = os.getenv("META_INSTAGRAM_ACCOUNT_ID", "").strip()
    if not token or not ig_user_id:
        raise RuntimeError("Faltan META_IG_ACCESS_TOKEN y META_INSTAGRAM_ACCOUNT_ID.")
    with httpx.Client(timeout=30) as client:
        container = client.post(
            f"{GRAPH_BASE}/{ig_user_id}/media",
            data={"image_url": image_url, "caption": caption, "access_token": token},
        )
        try:
            container.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(f"Instagram container error: {exc.response.text}") from exc
        container_payload = container.json()
        publish_error = ""
        for attempt in range(1, 6):
            if attempt > 1:
                time.sleep(attempt * 4)
            published = client.post(
                f"{GRAPH_BASE}/{ig_user_id}/media_publish",
                data={"creation_id": container_payload["id"], "access_token": token},
            )
            if published.is_success:
                published_payload = published.json()
                return {"container": container_payload, "published": published_payload}
            publish_error = published.text
        raise RuntimeError(f"Instagram publish error after retries: {publish_error}")


def publish_pending_house_social(limit: int = 3, publish: bool | None = None) -> dict[str, Any]:
    enabled = os.getenv("AUTOMATION_INSTAGRAM_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
    require_approval = os.getenv("INSTAGRAM_REQUIRE_APPROVAL", "true").strip().lower() in {"1", "true", "yes", "on"}
    auto_approve_rendered = (
        os.getenv("SOCIAL_AUTO_APPROVE_RENDERED", "false").strip().lower() in {"1", "true", "yes", "on"}
        and os.getenv("SOCIAL_ALLOW_BACKEND_RENDER", "false").strip().lower() in {"1", "true", "yes", "on"}
    )
    only_today = os.getenv("SOCIAL_PUBLISH_ONLY_TODAY", "false").strip().lower() in {"1", "true", "yes", "on"}
    publish_tz = os.getenv("SOCIAL_PUBLISH_TZ", "America/Mexico_City").strip() or "America/Mexico_City"
    try:
        local_today = datetime.now(ZoneInfo(publish_tz)).strftime("%Y-%m-%d")
    except Exception:
        local_today = datetime.now().strftime("%Y-%m-%d")
    today_key = os.getenv("SOCIAL_PUBLISH_DAY", "").strip() or local_today
    should_publish = enabled if publish is None else publish
    has_credentials = bool(os.getenv("META_IG_ACCESS_TOKEN", "").strip() and os.getenv("META_INSTAGRAM_ACCOUNT_ID", "").strip())
    if should_publish and not has_credentials:
        should_publish = False
    # Build a wide enough editorial window before filtering terminal rows. A
    # small window can be exhausted by already-published autopsies and hide
    # fresh daily/champion items from the Social Room renderer.
    candidates = build_house_social_candidates(limit=max(50, limit * 8, limit))
    if only_today:
        candidates = [candidate for candidate in candidates if _candidate_local_day(candidate, publish_tz) == today_key]
    results: list[dict[str, Any]] = []
    initialized = 0
    published = 0
    skipped = 0

    initialize_database()
    for candidate in candidates:
        with connect() as db:
            existing = db.execute("select * from social_publications where source_id = ?", (candidate["source_id"],)).fetchone()
        if existing and existing["status"] in UNAVAILABLE_STATUSES:
            skipped += 1
            continue
        if existing:
            publication = dict(existing)
        else:
            publication = _save_candidate(candidate)
            initialized += 1

        if len(results) >= limit:
            continue
        if not should_publish:
            results.append({"source_id": candidate["source_id"], "status": publication["status"], "image_url": publication["image_url"]})
            continue
        if publication["status"] != "approved" and auto_approve_rendered:
            publication = _save_approved_render(candidate)

        if publication["status"] != "approved":
            skipped += 1
            results.append({
                "source_id": candidate["source_id"],
                "status": publication["status"],
                "skipped": "requires_approved_social_room_artwork",
            })
            continue
        if not publication.get("image_url"):
            skipped += 1
            results.append({
                "source_id": candidate["source_id"],
                "status": publication["status"],
                "skipped": "missing_approved_artwork",
            })
            continue
        try:
            claimed = _claim_publication_for_publish(candidate["source_id"])
            if not claimed:
                skipped += 1
                results.append({
                    "source_id": candidate["source_id"],
                    "status": "publishing",
                    "skipped": "already_claimed_for_publish",
                })
                continue
            response = _instagram_publish(str(claimed["image_url"]), str(claimed["caption"]))
            _mark_publication(
                candidate["source_id"],
                "published",
                instagram_container_id=str(response["container"].get("id", "")),
                instagram_post_id=str(response["published"].get("id", "")),
            )
            published += 1
            results.append({"source_id": candidate["source_id"], "status": "published", "instagram_post_id": response["published"].get("id")})
        except Exception as exc:
            _mark_publication(candidate["source_id"], "error", error=str(exc))
            results.append({"source_id": candidate["source_id"], "status": "error", "error": str(exc)})

    return {
        "enabled": enabled,
        "publish": should_publish,
        "requires_approval": require_approval,
        "auto_approve_rendered": auto_approve_rendered,
        "only_today": only_today,
        "today": today_key,
        "card_format": os.getenv("SOCIAL_CARD_FORMAT", "square"),
        "credentials_ready": has_credentials,
        "candidates_seen": len(candidates),
        "generated": initialized,
        "published": published,
        "skipped_published": skipped,
        "results": results,
    }


def list_social_publications(limit: int = 50) -> list[dict[str, Any]]:
    initialize_database()
    bounded = max(1, min(200, limit))
    with connect() as db:
        rows = db.execute(
            """
            select *
            from social_publications
            order by generated_at desc, id desc
            limit ?
            """,
            (bounded,),
        ).fetchall()
    return [dict(row) for row in rows]
