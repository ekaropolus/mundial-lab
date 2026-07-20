import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Clipboard, Download, Flame, ImageDown, Instagram, Newspaper, Radio, Share2, Shuffle, Trophy } from "lucide-react";
import { SiteFooter } from "../components/SiteFooter";
import { fetchHouseDailyEditorials, fetchHouseEvolution, fetchLatestHouseBoard, fetchLearningLog, fetchMatches, fetchPublicDataQuality, fetchSocialPublications, recordSocialShare, runHouseMatchBoard, saveSocialArtwork } from "../lib/api";
import { getTournamentMoment, matchMomentLabel } from "../lib/tournamentMoment";
import { DataQualitySummary, HouseDailyEditorial, HouseLineEvolution, HouseMatchBoard, HouseMatchLine, LearningLogEntry, Match } from "../types";
import "../styles.css";

type CardFormat = "story" | "post" | "square";
type SocialMomentKind = "autopsy" | "match" | "next" | "data" | "daily_groups" | "champion_pulse";

type SocialMoment = {
  id: string;
  kind: SocialMomentKind;
  title: string;
  eyebrow: string;
  subtitle: string;
  detail: string;
  metric: string;
  accent: string;
  href: string;
  caption: string;
  sourceLabel: string;
  modelSignal: string;
  modelResult: string;
};

type VisualRecipe = {
  variant: number;
  palette: {
    bgA: string;
    bgB: string;
    bgC: string;
    accent: string;
    accent2: string;
    glow: string;
  };
  tilt: number;
  density: number;
  layout: "stadium" | "heatmap" | "bracket" | "ticker";
  poster: "split" | "arena" | "radar";
};

type ShareCounts = Record<string, number>;

declare global {
  interface Window {
    __MUNDIAL_SOCIAL_RENDER_RESULT__?: {
      ok: boolean;
      source_id?: string;
      status?: string;
      image_url?: string;
      instagram_post_id?: string;
      error?: string;
    };
  }
}

const shareCountsStorageKey = "mundial_lab_social_room_share_counts";

function readShareCounts(): ShareCounts {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.localStorage.getItem(shareCountsStorageKey);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
        .map(([key, value]) => [key, Math.max(0, Math.floor(value as number))]),
    );
  } catch {
    return {};
  }
}

function writeShareCounts(counts: ShareCounts) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(shareCountsStorageKey, JSON.stringify(counts));
}

const formats: Record<CardFormat, { label: string; width: number; height: number }> = {
  story: { label: "Story 9:16", width: 1080, height: 1920 },
  post: { label: "Post 4:5", width: 1080, height: 1350 },
  square: { label: "Square 1:1", width: 1080, height: 1080 },
};

function pct(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function parseEntry(entry: LearningLogEntry) {
  try {
    return JSON.parse(entry.best_parameters_json) as {
      stage?: "basic_autopsy" | "calibrated_autopsy" | "model_autopsy";
      probability_for_real_outcome?: number;
      best_contract?: { probability_for_real_outcome?: number; contract?: string };
      outcome_probability_lift?: number;
      candidates?: { contract?: string; probability_for_real_outcome?: number; error?: number }[];
    };
  } catch {
    return {};
  }
}

function entryProbability(entry: LearningLogEntry) {
  const params = parseEntry(entry);
  return params.best_contract?.probability_for_real_outcome ?? params.probability_for_real_outcome ?? 1 - entry.best_error;
}

function originalEntryProbability(entry: LearningLogEntry) {
  return Math.max(0, Math.min(1, 1 - entry.original_error));
}

function entryLift(entry: LearningLogEntry) {
  const params = parseEntry(entry);
  if (typeof params.outcome_probability_lift === "number") return params.outcome_probability_lift;
  return entryProbability(entry) - originalEntryProbability(entry);
}

function entryStage(entry: LearningLogEntry) {
  return parseEntry(entry).stage ?? "basic_autopsy";
}

function entryContract(entry: LearningLogEntry) {
  const params = parseEntry(entry);
  if (params.best_contract?.contract) return params.best_contract.contract;
  if (entryStage(entry) === "calibrated_autopsy") return "Monte Carlo de la casa";
  if (entry.best_model === "bayes_live") return "Bayes en vivo";
  if (entry.best_model === "dixon_coles") return "Dixon-Coles";
  return entry.best_model;
}

function entryOutcome(entry: LearningLogEntry) {
  if (entry.outcome === "home") return entry.home_team;
  if (entry.outcome === "away") return entry.away_team;
  return "Empate";
}

function modelSignalForEntry(entry: LearningLogEntry) {
  const lift = parseEntry(entry).outcome_probability_lift;
  const liftText = typeof lift === "number" ? ` | lift ${lift >= 0 ? "+" : ""}${pct(lift)}` : "";
  return `${entryContract(entry)}: ${pct(entryProbability(entry))} on the real outcome${liftText}`;
}

function modelResultForEntry(entry: LearningLogEntry) {
  return `${pct(entryProbability(entry))} on truth`;
}

function isHouseAutopsy(entry: LearningLogEntry) {
  return entryStage(entry) === "calibrated_autopsy";
}

function movementPhrase(lift: number) {
  const points = Math.abs(lift * 100);
  if (points < 0.5) return "the line moved just a hair, but in a World Cup that hair still matters";
  if (points < 2) return "the line moved quietly: not a scream, but a real adjustment";
  if (points < 6) return "the line moved with craft: not a panic turn, a calibration";
  return "the board shook: the autopsy found a very different read of the match";
}

function bermudezCall(entry: LearningLogEntry) {
  const lift = entryLift(entry);
  const before = originalEntryProbability(entry);
  const after = entryProbability(entry);
  const outcome = entryOutcome(entry);
  if (entryStage(entry) === "calibrated_autopsy") {
    return `Ufff, ladies and gentlemen: the first line had ${pct(before)} on ${outcome}; after the result, the autopsy pushed it to ${pct(after)}. ${movementPhrase(lift)}.`;
  }
  if (entryStage(entry) === "model_autopsy") {
    return `Watch the number: ${entryContract(entry)} put ${pct(after)} on what actually happened. Not hype, evidence after the whistle.`;
  }
  return `The score is final and the first read had ${pct(before)} on ${outcome}. Now we see who really learned.`;
}

function houseEvolutionLine(entry: LearningLogEntry) {
  const before = originalEntryProbability(entry);
  const after = entryProbability(entry);
  const lift = entryLift(entry);
  const direction = lift >= 0 ? "up" : "down";
  return `Opening line ${pct(before)} -> autopsy ${pct(after)}: ${direction} ${pct(Math.abs(lift))} on the real outcome.`;
}

function houseResultCaption(match: Match, entry?: LearningLogEntry, line?: HouseMatchLine, evolution?: HouseLineEvolution) {
  const score = `${match.home_team} ${match.home_score}-${match.away_score} ${match.away_team}`;
  if (entry) return houseAutopsyCaption(entry);
  return [
    `Final whistle: ${score}.`,
    "",
    houseEvolutionCaption(evolution) || "Monte Carlo de la casa now has a new piece of evidence. The first line is on the table; the autopsy is next.",
    line ? `Opening read: ${houseLineResult(line)}.` : "Opening read: line pending in the archive.",
    "",
    `Match room: ${publicUrl(`/partidos/${match.slug}/`)}`,
    `Monte Carlo board: ${publicUrl("/montecarlo-casa/")}`,
    "",
    "#MundialLab #MonteCarlo #FootballAnalytics #WorldCup",
  ].join("\n");
}

function houseLineSignal(line?: HouseMatchLine) {
  if (!line) return "Monte Carlo: line pending";
  const score = line.top_scores[0] ? ` | score ${line.top_scores[0].label} ${pct(line.top_scores[0].probability)}` : "";
  return `Monte Carlo: ${pct(line.home_win)} home / ${pct(line.draw)} draw / ${pct(line.away_win)} away${score}`;
}

function houseLineResult(line?: HouseMatchLine) {
  if (!line) return "Line pending";
  return `${pct(line.home_win)} H / ${pct(line.draw)} D / ${pct(line.away_win)} A`;
}

function houseEvolutionSignal(evolution?: HouseLineEvolution) {
  if (!evolution) return "";
  const opening = evolution.opening.outcome_probability;
  const latest = evolution.latest.outcome_probability;
  if (typeof opening !== "number" || typeof latest !== "number" || typeof evolution.movement !== "number") {
    return `House versions: ${evolution.versions}. Latest line: ${pct(evolution.latest.home_win)} H / ${pct(evolution.latest.draw)} D / ${pct(evolution.latest.away_win)} A.`;
  }
  const direction = evolution.movement >= 0 ? "up" : "down";
  return `House evolution: ${pct(opening)} -> ${pct(latest)} on the real outcome, ${direction} ${pct(Math.abs(evolution.movement))}.`;
}

function houseEvolutionCaption(evolution?: HouseLineEvolution) {
  if (!evolution) return "";
  const score = `${evolution.home_team} ${evolution.home_score}-${evolution.away_score} ${evolution.away_team}`;
  const signal = houseEvolutionSignal(evolution);
  return [
    `The house keeps receipts: ${score}.`,
    "",
    signal || "Monte Carlo has a saved opening line and a latest line for this match.",
    `Versions stored: ${evolution.versions}.`,
    `Opening scenario: ${evolution.opening.scenario}.`,
    `Latest scenario: ${evolution.latest.scenario}.`,
    "",
  ].join("\n");
}

function shortTeamName(name: string) {
  return name
    .replace("United States", "USA")
    .replace("South Korea", "Korea")
    .replace("South Africa", "S. Africa")
    .replace("Bosnia and Herzegovina", "Bosnia")
    .replace("Czech Republic", "Czechia")
    .replace("Saudi Arabia", "Saudi")
    .replace("New Zealand", "N. Zealand");
}

function splitTitle(title: string) {
  const parts = title.split(/\s+vs\s+/i);
  if (parts.length === 2) return [shortTeamName(parts[0]), shortTeamName(parts[1])] as const;
  const scoreParts = title.match(/^(.+?)\s+\d+\s*-\s*\d+\s+(.+)$/);
  if (scoreParts) return [shortTeamName(scoreParts[1]), shortTeamName(scoreParts[2])] as const;
  return [title, "Mundial Lab"] as const;
}

type CountryVisual = {
  name: string;
  colors: [string, string, string];
  symbol: "star" | "sun" | "cross" | "circle" | "stripe";
  motif: "tricolor" | "textile" | "radial" | "chevron" | "crossgrid" | "dotfield";
};

const countryVisuals: Record<string, CountryVisual> = {
  France: { name: "France", colors: ["#0055a4", "#ffffff", "#ef4135"], symbol: "stripe", motif: "tricolor" },
  Senegal: { name: "Senegal", colors: ["#00853f", "#fdef42", "#e31b23"], symbol: "star", motif: "textile" },
  Mexico: { name: "Mexico", colors: ["#006847", "#ffffff", "#ce1126"], symbol: "sun", motif: "radial" },
  "S. Africa": { name: "South Africa", colors: ["#007a4d", "#ffb81c", "#de3831"], symbol: "stripe", motif: "chevron" },
  Korea: { name: "South Korea", colors: ["#ffffff", "#c60c30", "#003478"], symbol: "circle", motif: "radial" },
  Germany: { name: "Germany", colors: ["#000000", "#dd0000", "#ffce00"], symbol: "stripe", motif: "tricolor" },
  Spain: { name: "Spain", colors: ["#aa151b", "#f1bf00", "#aa151b"], symbol: "sun", motif: "radial" },
  Argentina: { name: "Argentina", colors: ["#75aadb", "#ffffff", "#fcbf49"], symbol: "sun", motif: "radial" },
  Brazil: { name: "Brazil", colors: ["#009b3a", "#ffdf00", "#002776"], symbol: "circle", motif: "chevron" },
  Uruguay: { name: "Uruguay", colors: ["#ffffff", "#0038a8", "#fcd116"], symbol: "sun", motif: "tricolor" },
  Portugal: { name: "Portugal", colors: ["#006600", "#ff0000", "#ffcc00"], symbol: "circle", motif: "tricolor" },
  England: { name: "England", colors: ["#ffffff", "#ce1124", "#1f2937"], symbol: "cross", motif: "crossgrid" },
  Croatia: { name: "Croatia", colors: ["#ff0000", "#ffffff", "#171796"], symbol: "stripe", motif: "dotfield" },
  Japan: { name: "Japan", colors: ["#ffffff", "#bc002d", "#111827"], symbol: "circle", motif: "radial" },
  Netherlands: { name: "Netherlands", colors: ["#ae1c28", "#ffffff", "#21468b"], symbol: "stripe", motif: "tricolor" },
  Tunisia: { name: "Tunisia", colors: ["#e70013", "#ffffff", "#e70013"], symbol: "circle", motif: "radial" },
  Iran: { name: "Iran", colors: ["#239f40", "#ffffff", "#da0000"], symbol: "stripe", motif: "textile" },
  "N. Zealand": { name: "New Zealand", colors: ["#00247d", "#cc142b", "#ffffff"], symbol: "star", motif: "dotfield" },
  Belgium: { name: "Belgium", colors: ["#000000", "#fae042", "#ed2939"], symbol: "stripe", motif: "tricolor" },
  Egypt: { name: "Egypt", colors: ["#ce1126", "#ffffff", "#000000"], symbol: "sun", motif: "tricolor" },
  Qatar: { name: "Qatar", colors: ["#8a1538", "#ffffff", "#8a1538"], symbol: "stripe", motif: "chevron" },
  Canada: { name: "Canada", colors: ["#ff0000", "#ffffff", "#ff0000"], symbol: "star", motif: "radial" },
  Scotland: { name: "Scotland", colors: ["#005eb8", "#ffffff", "#005eb8"], symbol: "cross", motif: "crossgrid" },
  Morocco: { name: "Morocco", colors: ["#c1272d", "#006233", "#f9fafb"], symbol: "star", motif: "textile" },
};

function countryVisualFor(name: string): CountryVisual {
  return countryVisuals[name] ?? {
    name,
    colors: ["#071118", "#facc15", "#67e8f9"],
    symbol: "circle",
    motif: "dotfield",
  };
}

function publicUrl(path: string) {
  return `https://mundial.hadox.org${path}`;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexLuma(hex: string) {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.slice(0, 2), 16) / 255;
  const g = Number.parseInt(clean.slice(2, 4), 16) / 255;
  const b = Number.parseInt(clean.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function scoreRecipe(recipe: VisualRecipe) {
  const lumas = [recipe.palette.bgA, recipe.palette.bgB, recipe.palette.bgC].map(hexLuma);
  const avg = lumas.reduce((sum, value) => sum + value, 0) / lumas.length;
  const spread = Math.max(...lumas) - Math.min(...lumas);
  const accentContrast = Math.abs(hexLuma(recipe.palette.accent) - Math.min(...lumas));
  const brightPenalty = avg > 0.34 ? (avg - 0.34) * 4 : 0;
  const muddyPenalty = spread < 0.12 ? (0.12 - spread) * 3 : 0;
  return accentContrast * 2.4 + spread * 1.8 + recipe.density * 0.35 - brightPenalty - muddyPenalty;
}

function recipeFor(moment: SocialMoment, variantOffset = 0): VisualRecipe {
  const seed = hashString(`${moment.id}:${moment.kind}:${moment.sourceLabel}:${variantOffset}`);
  const paletteBank = {
    next: [
      ["#06121f", "#0f766e", "#1d4ed8", "#facc15", "#67e8f9", "rgba(250, 204, 21, 0.5)"],
      ["#08111f", "#0e7490", "#312e81", "#fb7185", "#bef264", "rgba(103, 232, 249, 0.44)"],
      ["#071118", "#166534", "#0f172a", "#f97316", "#7ee2a8", "rgba(249, 115, 22, 0.42)"],
    ],
    match: [
      ["#061118", "#0f766e", "#0f172a", "#7ee2a8", "#facc15", "rgba(126, 226, 168, 0.45)"],
      ["#070b1d", "#155e75", "#4c1d95", "#bef264", "#f97316", "rgba(94, 234, 212, 0.42)"],
      ["#0b1020", "#14532d", "#1e1b4b", "#f8fafc", "#facc15", "rgba(250, 204, 21, 0.38)"],
    ],
    data: [
      ["#06152a", "#075985", "#1e1b4b", "#67e8f9", "#facc15", "rgba(103, 232, 249, 0.44)"],
      ["#041512", "#0f766e", "#172554", "#bef264", "#38bdf8", "rgba(56, 189, 248, 0.4)"],
      ["#0f172a", "#164e63", "#312e81", "#f8fafc", "#f472b6", "rgba(244, 114, 182, 0.38)"],
    ],
    autopsy: [
      ["#111827", "#9f1239", "#075985", "#facc15", "#a7f3d0", "rgba(250, 204, 21, 0.42)"],
      ["#1e1b4b", "#6d28d9", "#0f766e", "#f8fafc", "#facc15", "rgba(196, 181, 253, 0.4)"],
      ["#120b18", "#be123c", "#0f172a", "#fb7185", "#67e8f9", "rgba(251, 113, 133, 0.42)"],
    ],
    daily_groups: [
      ["#071118", "#0f766e", "#155e75", "#facc15", "#a7f3d0", "rgba(20, 184, 166, 0.42)"],
      ["#082f49", "#14532d", "#0f172a", "#fde047", "#67e8f9", "rgba(253, 224, 71, 0.4)"],
      ["#111827", "#166534", "#1e3a8a", "#f8fafc", "#f97316", "rgba(249, 115, 22, 0.38)"],
    ],
    champion_pulse: [
      ["#0f172a", "#7f1d1d", "#4c1d95", "#facc15", "#67e8f9", "rgba(250, 204, 21, 0.48)"],
      ["#071118", "#92400e", "#0f766e", "#fff7ed", "#facc15", "rgba(251, 191, 36, 0.45)"],
      ["#120b18", "#1e40af", "#be123c", "#f8fafc", "#a7f3d0", "rgba(248, 250, 252, 0.35)"],
    ],
  } as const;
  const paletteSource = paletteBank[moment.kind];
  const layouts: VisualRecipe["layout"][] = moment.kind === "autopsy" || moment.kind === "champion_pulse"
    ? ["heatmap", "ticker", "stadium"]
    : moment.kind === "data" || moment.kind === "daily_groups"
      ? ["ticker", "heatmap", "bracket"]
      : moment.kind === "next"
        ? ["stadium", "bracket", "heatmap"]
        : ["stadium", "ticker", "heatmap"];
  const posters: VisualRecipe["poster"][] = ["split", "arena", "radar"];
  const candidates = Array.from({ length: 18 }, (_, index) => {
    const random = seededRandom(seed + index * 7919);
    const selected = paletteSource[Math.floor(random() * paletteSource.length)];
    return {
      variant: (seed + index * 137) % 10000,
      palette: {
        bgA: selected[0],
        bgB: selected[1],
        bgC: selected[2],
        accent: selected[3],
        accent2: selected[4],
        glow: selected[5],
      },
      tilt: (random() - 0.5) * 0.18,
      density: 0.72 + random() * 0.5,
      layout: layouts[Math.floor(random() * layouts.length)],
      poster: posters[Math.floor(random() * posters.length)],
    };
  });
  return candidates.sort((a, b) => scoreRecipe(b) - scoreRecipe(a))[variantOffset % candidates.length];
}

function houseAutopsyCaption(entry: LearningLogEntry) {
  const score = `${entry.home_team} ${entry.home_score}-${entry.away_score} ${entry.away_team}`;
  const call = bermudezCall(entry);
  const evolution = houseEvolutionLine(entry);
  return [
    `Ufff. The house has a new autopsy: ${score}.`,
    "",
    call,
    evolution,
    "",
    "This is not a director model. This is the master Monte Carlo line learning from the tournament.",
    `Real outcome: ${entryOutcome(entry)}.`,
    `What the house learned: ${entry.lesson}`,
    "",
    `House autopsy: ${publicUrl(`/diario-aprendizaje/?match=${entry.slug}&model=${entry.best_model}`)}`,
    `Monte Carlo board: ${publicUrl("/montecarlo-casa/")}`,
    "",
    "#MundialLab #MonteCarlo #FootballAnalytics #WorldCup",
  ].join("\n");
}

function matchCaption(match: Match, entry?: LearningLogEntry, line?: HouseMatchLine, evolution?: HouseLineEvolution) {
  const score = `${match.home_team} ${match.home_score}-${match.away_score} ${match.away_team}`;
  if (entry || line || evolution) return houseResultCaption(match, entry, line, evolution);
  return [
    `Final whistle, and the lab opens the hood: ${score}.`,
    "",
    "This is where the fun starts: the result stops being a score and becomes evidence for Monte Carlo de la casa.",
    "",
    `Match room: ${publicUrl(`/partidos/${match.slug}/`)}`,
    `Monte Carlo board: ${publicUrl("/montecarlo-casa/")}`,
    "",
    "#MundialLab #MonteCarlo #WorldCup",
  ].join("\n");
}

function nextCaption(match: Match) {
  return [
    `Here comes the next one: ${match.home_team} vs ${match.away_team}.`,
    "",
    "Monte Carlo de la casa already put a number on the pitch. This is the master line before the ball rolls.",
    "",
    "Before kickoff it is prediction. After the final whistle it becomes autopsy. That is where the house learns and the story grows.",
    "",
    `Match room: ${publicUrl(`/partidos/${match.slug}/`)}`,
    `Monte Carlo line: ${publicUrl("/montecarlo-casa/")}`,
    "",
    "#MundialLab #MonteCarlo #FootballAnalytics",
  ].join("\n");
}

function dailyEditorialCaption(editorial: HouseDailyEditorial) {
  if (editorial.kind === "champion_pulse") {
    return [
      `Title pulse: ${editorial.title}.`,
      "",
      editorial.detail,
      editorial.model_signal,
      "",
      "Monte Carlo does not crown anyone yet. It runs the World Cup again and again, then tells us who has the cleanest path right now.",
      "",
      `Full board: ${publicUrl(editorial.href)}`,
      "",
      "#MundialLab #MonteCarlo #WorldCup #FootballAnalytics",
    ].join("\n");
  }
  return [
    `End-of-day group close: ${editorial.day}.`,
    "",
    editorial.detail,
    editorial.model_result,
    "",
    "Real points are the scoreboard. Projected points are the current Monte Carlo closing read.",
    editorial.model_signal,
    "",
    `Full board: ${publicUrl(editorial.href)}`,
    "",
    "#MundialLab #MonteCarlo #DataScience #WorldCup",
  ].join("\n");
}

function buildMoments(
  matches: Match[],
  entries: LearningLogEntry[],
  quality: DataQualitySummary | null,
  houseBoard: HouseMatchBoard | null,
  evolution: HouseLineEvolution[],
  dailyEditorials: HouseDailyEditorial[],
): SocialMoment[] {
  const moment = getTournamentMoment(matches);
  const houseLineBySlug = new Map((houseBoard?.lines ?? []).map((line) => [line.slug, line]));
  const evolutionBySlug = new Map(evolution.map((item) => [item.slug, item]));
  const latestEntryBySlug = new Map<string, LearningLogEntry>();
  [...entries]
    .filter(isHouseAutopsy)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .forEach((entry) => {
      if (!latestEntryBySlug.has(entry.slug)) latestEntryBySlug.set(entry.slug, entry);
    });
  const finished = [...matches]
    .filter((match) => match.status === "finished")
    .sort((a, b) => b.match_number - a.match_number);
  const autopsies = [...entries]
    .filter(isHouseAutopsy)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((entry) => ({
      id: `house-autopsy-${entry.id}`,
      kind: "autopsy" as const,
      title: `${entry.home_team} ${entry.home_score}-${entry.away_score} ${entry.away_team}`,
      eyebrow: "Casa Monte Carlo",
      subtitle: `Before and after: ${entryOutcome(entry)}`,
      detail: bermudezCall(entry),
      metric: `${entryLift(entry) >= 0 ? "+" : ""}${pct(entryLift(entry))}`,
      accent: "house movement",
      href: `/diario-aprendizaje/?match=${entry.slug}&model=${entry.best_model}`,
      caption: houseAutopsyCaption(entry),
      sourceLabel: "monte-carlo-casa",
      modelSignal: houseEvolutionLine(entry),
      modelResult: `${pct(entryProbability(entry))} house read`,
    }));

  const matchMoments = finished.map((match) => {
    const entry = latestEntryBySlug.get(match.slug);
    const line = houseLineBySlug.get(match.slug);
    const movement = evolutionBySlug.get(match.slug);
    return {
      id: `match-${match.id}`,
      kind: "match" as const,
      title: `${match.home_team} ${match.home_score}-${match.away_score} ${match.away_team}`,
      eyebrow: "Final whistle",
      subtitle: match.result_trust_level === "real_verificado" ? "Verified score" : "Ingested score",
      detail: entry ? bermudezCall(entry) : houseEvolutionSignal(movement) || "The result is in the lab. Now the line has to explain itself.",
      metric: movement?.movement == null ? `#${match.match_number}` : `${movement.movement >= 0 ? "+" : ""}${pct(movement.movement)}`,
      accent: match.stage,
      href: `/partidos/${match.slug}/`,
      caption: matchCaption(match, entry, line, movement),
      sourceLabel: "casa-monte-carlo",
      modelSignal: entry ? houseEvolutionLine(entry) : houseEvolutionSignal(movement) || houseLineSignal(line),
      modelResult: entry ? `${pct(entryProbability(entry))} house read` : movement?.latest.outcome_probability ? `${pct(movement.latest.outcome_probability)} on truth` : houseLineResult(line),
    };
  });

  const next = moment.nextMatch
    ? [{
        id: `next-${moment.nextMatch.id}`,
        kind: "next" as const,
        title: `${moment.nextMatch.home_team} vs ${moment.nextMatch.away_team}`,
        eyebrow: "Next challenge",
        subtitle: matchMomentLabel(moment.nextMatch),
        detail: "La casa ya puso su lectura previa. Despues del resultado, esa misma linea se vuelve autopsia.",
        metric: "Challenge",
        accent: moment.nextMatch.venue,
        href: `/partidos/${moment.nextMatch.slug}/`,
        caption: nextCaption(moment.nextMatch),
        sourceLabel: "programado",
        modelSignal: houseLineSignal(houseLineBySlug.get(moment.nextMatch.slug)),
        modelResult: houseLineResult(houseLineBySlug.get(moment.nextMatch.slug)),
      }]
    : [];

  const data = quality?.recent_jobs[0]
    ? [{
        id: `data-${quality.recent_jobs[0].job_type}-${quality.recent_jobs[0].finished_at}`,
        kind: "data" as const,
        title: "El laboratorio se actualizo",
        eyebrow: "Ingesta automatica",
        subtitle: quality.recent_jobs[0].job_type,
        detail: `${quality.recent_jobs[0].source} added ${quality.recent_jobs[0].rows_inserted} new rows to the board.`,
        metric: String(quality.recent_jobs[0].rows_inserted),
        accent: "rows",
        href: "/laboratorio-datos/",
        caption: [
          "Mundial Lab is not frozen: the automated ingest just moved the board.",
          "",
          `${quality.recent_jobs[0].job_type}: ${quality.recent_jobs[0].rows_inserted} rows from ${quality.recent_jobs[0].source}.`,
          `Data lab: ${publicUrl("/laboratorio-datos/")}`,
          "",
          "#MundialLab #DataEngineering #FootballAnalytics",
        ].join("\n"),
        sourceLabel: "data",
        modelSignal: `Ingest: ${quality.recent_jobs[0].rows_inserted} rows from ${quality.recent_jobs[0].source}`,
        modelResult: `${quality.recent_jobs[0].rows_inserted} rows`,
      }]
    : [];

  const daily = dailyEditorials.map((editorial) => ({
    id: `${editorial.kind}-${editorial.id}`,
    kind: editorial.kind,
    title: editorial.title,
    eyebrow: editorial.eyebrow,
    subtitle: editorial.subtitle,
    detail: editorial.detail,
    metric: editorial.metric,
    accent: editorial.kind === "champion_pulse" ? "title race" : "daily close",
    href: editorial.href,
    caption: dailyEditorialCaption(editorial),
    sourceLabel: editorial.kind,
    modelSignal: editorial.model_signal,
    modelResult: editorial.model_result,
  }));

  return [...daily, ...next, ...autopsies, ...matchMoments];
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 5,
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((item, index) => ctx.fillText(item, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function drawContrastPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  accent: string,
  alpha = 0.9,
) {
  ctx.save();
  ctx.fillStyle = `rgba(7, 17, 24, ${alpha})`;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(x + 12, y + 12, width - 24, Math.max(2, height * 0.18));
  ctx.restore();
}

function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill = "#fffaf0",
  stroke = "#071118",
  lineWidth = 8,
) {
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawPitch(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(recipe.tilt);
  ctx.transform(1, -0.08, 0.14, 1, 0, 0);
  ctx.translate(-width / 2, -height / 2);
  ctx.shadowColor = recipe.palette.glow;
  ctx.shadowBlur = 18;
  const pitch = ctx.createLinearGradient(0, 0, width, height);
  pitch.addColorStop(0, "rgba(13, 148, 136, 0.84)");
  pitch.addColorStop(0.52, "rgba(22, 163, 74, 0.72)");
  pitch.addColorStop(1, "rgba(15, 23, 42, 0.88)");
  ctx.fillStyle = pitch;
  ctx.roundRect(0, 0, width, height, 18);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = Math.max(3, width * 0.006);
  ctx.strokeRect(width * 0.05, height * 0.08, width * 0.9, height * 0.84);
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.4;
  for (let lane = 1; lane < 8; lane += 1) {
    ctx.beginPath();
    ctx.moveTo(width * 0.05, height * (0.08 + lane * 0.105));
    ctx.lineTo(width * 0.95, height * (0.08 + lane * 0.105));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.86)";
  ctx.lineWidth = Math.max(3, width * 0.006);
  ctx.beginPath();
  ctx.moveTo(width / 2, height * 0.08);
  ctx.lineTo(width / 2, height * 0.92);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, height * 0.16, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 12; i += 1) {
    const px = width * (0.12 + ((i * 37 + recipe.variant) % 76) / 100);
    const py = height * (0.17 + ((i * 53 + recipe.variant) % 66) / 100);
    ctx.fillStyle = i % 2 ? recipe.palette.accent : recipe.palette.accent2;
    ctx.shadowColor = i % 2 ? recipe.palette.accent : recipe.palette.accent2;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(px, py, width * 0.035, height * 0.12, width * 0.018);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.5, height * 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDigitalGrid(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = "rgba(255,255,255,0.11)";
  ctx.lineWidth = 2;
  for (let x = -80; x < width + 120; x += 72) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + height * 0.2, height);
    ctx.stroke();
  }
  for (let y = 40; y < height; y += 88) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + Math.sin((y + recipe.variant) * 0.01) * 28);
    ctx.stroke();
  }
  ctx.strokeStyle = recipe.palette.accent;
  ctx.globalAlpha = 0.34;
  for (let i = 0; i < 12; i += 1) {
    const x = (i * 97 + recipe.variant * 3) % width;
    const y = (i * 151 + recipe.variant * 5) % height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 80, y);
    ctx.lineTo(x + 80, y + 42);
    ctx.lineTo(x + 142, y + 42);
    ctx.stroke();
    ctx.fillStyle = i % 2 ? recipe.palette.accent : recipe.palette.accent2;
    ctx.beginPath();
    ctx.arc(x + 142, y + 42, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHeatmap(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 24 * recipe.density; i += 1) {
    const x = ((i * 193 + recipe.variant * 7) % width);
    const y = ((i * 127 + recipe.variant * 11) % height);
    const radius = 110 + ((i * 29) % 190);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, i % 3 === 0 ? "rgba(250, 204, 21, 0.38)" : "rgba(103, 232, 249, 0.34)");
    glow.addColorStop(0.48, recipe.palette.glow);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.restore();
}

function drawPosterMarks(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = recipe.palette.accent;
  ctx.lineWidth = 7;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.arc(width * (0.84 - i * 0.03), height * (0.18 + i * 0.05), 72 + i * 48, 0.18, Math.PI * 1.55);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = recipe.palette.accent;
  ctx.beginPath();
  ctx.moveTo(width * 0.06, height * 0.08);
  ctx.lineTo(width * 0.42, height * 0.08);
  ctx.lineTo(width * 0.35, height * 0.12);
  ctx.lineTo(width * 0.06, height * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = recipe.palette.accent2;
  ctx.beginPath();
  ctx.moveTo(width * 0.72, height * 0.86);
  ctx.lineTo(width * 0.96, height * 0.79);
  ctx.lineTo(width * 0.96, height * 0.88);
  ctx.lineTo(width * 0.76, height * 0.93);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGlassPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  stroke: string,
) {
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, "rgba(3, 7, 18, 0.9)");
  gradient.addColorStop(0.5, "rgba(7, 17, 24, 0.72)");
  gradient.addColorStop(1, "rgba(15, 23, 42, 0.88)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function drawTeamDuel(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe, home: string, away: string) {
  ctx.save();
  const top = height * 0.12;
  const bottom = height * 0.58;
  ctx.fillStyle = "rgba(2,6,23,0.42)";
  ctx.fillRect(0, top, width, bottom - top);
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = recipe.palette.bgB;
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(width * 0.68, top);
  ctx.lineTo(width * 0.46, bottom);
  ctx.lineTo(0, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = recipe.palette.bgC;
  ctx.beginPath();
  ctx.moveTo(width, top);
  ctx.lineTo(width * 0.42, top);
  ctx.lineTo(width * 0.62, bottom);
  ctx.lineTo(width, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = recipe.palette.accent;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(width * 0.5, top + 12);
  ctx.lineTo(width * 0.5, bottom - 18);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(2,6,23,0.8)";
  ctx.shadowBlur = 16;
  ctx.font = `950 ${Math.max(54, width * 0.075)}px Arial`;
  drawWrappedText(ctx, home.toUpperCase(), width * 0.08, top + 120, width * 0.36, width * 0.08, 2);
  ctx.textAlign = "right";
  drawWrappedText(ctx, away.toUpperCase(), width * 0.92, top + 120, width * 0.36, width * 0.08, 2);
  ctx.textAlign = "left";
  ctx.shadowBlur = 0;

  ctx.fillStyle = recipe.palette.accent;
  ctx.beginPath();
  ctx.arc(width * 0.5, top + (bottom - top) * 0.5, 92, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#071118";
  ctx.font = "950 68px Arial";
  ctx.textAlign = "center";
  ctx.fillText("VS", width * 0.5, top + (bottom - top) * 0.5 + 24);
  ctx.textAlign = "left";
  ctx.restore();
}

function drawSignalBoard(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, recipe: VisualRecipe) {
  drawGlassPanel(ctx, x, y, width, height, 24, recipe.palette.accent);
  ctx.save();
  ctx.strokeStyle = recipe.palette.accent2;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.85;
  const mid = y + height * 0.56;
  ctx.beginPath();
  ctx.moveTo(x + 34, mid);
  for (let i = 0; i < 15; i += 1) {
    const px = x + 34 + i * ((width - 68) / 14);
    const py = mid - Math.sin((i + recipe.variant) * 0.92) * height * 0.24 - (i % 4) * 5;
    ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = recipe.palette.accent;
  for (let i = 0; i < 9; i += 1) {
    const px = x + 44 + i * ((width - 88) / 8);
    const barHeight = height * (0.16 + ((i * 31 + recipe.variant) % 52) / 100);
    ctx.fillRect(px, y + height - 42 - barHeight, 14, barHeight);
  }
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "900 22px Arial";
  ctx.fillText("MODEL SIGNALS", x + 26, y + 42);
  ctx.restore();
}

function drawDataMatrix(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, recipe: VisualRecipe) {
  ctx.save();
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const active = ((row * 17 + col * 31 + recipe.variant) % 5) < 2;
      ctx.fillStyle = active ? recipe.palette.accent : "rgba(255,255,255,0.13)";
      ctx.fillRect(x + col * cell, y + row * cell, cell * 0.72, cell * 0.72);
    }
  }
  ctx.restore();
}

function drawPowerRibbon(ctx: CanvasRenderingContext2D, width: number, y: number, text: string, recipe: VisualRecipe) {
  ctx.save();
  ctx.fillStyle = recipe.palette.accent;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y - 34);
  ctx.lineTo(width, y + 64);
  ctx.lineTo(0, y + 98);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#071118";
  ctx.font = "950 36px Arial";
  ctx.fillText(text.toUpperCase(), 54, y + 48);
  ctx.restore();
}

function drawBracketMarks(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 4;
  const startX = width * 0.12;
  const topY = height * 0.18;
  const gap = height * 0.09;
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 5 - col; row += 1) {
      const x = startX + col * width * 0.19;
      const y = topY + row * gap * (col + 1);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width * 0.12, y);
      ctx.lineTo(x + width * 0.12, y + gap * 0.5);
      ctx.lineTo(x + width * 0.18, y + gap * 0.5);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = recipe.palette.accent;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(width * 0.15, height * 0.72);
  ctx.bezierCurveTo(width * 0.34, height * 0.58, width * 0.52, height * 0.82, width * 0.8, height * 0.44);
  ctx.stroke();
  ctx.restore();
}

function drawTickerLines(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.strokeStyle = recipe.palette.accent;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 3;
  for (let i = 0; i < 12; i += 1) {
    const y = height * (0.16 + i * 0.06);
    ctx.beginPath();
    ctx.moveTo(width * 0.08, y);
    for (let x = width * 0.08; x < width * 0.94; x += 42) {
      ctx.lineTo(x, y + Math.sin((x + recipe.variant) * 0.014 + i) * 22);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawInkCloud(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 18; i += 1) {
    const x = ((recipe.variant * 47 + i * 173) % width);
    const y = ((recipe.variant * 83 + i * 119) % height);
    const radius = width * (0.12 + ((i * 23) % 19) / 100);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, i % 2 ? recipe.palette.accent : recipe.palette.accent2);
    glow.addColorStop(0.28, recipe.palette.glow);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.22 + (i % 5) * 0.035;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * (1 + (i % 3) * 0.24), radius * (0.42 + (i % 4) * 0.09), recipe.tilt + i * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHalftoneField(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const step = Math.max(22, width * 0.032);
  for (let y = height * 0.1; y < height * 0.92; y += step) {
    for (let x = width * 0.06; x < width * 0.94; x += step) {
      const wave = Math.sin((x + recipe.variant) * 0.011) + Math.cos((y - recipe.variant) * 0.013);
      const radius = Math.max(1.4, (wave + 2.2) * step * 0.08);
      ctx.globalAlpha = 0.08 + Math.max(0, wave) * 0.035;
      ctx.fillStyle = (Math.floor(x / step) + Math.floor(y / step)) % 2 ? recipe.palette.accent : recipe.palette.accent2;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawDataBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(recipe.tilt * 3);
  ctx.globalCompositeOperation = "screen";
  const ball = ctx.createRadialGradient(-radius * 0.25, -radius * 0.3, 0, 0, 0, radius);
  ball.addColorStop(0, "rgba(255,255,255,0.94)");
  ball.addColorStop(0.28, recipe.palette.accent2);
  ball.addColorStop(0.74, recipe.palette.bgB);
  ball.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = Math.max(4, radius * 0.025);
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * (0.24 + i * 0.1), radius * 0.92, i * 0.32, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = recipe.palette.accent;
  ctx.globalAlpha = 0.72;
  for (let i = 0; i < 10; i += 1) {
    ctx.beginPath();
    ctx.arc(0, 0, radius * (0.22 + i * 0.075), Math.PI * 0.08, Math.PI * 1.72);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTornStrips(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  const strips = [
    { y: height * 0.18, h: height * 0.09, color: recipe.palette.accent },
    { y: height * 0.62, h: height * 0.13, color: recipe.palette.bgB },
    { y: height * 0.82, h: height * 0.06, color: recipe.palette.accent2 },
  ];
  strips.forEach((strip, index) => {
    ctx.save();
    ctx.translate(width * 0.5, strip.y);
    ctx.rotate(recipe.tilt * 2 + (index - 1) * 0.12);
    ctx.globalAlpha = index === 1 ? 0.46 : 0.82;
    ctx.fillStyle = strip.color;
    ctx.beginPath();
    ctx.moveTo(-width * 0.62, -strip.h * 0.4);
    for (let i = 0; i <= 12; i += 1) {
      const x = -width * 0.62 + (width * 1.24 * i) / 12;
      const y = -strip.h * 0.45 + Math.sin(i * 1.7 + recipe.variant) * strip.h * 0.16;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width * 0.62, strip.h * 0.45);
    for (let i = 12; i >= 0; i -= 1) {
      const x = -width * 0.62 + (width * 1.24 * i) / 12;
      const y = strip.h * 0.45 + Math.cos(i * 1.2 + recipe.variant) * strip.h * 0.18;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();
}

function drawConcertPaper(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  const paper = ctx.createLinearGradient(0, 0, width, height);
  paper.addColorStop(0, "#fff4d6");
  paper.addColorStop(0.38, "#f9d94a");
  paper.addColorStop(0.66, recipe.palette.accent);
  paper.addColorStop(1, "#e11d48");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.2;
  ctx.fillStyle = "#071118";
  for (let y = 0; y < height; y += 9) {
    ctx.fillRect(0, y, width, 2);
  }
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 520; i += 1) {
    const x = (i * 47 + recipe.variant * 13) % width;
    const y = (i * 83 + recipe.variant * 7) % height;
    ctx.fillRect(x, y, i % 5 === 0 ? 4 : 2, i % 7 === 0 ? 4 : 2);
  }
  ctx.restore();
}

function drawStageLights(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(3,7,18,0.2)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const colors = ["#facc15", "#22d3ee", "#fb7185", "#a3e635", recipe.palette.accent2];
  for (let i = 0; i < 9; i += 1) {
    const cx = width * (0.05 + i * 0.115);
    const cy = height * (0.02 + (i % 3) * 0.04);
    const beam = ctx.createLinearGradient(cx, cy, width * (0.2 + ((i * 19 + recipe.variant) % 65) / 100), height * 0.84);
    beam.addColorStop(0, colors[i % colors.length]);
    beam.addColorStop(0.55, "rgba(255,255,255,0.08)");
    beam.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(cx - width * 0.035, cy);
    ctx.lineTo(cx + width * 0.035, cy);
    ctx.lineTo(width * (0.12 + ((i * 31 + recipe.variant) % 76) / 100), height * 0.92);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawCountrySymbol(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, profile: CountryVisual, fill = "#071118") {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(3, size * 0.08);
  if (profile.symbol === "star") {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 ? size * 0.38 : size * 0.82;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  } else if (profile.symbol === "sun") {
    for (let i = 0; i < 16; i += 1) {
      ctx.rotate(Math.PI / 8);
      ctx.beginPath();
      ctx.moveTo(size * 0.35, -size * 0.06);
      ctx.lineTo(size * 0.84, 0);
      ctx.lineTo(size * 0.35, size * 0.06);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
    ctx.fill();
  } else if (profile.symbol === "cross") {
    ctx.fillRect(-size * 0.14, -size * 0.74, size * 0.28, size * 1.48);
    ctx.fillRect(-size * 0.74, -size * 0.14, size * 1.48, size * 0.28);
  } else if (profile.symbol === "stripe") {
    for (let i = 0; i < 4; i += 1) {
      ctx.fillRect(-size * 0.72, -size * 0.48 + i * size * 0.3, size * 1.44, size * 0.12);
    }
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.65, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCountryMotif(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  profile: CountryVisual,
  recipe: VisualRecipe,
  mirror = false,
) {
  const seed = hashString(`${profile.name}:${recipe.variant}:${profile.motif}`);
  const random = seededRandom(seed);
  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate((mirror ? -1 : 1) * (recipe.tilt + (random() - 0.5) * 0.18));
  ctx.translate(-width / 2, -height / 2);
  ctx.globalAlpha = 0.82;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, 18);
  ctx.clip();

  if (profile.motif === "tricolor") {
    profile.colors.forEach((color, index) => {
      ctx.fillStyle = color;
      const bandW = width / 3;
      ctx.fillRect(index * bandW, 0, bandW + 2, height);
    });
    ctx.strokeStyle = "rgba(7,17,24,0.55)";
    ctx.lineWidth = 5;
    for (let i = 0; i < 8; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-width * 0.1, i * height * 0.16);
      ctx.lineTo(width * 1.1, i * height * 0.16 - height * 0.28);
      ctx.stroke();
    }
  } else if (profile.motif === "textile") {
    ctx.fillStyle = profile.colors[0];
    ctx.fillRect(0, 0, width, height);
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const color = profile.colors[(row + col + Math.floor(random() * 3)) % profile.colors.length];
        ctx.fillStyle = color;
        ctx.beginPath();
        const cx = (col + 0.5) * (width / 9);
        const cy = (row + 0.5) * (height / 9);
        const r = Math.min(width, height) * (0.035 + random() * 0.035);
        if ((row + col + seed) % 2) {
          ctx.rect(cx - r, cy - r, r * 2, r * 2);
        } else {
          ctx.moveTo(cx, cy - r * 1.6);
          ctx.lineTo(cx + r * 1.6, cy);
          ctx.lineTo(cx, cy + r * 1.6);
          ctx.lineTo(cx - r * 1.6, cy);
          ctx.closePath();
        }
        ctx.fill();
      }
    }
  } else if (profile.motif === "radial") {
    const gradient = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, width * 0.65);
    gradient.addColorStop(0, profile.colors[1]);
    gradient.addColorStop(0.52, profile.colors[0]);
    gradient.addColorStop(1, profile.colors[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(7,17,24,0.72)";
    ctx.lineWidth = 7;
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2 + recipe.tilt;
      ctx.beginPath();
      ctx.moveTo(width * 0.5, height * 0.5);
      ctx.lineTo(width * 0.5 + Math.cos(angle) * width, height * 0.5 + Math.sin(angle) * width);
      ctx.stroke();
    }
  } else if (profile.motif === "chevron") {
    ctx.fillStyle = profile.colors[0];
    ctx.fillRect(0, 0, width, height);
    for (let i = -2; i < 9; i += 1) {
      ctx.strokeStyle = profile.colors[(i + 4) % profile.colors.length];
      ctx.lineWidth = height * 0.08;
      ctx.beginPath();
      ctx.moveTo(width * 0.08, i * height * 0.16);
      ctx.lineTo(width * 0.5, i * height * 0.16 + height * 0.18);
      ctx.lineTo(width * 0.92, i * height * 0.16);
      ctx.stroke();
    }
  } else if (profile.motif === "crossgrid") {
    ctx.fillStyle = profile.colors[0];
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = profile.colors[1];
    ctx.lineWidth = height * 0.08;
    ctx.beginPath();
    ctx.moveTo(width * 0.5, 0);
    ctx.lineTo(width * 0.5, height);
    ctx.moveTo(0, height * 0.5);
    ctx.lineTo(width, height * 0.5);
    ctx.stroke();
    ctx.strokeStyle = profile.colors[2];
    ctx.lineWidth = 3;
    for (let i = 0; i < 10; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * width * 0.11, 0);
      ctx.lineTo(i * width * 0.11 - width * 0.24, height);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = profile.colors[0];
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 85; i += 1) {
      ctx.fillStyle = profile.colors[i % profile.colors.length];
      ctx.globalAlpha = 0.45 + random() * 0.45;
      ctx.beginPath();
      ctx.arc(random() * width, random() * height, 3 + random() * 13, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 0.9;
  drawCountrySymbol(ctx, width * (mirror ? 0.28 : 0.72), height * 0.5, Math.min(width, height) * 0.22, profile, "rgba(7,17,24,0.88)");
  ctx.restore();
}

function drawCountryFusion(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe, home: CountryVisual, away: CountryVisual) {
  ctx.save();
  drawCountryMotif(ctx, width * 0.04, height * 0.13, width * 0.44, height * 0.34, home, recipe);
  drawCountryMotif(ctx, width * 0.52, height * 0.17, width * 0.44, height * 0.34, away, recipe, true);

  const bandY = height * 0.36;
  const bandH = height * 0.2;
  const colors = [...home.colors, ...away.colors];
  colors.forEach((color, index) => {
    ctx.save();
    ctx.translate(width * 0.5, bandY + index * bandH * 0.12);
    ctx.rotate(recipe.tilt * 1.2 + (index - 2.5) * 0.035);
    ctx.globalAlpha = 0.86;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-width * 0.68, -bandH * 0.34);
    ctx.lineTo(width * 0.68, -bandH * 0.5 + Math.sin(index + recipe.variant) * 18);
    ctx.lineTo(width * 0.7, bandH * 0.05);
    ctx.lineTo(-width * 0.66, bandH * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  ctx.globalCompositeOperation = "multiply";
  drawCountrySymbol(ctx, width * 0.19, height * 0.52, width * 0.12, home, "#071118");
  drawCountrySymbol(ctx, width * 0.84, height * 0.5, width * 0.12, away, "#071118");
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(7,17,24,0.9)";
  ctx.fillRect(width * 0.08, height * 0.5, width * 0.84, height * 0.055);
  ctx.fillStyle = "#fff4d6";
  ctx.font = `950 ${Math.max(18, width * 0.029)}px Arial Black, Arial`;
  ctx.fillText(`${home.name.toUpperCase()}  X  ${away.name.toUpperCase()}`, width * 0.105, height * 0.537);
  ctx.restore();
}

function drawScreenprintSun(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#071118";
  for (let i = 0; i < 32; i += 1) {
    ctx.rotate((Math.PI * 2) / 32);
    ctx.beginPath();
    ctx.moveTo(radius * 0.22, -radius * 0.018);
    ctx.lineTo(radius * 1.48, -radius * 0.06);
    ctx.lineTo(radius * 1.48, radius * 0.06);
    ctx.lineTo(radius * 0.22, radius * 0.018);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = recipe.palette.accent2;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = "#071118";
  ctx.lineWidth = Math.max(4, radius * 0.035);
  for (let r = radius * 0.18; r < radius * 0.92; r += radius * 0.16) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGigCutout(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe, y: number, color: string, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-width * 0.04, y);
  for (let i = 0; i <= 18; i += 1) {
    const x = -width * 0.04 + (width * 1.08 * i) / 18;
    const jitter = Math.sin(i * 1.9 + recipe.variant * 0.01) * height * 0.012;
    ctx.lineTo(x, y + jitter);
  }
  ctx.lineTo(width * 1.04, y + height * 0.13);
  for (let i = 18; i >= 0; i -= 1) {
    const x = -width * 0.04 + (width * 1.08 * i) / 18;
    const jitter = Math.cos(i * 1.4 + recipe.variant * 0.02) * height * 0.014;
    ctx.lineTo(x, y + height * 0.13 + jitter);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTicketStamp(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, text: string, recipe: VisualRecipe) {
  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(-0.06 + recipe.tilt * 0.8);
  ctx.translate(-width / 2, -height / 2);
  ctx.fillStyle = "#071118";
  ctx.strokeStyle = recipe.palette.accent2;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = recipe.palette.accent2;
  ctx.font = `950 ${Math.max(28, width * 0.1)}px Arial`;
  ctx.fillText(text.toUpperCase(), 24, height * 0.44);
  ctx.fillStyle = "#fff4d6";
  ctx.font = `900 ${Math.max(16, width * 0.044)}px Arial`;
  ctx.fillText("MUNDIAL LAB PRESENTS", 24, height * 0.74);
  ctx.globalAlpha = 0.32;
  for (let i = 0; i < 8; i += 1) {
    ctx.beginPath();
    ctx.arc(width - 16, 18 + i * 18, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCrowdSilhouette(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.fillStyle = "#071118";
  const base = height * 0.88;
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, base);
  for (let i = 0; i <= 40; i += 1) {
    const x = (width * i) / 40;
    const y = base - (18 + ((i * 37 + recipe.variant) % 84));
    ctx.lineTo(x, y);
    ctx.lineTo(x + width / 80, base - ((i * 19 + recipe.variant) % 38));
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = recipe.palette.accent;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.74;
  for (let i = 0; i < 14; i += 1) {
    const x = (i * 83 + recipe.variant) % width;
    const y = base - 30 - ((i * 31 + recipe.variant) % 70);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.sin(i) * 28, y - 70);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBigGigTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  baseSize: number,
  lineHeight: number,
) {
  const words = text.toUpperCase().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    ctx.font = `950 ${baseSize}px Arial Black, Arial`;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  const visible = lines.slice(0, 5);
  ctx.save();
  ctx.fillStyle = "rgba(7,17,24,0.88)";
  ctx.beginPath();
  ctx.roundRect(x - 18, y - baseSize * 0.78, maxWidth + 36, visible.length * lineHeight + baseSize * 0.18, 16);
  ctx.fill();
  ctx.restore();
  visible.forEach((line, index) => {
    const yy = y + index * lineHeight;
    ctx.strokeStyle = "#071118";
    ctx.lineWidth = Math.max(7, baseSize * 0.07);
    ctx.strokeText(line, x, yy);
    ctx.fillStyle = "#fffaf0";
    ctx.fillText(line, x, yy);
  });
  return y + visible.length * lineHeight;
}

function drawIsometricLines(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe) {
  ctx.save();
  ctx.translate(width * 0.5, height * 0.53);
  ctx.rotate(recipe.tilt);
  ctx.transform(1, -0.12, 0.2, 1, 0, 0);
  ctx.translate(-width * 0.5, -height * 0.53);
  ctx.strokeStyle = "rgba(255,255,255,0.34)";
  ctx.lineWidth = Math.max(2, width * 0.003);
  const x = width * 0.08;
  const y = height * 0.28;
  const w = width * 0.84;
  const h = height * 0.36;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h / 2, h * 0.18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = recipe.palette.accent;
  for (let i = 0; i < 18; i += 1) {
    ctx.beginPath();
    const sx = x + ((i * 53 + recipe.variant) % Math.floor(w));
    const sy = y + ((i * 31 + recipe.variant) % Math.floor(h));
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(sx + w * 0.12, sy - h * 0.14, sx + w * 0.32, sy + h * 0.16, sx + w * 0.5, sy - h * 0.04);
    ctx.stroke();
  }
  ctx.restore();
}

function artCopyFor(moment: SocialMoment) {
  if (moment.kind === "next") {
    return {
      eyebrow: "BEFORE KICKOFF",
      headline: "The prediction has entered the pitch.",
      proof: "The match has not started yet. The line already carries tension, data and a reading to challenge.",
      cta: "TAKE A STANCE",
    };
  }
  if (moment.kind === "autopsy") {
    return {
      eyebrow: "MODEL AUTOPSY",
      headline: "The data goes back to the locker room.",
      proof: "After the score, the model shows what it saw, what it missed and what it learned for the next match.",
      cta: "READ THE AUTOPSY",
    };
  }
  if (moment.kind === "data") {
    return {
      eyebrow: "LIVE INGEST",
      headline: "The World Cup feeds the model.",
      proof: "Every data load moves the lab: schedule, results, quality, signals and tournament memory.",
      cta: "OPEN THE LOG",
    };
  }
  if (moment.kind === "daily_groups") {
    return {
      eyebrow: "END OF DAY",
      headline: "The table changed. The projection answered.",
      proof: "Real points show the scoreboard. Monte Carlo shows how the group would close if the tournament kept rolling from here.",
      cta: "SEE THE BOARD",
    };
  }
  if (moment.kind === "champion_pulse") {
    return {
      eyebrow: "TITLE PULSE",
      headline: "The trophy has a new gravitational pull.",
      proof: "Thousands of tournament paths are speaking at once. One team is carrying the cleanest road right now.",
      cta: "OPEN MONTE CARLO",
    };
  }
  return {
    eyebrow: "FINAL WHISTLE",
    headline: "The score has spoken. Now the model speaks.",
    proof: "The ball left a fixed result. The question is how close the prediction really was.",
    cta: "OPEN THE MATCH",
  };
}

function drawEditorialScene(ctx: CanvasRenderingContext2D, width: number, height: number, recipe: VisualRecipe, moment: SocialMoment, homeName: string, awayName: string) {
  drawHeatmap(ctx, width, height, recipe);
  drawDigitalGrid(ctx, width, height, recipe);
  drawPosterMarks(ctx, width, height, recipe);

  if (moment.kind === "next") {
    drawTeamDuel(ctx, width, height, recipe, homeName, awayName);
    drawPitch(ctx, width * 0.16, height * 0.42, width * 0.68, height * 0.22, recipe);
    return;
  }
  if (moment.kind === "autopsy") {
    drawSignalBoard(ctx, width * 0.13, height * 0.28, width * 0.74, height * 0.24, recipe);
    drawTickerLines(ctx, width, height, recipe);
    return;
  }
  if (moment.kind === "data") {
    drawDataMatrix(ctx, width * 0.58, height * 0.2, 18, recipe);
    drawBracketMarks(ctx, width, height, recipe);
    return;
  }
  if (moment.kind === "daily_groups") {
    drawDataMatrix(ctx, width * 0.58, height * 0.2, 20, recipe);
    drawTickerLines(ctx, width, height, recipe);
    return;
  }
  if (moment.kind === "champion_pulse") {
    drawSignalBoard(ctx, width * 0.16, height * 0.26, width * 0.68, height * 0.26, recipe);
    drawBracketMarks(ctx, width, height, recipe);
    return;
  }
  if (recipe.layout === "bracket") {
    drawBracketMarks(ctx, width, height, recipe);
  } else if (recipe.layout === "ticker") {
    drawTickerLines(ctx, width, height, recipe);
  } else {
    drawPitch(ctx, width * 0.1, height * 0.28, width * 0.8, height * 0.32, recipe);
  }
}

function generateSocialCanvas(moment: SocialMoment, format: CardFormat, variantOffset = 0) {
  const size = formats[format];
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible.");

  const recipe = recipeFor(moment, variantOffset);
  const [homeName, awayName] = splitTitle(moment.title);
  const homeVisual = countryVisualFor(homeName);
  const awayVisual = countryVisualFor(awayName);
  const copy = artCopyFor(moment);
  const margin = format === "story" ? 70 : 58;
  const contentWidth = size.width - margin * 2;
  drawConcertPaper(ctx, size.width, size.height, recipe);
  drawStageLights(ctx, size.width, size.height, recipe);
  drawHalftoneField(ctx, size.width, size.height, recipe);
  drawInkCloud(ctx, size.width, size.height, recipe);
  drawCountryFusion(ctx, size.width, size.height, recipe, homeVisual, awayVisual);

  drawGigCutout(ctx, size.width, size.height, recipe, size.height * 0.08, "#071118", 0.95);
  drawGigCutout(ctx, size.width, size.height, recipe, size.height * 0.31, recipe.palette.accent2, 0.88);
  drawGigCutout(ctx, size.width, size.height, recipe, size.height * 0.57, "#071118", 0.92);
  drawGigCutout(ctx, size.width, size.height, recipe, size.height * 0.75, recipe.palette.accent, 0.9);

  if ((recipe.variant + homeVisual.name.length + awayVisual.name.length) % 4 === 0) {
    drawScreenprintSun(ctx, size.width * 0.78, size.height * 0.23, size.width * (format === "story" ? 0.14 : 0.11), recipe);
  }
  drawDataBall(ctx, size.width * 0.24, size.height * 0.69, size.width * 0.13, recipe);
  drawIsometricLines(ctx, size.width, size.height, recipe);
  drawCrowdSilhouette(ctx, size.width, size.height, recipe);

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(7,17,24,0.12)";
  for (let i = 0; i < 12; i += 1) {
    ctx.beginPath();
    ctx.moveTo((i * size.width) / 10, 0);
    ctx.lineTo((i * size.width) / 10 + size.width * 0.18, size.height);
    ctx.lineTo((i * size.width) / 10 + size.width * 0.1, size.height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const topY = margin;
  drawContrastPlate(ctx, margin - 24, topY - 26, contentWidth * 0.78, format === "story" ? 106 : 92, recipe.palette.accent2, 0.76);
  ctx.fillStyle = recipe.palette.accent2;
  ctx.font = "950 30px Arial Black, Arial";
  drawOutlinedText(ctx, "MUNDIAL LAB", margin, topY + 24, recipe.palette.accent2, "#071118", 5);
  ctx.fillStyle = "#fff4d6";
  ctx.font = "900 22px Arial Black, Arial";
  drawOutlinedText(ctx, copy.eyebrow, margin, topY + 56, "#fff4d6", "#071118", 5);

  ctx.font = `950 ${format === "story" ? 28 : 23}px Arial Black, Arial`;
  drawOutlinedText(ctx, "HYPOTHESIS / DATA / UNCERTAINTY", margin, topY + 88, recipe.palette.accent2, "#071118", 5);

  const headlineY = format === "story" ? size.height * 0.22 : size.height * 0.2;
  const titleBottom = drawBigGigTitle(ctx, copy.headline, margin, headlineY, contentWidth * 0.92, format === "story" ? 100 : 74, format === "story" ? 92 : 70);

  ctx.font = `950 ${format === "story" ? 54 : 43}px Arial Black, Arial`;
  const teamTitleY = titleBottom + 34;
  drawContrastPlate(ctx, margin - 18, teamTitleY - 42, contentWidth * 0.94, format === "story" ? 126 : 106, recipe.palette.accent, 0.76);
  ctx.fillStyle = recipe.palette.accent;
  drawWrappedText(ctx, moment.title.toUpperCase(), margin, teamTitleY, contentWidth * 0.88, format === "story" ? 58 : 48, 2);

  const signalHeight = format === "story" ? 172 : 142;
  const signalY = Math.max(teamTitleY + (format === "story" ? 126 : 108) + 18, size.height * (format === "story" ? 0.49 : 0.48));
  drawContrastPlate(ctx, margin, signalY, contentWidth * 0.88, signalHeight, recipe.palette.accent2, 0.88);
  ctx.fillStyle = recipe.palette.accent2;
  ctx.font = `950 ${format === "story" ? 25 : 21}px Arial Black, Arial`;
  ctx.fillText("MODEL RESULT", margin + 24, signalY + 32);
  ctx.font = `950 ${format === "story" ? 48 : 38}px Arial Black, Arial`;
  drawOutlinedText(ctx, moment.modelResult.toUpperCase(), margin + 24, signalY + (format === "story" ? 88 : 76), "#fffaf0", "#071118", 7);
  ctx.fillStyle = "#fffaf0";
  ctx.font = `900 ${format === "story" ? 25 : 21}px Arial`;
  drawWrappedText(ctx, moment.modelSignal, margin + 24, signalY + (format === "story" ? 126 : 108), contentWidth * 0.78, format === "story" ? 30 : 25, 2);

  const ticketY = Math.max(signalY + signalHeight + 28, size.height * (format === "story" ? 0.64 : 0.62));
  drawTicketStamp(
    ctx,
    margin,
    ticketY,
    contentWidth * 0.64,
    format === "story" ? 148 : 124,
    copy.cta,
    recipe,
  );

  ctx.save();
  const proofY = Math.max(ticketY + (format === "story" ? 166 : 140), size.height * (format === "story" ? 0.735 : 0.71));
  drawContrastPlate(ctx, margin - 20, proofY - 26, contentWidth * 0.92, format === "story" ? 178 : 148, recipe.palette.accent, 0.78);
  ctx.fillStyle = "#fff4d6";
  ctx.font = `900 ${format === "story" ? 31 : 26}px Arial`;
  drawWrappedText(ctx, copy.proof, margin, proofY + 18, contentWidth * 0.82, format === "story" ? 38 : 32, 4);
  ctx.restore();

  ctx.save();
  ctx.translate(margin, size.height - margin - 88);
  ctx.fillStyle = "#071118";
  ctx.fillRect(0, 0, contentWidth, 70);
  ctx.fillStyle = recipe.palette.accent2;
  ctx.font = "950 24px Arial Black, Arial";
  ctx.fillText(`WORK ${recipe.variant}`, 22, 28);
  ctx.fillStyle = "#fff4d6";
  ctx.font = "800 21px Arial";
  ctx.fillText(`mundial.hadox.org${moment.href}`, 22, 55);
  ctx.restore();

  return canvas;
}

function canvasToFile(canvas: HTMLCanvasElement, name: string) {
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not generate the image."));
        return;
      }
      resolve(new File([blob], name, { type: "image/png" }));
    }, "image/png");
  });
}

function downloadImage(dataUrl: string, name: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = name;
  link.click();
}

function AdminSocialRoomPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [entries, setEntries] = useState<LearningLogEntry[]>([]);
  const [quality, setQuality] = useState<DataQualitySummary | null>(null);
  const [houseBoard, setHouseBoard] = useState<HouseMatchBoard | null>(null);
  const [evolution, setEvolution] = useState<HouseLineEvolution[]>([]);
  const [dailyEditorials, setDailyEditorials] = useState<HouseDailyEditorial[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [format, setFormat] = useState<CardFormat>("story");
  const [image, setImage] = useState("");
  const [variantOffset, setVariantOffset] = useState(0);
  const [message, setMessage] = useState("Choose a moment and generate a publish-ready piece.");
  const [shareCounts, setShareCounts] = useState<ShareCounts>(() => readShareCounts());
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    fetchMatches().then(setMatches).catch(() => setMatches([]));
    fetchLearningLog(500).then(setEntries).catch(() => setEntries([]));
    fetchPublicDataQuality().then(setQuality).catch(() => setQuality(null));
    fetchHouseEvolution().then(setEvolution).catch(() => setEvolution([]));
    fetchHouseDailyEditorials().then(setDailyEditorials).catch(() => setDailyEditorials([]));
    fetchSocialPublications(700)
      .then((records) => {
        const remoteCounts = Object.fromEntries(
          records
            .filter((record) => (record.share_count ?? 0) > 0 || ["published", "manual_shared", "deleted"].includes(record.status))
            .map((record) => [record.source_id, Math.max(1, record.share_count ?? 0)]),
        );
        const merged = { ...remoteCounts, ...readShareCounts() };
        writeShareCounts(merged);
        setShareCounts(merged);
      })
      .catch(() => undefined);
    fetchLatestHouseBoard()
      .then((board) => {
        if (board) {
          setHouseBoard(board);
          return;
        }
        return runHouseMatchBoard({
          simulations: 2500,
          seed: 2026,
          use_stadium: true,
          use_fixed_results: true,
          use_xg: true,
          scenario: "social-room-fallback",
        }).then(setHouseBoard);
      })
      .catch(() => setHouseBoard(null));
  }, []);

  const moments = useMemo(
    () => buildMoments(matches, entries, quality, houseBoard, evolution, dailyEditorials),
    [matches, entries, quality, houseBoard, evolution, dailyEditorials],
  );
  const selected = moments.find((moment) => moment.id === selectedId) ?? moments[0];
  const momentState = getTournamentMoment(matches);
  const selectedShareCount = selected ? shareCounts[selected.id] ?? 0 : 0;
  const autoParams = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const sourceId = params.get("autoSocialSource") || "";
    if (!sourceId) return null;
    return {
      sourceId,
      publish: ["1", "true", "yes"].includes((params.get("autoPublish") || "").toLowerCase()),
      token: params.get("adminToken") || "",
      variant: Number.parseInt(params.get("variant") || "0", 10) || 0,
    };
  }, []);

  useEffect(() => {
    if (!selectedId && moments[0]) setSelectedId(moments[0].id);
  }, [moments, selectedId]);

  useEffect(() => {
    if (!autoParams || !moments.length) return;
    if (autoParams.token) {
      window.localStorage.setItem("mundial_lab_admin_token", autoParams.token);
    }
    setFormat("square");
    setVariantOffset(autoParams.variant);
    setSelectedId(autoParams.sourceId);
  }, [autoParams, moments.length]);

  const generate = (target = selected, targetFormat = format) => {
    if (!target) return;
    const canvas = generateSocialCanvas(target, targetFormat, variantOffset);
    setImage(canvas.toDataURL("image/png"));
    setMessage(`${formats[targetFormat].label} artwork ready for ${target.title}.`);
  };

  const copyCaption = async () => {
    if (!selected) return;
    await navigator.clipboard?.writeText(selected.caption);
    setMessage("Caption copied.");
  };

  const download = () => {
    if (!selected || !image) return;
    downloadImage(image, `${selected.id}-${format}-mundial-lab.png`);
  };

  const generateAll = () => {
    if (!selected) return;
    (Object.keys(formats) as CardFormat[]).forEach((item) => {
      const canvas = generateSocialCanvas(selected, item, variantOffset);
      downloadImage(canvas.toDataURL("image/png"), `${selected.id}-${item}-mundial-lab.png`);
    });
    setMessage("Downloaded story, post and square for the selected moment.");
  };

  const nextVariant = () => {
    setVariantOffset((value) => value + 1);
    setImage("");
    setMessage("New variant ready to generate.");
  };

  const recordShare = async (moment: SocialMoment, imageUrl = "") => {
    const stored = readShareCounts();
    const momentId = moment.id;
    const nextCount = (stored[momentId] ?? shareCounts[momentId] ?? 0) + 1;
    const next = { ...shareCounts, ...stored, [momentId]: nextCount };
    writeShareCounts(next);
    setShareCounts(next);
    try {
      const saved = await recordSocialShare({
        source_id: moment.id,
        source_kind: moment.kind,
        title: moment.title,
        caption: moment.caption,
        image_url: imageUrl,
      });
      const serverCount = Math.max(nextCount, saved.share_count ?? 0);
      const synced = { ...next, [momentId]: serverCount };
      writeShareCounts(synced);
      setShareCounts(synced);
      return serverCount;
    } catch {
      setMessage("Shared locally, but the backend share counter did not answer.");
    }
    return nextCount;
  };

  const shareMoment = async () => {
    if (!selected) return;
    const canvas = generateSocialCanvas(selected, format, variantOffset);
    const file = await canvasToFile(canvas, `${selected.id}-${format}-mundial-lab.png`);
    const shareData = {
      title: selected.title,
      text: selected.caption,
      url: publicUrl(selected.href),
      files: [file],
    };
    const shareNavigator = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (shareNavigator.share && (!shareNavigator.canShare || shareNavigator.canShare({ files: [file] }))) {
      await shareNavigator.share(shareData);
      const count = await recordShare(selected, canvas.toDataURL("image/png"));
      setMessage(`Shared from this device ${count} time${count === 1 ? "" : "s"}.`);
      return;
    }
    if (shareNavigator.share) {
      await shareNavigator.share({ title: selected.title, text: selected.caption, url: publicUrl(selected.href) });
      const count = await recordShare(selected);
      setMessage(`Shared as link and caption. Count saved: ${count}.`);
      return;
    }
    await navigator.clipboard?.writeText(selected.caption);
    downloadImage(canvas.toDataURL("image/png"), `${selected.id}-${format}-mundial-lab.png`);
    const count = await recordShare(selected, canvas.toDataURL("image/png"));
    setMessage(`Native sharing is not available: copied the caption, downloaded the image and saved count ${count}.`);
  };

  const saveApprovedArtwork = async (publish = false) => {
    if (!selected) return;
    if (publish && selectedShareCount > 0) {
      setMessage("This moment is already marked as shared. I will not publish a duplicate.");
      return;
    }
    setPublishing(true);
    try {
      const canvas = generateSocialCanvas(selected, format, variantOffset);
      const imageData = canvas.toDataURL("image/png");
      setImage(imageData);
      const saved = await saveSocialArtwork({
        source_id: selected.id,
        source_kind: selected.kind,
        title: selected.title,
        caption: selected.caption,
        image_data: imageData,
        publish,
      });
      if (saved.status === "published") {
        await recordShare(selected, saved.image_url || "");
        setMessage("Published to Instagram with the Social Room artwork and marked as shared.");
      } else if (saved.status === "manual_shared") {
        setMessage("This moment was already shared manually; publication was blocked to avoid a duplicate.");
      } else {
        setMessage("Approved artwork saved in the backend. It is ready for controlled publication.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the approved artwork.");
    } finally {
      setPublishing(false);
    }
  };

  useEffect(() => {
    if (!autoParams || !selected || selected.id !== autoParams.sourceId) return;
    let cancelled = false;
    const run = async () => {
      try {
        const canvas = generateSocialCanvas(selected, "square", autoParams.variant);
        const imageData = canvas.toDataURL("image/png");
        const saved = await saveSocialArtwork({
          source_id: selected.id,
          source_kind: selected.kind,
          title: selected.title,
          caption: selected.caption,
          image_data: imageData,
          publish: autoParams.publish,
        });
        if (cancelled) return;
        window.__MUNDIAL_SOCIAL_RENDER_RESULT__ = {
          ok: true,
          source_id: selected.id,
          status: saved.status,
          image_url: saved.image_url,
          instagram_post_id: saved.instagram_post_id,
        };
        setImage(imageData);
        setMessage(autoParams.publish ? "Auto-rendered and published with Social Room artwork." : "Auto-rendered and saved with Social Room artwork.");
      } catch (error) {
        if (cancelled) return;
        window.__MUNDIAL_SOCIAL_RENDER_RESULT__ = {
          ok: false,
          source_id: selected.id,
          error: error instanceof Error ? error.message : "Auto-render failed.",
        };
        setMessage(error instanceof Error ? error.message : "Auto-render failed.");
      }
    };
    const timer = window.setTimeout(run, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autoParams, selected]);

  return (
    <main>
      <nav className="nav page-nav" aria-label="Main navigation">
        <a className="brand" href="/">
          <Trophy size={22} />
          <span>Mundial Lab</span>
        </a>
        <div className="nav-links">
          <a href="/admin/live-control/">Admin</a>
          <a href="/diario-aprendizaje/">Learning Log</a>
          <a href="/partidos/">Matches</a>
          <a href="/montecarlo-casa/">Monte Carlo</a>
        </div>
      </nav>

      <section className="social-room-hero">
        <div>
          <p className="section-kicker">Cabina social de la casa</p>
          <h1>Publica la historia de Monte Carlo partido por partido.</h1>
          <p>
            Linea previa, marcador real, autopsia de la casa y cuanto se movio la lectura
            despues del silbatazo. Esta cabina es para el master, sin ruido de directores.
          </p>
        </div>
        <aside>
          <Instagram size={30} />
          <strong>{moments.length}</strong>
          <span>posts de la casa</span>
          <small>{momentState.latestFinished ? `Latest final: ${momentState.latestFinished.home_team} vs ${momentState.latestFinished.away_team}` : "Waiting for finals"}</small>
        </aside>
      </section>

      <section className="social-room-grid">
        <aside className="social-moment-list">
          <div className="workflow-title">
            <Flame />
            <h2>Archivo Monte Carlo</h2>
          </div>
          <p>Orden editorial: proximo partido, autopsias de la casa y marcadores que esperan autopsia.</p>
          <div className="social-moment-scroll">
            {moments.map((moment) => (
              <button className={selected?.id === moment.id ? "active" : ""} key={moment.id} onClick={() => { setSelectedId(moment.id); setImage(""); }} type="button">
                <span>{moment.eyebrow}</span>
                <strong>{moment.title}</strong>
                <small>{moment.subtitle}</small>
                <em className={(shareCounts[moment.id] ?? 0) > 0 ? "social-share-count is-shared" : "social-share-count"}>
                  {(shareCounts[moment.id] ?? 0) > 0 ? `${shareCounts[moment.id]} shares` : "not shared yet"}
                </em>
              </button>
            ))}
            {!moments.length && <p>No moments loaded from the API yet.</p>}
          </div>
        </aside>

        <section className="social-builder">
          {selected ? (
            <>
              <div className="social-builder-head">
                <div>
                  <p className="section-kicker">{selected.eyebrow}</p>
                  <h2>{selected.title}</h2>
                  <p>{selected.detail}</p>
                  <small className={selectedShareCount > 0 ? "social-selected-counter is-shared" : "social-selected-counter"}>
                    {selectedShareCount > 0
                      ? `Shared ${selectedShareCount} time${selectedShareCount === 1 ? "" : "s"} from this device`
                      : "Not shared from this device yet"}
                  </small>
                </div>
                <div className="social-format-switch">
                  {(Object.entries(formats) as [CardFormat, { label: string }][])
                    .map(([key, value]) => (
                      <button className={format === key ? "active" : ""} key={key} onClick={() => { setFormat(key); setImage(""); }} type="button">
                        {value.label}
                      </button>
                    ))}
                </div>
              </div>

              <div className="social-actions">
                <button onClick={() => generate()} type="button">
                  <ImageDown size={16} />
                  Create artwork
                </button>
                <button onClick={nextVariant} type="button">
                  <Shuffle size={16} />
                  New variant
                </button>
                <button onClick={shareMoment} type="button">
                  <Share2 size={16} />
                  Share
                </button>
                <button disabled={publishing} onClick={() => saveApprovedArtwork(false)} type="button">
                  <ImageDown size={16} />
                  Save approved
                </button>
                <button disabled={publishing || selectedShareCount > 0} onClick={() => saveApprovedArtwork(true)} type="button">
                  <Instagram size={16} />
                  Publish approved
                </button>
                <button onClick={generateAll} type="button">
                  <Download size={16} />
                  Download 3 formats
                </button>
                <button onClick={copyCaption} type="button">
                  <Clipboard size={16} />
                  Copy caption
                </button>
                <a href={selected.href}>
                  <Newspaper size={16} />
                  Open source
                </a>
              </div>
              <small className="social-message">{message}</small>

              <div className="social-preview-layout">
                <div className={`social-preview ${format}`}>
                  {image ? (
                      <img alt={`Social artwork for ${selected.title}`} src={image} />
                  ) : (
                    <div>
                      <Instagram size={34} />
                      <strong>{formats[format].label}</strong>
                      <p>Generate the artwork to preview it here.</p>
                    </div>
                  )}
                </div>
                <label className="suggested-copy social-caption-box">
                  <span>Suggested caption</span>
                  <textarea readOnly value={selected.caption} />
                  <button onClick={copyCaption} type="button">Copy caption</button>
                  <button onClick={shareMoment} type="button">Share artwork and caption</button>
                  <button disabled={publishing} onClick={() => saveApprovedArtwork(false)} type="button">Save approved artwork</button>
                  <button disabled={publishing || selectedShareCount > 0} onClick={() => saveApprovedArtwork(true)} type="button">Publish approved artwork</button>
                  <button disabled={!image} onClick={download} type="button">Download current image</button>
                </label>
              </div>
            </>
          ) : (
            <article className="social-empty">
              <Radio />
              <h2>Esperando material de la casa.</h2>
              <p>Cuando la API cargue lineas, resultados o autopsias Monte Carlo, el archivo aparece aqui.</p>
            </article>
          )}
        </section>
      </section>

      <section className="social-playbook">
        <article>
          <CalendarClock />
          <strong>Antes del partido</strong>
          <p>Publica la linea previa: que vio Monte Carlo antes de que ruede la pelota.</p>
        </article>
        <article>
          <Radio />
          <strong>Al silbatazo final</strong>
          <p>Publica que el marcador ya entro al laboratorio y que la casa tiene que explicar su lectura.</p>
        </article>
        <article>
          <Flame />
          <strong>Cuando cae autopsia</strong>
          <p>Publica el crescendo: probabilidad antes, probabilidad despues y cuanto aprendio Monte Carlo.</p>
        </article>
      </section>

      <SiteFooter />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<AdminSocialRoomPage />);
