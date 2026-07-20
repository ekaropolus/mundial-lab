import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import { ChevronRight, Gauge, History, ImageDown, Move, RotateCcw, Share2, Trophy, ZoomIn, ZoomOut } from "lucide-react";
import { SiteFooter } from "../components/SiteFooter";
import { loadHouseHistory, saveHouseHistory } from "../lib/houseHistory";
import { fetchLatestHouseBoard, runHouseMatchBoard } from "../lib/api";
import { teamFlag } from "../lib/teamVisuals";
import { HouseMatchBoard, HouseMatchLine } from "../types";
import "../styles.css";

const DEFAULT_ZOOM = 0.78;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.35;

type ProjectedBracketLine = {
  home: string;
  away: string;
  winner: string;
  loser: string;
  winnerProbability: number;
};

function pct(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function savedAtLabel(value?: string) {
  if (!value) return "corrida automatica";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function phaseLabel(phase: string, stage: string) {
  if (phase === "grupos") return stage;
  return stage || "Eliminacion";
}

function lineTone(line: HouseMatchLine) {
  if (line.status === "finished") return "is-fixed";
  if (line.status === "live" || line.status === "halftime") return "is-live";
  if (line.confidence >= 0.62) return "is-strong";
  return "is-open";
}

function projectedHome(line: HouseMatchLine) {
  if (line.phase === "grupos") return line.home_team;
  return line.projected_home ?? slotDisplay(line.home_team);
}

function projectedAway(line: HouseMatchLine) {
  if (line.phase === "grupos") return line.away_team;
  return line.projected_away ?? slotDisplay(line.away_team);
}

function sameTeam(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sourceMatchNumber(slot: string, prefix: "winner-match-" | "loser-match-") {
  return slot.startsWith(prefix) ? Number(slot.replace(prefix, "")) : null;
}

function projectedSide(slot: string, fallback: string, projected: Map<number, ProjectedBracketLine>) {
  const winnerSource = sourceMatchNumber(slot, "winner-match-");
  if (winnerSource) return projected.get(winnerSource)?.winner ?? fallback;
  const loserSource = sourceMatchNumber(slot, "loser-match-");
  if (loserSource) return projected.get(loserSource)?.loser ?? fallback;
  return fallback;
}

function groupCodeFromStage(stage: string) {
  return stage.replace("Grupo", "").trim().toUpperCase();
}

function groupCodeFromSlot(slot: string) {
  const match = slot.match(/^group-([a-z])-/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function eligibleThirdGroups(slot: string) {
  return slot
    .replace(/^group-/i, "")
    .replace(/-third-place$/i, "")
    .split("-")
    .map((item) => item.toUpperCase())
    .filter(Boolean);
}

function buildProjectedGroups(lines: HouseMatchLine[]) {
  const groupLines = new Map<string, HouseMatchLine[]>();
  for (const line of lines) {
    if (line.phase !== "grupos") continue;
    const code = groupCodeFromStage(line.stage);
    groupLines.set(code, [...(groupLines.get(code) ?? []), line]);
  }
  const ranked = new Map<string, GroupStanding[]>();
  for (const [code, items] of groupLines) {
    ranked.set(code, buildGroupTable(items));
  }
  return ranked;
}

function resolveProjectedGroupSlot(slot: string, rankedGroups: Map<string, GroupStanding[]>, usedThirds: Set<string>) {
  if (slot.startsWith("group-") && slot.endsWith("-winners")) {
    return rankedGroups.get(groupCodeFromSlot(slot))?.[0];
  }
  if (slot.startsWith("group-") && slot.endsWith("-runners-up")) {
    return rankedGroups.get(groupCodeFromSlot(slot))?.[1];
  }
  if (slot.startsWith("group-") && slot.endsWith("-third-place")) {
    const eligible = new Set(eligibleThirdGroups(slot));
    const thirdPool = Array.from(rankedGroups.values())
      .map((group) => group[2])
      .filter((team): team is GroupStanding => Boolean(team))
      .sort((a, b) => {
        const expected = b.expectedPoints - a.expectedPoints;
        if (Math.abs(expected) > 0.01) return expected;
        return b.topSignal - a.topSignal;
      });
    const selected = thirdPool.find((team) => eligible.has(groupCodeForTeam(team.teamId, rankedGroups)) && !usedThirds.has(team.teamId))
      ?? thirdPool.find((team) => !usedThirds.has(team.teamId));
    if (selected) usedThirds.add(selected.teamId);
    return selected;
  }
  return undefined;
}

function groupCodeForTeam(teamId: string, rankedGroups: Map<string, GroupStanding[]>) {
  for (const [code, teams] of rankedGroups) {
    if (teams.some((team) => team.teamId === teamId)) return code;
  }
  return "";
}

function coherentSlotLabel(slot: string, fallback: string, projected: Map<number, ProjectedBracketLine>, rankedGroups: Map<string, GroupStanding[]>, usedThirds: Set<string>) {
  const fromGroup = resolveProjectedGroupSlot(slot, rankedGroups, usedThirds);
  if (fromGroup) return fromGroup.team;
  return projectedSide(slot, fallback, projected);
}

function buildBracketProjection(lines: HouseMatchLine[]) {
  const projected = new Map<number, ProjectedBracketLine>();
  const rankedGroups = buildProjectedGroups(lines);
  const usedThirds = new Set<string>();
  const ordered = [...lines].filter((line) => line.phase !== "grupos").sort((a, b) => a.match_number - b.match_number);

  for (const line of ordered) {
    const home = coherentSlotLabel(line.home_team_id, projectedHome(line), projected, rankedGroups, usedThirds);
    const away = coherentSlotLabel(line.away_team_id, projectedAway(line), projected, rankedGroups, usedThirds);
    const favoriteIsHome = sameTeam(line.favorite, home);
    const favoriteIsAway = sameTeam(line.favorite, away);
    const homeLeads = line.home_win >= line.away_win;
    const winner = favoriteIsHome ? home : favoriteIsAway ? away : homeLeads ? home : away;
    const loser = sameTeam(winner, home) ? away : home;
    const winnerProbability = favoriteIsHome || favoriteIsAway ? line.confidence : homeLeads ? line.home_win : line.away_win;
    projected.set(line.match_number, { home, away, winner, loser, winnerProbability });
  }

  return projected;
}

function isFinishedLine(line: HouseMatchLine) {
  return line.status === "finished";
}

function lineWinner(line: HouseMatchLine, home: string, away: string) {
  const homeScore = line.home_score ?? 0;
  const awayScore = line.away_score ?? 0;
  if (homeScore > awayScore) return home;
  if (awayScore > homeScore) return away;
  if (line.winner_team) return line.winner_team;
  return line.favorite || "Empate";
}

function lineScore(line: HouseMatchLine) {
  return `${line.home_score ?? 0}-${line.away_score ?? 0}`;
}

function buildHouseShareText({
  board,
  line,
  home,
  away,
  favorite,
  confidence,
  shareUrl,
}: {
  board: HouseMatchBoard;
  line: HouseMatchLine;
  home: string;
  away: string;
  favorite: string;
  confidence: number;
  shareUrl: string;
}) {
  return [
    "Monte Carlo ya puso linea para este partido.",
    "",
    `${home} vs ${away}`,
    `Lectura: ${favorite}`,
    `Linea: ${pct(line.home_win)} local${line.phase === "grupos" ? ` · ${pct(line.draw)} empate` : ""} · ${pct(line.away_win)} visita`,
    `Confianza: ${pct(confidence)}`,
    `Corrida: ${board.run_id} · ${board.simulations.toLocaleString("es-MX")} simulaciones · seed ${board.seed}`,
    "",
    "Data Directors: pueden ganarle a esta linea?",
    shareUrl,
    "",
    "#MundialLab #WorldCup #MonteCarlo #FootballAnalytics",
  ].join("\n");
}

function stageOrder(stage: string) {
  const order = ["Ronda de 32", "Octavos de final", "Cuartos de final", "Semifinal", "Tercer lugar", "Final"];
  const index = order.findIndex((item) => stage.includes(item));
  return index === -1 ? 99 : index;
}

function compactPct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function slotDisplay(label: string) {
  return label
    .replace(/^Winner Match /, "Ganador M")
    .replace(/^Loser Match /, "Perdedor M")
    .replace(/^Group /, "")
    .replace(" winners", " #1")
    .replace(" runners-up", " #2")
    .replace(" third place", " #3");
}

function slotSubLabel(line: HouseMatchLine, side: "home" | "away") {
  const label = side === "home" ? line.home_team : line.away_team;
  if (line.phase === "grupos") return "";
  const displayed = side === "home" ? projectedHome(line) : projectedAway(line);
  const subLabel = slotDisplay(label);
  return sameTeam(subLabel, displayed) ? "" : subLabel;
}

const TEAM_CODES: Record<string, string> = {
  algeria: "DZ",
  argentina: "AR",
  australia: "AU",
  austria: "AT",
  belgium: "BE",
  "bosnia-and-herzegovina": "BA",
  brazil: "BR",
  canada: "CA",
  "cape-verde": "CV",
  colombia: "CO",
  croatia: "HR",
  curacao: "CW",
  "czech-republic": "CZ",
  "dr-congo": "CD",
  ecuador: "EC",
  egypt: "EG",
  england: "EN",
  france: "FR",
  germany: "DE",
  ghana: "GH",
  haiti: "HT",
  iran: "IR",
  iraq: "IQ",
  "ivory-coast": "CI",
  japan: "JP",
  jordan: "JO",
  mexico: "MX",
  morocco: "MA",
  netherlands: "NL",
  "new-zealand": "NZ",
  norway: "NO",
  panama: "PA",
  paraguay: "PY",
  portugal: "PT",
  qatar: "QA",
  "saudi-arabia": "SA",
  scotland: "SCO",
  senegal: "SN",
  "south-africa": "ZA",
  "south-korea": "KR",
  spain: "ES",
  sweden: "SE",
  switzerland: "CH",
  tunisia: "TN",
  turkey: "TR",
  "united-states": "US",
  uruguay: "UY",
  uzbekistan: "UZ",
};

function teamCode(teamId: string) {
  if (teamId.startsWith("winner") || teamId.startsWith("loser") || teamId.startsWith("group")) return "KO";
  return TEAM_CODES[teamId] ?? teamId.slice(0, 3).toUpperCase();
}

function teamCodeForName(name: string, lines: HouseMatchLine[]) {
  const normalized = name.trim().toLowerCase();
  const match = lines.find((line) => (
    line.home_team.trim().toLowerCase() === normalized ||
    line.away_team.trim().toLowerCase() === normalized
  ));
  if (!match) return name;
  return match.home_team.trim().toLowerCase() === normalized
    ? teamCode(match.home_team_id)
    : teamCode(match.away_team_id);
}

function groupMatchCall(line: HouseMatchLine, lines: HouseMatchLine[]) {
  if (line.status === "finished") return `${line.home_score ?? 0}-${line.away_score ?? 0}`;
  return `${teamCodeForName(line.favorite, lines)} ${pct(line.confidence)}`;
}

type GroupStanding = {
  team: string;
  teamId: string;
  played: number;
  points: number;
  expectedPoints: number;
  goalsFor: number;
  goalsAgainst: number;
  topSignal: number;
};

function buildGroupTable(lines: HouseMatchLine[]) {
  const table = new Map<string, GroupStanding>();
  const ensure = (teamId: string, team: string) => {
    if (!table.has(teamId)) {
      table.set(teamId, {
        team,
        teamId,
        played: 0,
        points: 0,
        expectedPoints: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        topSignal: 0,
      });
    }
    return table.get(teamId)!;
  };

  for (const line of lines) {
    const home = ensure(line.home_team_id, line.home_team);
    const away = ensure(line.away_team_id, line.away_team);

    const homeScore = line.home_score ?? 0;
    const awayScore = line.away_score ?? 0;

    if (line.status === "finished") {
      home.played += 1;
      away.played += 1;
      home.goalsFor += homeScore;
      home.goalsAgainst += awayScore;
      away.goalsFor += awayScore;
      away.goalsAgainst += homeScore;
      if (homeScore > awayScore) {
        home.points += 3;
      } else if (homeScore < awayScore) {
        away.points += 3;
      } else {
        home.points += 1;
        away.points += 1;
      }
    }

    const homeExpected = line.status === "finished"
      ? homeScore > awayScore ? 3 : homeScore === awayScore ? 1 : 0
      : line.home_win * 3 + line.draw;
    const awayExpected = line.status === "finished"
      ? awayScore > homeScore ? 3 : homeScore === awayScore ? 1 : 0
      : line.away_win * 3 + line.draw;

    home.expectedPoints += homeExpected;
    away.expectedPoints += awayExpected;
    home.topSignal = Math.max(home.topSignal, line.home_win);
    away.topSignal = Math.max(away.topSignal, line.away_win);
  }

  return Array.from(table.values()).sort((a, b) => {
    const expected = b.expectedPoints - a.expectedPoints;
    if (Math.abs(expected) > 0.01) return expected;
    return b.topSignal - a.topSignal;
  });
}

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function pointerDistance(points: Array<{ x: number; y: number }>) {
  const [first, second] = points;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function pointerCenter(points: Array<{ x: number; y: number }>) {
  const [first, second] = points;
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function GroupPanel({ group, lines, selected, onSelect }: { group: string; lines: HouseMatchLine[]; selected?: string; onSelect: (line: HouseMatchLine) => void }) {
  const teams = Array.from(new Set(lines.flatMap((line) => [line.home_team, line.away_team])));
  return (
    <section className="mc-group-panel">
      <header>
        <h2>{group}</h2>
        <span>{teams.join(" - ")}</span>
      </header>
      <div className="mc-group-fixtures">
        {lines.map((line) => (
          <button className={selected === line.match_id ? "selected" : ""} key={line.match_id} onClick={() => onSelect(line)} type="button">
            <small>#{line.match_number}</small>
            <b>{teamFlag(line.home_team_id)} {line.home_team}</b>
            <em>{line.draw > line.home_win && line.draw > line.away_win ? "Empate" : line.favorite}</em>
            <strong>{compactPct(line.confidence)}</strong>
            <b>{teamFlag(line.away_team_id)} {line.away_team}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

function GroupTable({ group, lines, selected, onSelect }: { group: string; lines: HouseMatchLine[]; selected?: string; onSelect: (line: HouseMatchLine) => void }) {
  const standings = buildGroupTable(lines);
  const nextFixture = lines.find((line) => line.status !== "finished");
  return (
    <section className="mc-group-table-card">
      <header>
        <div>
          <span>{group}</span>
          <strong>{nextFixture ? `Siguiente: ${projectedHome(nextFixture)} vs ${projectedAway(nextFixture)}` : "Grupo cerrado"}</strong>
        </div>
        <small>{lines.filter((line) => line.status === "finished").length}/{lines.length} jugados</small>
      </header>
      <table>
        <colgroup>
          <col className="mc-team-col" />
          <col className="mc-played-col" />
          <col className="mc-points-col" />
          <col className="mc-projected-col" />
        </colgroup>
        <thead>
          <tr>
            <th>Equipo</th>
            <th>J</th>
            <th title="Puntos reales con resultados cerrados">Pts</th>
            <th title="Puntos esperados al cierre del grupo">Proy</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((team, index) => (
            <tr key={team.teamId} className={index < 2 ? "is-qualifying" : index === 2 ? "is-third-place" : ""}>
              <td><b>{teamFlag(team.teamId)}</b><span>{team.team}</span></td>
              <td>{team.played}</td>
              <td>{team.points}</td>
              <td>{team.expectedPoints.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mc-group-match-strip">
        {lines.map((line) => (
          <button className={selected === line.match_id ? "selected" : ""} key={line.match_id} onClick={() => onSelect(line)} type="button">
            <span>#{line.match_number}</span>
            <strong title={`${projectedHome(line)} vs ${projectedAway(line)}`}>
              {teamCode(line.home_team_id)} vs {teamCode(line.away_team_id)}
            </strong>
            <em title={line.status === "finished" ? "Resultado fijo" : `${line.favorite} ${pct(line.confidence)}`}>
              {groupMatchCall(line, lines)}
            </em>
          </button>
        ))}
      </div>
    </section>
  );
}

function BracketLineCard({
  line,
  projection,
  selected,
  onSelect,
}: {
  line: HouseMatchLine;
  projection: ProjectedBracketLine;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`mc-bracket-card ${lineTone(line)} ${selected ? "selected" : ""}`} onClick={onSelect} type="button">
      <span className="mc-bracket-meta">Partido {line.match_number}</span>
      <span className="mc-bracket-team">
        <b>{projection.home}</b>
        <em>{pct(line.home_win)}</em>
      </span>
      <span className="mc-bracket-vs">contra</span>
      <span className="mc-bracket-team">
        <b>{projection.away}</b>
        <em>{pct(line.away_win)}</em>
      </span>
      <span className="mc-bracket-call">
        Ruta casa: <strong>{projection.winner}</strong> <b>{pct(projection.winnerProbability)}</b>
      </span>
    </button>
  );
}

function BracketStageRow({
  stage,
  lines,
  projection,
  selected,
  onSelect,
}: {
  stage: string;
  lines: HouseMatchLine[];
  projection: Map<number, ProjectedBracketLine>;
  selected?: string;
  onSelect: (line: HouseMatchLine) => void;
}) {
  return (
    <section className="mc-stage-row">
      <header>
        <span>{stage}</span>
        <strong>{lines.length} partidos</strong>
      </header>
      <div className="mc-stage-row-track">
        {lines.map((line) => {
          const projectedLine = projection.get(line.match_number);
          const home = projectedLine?.home ?? projectedHome(line);
          const away = projectedLine?.away ?? projectedAway(line);
          const finished = isFinishedLine(line);
          const winner = finished ? lineWinner(line, home, away) : (projectedLine?.winner ?? line.projected_winner ?? line.favorite);
          const winnerProbability = projectedLine?.winnerProbability ?? line.confidence;
          return (
            <button className={`mc-stage-match ${lineTone(line)} ${selected === line.match_id ? "selected" : ""}`} key={line.match_id} onClick={() => onSelect(line)} type="button">
              <small>Partido {line.match_number}</small>
              <span>
                <b>{home}</b>
                {slotSubLabel(line, "home") && <small>{slotSubLabel(line, "home")}</small>}
                <em>{finished ? String(line.home_score ?? 0) : pct(line.home_win)}</em>
              </span>
              <i>{finished ? lineScore(line) : "vs"}</i>
              <span>
                <b>{away}</b>
                {slotSubLabel(line, "away") && <small>{slotSubLabel(line, "away")}</small>}
                <em>{finished ? String(line.away_score ?? 0) : pct(line.away_win)}</em>
              </span>
              <strong className="mc-stage-call">
                {finished ? "Dato fijo" : "Proyecta"}: <b>{winner}</b>{!finished && <em>{pct(winnerProbability)}</em>}
              </strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MatchLineCard({ line, selected, onSelect }: { line: HouseMatchLine; selected: boolean; onSelect: () => void }) {
  const isGroup = line.phase === "grupos";
  const home = projectedHome(line);
  const away = projectedAway(line);
  return (
    <button className={`mc-line-card ${lineTone(line)} ${selected ? "selected" : ""}`} onClick={onSelect} type="button">
      <span className="mc-line-top">
        <small>Partido {line.match_number}</small>
        <strong>{phaseLabel(line.phase, line.stage)}</strong>
      </span>
      <span className="mc-line-teams">
        <b>{isGroup ? teamFlag(line.home_team_id) : "Copa"}</b>
        <span>{home}</span>
        <em>vs</em>
        <b>{isGroup ? teamFlag(line.away_team_id) : "Copa"}</b>
        <span>{away}</span>
      </span>
      <span className="mc-market">
        <span>
          <small>{isGroup ? "Casa A" : "Slot A"}</small>
          <strong>{pct(line.home_win)}</strong>
        </span>
        {isGroup && (
          <span>
            <small>Empate</small>
            <strong>{pct(line.draw)}</strong>
          </span>
        )}
        <span>
          <small>{isGroup ? "Casa B" : "Slot B"}</small>
          <strong>{pct(line.away_win)}</strong>
        </span>
      </span>
      <span className="mc-call">
        <small>Monte Carlo va con</small>
        <strong>{line.favorite}</strong>
        <b>{pct(line.confidence)}</b>
      </span>
    </button>
  );
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo generar la imagen."));
    }, "image/png", 0.96);
  });
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(" ");
  let line = "";
  let currentY = y;
  for (const word of words) {
    const testLine = `${line}${word} `;
    if (context.measureText(testLine).width > maxWidth && line) {
      context.fillText(line.trim(), x, currentY);
      line = `${word} `;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) context.fillText(line.trim(), x, currentY);
  return currentY;
}

function generateHouseShareCanvas({
  board,
  line,
  home,
  away,
  favorite,
  confidence,
  shareUrl,
}: {
  board: HouseMatchBoard;
  line: HouseMatchLine;
  home: string;
  away: string;
  favorite: string;
  confidence: number;
  shareUrl: string;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas no disponible.");

  const gradient = context.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, "#031314");
  gradient.addColorStop(0.35, "#073c37");
  gradient.addColorStop(0.72, "#0b1820");
  gradient.addColorStop(1, "#05070a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1080, 1350);

  const goldGlow = context.createRadialGradient(830, 190, 20, 830, 190, 620);
  goldGlow.addColorStop(0, "rgba(245, 213, 71, 0.55)");
  goldGlow.addColorStop(0.42, "rgba(245, 213, 71, 0.16)");
  goldGlow.addColorStop(1, "rgba(245, 213, 71, 0)");
  context.fillStyle = goldGlow;
  context.fillRect(0, 0, 1080, 1350);

  context.strokeStyle = "rgba(126, 226, 168, 0.24)";
  context.lineWidth = 2;
  for (let index = 0; index < 22; index += 1) {
    const x = 70 + index * 46;
    context.beginPath();
    context.moveTo(x, 235);
    context.bezierCurveTo(290, 450 + index * 8, 760, 420 - index * 4, 1010 - index * 8, 710);
    context.stroke();
  }

  context.save();
  context.translate(96, 615);
  context.rotate(-0.045);
  context.fillStyle = "rgba(255, 255, 255, 0.055)";
  context.strokeStyle = "rgba(255,255,255,0.42)";
  context.lineWidth = 5;
  context.beginPath();
  context.roundRect(0, 0, 888, 420, 22);
  context.fill();
  context.stroke();
  context.strokeStyle = "rgba(126, 226, 168, 0.46)";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(444, 0);
  context.lineTo(444, 420);
  context.stroke();
  context.beginPath();
  context.arc(444, 210, 76, 0, Math.PI * 2);
  context.stroke();
  context.strokeRect(0, 110, 120, 200);
  context.strokeRect(768, 110, 120, 200);
  context.restore();

  context.fillStyle = "#ffffff";
  context.font = "950 46px Inter, Arial, sans-serif";
  context.fillText("MUNDIAL LAB", 78, 92);
  context.fillStyle = "#f5d547";
  context.font = "950 34px Inter, Arial, sans-serif";
  context.fillText("HOUSE MONTE CARLO LINE", 78, 142);

  context.fillStyle = "rgba(255,255,255,0.74)";
  context.font = "800 26px Inter, Arial, sans-serif";
  context.fillText(`${board.simulations.toLocaleString("es-MX")} simulations - seed ${board.seed} - run ${board.run_id}`, 78, 196);

  context.fillStyle = "#ffffff";
  context.font = "950 76px Inter, Arial, sans-serif";
  drawWrappedText(context, `${home} vs ${away}`, 78, 310, 920, 82);
  context.fillStyle = "rgba(255,255,255,0.72)";
  context.font = "800 30px Inter, Arial, sans-serif";
  context.fillText(`${line.stage} - Partido ${line.match_number} - ${line.venue}`, 80, 418);

  context.fillStyle = "#ffffff";
  context.font = "950 64px Inter, Arial, sans-serif";
  context.fillText("Monte Carlo va con", 78, 525);
  context.fillStyle = "#f5d547";
  context.font = "950 110px Inter, Arial, sans-serif";
  drawWrappedText(context, favorite, 78, 642, 880, 112);

  context.fillStyle = "rgba(6, 20, 22, 0.84)";
  context.beginPath();
  context.roundRect(78, 770, 924, 195, 30);
  context.fill();
  context.strokeStyle = "rgba(245, 213, 71, 0.38)";
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = "950 52px Inter, Arial, sans-serif";
  context.fillText(`${pct(line.home_win)} local`, 122, 840);
  if (line.phase === "grupos") context.fillText(`${pct(line.draw)} empate`, 408, 840);
  context.fillText(`${pct(line.away_win)} visita`, line.phase === "grupos" ? 735 : 500, 840);
  context.fillStyle = "#7ee2a8";
  context.font = "900 34px Inter, Arial, sans-serif";
  context.fillText(`Confianza de la linea: ${pct(confidence)}`, 122, 912);

  const x0 = 92;
  const y0 = 1032;
  const barWidth = 896;
  const barHeight = 42;
  context.fillStyle = "rgba(255,255,255,0.12)";
  context.beginPath();
  context.roundRect(x0, y0, barWidth, barHeight, 21);
  context.fill();
  context.fillStyle = "#7ee2a8";
  context.fillRect(x0, y0, barWidth * line.home_win, barHeight);
  if (line.phase === "grupos") {
    context.fillStyle = "#f5d547";
    context.fillRect(x0 + barWidth * line.home_win, y0, barWidth * line.draw, barHeight);
  }
  context.fillStyle = "#4dabf7";
  context.fillRect(x0 + barWidth * (line.phase === "grupos" ? line.home_win + line.draw : line.home_win), y0, barWidth * line.away_win, barHeight);

  context.fillStyle = "#ffffff";
  context.font = "900 34px Inter, Arial, sans-serif";
  context.fillText(line.phase === "grupos" ? "Marcadores mas vistos" : "Equipos mas repetidos en el slot", 78, 1155);
  context.font = "800 28px Inter, Arial, sans-serif";
  context.fillStyle = "rgba(255,255,255,0.84)";
  const evidence = line.phase === "grupos" ? line.top_scores : line.likely_participants;
  evidence.slice(0, 4).forEach((item, index) => {
    const x = 78 + (index % 2) * 470;
    const y = 1210 + Math.floor(index / 2) * 50;
    context.fillText(`${item.label} ${pct(item.probability)}`, x, y);
  });

  context.fillStyle = "rgba(255,255,255,0.72)";
  context.font = "800 25px Inter, Arial, sans-serif";
  context.fillText("Esta es la linea que los Data Directors tienen que tumbar.", 78, 1300);
  context.fillStyle = "#7ee2a8";
  context.fillText(shareUrl.replace("https://", ""), 650, 1300);

  return canvas;
}

function MatchDetail({ board, line }: { board: HouseMatchBoard; line: HouseMatchLine }) {
  const home = projectedHome(line);
  const away = projectedAway(line);
  const favorite = line.match_number <= 88 ? line.projected_winner ?? line.favorite : line.favorite;
  const confidence = line.confidence;
  const [shareImage, setShareImage] = useState("");
  const [shareMessage, setShareMessage] = useState("Genera una tarjeta Monte Carlo para este partido.");
  const [isSharing, setIsSharing] = useState(false);
  const shareUrl = `https://mundial.hadox.org/montecarlo-casa/?match=${line.slug}`;
  const kitUrl = `/diario-aprendizaje/?match=${line.slug}&kit=1`;
  const replayUrl = `/simulador-partido/?match=${line.slug}`;
  const shareText = buildHouseShareText({ board, line, home, away, favorite, confidence, shareUrl });

  const createShareCard = () => {
    const canvas = generateHouseShareCanvas({ board, line, home, away, favorite, confidence, shareUrl });
    const image = canvas.toDataURL("image/png");
    setShareImage(image);
    setShareMessage("Tarjeta Monte Carlo generada para este partido.");
    return { canvas, image };
  };

  const downloadShareImage = (image = shareImage) => {
    if (!image) return;
    const link = document.createElement("a");
    link.href = image;
    link.download = `${line.slug}-house-montecarlo-line.png`;
    link.click();
  };

  const copyShareText = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setShareMessage("Texto Monte Carlo copiado.");
    } catch {
      setShareMessage("No pude copiar el texto, pero la tarjeta esta lista.");
    }
  };

  const sharePredictionImage = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      const { canvas, image } = shareImage ? { canvas: generateHouseShareCanvas({ board, line, home, away, favorite, confidence, shareUrl }), image: shareImage } : createShareCard();
      const blob = await canvasBlob(canvas);
      const file = new File([blob], `${line.slug}-house-line.png`, { type: "image/png" });
      if ("canShare" in navigator && navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({
          title: "Mundial Lab House Line",
          text: shareText,
          url: shareUrl,
          files: [file],
        });
        setShareMessage("Tarjeta Monte Carlo compartida.");
        return;
      }
      downloadShareImage(image);
      await navigator.clipboard?.writeText(shareText);
      setShareMessage("PNG descargado y texto copiado.");
    } catch {
      if (shareImage) downloadShareImage();
      setShareMessage("No se pudo abrir compartir. Descarga la tarjeta y subela manualmente.");
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <aside className="mc-detail">
      <div className="workflow-title">
        <Gauge />
        <h3>Linea de Monte Carlo</h3>
      </div>
      <p className="mc-detail-title">
        Partido {line.match_number}: {home} vs {away}
      </p>
      <div className="mc-odds-grid">
        <span><small>{line.phase === "grupos" ? "Favorito" : "Gana mas veces"}</small><strong>{favorite}</strong></span>
        <span><small>Confianza</small><strong>{pct(confidence)}</strong></span>
        <span><small>xG local</small><strong>{line.expected_home_goals || "slot"}</strong></span>
        <span><small>xG visita</small><strong>{line.expected_away_goals || "slot"}</strong></span>
      </div>
      {line.xg_impact && (
        <p className="mc-xg-impact">
          xG v1: {line.xg_impact.note}. Empuje local {line.xg_impact.delta > 0 ? "+" : ""}{line.xg_impact.delta.toFixed(3)}
          {" "}con {line.xg_impact.home_games + line.xg_impact.away_games} partidos de señal.
        </p>
      )}
      <div className="mc-bars">
        <span><b>{home}</b><i style={{ width: pct(line.home_win) }} /><em>{pct(line.home_win)}</em></span>
        {line.phase === "grupos" && <span><b>Empate</b><i style={{ width: pct(line.draw) }} /><em>{pct(line.draw)}</em></span>}
        <span><b>{away}</b><i style={{ width: pct(line.away_win) }} /><em>{pct(line.away_win)}</em></span>
      </div>
      <div className="mc-detail-lists">
        <section>
          <h4>{line.phase === "grupos" ? "Marcadores mas vistos" : "Resoluciones mas vistas"}</h4>
          {line.top_scores.map((item) => (
            <span key={item.label}><b>{item.label}</b><em>{pct(item.probability)}</em></span>
          ))}
        </section>
        {line.phase !== "grupos" && (
          <section>
            <h4>Slot A mas probable</h4>
            {line.likely_home.map((item) => (
              <span key={item.label}><b>{item.label}</b><em>{pct(item.probability)}</em></span>
            ))}
          </section>
        )}
        {line.phase !== "grupos" && (
          <section>
            <h4>Slot B mas probable</h4>
            {line.likely_away.map((item) => (
              <span key={item.label}><b>{item.label}</b><em>{pct(item.probability)}</em></span>
            ))}
          </section>
        )}
        {line.phase !== "grupos" && (
          <section>
            <h4>Todos los equipos que aparecen</h4>
            {line.likely_participants.map((item) => (
              <span key={item.label}><b>{item.label}</b><em>{pct(item.probability)}</em></span>
            ))}
          </section>
        )}
      </div>
      <div className="house-share-card">
        <div className="house-share-head">
          <span>Tarjeta Monte Carlo</span>
          <strong>{favorite} · {pct(confidence)}</strong>
          <small>{shareMessage}</small>
        </div>
        <label className="suggested-copy house-copy">
          <span>Copy sugerido</span>
          <textarea readOnly value={shareText} />
        </label>
        {shareImage && (
          <img
            alt={`Tarjeta Monte Carlo para ${home} vs ${away}`}
            src={shareImage}
          />
        )}
        <div className="house-share-actions">
          <button onClick={createShareCard} type="button">
            <ImageDown size={16} />
            Crear tarjeta
          </button>
          <button disabled={isSharing} onClick={sharePredictionImage} type="button">
            <Share2 size={16} />
            Compartir imagen
          </button>
          <button disabled={!shareImage} onClick={() => downloadShareImage()} type="button">
            Descargar PNG
          </button>
          <button onClick={copyShareText} type="button">
            Copiar texto
          </button>
        </div>
      </div>
      <div className="mc-detail-actions">
        <a className="mc-open-match" href={`/partidos/${line.slug}/`}>
          Sala del partido <ChevronRight size={16} />
        </a>
        <a className="mc-open-match secondary" href={replayUrl}>
          Replay 3D <ChevronRight size={16} />
        </a>
        <a className="mc-open-match secondary" href={kitUrl}>
          Autopsia + kit <ChevronRight size={16} />
        </a>
      </div>
    </aside>
  );
}

function HouseMontecarloPage() {
  const [board, setBoard] = useState<HouseMatchBoard | null>(null);
  const [history, setHistory] = useState<HouseMatchBoard[]>([]);
  const [selected, setSelected] = useState<HouseMatchLine | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState({ x: 20, y: 10 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    centerX: number;
    centerY: number;
    distance: number;
    panX: number;
    panY: number;
    zoom: number;
  } | null>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const requestedMatch = new URLSearchParams(window.location.search).get("match");

  const selectRelevantLine = (data: HouseMatchBoard) => {
    if (requestedMatch) {
      return data.lines.find((line) => line.slug === requestedMatch) ?? data.lines[0] ?? null;
    }
    return (
      data.lines.find((line) => line.status === "live" || line.status === "halftime") ??
      [...data.lines].filter((line) => line.status === "finished").sort((a, b) => b.match_number - a.match_number)[0] ??
      data.lines.find((line) => line.status === "scheduled") ??
      data.lines[0] ??
      null
    );
  };

  const run = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await runHouseMatchBoard({
        simulations: 2500,
        seed: 2026,
        use_stadium: true,
        use_fixed_results: true,
        use_xg: true,
        scenario: "Linea publica Monte Carlo",
      });
      setBoard(data);
      setSelected(selectRelevantLine(data));
      setHistory(saveHouseHistory(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo correr Monte Carlo.");
    } finally {
      setLoading(false);
    }
  };

  const loadOfficialBoard = async () => {
    setLoading(true);
    setError("");
    try {
      const official = await fetchLatestHouseBoard();
      if (official) {
        setBoard(official);
        setSelected(selectRelevantLine(official));
        setHistory(saveHouseHistory(official));
        return;
      }
      const stored = loadHouseHistory();
      if (stored.length) {
        setHistory(stored);
        setBoard(stored[0]);
        setSelected(selectRelevantLine(stored[0]));
        return;
      }
      await run();
    } catch (err) {
      const stored = loadHouseHistory();
      if (stored.length) {
        setHistory(stored);
        setBoard(stored[0]);
        setSelected(selectRelevantLine(stored[0]));
      } else {
        setError(err instanceof Error ? err.message : "No se pudo cargar la linea oficial.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOfficialBoard();
  }, []);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const groupPanels = useMemo(() => {
    const groups = new Map<string, HouseMatchLine[]>();
    for (const line of board?.lines ?? []) {
      if (line.phase !== "grupos") continue;
      const key = line.stage;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [board]);

  const bracketPanels = useMemo(() => {
    const groups = new Map<string, HouseMatchLine[]>();
    for (const line of board?.lines ?? []) {
      if (line.phase === "grupos") continue;
      const key = line.stage || "Eliminacion";
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => stageOrder(a) - stageOrder(b));
  }, [board]);

  const bracketProjection = useMemo(() => buildBracketProjection(board?.lines ?? []), [board]);

  const zoomAt = (nextZoom: number, center: { x: number; y: number }) => {
    const boundedZoom = clampZoom(nextZoom);
    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    const contentX = (center.x - currentPan.x) / currentZoom;
    const contentY = (center.y - currentPan.y) / currentZoom;
    const nextPan = {
      x: center.x - contentX * boundedZoom,
      y: center.y - contentY * boundedZoom,
    };
    panRef.current = nextPan;
    zoomRef.current = boundedZoom;
    setPan(nextPan);
    setZoom(boundedZoom);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -0.06 : 0.06;
    const rect = event.currentTarget.getBoundingClientRect();
    zoomAt(zoomRef.current + direction, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    pointersRef.current.set(event.pointerId, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });

    const points = Array.from(pointersRef.current.values());
    if (points.length === 1) {
      dragRef.current = {
        x: points[0].x,
        y: points[0].y,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      pinchRef.current = null;
      return;
    }

    if (points.length >= 2) {
      const activePoints = points.slice(0, 2);
      const center = pointerCenter(activePoints);
      pinchRef.current = {
        centerX: center.x,
        centerY: center.y,
        distance: pointerDistance(activePoints),
        panX: panRef.current.x,
        panY: panRef.current.y,
        zoom: zoomRef.current,
      };
      dragRef.current = null;
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    pointersRef.current.set(event.pointerId, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });

    const points = Array.from(pointersRef.current.values());
    if (points.length >= 2 && pinchRef.current) {
      const activePoints = points.slice(0, 2);
      const currentCenter = pointerCenter(activePoints);
      const nextZoom = clampZoom((pointerDistance(activePoints) / pinchRef.current.distance) * pinchRef.current.zoom);
      const contentX = (pinchRef.current.centerX - pinchRef.current.panX) / pinchRef.current.zoom;
      const contentY = (pinchRef.current.centerY - pinchRef.current.panY) / pinchRef.current.zoom;
      const nextPan = {
        x: currentCenter.x - contentX * nextZoom,
        y: currentCenter.y - contentY * nextZoom,
      };
      panRef.current = nextPan;
      zoomRef.current = nextZoom;
      setPan(nextPan);
      setZoom(nextZoom);
      return;
    }

    if (points.length === 1 && dragRef.current) {
      const nextPan = {
        x: dragRef.current.panX + points[0].x - dragRef.current.x,
        y: dragRef.current.panY + points[0].y - dragRef.current.y,
      };
      panRef.current = nextPan;
      setPan(nextPan);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointersRef.current.delete(event.pointerId);
    pinchRef.current = null;

    const points = Array.from(pointersRef.current.values());
    if (points.length === 1) {
      dragRef.current = {
        x: points[0].x,
        y: points[0].y,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      return;
    }

    dragRef.current = null;
  };

  return (
    <main>
      <nav className="nav page-nav" aria-label="Navegacion principal">
        <a className="brand" href="/">
          <Trophy size={22} />
          <span>Mundial Lab</span>
        </a>
        <div className="nav-links">
          <a href="/partidos/">Partidos</a>
          <a href="/laboratorio-datos/">Datos</a>
          <a href="/diario-aprendizaje/">Diario</a>
          <a href="/directores/">Directores</a>
        </div>
      </nav>

      <section className="mc-public-hero">
        <div>
          <p className="section-kicker">Monte Carlo de la casa</p>
          <h1>Monte Carlo ya puso la linea. Ahora rompela.</h1>
          <p>
            Grupos, tablas, llaves por ronda, favoritos y sustos probables. Cada partido abre sala,
            replay, tarjeta Monte Carlo y autopsia publicable.
          </p>
        </div>
        <div className="mc-public-note">
          <strong>{loading ? "Monte Carlo esta recalculando..." : "Linea publica viva"}</strong>
          <span>Se actualiza cuando hay resultados cerrados o una nueva corrida oficial.</span>
          <em>Tablero para ver, discutir y retar al algoritmo.</em>
          <a href="/diario-aprendizaje/">Ver autopsias destacadas</a>
        </div>
      </section>

      <section className="mc-autopsy-bridge">
        <div>
          <p className="section-kicker">Despues del silbatazo</p>
          <h2>La linea no muere: se vuelve leccion.</h2>
          <p>
            Cuando entra un resultado real, el Diario genera autopsias automaticas y el kit para
            publicar que modelo leyo mejor el partido.
          </p>
        </div>
        <div>
          <a href="/diario-aprendizaje/">Diario + kits</a>
          <a href="/partidos/">Retar desde una sala</a>
        </div>
      </section>

      <section className="mc-summary-strip">
        <article><strong>{board?.simulations.toLocaleString("es-MX") ?? "-"}</strong><span>simulaciones</span></article>
        <article><strong>{board?.fixed_results_used ?? 0}</strong><span>resultados fijos</span></article>
        <article><strong>{board?.lines.length ?? 0}</strong><span>partidos con linea</span></article>
        <article><strong>{board?.run_id ?? "-"}</strong><span>corrida activa</span></article>
      </section>

      {error && <p className="error-text mc-error">{error}</p>}

      <section className="mc-public-board">
        <div className="mc-board-head">
          <div>
            <p className="section-kicker">Tabla del torneo</p>
            <h2>Grupos primero. Llaves despues. Sin perderse en el mapa.</h2>
          </div>
          <span>Selecciona cualquier partido para abrir la lectura de la casa.</span>
        </div>

        <section className="mc-groups-table-stage">
          <div className="mc-stage-title">
            <span>Fase de grupos</span>
            <strong>Pts reales solo cuenta marcadores cerrados. Proy cierre suma esos puntos mas lo esperado por Monte Carlo.</strong>
          </div>
          <div className="mc-group-table-grid">
            {groupPanels.map(([group, lines]) => (
              <GroupTable group={group} key={group} lines={lines} onSelect={setSelected} selected={selected?.match_id} />
            ))}
          </div>
        </section>

        <section className="mc-knockout-lines">
          <div className="mc-stage-title">
            <span>Camino a la copa</span>
            <strong>Cada tarjeta muestra solo la probabilidad de ganar desde cada lado del cruce.</strong>
          </div>
          {bracketPanels.map(([stage, lines]) => (
            <BracketStageRow
              key={stage}
              lines={lines}
              onSelect={setSelected}
              projection={bracketProjection}
              selected={selected?.match_id}
              stage={stage}
            />
          ))}
        </section>
      </section>

      {selected && board && (
        <MatchDetail
          board={board}
          line={selected}
        />
      )}

      <section className="mc-bottom-grid single">
        <article className="live-panel">
          <div className="workflow-title">
            <History />
            <h3>Auditoria de corridas</h3>
          </div>
          <p className="mc-panel-note">
            Cada registro es una version oficial guardada: fecha, simulaciones y seed. Sirve para ver como cambio
            la lectura de la casa despues de nuevos resultados.
          </p>
          <div className="mc-history-list">
            {history.map((item, index) => (
              <button key={`${item.run_id}-${item.saved_at ?? index}`} onClick={() => { setBoard(item); setSelected(item.lines[0] ?? null); }} type="button">
                <strong>{item.run_id}</strong>
                <span>{savedAtLabel(item.saved_at)} - {item.simulations.toLocaleString("es-MX")} sims - seed {item.seed}</span>
              </button>
            ))}
          </div>
        </article>
      </section>

      <SiteFooter />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<HouseMontecarloPage />);
