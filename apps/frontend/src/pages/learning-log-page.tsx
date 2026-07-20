import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { Activity, BookOpenCheck, BrainCircuit, Clipboard, Database, Filter, Flame, ImageDown, Share2, Sparkles, Trophy } from "lucide-react";
import { SiteFooter } from "../components/SiteFooter";
import { fetchLearningLog, fetchPublicDataQuality } from "../lib/api";
import { DataQualitySummary, LearningLogEntry, ModelName } from "../types";
import "../styles.css";

type LearningFilter = "destacadas" | "casa" | "modelos" | ModelName | "todo" | `tag:${string}`;
const modelFilterValues = new Set(["poisson", "elo", "dixon_coles", "bayes_live", "ensemble"]);

type ParsedAutopsy = {
  stage?: "basic_autopsy" | "calibrated_autopsy" | "model_autopsy";
  model?: ModelName;
  best_contract?: {
    contract?: string;
    probability_for_real_outcome?: number;
    home_win?: number;
    draw?: number;
    away_win?: number;
    use_stadium?: boolean;
    use_xg?: boolean;
  };
  candidates?: {
    contract: string;
    probability_for_real_outcome: number;
    use_stadium?: boolean;
    use_xg?: boolean;
  }[];
  line?: {
    home_win: number;
    draw: number;
    away_win: number;
    favorite: string;
  };
  outcome_probability_lift?: number;
  probability_for_real_outcome?: number;
  no_leakage_rule?: string;
};

const modelLabels: Record<string, string> = {
  casa: "Monte Carlo",
  elo: "Elo",
  poisson: "Poisson",
  dixon_coles: "Dixon-Coles",
  bayes_live: "Bayes",
  ensemble: "Ensamble",
};

function pct(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function parseParameters(entry: LearningLogEntry): ParsedAutopsy {
  try {
    return JSON.parse(entry.best_parameters_json) as ParsedAutopsy;
  } catch {
    return {};
  }
}

function stageOf(entry: LearningLogEntry) {
  return parseParameters(entry).stage ?? "basic_autopsy";
}

function familyOf(entry: LearningLogEntry) {
  return stageOf(entry) === "calibrated_autopsy" ? "casa" : entry.best_model;
}

function contractName(entry: LearningLogEntry) {
  const params = parseParameters(entry);
  return params.best_contract?.contract ?? modelLabels[entry.best_model] ?? entry.best_model;
}

function outcomeLabel(entry: LearningLogEntry) {
  if (entry.outcome === "home") return entry.home_team;
  if (entry.outcome === "away") return entry.away_team;
  return "Empate";
}

function realProbability(entry: LearningLogEntry) {
  const params = parseParameters(entry);
  return params.best_contract?.probability_for_real_outcome ?? params.probability_for_real_outcome ?? 1 - entry.best_error;
}

function originalProbability(entry: LearningLogEntry) {
  return 1 - entry.original_error;
}

function liftOf(entry: LearningLogEntry) {
  const params = parseParameters(entry);
  return Number(params.outcome_probability_lift ?? realProbability(entry) - originalProbability(entry));
}

function highlightTags(entry: LearningLogEntry) {
  const params = parseParameters(entry);
  const tags: string[] = [];
  const real = realProbability(entry);
  const original = originalProbability(entry);
  const lift = liftOf(entry);
  const best = params.best_contract;
  const candidates = params.candidates ?? [];
  const usedXg = Boolean(best?.use_xg || candidates[0]?.use_xg);
  const usedStadium = Boolean(best?.use_stadium || candidates[0]?.use_stadium);

  if (entry.outcome === "draw") tags.push("Empate que habia que escuchar");
  if (original < 0.28 && real >= 0.28) tags.push("Sorpresa fuerte");
  if (stageOf(entry) === "calibrated_autopsy" && real < 0.28) tags.push("Monte Carlo sufrio");
  if (stageOf(entry) === "calibrated_autopsy" && lift > 0.025) tags.push("Calibracion que si movio");
  if (usedXg && lift > 0.01) tags.push("xG v1 levanto la mano");
  if (usedStadium && lift > 0.01) tags.push("Estadio peso en la lectura");
  if (stageOf(entry) === "model_autopsy" && real >= 0.38) tags.push(`${modelLabels[entry.best_model]} salio fino`);
  if (!tags.length && real >= 0.32) tags.push("Lectura publicable");

  return tags;
}

function highlightScore(entry: LearningLogEntry) {
  const tags = highlightTags(entry);
  const real = realProbability(entry);
  const lift = liftOf(entry);
  return tags.length * 10 + real * 18 + Math.max(0, lift) * 120 + (entry.outcome === "draw" ? 6 : 0);
}

function editorialHeadline(entry: LearningLogEntry) {
  const family = familyOf(entry);
  const label = modelLabels[family] ?? family;
  const result = `${entry.home_team} ${entry.home_score}-${entry.away_score} ${entry.away_team}`;
  if (stageOf(entry) === "calibrated_autopsy") {
    return `${label} abre la libreta: ${outcomeLabel(entry)} era la senal del ${result}`;
  }
  return `${label} a examen: que entendio del ${result}`;
}

function publicMatchUrl(entry: LearningLogEntry) {
  return `https://mundial.hadox.org/partidos/${entry.slug}/`;
}

function publicReplayUrl(entry: LearningLogEntry) {
  return `https://mundial.hadox.org/simulador-partido/?match=${entry.slug}`;
}

function publicDiaryUrl(entry: LearningLogEntry) {
  return `https://mundial.hadox.org/diario-aprendizaje/?match=${entry.slug}`;
}

function editorialCopy(entry: LearningLogEntry) {
  const tags = highlightTags(entry).slice(0, 2).join(" / ");
  return [
    editorialHeadline(entry),
    "",
    `Resultado real: ${entry.home_team} ${entry.home_score}-${entry.away_score} ${entry.away_team}.`,
    `Probabilidad al desenlace real: ${pct(realProbability(entry))}.`,
    `Aprendizaje: ${entry.lesson}`,
    tags ? `Etiqueta editorial: ${tags}.` : "",
    "",
    `Ver autopsia: ${publicDiaryUrl(entry)}`,
    `Replay 3D: ${publicReplayUrl(entry)}`,
    `Reta la lectura como Data Director: ${publicMatchUrl(entry)}`,
    "",
    "#MundialLab #DataScience #FootballAnalytics #WorldCup",
  ].filter(Boolean).join("\n");
}

function shortSocialCopy(entry: LearningLogEntry) {
  const model = modelLabels[familyOf(entry)] ?? entry.best_model;
  const tag = highlightTags(entry)[0] ?? "Autopsia publicable";
  const score = `${entry.home_team} ${entry.home_score}-${entry.away_score} ${entry.away_team}`;
  return [
    `${score}. ${tag}.`,
    `${model} le dio ${pct(realProbability(entry))} al desenlace real y dejo una mejora de ${liftOf(entry) >= 0 ? "+" : ""}${pct(liftOf(entry))}.`,
    `Replay + autopsia: ${publicDiaryUrl(entry)}`,
    "#MundialLab #FootballAnalytics #DataScience",
  ].join("\n");
}

function technicalSummary(entry: LearningLogEntry) {
  const params = parseParameters(entry);
  const metadata = params as Record<string, unknown>;
  const contract = params.best_contract as Record<string, unknown> | undefined;
  const tags = highlightTags(entry);
  return [
    `Partido: ${entry.home_team} ${entry.home_score}-${entry.away_score} ${entry.away_team}`,
    `Modelo: ${modelLabels[familyOf(entry)] ?? entry.best_model}`,
    `Contrato ganador: ${contractName(entry)}`,
    `Desenlace evaluado: ${outcomeLabel(entry)}`,
    `Probabilidad original: ${pct(originalProbability(entry))}`,
    `Probabilidad calibrada: ${pct(realProbability(entry))}`,
    `Mejora contra lectura original: ${liftOf(entry) >= 0 ? "+" : ""}${pct(liftOf(entry))}`,
    `Sede: ${entry.venue}`,
    tags.length ? `Senales editoriales: ${tags.join(", ")}` : "",
    metadata.stadium_factor ? `Factor estadio: ${Number(metadata.stadium_factor).toFixed(2)}` : "",
    contract?.notes ? `Nota del contrato: ${String(contract.notes)}` : "",
  ].filter(Boolean).join("\n");
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text);
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo generar la tarjeta."));
    }, "image/png");
  });
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
  lines.forEach((current, index) => ctx.fillText(current, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function cardTheme(entry: LearningLogEntry) {
  const tag = highlightTags(entry)[0] ?? "";
  if (tag.includes("xG")) return { a: "#082f49", b: "#0f766e", c: "#67e8f9", accent: "#facc15" };
  if (tag.includes("Estadio")) return { a: "#052e16", b: "#365314", c: "#86efac", accent: "#fbbf24" };
  if (tag.includes("Empate")) return { a: "#111827", b: "#713f12", c: "#fde68a", accent: "#5eead4" };
  if (tag.includes("sufrio") || tag.includes("Sorpresa")) return { a: "#18181b", b: "#7f1d1d", c: "#fb7185", accent: "#fbbf24" };
  if (tag.includes("salio fino")) return { a: "#0f172a", b: "#312e81", c: "#c4b5fd", accent: "#5eead4" };
  return { a: "#071118", b: "#064e3b", c: "#7ee2a8", accent: "#facc15" };
}

function generateAutopsyShareCanvas(entry: LearningLogEntry) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo abrir el canvas.");
  const theme = cardTheme(entry);
  const family = familyOf(entry);
  const tag = highlightTags(entry)[0] ?? "Autopsia del modelo";
  const score = `${entry.home_team} ${entry.home_score}-${entry.away_score} ${entry.away_team}`;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, theme.a);
  gradient.addColorStop(0.5, theme.b);
  gradient.addColorStop(1, "#020617");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1350);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = theme.c;
  ctx.lineWidth = 3;
  for (let i = 0; i < 18; i += 1) {
    ctx.beginPath();
    ctx.ellipse(540, 700, 180 + i * 34, 72 + i * 18, -0.32, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 170; i += 1) {
    const x = (i * 89) % 1080;
    const y = (i * 137) % 1350;
    ctx.fillRect(x, y, i % 5 === 0 ? 5 : 2, i % 7 === 0 ? 5 : 2);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(78, 98, 924, 1138);
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.lineWidth = 2;
  ctx.strokeRect(78, 98, 924, 1138);

  ctx.fillStyle = theme.accent;
  ctx.font = "900 30px Arial";
  ctx.fillText("MUNDIAL LAB AUTOPSIA", 116, 160);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 76px Arial";
  drawWrappedText(ctx, score, 116, 260, 848, 82, 3);

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(116, 515, 848, 170);
  ctx.fillStyle = theme.c;
  ctx.font = "900 30px Arial";
  ctx.fillText(tag.toUpperCase(), 146, 570);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 39px Arial";
  drawWrappedText(ctx, editorialHeadline(entry), 146, 632, 790, 44, 2);

  const metrics = [
    ["Desenlace real", pct(realProbability(entry))],
    ["Aprendio", modelLabels[family] ?? family],
    ["Mejora", `${liftOf(entry) >= 0 ? "+" : ""}${pct(liftOf(entry))}`],
  ];
  metrics.forEach(([label, value], index) => {
    const x = 116 + index * 288;
    ctx.fillStyle = index === 0 ? "rgba(126,226,168,0.2)" : "rgba(255,255,255,0.1)";
    ctx.fillRect(x, 725, 258, 142);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = "900 23px Arial";
    ctx.fillText(label.toUpperCase(), x + 22, 770);
    ctx.fillStyle = index === 0 ? theme.c : "#ffffff";
    ctx.font = "900 43px Arial";
    drawWrappedText(ctx, value, x + 22, 830, 212, 46, 1);
  });

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 44px Arial";
  ctx.fillText("Lectura para publicar", 116, 955);
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "700 31px Arial";
  drawWrappedText(ctx, entry.lesson, 116, 1012, 848, 40, 4);

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(116, 1165, 848, 1);
  ctx.fillStyle = theme.c;
  ctx.font = "900 27px Arial";
  ctx.fillText("VER REPLAY + AUTOPSIA", 116, 1218);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "800 23px Arial";
  ctx.fillText(`mundial.hadox.org/diario-aprendizaje/?match=${entry.slug}`, 116, 1250);
  ctx.fillText(`Reta la lectura en /partidos/${entry.slug}/ - ${entry.venue}`, 116, 1286);

  return canvas;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function groupCounts(entries: LearningLogEntry[]) {
  return entries.reduce<Record<string, number>>((acc, entry) => {
    const key = familyOf(entry);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function modelRanking(entries: LearningLogEntry[]) {
  const groups = new Map<string, { count: number; lift: number; real: number; highlights: number }>();
  for (const entry of entries) {
    const key = familyOf(entry);
    const current = groups.get(key) ?? { count: 0, lift: 0, real: 0, highlights: 0 };
    current.count += 1;
    current.lift += liftOf(entry);
    current.real += realProbability(entry);
    current.highlights += highlightTags(entry).length ? 1 : 0;
    groups.set(key, current);
  }
  return Array.from(groups.entries())
    .map(([key, value]) => ({
      key,
      label: modelLabels[key] ?? key,
      count: value.count,
      avgLift: value.count ? value.lift / value.count : 0,
      avgReal: value.count ? value.real / value.count : 0,
      highlights: value.highlights,
      score: value.highlights * 5 + value.real + Math.max(0, value.lift) * 20,
    }))
    .sort((a, b) => b.score - a.score);
}

function tagRanking(entries: LearningLogEntry[]) {
  const tags = new Map<string, { count: number; lift: number }>();
  for (const entry of entries) {
    for (const tag of highlightTags(entry)) {
      const current = tags.get(tag) ?? { count: 0, lift: 0 };
      current.count += 1;
      current.lift += Math.max(0, liftOf(entry));
      tags.set(tag, current);
    }
  }
  return Array.from(tags.entries())
    .map(([tag, value]) => ({ tag, count: value.count, avgLift: value.count ? value.lift / value.count : 0 }))
    .sort((a, b) => b.count - a.count || b.avgLift - a.avgLift);
}

function modelUrlKey(entry: LearningLogEntry) {
  return familyOf(entry);
}

function focusedSort(a: LearningLogEntry, b: LearningLogEntry) {
  const order = ["casa", "poisson", "elo", "dixon_coles", "bayes_live", "ensemble"];
  const aIndex = order.indexOf(familyOf(a));
  const bIndex = order.indexOf(familyOf(b));
  return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || highlightScore(b) - highlightScore(a);
}

function comparisonWinner(entries: LearningLogEntry[]) {
  return [...entries].sort((a, b) => realProbability(b) - realProbability(a) || liftOf(b) - liftOf(a))[0];
}

function modelImpactLine(entry: LearningLogEntry) {
  const family = familyOf(entry);
  const params = parseParameters(entry);
  if (family === "casa") return params.best_contract?.contract ?? "mejor contrato calibrado";
  if (family === "poisson") return "lambda de gol y distribucion de marcadores";
  if (family === "elo") return "jerarquia historica y forma competitiva";
  if (family === "dixon_coles") return "empates y marcadores bajos";
  if (family === "bayes_live") return "prior corregido con evidencia viva";
  if (family === "ensemble") return "mezcla de senales y desacuerdo";
  return "lectura del modelo";
}

function whyItMatters(entry: LearningLogEntry) {
  const tag = highlightTags(entry)[0] ?? "Lectura publicable";
  const family = familyOf(entry);
  if (tag.includes("Sorpresa")) {
    return "Sirve para mostrar donde el modelo corrigio una primera lectura floja. Eso es aprendizaje visible, no marcador maquillado.";
  }
  if (tag.includes("Empate")) {
    return "Los empates rompen muchas quinielas. Esta autopsia ensena cuando conviene escuchar la incertidumbre.";
  }
  if (tag.includes("xG")) {
    return "La senal de tiros no reemplaza al futbol, pero ayuda a explicar por que una lectura subio despues de ver peligro real.";
  }
  if (tag.includes("Estadio")) {
    return "El contexto tambien juega. Esta pieza ayuda a hablar de sede, presion y condiciones sin vender humo.";
  }
  if (tag.includes("salio fino")) {
    return `${modelLabels[family] ?? entry.best_model} encontro una lectura defendible. Buen caso para ensenar como opera el modelo.`;
  }
  return "Convierte un resultado cerrado en una leccion breve: que penso el modelo, que paso, y que se ajusta para el siguiente partido.";
}

function nextActionFor(entry: LearningLogEntry) {
  const family = familyOf(entry);
  if (family === "casa") return "Revisar si el contrato ganador debe pesar mas en la siguiente corrida Monte Carlo.";
  if (family === "poisson") return "Comparar lambdas contra tiros/xG reales antes de tocar ataque o defensa.";
  if (family === "elo") return "Ver si la jerarquia historica quedo vieja frente a forma reciente y alineacion.";
  if (family === "dixon_coles") return "Auditar si el partido merecia mas masa en marcadores bajos y empate.";
  if (family === "bayes_live") return "Separar evidencia viva de ruido: tiros buenos, tarjetas, cambios y momentum.";
  if (family === "ensemble") return "Medir desacuerdo entre modelos antes de subir confianza.";
  return "Usar esta autopsia como caso de entrenamiento.";
}

function comparisonCopy(entry: LearningLogEntry, entries: LearningLogEntry[]) {
  const ranking = [...entries]
    .sort((a, b) => realProbability(b) - realProbability(a))
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${modelLabels[familyOf(item)] ?? item.best_model}: ${pct(realProbability(item))}`)
    .join("\n");
  return [
    `El modelo que mejor leyo ${entry.home_team} ${entry.home_score}-${entry.away_score} ${entry.away_team} fue ${modelLabels[familyOf(entry)] ?? entry.best_model}.`,
    "",
    `Le dio ${pct(realProbability(entry))} al desenlace real.`,
    `La senal clave: ${modelImpactLine(entry)}.`,
    "",
    "Tabla corta:",
    ranking,
    "",
    `Autopsia completa: ${publicDiaryUrl(entry)}`,
    `Replay 3D: ${publicReplayUrl(entry)}`,
    "#MundialLab #FootballAnalytics #DataScience",
  ].join("\n");
}

function generateComparisonWinnerCanvas(entry: LearningLogEntry, entries: LearningLogEntry[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo abrir el canvas.");
  const score = `${entry.home_team} ${entry.home_score}-${entry.away_score} ${entry.away_team}`;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, "#071118");
  gradient.addColorStop(0.58, "#0f766e");
  gradient.addColorStop(1, "#020617");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(74, 86, 932, 1178);
  ctx.strokeStyle = "rgba(126,226,168,0.34)";
  ctx.strokeRect(74, 86, 932, 1178);

  ctx.globalAlpha = 0.17;
  ctx.strokeStyle = "#7ee2a8";
  for (let i = 0; i < 14; i += 1) {
    ctx.beginPath();
    ctx.arc(810 - i * 18, 332 + i * 42, 120 + i * 20, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#7ee2a8";
  ctx.font = "900 32px Arial";
  ctx.fillText("AUTOPSIA COMPARATIVA", 116, 160);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 88px Arial";
  drawWrappedText(ctx, score, 116, 270, 820, 92, 2);
  ctx.fillStyle = "#facc15";
  ctx.font = "900 42px Arial";
  ctx.fillText("GANO LA LECTURA", 116, 520);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 92px Arial";
  drawWrappedText(ctx, modelLabels[familyOf(entry)] ?? entry.best_model, 116, 635, 820, 88, 2);
  ctx.fillStyle = "#7ee2a8";
  ctx.font = "900 72px Arial";
  ctx.fillText(`${pct(realProbability(entry))}`, 116, 830);
  ctx.fillStyle = "rgba(255,255,255,0.84)";
  ctx.font = "700 34px Arial";
  drawWrappedText(ctx, `Senal clave: ${modelImpactLine(entry)}.`, 116, 900, 820, 44, 3);

  const top = [...entries].sort((a, b) => realProbability(b) - realProbability(a)).slice(0, 4);
  ctx.font = "800 30px Arial";
  top.forEach((item, index) => {
    const y = 1060 + index * 48;
    ctx.fillStyle = index === 0 ? "#facc15" : "rgba(255,255,255,0.82)";
    ctx.fillText(`${index + 1}. ${modelLabels[familyOf(item)] ?? item.best_model}`, 116, y);
    ctx.fillText(pct(realProbability(item)), 820, y);
  });

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "800 23px Arial";
  ctx.fillText(`mundial.hadox.org/diario-aprendizaje/?match=${entry.slug}`, 116, 1260);
  return canvas;
}

function coverageItems(match?: DataQualitySummary["matches"][number]) {
  if (!match) {
    return [
      ["resultado", false],
      ["lineups", false],
      ["stats", false],
      ["tiros", false],
      ["xG", false],
      ["clima", false],
    ] as const;
  }
  return [
    ["resultado", match.result_trust_level === "real_verificado"],
    ["lineups", match.has_lineups],
    ["stats", match.has_live_features],
    ["tiros", match.has_shots],
    ["xG", match.has_xg],
    ["clima", match.has_weather],
  ] as const;
}

function LearningLogPage() {
  const [entries, setEntries] = useState<LearningLogEntry[]>([]);
  const [quality, setQuality] = useState<DataQualitySummary | null>(null);
  const [mode, setMode] = useState("cargando");
  const [filter, setFilter] = useState<LearningFilter>(() => {
    const model = new URLSearchParams(window.location.search).get("model") ?? "";
    if (model === "casa" || modelFilterValues.has(model)) return model as LearningFilter;
    return "destacadas";
  });
  const [shareCards, setShareCards] = useState<Record<number, { image: string; text: string }>>({});
  const [sharingId, setSharingId] = useState<number | null>(null);
  const [comparisonCard, setComparisonCard] = useState<{ image: string; text: string } | null>(null);
  const [comparisonSharing, setComparisonSharing] = useState(false);
  const query = new URLSearchParams(window.location.search);
  const selectedMatchSlug = query.get("match") ?? "";
  const selectedModel = query.get("model") ?? "";

  useEffect(() => {
    fetchLearningLog(100)
      .then((items) => {
        setEntries(items);
        setMode(items.length ? "api conectada" : "sin entradas");
      })
      .catch(() => setMode("sin api"));
    fetchPublicDataQuality()
      .then(setQuality)
      .catch(() => setQuality(null));
  }, []);

  const highlighted = useMemo(
    () => entries
      .filter((entry) => highlightTags(entry).length > 0)
      .sort((a, b) => highlightScore(b) - highlightScore(a)),
    [entries],
  );

  const filteredEntries = useMemo(() => {
    if (filter === "destacadas") return highlighted;
    if (filter === "todo") return entries;
    if (filter === "casa") return entries.filter((entry) => familyOf(entry) === "casa");
    if (filter === "modelos") return entries.filter((entry) => familyOf(entry) !== "casa");
    if (filter.startsWith("tag:")) {
      const tag = filter.slice(4);
      return entries.filter((entry) => highlightTags(entry).includes(tag));
    }
    return entries.filter((entry) => entry.best_model === filter && stageOf(entry) === "model_autopsy");
  }, [entries, filter, highlighted]);

  const counts = useMemo(() => groupCounts(entries), [entries]);
  const rankedModels = useMemo(() => modelRanking(entries), [entries]);
  const rankedTags = useMemo(() => tagRanking(entries), [entries]);
  const focusedMatchEntries = useMemo(() => {
    if (!selectedMatchSlug) return [];
    return entries
      .filter((entry) => entry.slug === selectedMatchSlug)
      .filter((entry) => !selectedModel || modelUrlKey(entry) === selectedModel || entry.best_model === selectedModel)
      .sort(focusedSort);
  }, [entries, selectedMatchSlug, selectedModel]);
  const focusedAllModels = useMemo(() => {
    if (!selectedMatchSlug) return [];
    return entries.filter((entry) => entry.slug === selectedMatchSlug).sort(focusedSort);
  }, [entries, selectedMatchSlug]);
  const focusedComparison = useMemo(
    () => [...focusedAllModels].sort((a, b) => realProbability(b) - realProbability(a) || liftOf(b) - liftOf(a)),
    [focusedAllModels],
  );
  const matchWinner = focusedComparison.length ? comparisonWinner(focusedComparison) : null;
  const focusedQuality = useMemo(
    () => quality?.matches.find((match) => match.slug === selectedMatchSlug),
    [quality, selectedMatchSlug],
  );
  const focusedModelTabs = useMemo(() => {
    const tabs = new Map<string, LearningLogEntry>();
    for (const entry of focusedAllModels) {
      const key = modelUrlKey(entry);
      const current = tabs.get(key);
      if (!current || highlightScore(entry) > highlightScore(current)) tabs.set(key, entry);
    }
    return Array.from(tabs.values()).sort(focusedSort);
  }, [focusedAllModels]);

  const signalRanking = useMemo(() => {
    const signals = new Map<string, { count: number; lift: number }>();
    for (const entry of entries) {
      const params = parseParameters(entry);
      if (!params.best_contract?.contract) continue;
      const name = params.best_contract.contract;
      const current = signals.get(name) ?? { count: 0, lift: 0 };
      current.count += 1;
      current.lift += Number(params.outcome_probability_lift ?? 0);
      signals.set(name, current);
    }
    return Array.from(signals.entries())
      .map(([name, value]) => ({ name, count: value.count, avgLift: value.count ? value.lift / value.count : 0 }))
      .sort((a, b) => b.count - a.count || b.avgLift - a.avgLift);
  }, [entries]);

  const avgLift = useMemo(() => {
    const calibrated = entries
      .filter((entry) => stageOf(entry) === "calibrated_autopsy")
      .map((entry) => liftOf(entry));
    if (!calibrated.length) return 0;
    return calibrated.reduce((sum, value) => sum + Number(value), 0) / calibrated.length;
  }, [entries]);

  const featured = focusedMatchEntries[0] ?? highlighted[0] ?? entries[0];
  const kitEntry = focusedMatchEntries[0] ?? focusedAllModels[0];
  const coverStories = highlighted.slice(0, 5);
  const newestEntry = useMemo(
    () => [...entries].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0],
    [entries],
  );
  const newestMatchEntries = useMemo(
    () => newestEntry ? entries.filter((entry) => entry.slug === newestEntry.slug) : [],
    [entries, newestEntry],
  );

  async function createAutopsyCard(entry: LearningLogEntry) {
    setSharingId(entry.id);
    try {
      const canvas = generateAutopsyShareCanvas(entry);
      const image = canvas.toDataURL("image/png");
      const text = editorialCopy(entry);
      setShareCards((current) => ({ ...current, [entry.id]: { image, text } }));
      return { canvas, image, text };
    } finally {
      setSharingId(null);
    }
  }

  async function downloadAutopsyCard(entry: LearningLogEntry) {
    const { canvas } = await createAutopsyCard(entry);
    const blob = await canvasBlob(canvas);
    downloadBlob(blob, `${entry.slug}-${entry.best_model}-autopsia.png`);
  }

  async function shareAutopsyCard(entry: LearningLogEntry) {
    const { canvas, text } = await createAutopsyCard(entry);
    const blob = await canvasBlob(canvas);
    const file = new File([blob], `${entry.slug}-${entry.best_model}-autopsia.png`, { type: "image/png" });
    const sharePayload = { title: editorialHeadline(entry), text, files: [file] };
    if (navigator.canShare?.(sharePayload)) {
      await navigator.share(sharePayload);
      return;
    }
    await copyText(text);
    downloadBlob(blob, file.name);
  }

  async function createComparisonCard() {
    if (!matchWinner) return null;
    setComparisonSharing(true);
    try {
      const canvas = generateComparisonWinnerCanvas(matchWinner, focusedComparison);
      const image = canvas.toDataURL("image/png");
      const text = comparisonCopy(matchWinner, focusedComparison);
      setComparisonCard({ image, text });
      return { canvas, image, text };
    } finally {
      setComparisonSharing(false);
    }
  }

  async function downloadComparisonCard() {
    const generated = await createComparisonCard();
    if (!generated || !matchWinner) return;
    const blob = await canvasBlob(generated.canvas);
    downloadBlob(blob, `${matchWinner.slug}-comparativa-modelos.png`);
  }

  async function shareComparisonCard() {
    const generated = await createComparisonCard();
    if (!generated || !matchWinner) return;
    const blob = await canvasBlob(generated.canvas);
    const file = new File([blob], `${matchWinner.slug}-comparativa-modelos.png`, { type: "image/png" });
    const sharePayload = { title: "Autopsia comparativa Mundial Lab", text: generated.text, files: [file] };
    if (navigator.canShare?.(sharePayload)) {
      await navigator.share(sharePayload);
      return;
    }
    await copyText(generated.text);
    downloadBlob(blob, file.name);
  }

  return (
    <main>
      <nav className="nav page-nav" aria-label="Navegacion principal">
        <a className="brand" href="/">
          <Trophy size={22} />
          <span>Mundial Lab</span>
        </a>
        <div className="nav-links">
          <a href="/montecarlo-casa/">Monte Carlo</a>
          <a href="/partidos/">Partidos</a>
          <a href="/laboratorio-datos/">Datos</a>
          <a href="/directores/">Directores</a>
        </div>
      </nav>

      <section className="learning-hero editorial-learning-hero">
        <div>
          <p className="section-kicker">Diario editorial de aprendizaje</p>
          <h1>El Mundial tambien se gana despues del silbatazo.</h1>
          <p>
            Cada marcador cerrado deja una autopsia publicable: que entendio Monte Carlo, que modelo
            vio mejor la jugada y que senal merece mas peso antes del siguiente partido.
          </p>
          <div className="hero-actions">
            <a href="/montecarlo-casa/">Ver linea de la casa</a>
            <a className="ghost" href="/partidos/">Entrar a partidos</a>
          </div>
        </div>
        <aside className="learning-feature">
          <span>{mode}</span>
          <strong>{newestEntry ? `Nueva autopsia: ${newestEntry.home_team} ${newestEntry.home_score}-${newestEntry.away_score} ${newestEntry.away_team}` : featured ? editorialHeadline(featured) : "Aun no hay autopsias destacadas."}</strong>
          <p>{newestEntry ? newestEntry.lesson : featured ? featured.lesson : "Cuando cierren partidos, aqui se vera que esta aprendiendo cada modelo."}</p>
          {newestEntry && (
            <a href={`/diario-aprendizaje/?match=${newestEntry.slug}`}>
              Ver paquete del partido
            </a>
          )}
        </aside>
      </section>

      <section className="learning-kpis editorial-learning-kpis">
        <article>
          <strong>{highlighted.length}</strong>
          <span>autopsias destacadas</span>
        </article>
        <article>
          <strong>{counts.casa ?? 0}</strong>
          <span>lecturas Monte Carlo</span>
        </article>
        <article>
          <strong>{(counts.elo ?? 0) + (counts.poisson ?? 0) + (counts.dixon_coles ?? 0) + (counts.bayes_live ?? 0) + (counts.ensemble ?? 0)}</strong>
          <span>autopsias educativas</span>
        </article>
        <article>
          <strong>{pct(Math.max(0, avgLift))}</strong>
          <span>mejora media de calibracion</span>
        </article>
        <article>
          <strong>{newestMatchEntries.length}</strong>
          <span>autopsias del ultimo cierre</span>
        </article>
      </section>

      <section className="learning-cover-desk">
        <div className="learning-cover-head">
          <div>
            <p className="section-kicker">Portada publicable</p>
            <h2>Las autopsias que si dan historia.</h2>
            <p>
              No todo resultado merece post. Estas piezas tienen gancho: sorpresa, empate,
              senal nueva o una calibracion que cambio la lectura.
            </p>
          </div>
          <div className="learning-cover-filters">
            {rankedTags.slice(0, 5).map((tag) => (
              <button
                className={filter === `tag:${tag.tag}` ? "active" : ""}
                key={tag.tag}
                onClick={() => setFilter(`tag:${tag.tag}`)}
                type="button"
              >
                {tag.tag}
                <strong>{tag.count}</strong>
              </button>
            ))}
          </div>
        </div>
        {coverStories.length ? (
          <div className="learning-cover-grid">
            {coverStories.map((entry, index) => (
              <article className={index === 0 ? "is-main" : ""} key={`cover-${entry.id}`}>
                <span>{highlightTags(entry)[0] ?? "Autopsia"}</span>
                <h3>{editorialHeadline(entry)}</h3>
                <p>{whyItMatters(entry)}</p>
                <div className="learning-cover-metrics">
                  <b>{pct(realProbability(entry))}</b>
                  <small>al desenlace real</small>
                  <b>{liftOf(entry) >= 0 ? "+" : ""}{pct(liftOf(entry))}</b>
                  <small>mejora</small>
                </div>
                <em>{nextActionFor(entry)}</em>
                <div className="learning-cover-actions">
                  <button onClick={() => copyText(editorialCopy(entry))} type="button">
                    <Clipboard size={15} />
                    Copiar post
                  </button>
                  <button onClick={() => createAutopsyCard(entry)} type="button">
                    <ImageDown size={15} />
                    {sharingId === entry.id ? "Creando..." : "Tarjeta"}
                  </button>
                  <a href={`/diario-aprendizaje/?match=${entry.slug}&model=${modelUrlKey(entry)}`}>
                    Ver autopsia
                  </a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="learning-cover-empty">
            <strong>Esperando resultados cerrados.</strong>
            <p>Cuando la cola termine autopsias, aqui aparecen las historias listas para publicar.</p>
          </div>
        )}
      </section>

      {selectedMatchSlug && (
        <section className="focused-autopsy">
          {focusedAllModels.length ? (
            <>
              <div className="focused-autopsy-head">
                <div>
                  <p className="section-kicker">Autopsia enfocada</p>
                  <h2>
                    {focusedAllModels[0].home_team} {focusedAllModels[0].home_score}-{focusedAllModels[0].away_score}{" "}
                    {focusedAllModels[0].away_team}
                  </h2>
                  <p>
                    Esta URL abre directo la evidencia del partido. Puedes comparar modelos,
                    compartir una tarjeta o saltar al replay sin pasar por todo el Diario.
                  </p>
                </div>
                <div className="focused-autopsy-actions">
                  <a href={`/simulador-partido/?match=${selectedMatchSlug}`}>Ver replay 3D</a>
                  <a href={`/partidos/${selectedMatchSlug}/`}>Retar lectura</a>
                  <a href="/diario-aprendizaje/">Ver Diario completo</a>
                </div>
              </div>
              <div className="focused-model-tabs">
                <a className={!selectedModel ? "active" : ""} href={`/diario-aprendizaje/?match=${selectedMatchSlug}`}>
                  Todos <strong>{focusedAllModels.length}</strong>
                </a>
                {focusedModelTabs.map((entry) => (
                  <a
                    className={selectedModel === modelUrlKey(entry) || selectedModel === entry.best_model ? "active" : ""}
                    href={`/diario-aprendizaje/?match=${selectedMatchSlug}&model=${modelUrlKey(entry)}`}
                    key={`${entry.id}-${modelUrlKey(entry)}`}
                  >
                    {modelLabels[familyOf(entry)] ?? entry.best_model}
                    <strong>{pct(realProbability(entry))}</strong>
                  </a>
                ))}
              </div>
              {kitEntry && (
                <div className="publication-kit">
                  <div className="publication-kit-head">
                    <div>
                      <p className="section-kicker">Kit publicable del partido</p>
                      <h3>{editorialHeadline(kitEntry)}</h3>
                      <p>
                        Un paquete listo para sacar la autopsia a LinkedIn, Instagram o X:
                        imagen, copy corto, copy largo y ficha tecnica de la lectura.
                      </p>
                    </div>
                    <div className="publication-kit-actions">
                      <button onClick={() => createAutopsyCard(kitEntry)} type="button">
                        <ImageDown size={15} />
                        {sharingId === kitEntry.id ? "Creando..." : "Crear tarjeta"}
                      </button>
                      <button onClick={() => downloadAutopsyCard(kitEntry)} type="button">
                        <ImageDown size={15} />
                        Descargar PNG
                      </button>
                      <button onClick={() => shareAutopsyCard(kitEntry)} type="button">
                        <Share2 size={15} />
                        Compartir imagen
                      </button>
                    </div>
                  </div>
                  <div className="publication-kit-grid">
                    <article className="publication-kit-card">
                      <span>Modelo que mejor explica</span>
                      <strong>{modelLabels[familyOf(kitEntry)] ?? kitEntry.best_model}</strong>
                    </article>
                    <article className="publication-kit-card">
                      <span>Al desenlace real</span>
                      <strong>{pct(realProbability(kitEntry))}</strong>
                    </article>
                    <article className="publication-kit-card">
                      <span>Mejora calibrada</span>
                      <strong>{liftOf(kitEntry) >= 0 ? "+" : ""}{pct(liftOf(kitEntry))}</strong>
                    </article>
                    <article className="publication-kit-card">
                      <span>Gancho editorial</span>
                      <strong>{highlightTags(kitEntry)[0] ?? "Autopsia publicable"}</strong>
                    </article>
                  </div>
                  <div className="publication-kit-copy">
                    <label className="suggested-copy learning-copy-box">
                      <span>Copy LinkedIn largo</span>
                      <textarea readOnly value={editorialCopy(kitEntry)} />
                      <button onClick={() => copyText(editorialCopy(kitEntry))} type="button">
                        <Clipboard size={15} />
                        Copiar LinkedIn
                      </button>
                    </label>
                    <label className="suggested-copy learning-copy-box">
                      <span>Copy Instagram / X</span>
                      <textarea readOnly value={shortSocialCopy(kitEntry)} />
                      <button onClick={() => copyText(shortSocialCopy(kitEntry))} type="button">
                        <Clipboard size={15} />
                        Copiar social corto
                      </button>
                    </label>
                    <label className="suggested-copy learning-copy-box">
                      <span>Resumen tecnico</span>
                      <textarea readOnly value={technicalSummary(kitEntry)} />
                      <button onClick={() => copyText(technicalSummary(kitEntry))} type="button">
                        <Clipboard size={15} />
                        Copiar ficha tecnica
                      </button>
                    </label>
                    <div className="publication-kit-preview">
                      {shareCards[kitEntry.id] ? (
                        <img alt={`Kit publicable de ${kitEntry.home_team} vs ${kitEntry.away_team}`} src={shareCards[kitEntry.id].image} />
                      ) : (
                        <div>
                          <Sparkles size={28} />
                          <strong>Tarjeta pendiente</strong>
                          <p>Genera la imagen 4:5 para publicar la autopsia del partido.</p>
                        </div>
                      )}
                      <div className="publication-kit-links">
                        <a href={publicReplayUrl(kitEntry)}>Replay 3D</a>
                        <a href={publicMatchUrl(kitEntry)}>Sala del partido</a>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {matchWinner && (
                <div className="match-comparison-kit">
                  <div className="match-comparison-head">
                    <div>
                      <p className="section-kicker">Autopsia comparativa del partido</p>
                      <h3>Gano la lectura: {modelLabels[familyOf(matchWinner)] ?? matchWinner.best_model}</h3>
                      <p>
                        Aqui no gana el modelo mas elegante: gana quien le dio mas probabilidad al desenlace real
                        antes de conocer el marcador.
                      </p>
                    </div>
                    <div className="match-comparison-winner">
                      <span>Al resultado real</span>
                      <strong>{pct(realProbability(matchWinner))}</strong>
                      <small>{modelImpactLine(matchWinner)}</small>
                    </div>
                  </div>
                  <div className="match-comparison-actions">
                    <button onClick={() => createComparisonCard()} type="button">
                      <ImageDown size={15} />
                      {comparisonSharing ? "Creando..." : "Crear tarjeta comparativa"}
                    </button>
                    <button onClick={() => downloadComparisonCard()} type="button">
                      <ImageDown size={15} />
                      Descargar PNG
                    </button>
                    <button onClick={() => shareComparisonCard()} type="button">
                      <Share2 size={15} />
                      Compartir ganadora
                    </button>
                    <button onClick={() => copyText(comparisonCopy(matchWinner, focusedComparison))} type="button">
                      <Clipboard size={15} />
                      Copiar copy
                    </button>
                  </div>
                  <div className="match-comparison-grid">
                    {focusedComparison.map((entry, index) => (
                      <article className={entry.id === matchWinner.id ? "is-winner" : ""} key={`comparison-${entry.id}`}>
                        <b>{index + 1}</b>
                        <span>
                          <strong>{modelLabels[familyOf(entry)] ?? entry.best_model}</strong>
                          <small>{modelImpactLine(entry)}</small>
                        </span>
                        <em>{pct(realProbability(entry))}</em>
                        <i>{liftOf(entry) >= 0 ? "+" : ""}{pct(liftOf(entry))}</i>
                      </article>
                    ))}
                  </div>
                  <div className="match-comparison-preview">
                    {comparisonCard ? (
                      <>
                        <img alt={`Tarjeta comparativa de ${matchWinner.home_team} vs ${matchWinner.away_team}`} src={comparisonCard.image} />
                        <label className="suggested-copy learning-copy-box">
                          <span>Copy sugerido de la comparativa</span>
                          <textarea readOnly value={comparisonCard.text} />
                        </label>
                      </>
                    ) : (
                      <div>
                        <Sparkles size={28} />
                        <strong>Tarjeta comparativa pendiente</strong>
                        <p>Genera la imagen para publicar que modelo leyo mejor este partido.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="autopsy-data-evidence">
                <div>
                  <p className="section-kicker">Datos detras de esta autopsia</p>
                  <h3>La lectura se entiende mejor cuando se ve la cobertura.</h3>
                  <p>
                    Estos badges vienen del laboratorio de datos. Si algo aparece pendiente, la autopsia
                    debe leerse como modelo educativo, no como certeza dura.
                  </p>
                </div>
                <div className="autopsy-data-badges">
                  {coverageItems(focusedQuality).map(([label, ok]) => (
                    <span className={ok ? "ok" : "pending"} key={label}>{label}</span>
                  ))}
                </div>
                <a href="/laboratorio-datos/">Abrir laboratorio de datos</a>
              </div>
              <div className="focused-autopsy-grid">
                {focusedMatchEntries.map((entry) => (
                  <article className="focused-autopsy-card" key={entry.id}>
                    <span>{modelLabels[familyOf(entry)] ?? entry.best_model}</span>
                    <h3>{editorialHeadline(entry)}</h3>
                    <p>{entry.lesson}</p>
                    <div>
                      <b>{pct(realProbability(entry))}</b>
                      <small>al desenlace real</small>
                      <b>{liftOf(entry) >= 0 ? "+" : ""}{pct(liftOf(entry))}</b>
                      <small>mejora</small>
                    </div>
                    <label className="suggested-copy learning-copy-box">
                      <span>Copy sugerido para esta autopsia</span>
                      <textarea readOnly value={editorialCopy(entry)} />
                    </label>
                    {shareCards[entry.id] && (
                      <div className="learning-share-preview compact">
                        <img alt={`Tarjeta editorial de ${entry.home_team} vs ${entry.away_team}`} src={shareCards[entry.id].image} />
                        <div>
                          <strong>Tarjeta lista</strong>
                          <p>Comparte esta lectura enfocada del partido.</p>
                        </div>
                      </div>
                    )}
                    <div className="learning-actions">
                      <button onClick={() => copyText(editorialCopy(entry))} type="button">
                        <Clipboard size={15} />
                        Copiar post
                      </button>
                      <button onClick={() => createAutopsyCard(entry)} type="button">
                        <ImageDown size={15} />
                        {sharingId === entry.id ? "Creando..." : "Crear tarjeta"}
                      </button>
                      <button onClick={() => shareAutopsyCard(entry)} type="button">
                        <Share2 size={15} />
                        Compartir imagen
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="focused-autopsy-empty">
              <p className="section-kicker">Autopsia enfocada</p>
              <h2>No encontre autopsias para este partido.</h2>
              <p>
                Puede que la cola automatica todavia no haya procesado el resultado o que el enlace
                tenga un slug distinto.
              </p>
              <a href="/diario-aprendizaje/">Volver al Diario completo</a>
            </div>
          )}
        </section>
      )}

      <section className="learning-rankings">
        <article>
          <div className="workflow-title">
            <Trophy />
            <div>
              <h2>Ranking vivo de aprendizaje</h2>
              <p className="learning-ranking-note">
                Se ordena por autopsias destacadas, probabilidad al desenlace real y mejora calibrada.
              </p>
            </div>
          </div>
          <div className="learning-ranking-list">
            {rankedModels.slice(0, 5).map((model, index) => (
              <button key={model.key} onClick={() => setFilter(model.key === "casa" ? "casa" : model.key as LearningFilter)} type="button">
                <b>{index + 1}</b>
                <span>
                  <strong>{model.label}</strong>
                  <small>{model.count} autopsias - {model.highlights} destacadas</small>
                </span>
                <em>{pct(model.avgReal)}</em>
                <i>+{pct(Math.max(0, model.avgLift))}</i>
              </button>
            ))}
            {!rankedModels.length && <p>El ranking aparece cuando lleguen autopsias automaticas.</p>}
          </div>
        </article>
        <article>
          <div className="workflow-title">
            <Flame />
            <h2>Ganchos para publicar</h2>
          </div>
          <div className="learning-ranking-list compact">
            {rankedTags.slice(0, 6).map((tag) => (
              <span key={tag.tag}>
                <strong>{tag.tag}</strong>
                <small>{tag.count} veces - mejora media +{pct(tag.avgLift)}</small>
              </span>
            ))}
            {!rankedTags.length && <p>Cuando haya cierres reales, aqui saldran las historias que valen post.</p>}
          </div>
        </article>
      </section>

      <section className="learning-filter-bar">
        <div>
          <Filter size={17} />
          <strong>Ver aprendizaje de</strong>
        </div>
        {([
          ["destacadas", "Destacadas"],
          ["casa", "Monte Carlo"],
          ["modelos", "Modelos"],
          ["poisson", "Poisson"],
          ["elo", "Elo"],
          ["dixon_coles", "Dixon-Coles"],
          ["bayes_live", "Bayes"],
          ["ensemble", "Ensamble"],
          ["todo", "Todo"],
        ] as [LearningFilter, string][]).map(([key, label]) => (
          <button className={filter === key ? "active" : ""} key={key} onClick={() => setFilter(key)} type="button">
            {label}
          </button>
        ))}
      </section>

      <section className="learning-layout editorial-learning-layout">
        <aside className="learning-signals">
          <div className="workflow-title">
            <Activity />
            <h2>Senales que estan ganando</h2>
          </div>
          {signalRanking.length ? (
            signalRanking.map((signal) => (
              <span key={signal.name}>
                <strong>{signal.name}</strong>
                <b>{signal.count} veces</b>
                <small>mejora media {pct(Math.max(0, signal.avgLift))}</small>
              </span>
            ))
          ) : (
            <p>El ranking aparece cuando existan autopsias calibradas.</p>
          )}
          <div className="learning-family-board">
            <h3>Familias del aprendizaje</h3>
            {(["casa", "poisson", "elo", "dixon_coles", "bayes_live", "ensemble"] as const).map((key) => (
              <button key={key} onClick={() => setFilter(key === "casa" ? "casa" : key)} type="button">
                <span>{modelLabels[key]}</span>
                <strong>{counts[key] ?? 0}</strong>
              </button>
            ))}
          </div>
        </aside>

        <section className="learning-feed">
          {filteredEntries.map((entry) => {
            const params = parseParameters(entry);
            const best = params.best_contract;
            const real = realProbability(entry);
            const original = originalProbability(entry);
            const lift = liftOf(entry);
            const tags = highlightTags(entry);
            return (
              <article className={`learning-entry editorial-learning-entry ${tags.length ? "is-highlighted" : ""}`} key={entry.id}>
                <div className="learning-entry-top">
                  <span>
                    <BookOpenCheck size={16} />
                    {modelLabels[familyOf(entry)] ?? entry.best_model} - Partido {entry.match_number}
                  </span>
                  <a href={`/partidos/${entry.slug}/`}>Abrir sala</a>
                </div>
                <div className="learning-tag-row">
                  {tags.slice(0, 3).map((tag) => (
                    <span key={tag}>
                      <Flame size={13} />
                      {tag}
                    </span>
                  ))}
                </div>
                <h2>{editorialHeadline(entry)}</h2>
                <p className="learning-outcome">
                  Resultado real: <strong>{entry.home_team} {entry.home_score}-{entry.away_score} {entry.away_team}</strong>.
                  La cancha dijo <strong>{outcomeLabel(entry)}</strong>. La primera lectura traia{" "}
                  <strong>{pct(original)}</strong>; la autopsia subio a <strong>{pct(real)}</strong>.
                </p>
                <div className="learning-entry-grid">
                  <span>
                    <small>{stageOf(entry) === "calibrated_autopsy" ? "Contrato ganador" : "Modelo auditado"}</small>
                    <strong>{contractName(entry)}</strong>
                  </span>
                  <span>
                    <small>Mejora</small>
                    <strong>{lift >= 0 ? "+" : ""}{pct(lift)}</strong>
                  </span>
                  <span>
                    <small>Contexto</small>
                    <strong>{entry.venue}</strong>
                  </span>
                </div>
                <p>{entry.lesson}</p>
                <div className="learning-candidates">
                  {(params.candidates ?? []).slice(0, 4).map((candidate) => (
                    <span key={candidate.contract}>
                      <b>{candidate.contract}</b>
                      <em>{pct(candidate.probability_for_real_outcome)}</em>
                    </span>
                  ))}
                  {!params.candidates?.length && params.line && (
                    <>
                      <span><b>Local</b><em>{pct(params.line.home_win)}</em></span>
                      <span><b>Empate</b><em>{pct(params.line.draw)}</em></span>
                      <span><b>Visita</b><em>{pct(params.line.away_win)}</em></span>
                    </>
                  )}
                </div>
                <label className="suggested-copy learning-copy-box">
                  <span>Copy editorial sugerido</span>
                  <textarea readOnly value={editorialCopy(entry)} />
                </label>
                {shareCards[entry.id] && (
                  <div className="learning-share-preview">
                    <img alt={`Tarjeta editorial de ${entry.home_team} vs ${entry.away_team}`} src={shareCards[entry.id].image} />
                    <div>
                      <strong>Tarjeta lista para compartir</strong>
                      <p>
                        Formato vertical 1080x1350, con marcador real, aprendizaje del modelo,
                        probabilidad al desenlace y liga al Diario.
                      </p>
                      <div className="learning-share-links">
                        <a href={`/simulador-partido/?match=${entry.slug}`}>Replay 3D</a>
                        <a href={`/partidos/${entry.slug}/`}>Retar lectura</a>
                      </div>
                    </div>
                  </div>
                )}
                <div className="learning-actions">
                  <button onClick={() => copyText(editorialCopy(entry))} type="button">
                    <Clipboard size={15} />
                    Copiar post
                  </button>
                  <button onClick={() => copyText(entry.share_copy)} type="button">
                    <Clipboard size={15} />
                    Copiar copy tecnico
                  </button>
                  <a href={`/simulador-partido/?match=${entry.slug}`}>
                    <Sparkles size={15} />
                    Ver replay
                  </a>
                  <a href={`/partidos/${entry.slug}/`}>
                    <Trophy size={15} />
                    Retar lectura
                  </a>
                  <button onClick={() => createAutopsyCard(entry)} type="button">
                    <ImageDown size={15} />
                    {sharingId === entry.id ? "Creando..." : "Crear tarjeta"}
                  </button>
                  <button onClick={() => downloadAutopsyCard(entry)} type="button">
                    <ImageDown size={15} />
                    Descargar PNG
                  </button>
                  <button onClick={() => shareAutopsyCard(entry)} type="button">
                    <Share2 size={15} />
                    Compartir imagen
                  </button>
                </div>
              </article>
            );
          })}
          {!filteredEntries.length && (
            <article className="learning-entry">
              <div className="workflow-title">
                <BrainCircuit />
                <h2>Este filtro todavia esta calentando.</h2>
              </div>
              <p>
                No es un callejon sin salida: cuando cierren partidos, la cola automatica generara
                autopsias para esta familia. Mientras tanto puedes abrir una sala, ver la catedra del
                modelo o volver a destacadas.
              </p>
              <div className="learning-actions">
                <a href="/partidos/">Ir a partidos</a>
                {modelFilterValues.has(filter) && <a href={`/modelos/${filter}/`}>Ver catedra</a>}
                <button onClick={() => setFilter("destacadas")} type="button">Volver a destacadas</button>
              </div>
            </article>
          )}
        </section>
      </section>

      <SiteFooter />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<LearningLogPage />);
