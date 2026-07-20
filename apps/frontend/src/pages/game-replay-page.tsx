import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Pause, Play, Radio, RotateCcw, Sparkles, Trophy, Volume2, VolumeX } from "lucide-react";
import { SiteFooter } from "../components/SiteFooter";
import { fetchLearningLog, fetchMatch, runHouseMatchBoard } from "../lib/api";
import { demoMatch } from "../lib/liveDemo";
import { teamFlag } from "../lib/teamVisuals";
import { HouseMatchLine, LearningLogEntry, MatchDetail } from "../types";
import "../styles.css";

type ReplayMoment = {
  minute: number;
  label: string;
  narration: string;
  homeXg: number;
  awayXg: number;
  momentum: number;
  ball: [number, number];
};

const fallbackSlug = new URLSearchParams(window.location.search).get("match") ?? "001-mexico-vs-south-africa";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lineNarrative(line?: HouseMatchLine) {
  if (!line) {
    return "La casa todavia no tiene linea Monte Carlo conectada para este replay, asi que la narracion usa lectura local de eventos.";
  }
  const winSide = line.favorite;
  const confidence = Math.round(line.confidence * 100);
  return `Monte Carlo de la casa corrio la lectura del partido: ${winSide} aparece como favorito con ${confidence}% de confianza. La linea marca ${Math.round(line.home_win * 100)}% local, ${Math.round(line.draw * 100)}% empate y ${Math.round(line.away_win * 100)}% visita.`;
}

function autopsyProbability(entry?: LearningLogEntry | null) {
  if (!entry) return null;
  try {
    const params = JSON.parse(entry.best_parameters_json) as {
      best_contract?: { probability_for_real_outcome?: number };
      probability_for_real_outcome?: number;
    };
    return params.best_contract?.probability_for_real_outcome ?? params.probability_for_real_outcome ?? 1 - entry.best_error;
  } catch {
    return 1 - entry.best_error;
  }
}

function autopsyReplayLine(entry?: LearningLogEntry | null) {
  if (!entry) return "Cuando exista autopsia, este replay tambien mostrara que aprendio el modelo despues del resultado.";
  const probability = autopsyProbability(entry);
  const pct = probability == null ? "" : ` con ${Math.round(probability * 1000) / 10}% al desenlace real`;
  return `${entry.headline}${pct}. ${entry.lesson}`;
}

function buildMoments(detail: MatchDetail, houseLine?: HouseMatchLine): ReplayMoment[] {
  const { match } = detail;
  const house = lineNarrative(houseLine);
  const favorite = houseLine?.favorite ?? "la casa";
  const homeWin = Math.round((houseLine?.home_win ?? 0) * 100);
  const draw = Math.round((houseLine?.draw ?? 0) * 100);
  const awayWin = Math.round((houseLine?.away_win ?? 0) * 100);
  const confidence = Math.round((houseLine?.confidence ?? 0) * 100);
  const base: ReplayMoment[] = [
    {
      minute: 1,
      label: "Arranque",
      narration: `Arranca la pelicula de datos. ${match.home_team} y ${match.away_team} entran a una cancha donde cada pase mueve la probabilidad. ${house}`,
      homeXg: 0.04,
      awayXg: 0.03,
      momentum: 0.5,
      ball: [-4.8, 0.4],
    },
    {
      minute: 18,
      label: "La casa ajusta",
      narration: houseLine
        ? `Primer ajuste de Monte Carlo para este partido: ${favorite} manda la linea, pero la casa no lo canta como certeza. Local ${homeWin}%, empate ${draw}%, visita ${awayWin}%. La confianza queda en ${confidence}%, suficiente para inclinar la cancha, no para apagar el partido.`
        : `Primer ajuste: el modelo empieza a separar ruido de senal. La presion, el ritmo y el territorio ya pintan un partido distinto al pronostico inicial.`,
      homeXg: 0.22,
      awayXg: 0.17,
      momentum: 0.58,
      ball: [-2.2, -1.5],
    },
    {
      minute: 44,
      label: "Corte tactico",
      narration: houseLine
        ? `Corte tactico. La maqueta muestra donde Monte Carlo puso el peso: si el balon vive del lado favorito, la linea se sostiene; si el partido se ensucia, el empate de ${draw}% empieza a tener voz.`
        : `Medio tiempo virtual. Aqui el Data Director no mira solo el marcador: mira xG, fatiga, altura, espacios y probabilidad viva. La casa pregunta si su linea sigue siendo defendible.`,
      homeXg: 0.55,
      awayXg: 0.48,
      momentum: 0.51,
      ball: [0, 0],
    },
    {
      minute: 67,
      label: "Zona caliente",
      narration: houseLine
        ? `Zona caliente. La casa ilumina el corredor de mayor peligro: no porque haya visto el futuro, sino porque despues de miles de rutas simuladas esta zona aparece demasiadas veces como punto de quiebre.`
        : `El partido se rompe. Una perdida cambia la ruta de la pelota y la simulacion enciende la zona donde el gol se vuelve posible. Si la casa se equivoca, aqui empieza a pagar el costo.`,
      homeXg: 0.88,
      awayXg: 0.79,
      momentum: 0.63,
      ball: [2.6, 1.1],
    },
    {
      minute: 90,
      label: "Resumen final",
      narration: houseLine
        ? `Cierre de replay. La linea de la casa termino contando una postura: ${favorite} era el lado con mas caminos, pero cada Data Director puede buscar la grieta donde Monte Carlo se queda corto.`
        : `Cierre de replay. La historia no fue una tabla: fue una secuencia de decisiones, azar, cansancio y modelos peleando por leer la cancha. El reto es ganarle a la linea Monte Carlo de la casa.`,
      homeXg: 1.15,
      awayXg: 1.02,
      momentum: 0.56,
      ball: [4.4, -0.2],
    },
  ];

  const eventMoments = detail.events.map((event, index) => {
    const isHome = event.team_id === match.home_team_id;
    const minute = clamp(event.minute, 2, 89);
    return {
      minute,
      label: event.event_type === "goal" ? "Gol en la pelicula" : "Evento vivo",
      narration: `${minute} minutos. ${event.description} La narracion de la casa sube el volumen porque el modelo ya no puede quedarse quieto.`,
      homeXg: 0.28 + minute / 90 + (isHome ? 0.24 : 0),
      awayXg: 0.24 + minute / 100 + (!isHome ? 0.24 : 0),
      momentum: isHome ? 0.68 : 0.32,
      ball: [isHome ? 3.8 : -3.8, index % 2 === 0 ? 1.4 : -1.2],
    } satisfies ReplayMoment;
  });

  return [...base, ...eventMoments].sort((a, b) => a.minute - b.minute);
}

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-MX";
  utterance.rate = 0.96;
  utterance.pitch = 0.88;
  window.speechSynthesis.speak(utterance);
}

function ReplayCanvas({
  cinematic,
  detail,
  houseLine,
  moments,
  progress,
}: {
  cinematic: boolean;
  detail: MatchDetail;
  houseLine?: HouseMatchLine;
  moments: ReplayMoment[];
  progress: number;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<{
    renderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    activePlayerHalo?: THREE.Mesh;
    frame?: number;
    ball?: THREE.Mesh;
    cameraDistance?: number;
    drag?: { active: boolean; x: number; y: number };
    flags?: THREE.Group[];
    heatCells?: THREE.Mesh[];
    heatDisc?: THREE.Mesh;
    introGate?: THREE.Group;
    liveProgress?: number;
    momentumArrows?: THREE.Group[];
    oddsBars?: THREE.Mesh[];
    passLines?: THREE.Line[];
    players?: THREE.Group[];
    probabilityHalo?: THREE.Mesh;
    ribbons?: THREE.Line[];
    root?: THREE.Group;
    screens?: THREE.Mesh[];
    shotTrail?: THREE.Line;
    spotLights?: THREE.SpotLight[];
    tacticalBlocks?: THREE.Mesh[];
    targetRotation?: { x: number; y: number };
    clock?: THREE.Clock;
  }>({});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#081116");
    scene.fog = new THREE.Fog("#081116", 12, 30);

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(8, 7.2, 9.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight("#d8fff0", "#102430", 1.65));
    const key = new THREE.DirectionalLight("#9fffd7", 2.8);
    key.position.set(-6, 10, 8);
    scene.add(key);
    const rim = new THREE.DirectionalLight("#f0d45b", 1.15);
    rim.position.set(8, 6, -4);
    scene.add(rim);
    const ambientGlow = new THREE.PointLight("#75ffd1", 1.4, 24);
    ambientGlow.position.set(0, 6, 0);
    scene.add(ambientGlow);

    const root = new THREE.Group();
    root.rotation.x = -0.14;
    root.rotation.y = -0.66;
    scene.add(root);

    const homeProb = houseLine?.home_win ?? 0.44;
    const drawProb = houseLine?.draw ?? 0.3;
    const awayProb = houseLine?.away_win ?? 0.26;
    const favoriteSide = homeProb >= awayProb ? "home" : "away";
    const favoriteColor = favoriteSide === "home" ? "#24d38e" : "#e8d25b";

    const makeGrassTexture = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#14533d";
        context.fillRect(0, 0, canvas.width, canvas.height);
        for (let stripe = 0; stripe < 10; stripe += 1) {
          context.fillStyle = stripe % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.045)";
          context.fillRect(0, stripe * 52, canvas.width, 52);
        }
        for (let dot = 0; dot < 1200; dot += 1) {
          context.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
          context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1);
        }
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2, 1);
      return texture;
    };

    const pitch = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.18, 7.2),
      new THREE.MeshStandardMaterial({ map: makeGrassTexture(), roughness: 0.84, metalness: 0.02 }),
    );
    pitch.position.y = -0.15;
    root.add(pitch);

    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(13.2, 1.15, 8.4),
      new THREE.MeshStandardMaterial({ color: "#233033", roughness: 0.88 }),
    );
    edge.position.y = -0.86;
    root.add(edge);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(8.2, 8.6, 0.34, 40),
      new THREE.MeshStandardMaterial({ color: "#0b171d", roughness: 0.82, metalness: 0.08 }),
    );
    pedestal.position.y = -1.42;
    pedestal.rotation.y = Math.PI / 8;
    root.add(pedestal);

    const crowd = new THREE.BufferGeometry();
    const crowdPositions: number[] = [];
    const crowdColors: number[] = [];
    const color = new THREE.Color();
    for (let index = 0; index < 900; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radiusX = 6.2 + Math.random() * 1.2;
      const radiusZ = 3.95 + Math.random() * 0.85;
      const x = Math.cos(angle) * radiusX;
      const z = Math.sin(angle) * radiusZ;
      const y = 0.42 + Math.random() * 0.9;
      crowdPositions.push(x, y, z);
      color.set(index % 5 === 0 ? "#f0d45b" : index % 3 === 0 ? "#75ffd1" : "#dce7ef");
      crowdColors.push(color.r, color.g, color.b);
    }
    crowd.setAttribute("position", new THREE.Float32BufferAttribute(crowdPositions, 3));
    crowd.setAttribute("color", new THREE.Float32BufferAttribute(crowdColors, 3));
    const crowdPoints = new THREE.Points(
      crowd,
      new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.55 }),
    );
    root.add(crowdPoints);

    const ringMaterial = new THREE.MeshStandardMaterial({
      color: "#1a272d",
      emissive: "#071923",
      emissiveIntensity: 0.08,
      metalness: 0.04,
      roughness: 0.86,
      transparent: true,
      opacity: 0.45,
    });
    [0, 1, 2].forEach((ring) => {
      const bowl = new THREE.Mesh(new THREE.TorusGeometry(4.65 + ring * 0.44, 0.035, 6, 120), ringMaterial.clone());
      bowl.scale.set(1.36, 0.16, 0.74);
      bowl.position.y = 0.28 + ring * 0.24;
      bowl.rotation.x = Math.PI / 2;
      root.add(bowl);
    });

    const roofMaterial = new THREE.MeshBasicMaterial({
      color: "#75ffd1",
      opacity: 0.018,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const roof = new THREE.Mesh(new THREE.RingGeometry(5.3, 6.55, 96), roofMaterial);
    roof.scale.set(1.45, 0.82, 1);
    roof.position.y = 2.15;
    roof.rotation.x = -Math.PI / 2;
    roof.visible = false;
    root.add(roof);

    const makeScreenTexture = (title: string, value: string, accent: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#061016";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = accent;
        context.lineWidth = 10;
        context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
        context.fillStyle = accent;
        context.font = "800 34px Arial";
        context.fillText(title.toUpperCase(), 34, 70);
        context.fillStyle = "#ffffff";
        context.font = "900 72px Arial";
        context.fillText(value, 34, 160);
        context.fillStyle = "rgba(234,255,244,0.72)";
        context.font = "700 24px Arial";
        context.fillText("MONTE CARLO LIVE", 34, 212);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    };

    const screens: THREE.Mesh[] = [
      new THREE.Mesh(
        new THREE.PlaneGeometry(1.55, 0.76),
        new THREE.MeshBasicMaterial({
          map: makeScreenTexture("Favorito", houseLine?.favorite ?? detail.match.home_team, favoriteColor),
          side: THREE.DoubleSide,
        }),
      ),
      new THREE.Mesh(
        new THREE.PlaneGeometry(1.55, 0.76),
        new THREE.MeshBasicMaterial({
          map: makeScreenTexture("Marcador", `${detail.match.home_score}-${detail.match.away_score}`, "#75ffd1"),
          side: THREE.DoubleSide,
        }),
      ),
    ];
    screens[0].position.set(-3.1, 1.55, -4.55);
    screens[1].position.set(3.1, 1.55, -4.55);
    screens.forEach((screen) => {
      screen.rotation.x = -0.08;
      root.add(screen);
    });

    const flags: THREE.Group[] = [];
    const flagColors = ["#24d38e", "#ffffff", "#e8d25b", "#ef4444"];
    [-6.4, -3.2, 3.2, 6.4].forEach((x, index) => {
      const flag = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.7, 8),
        new THREE.MeshStandardMaterial({ color: "#dce7ef", metalness: 0.6, roughness: 0.28 }),
      );
      pole.position.y = 1.38;
      const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.2, 6, 2),
        new THREE.MeshBasicMaterial({ color: flagColors[index], side: THREE.DoubleSide, transparent: true, opacity: 0.74 }),
      );
      cloth.position.set(0.18, 1.6, 0);
      flag.add(pole, cloth);
      flag.position.set(x * 0.9, 0, index < 2 ? -4.8 : 4.8);
      flag.rotation.y = index < 2 ? 0 : Math.PI;
      flags.push(flag);
      root.add(flag);
    });

    const introGate = new THREE.Group();
    const gateMaterial = new THREE.MeshBasicMaterial({ color: "#75ffd1", transparent: true, opacity: 0.12 });
    [-1, 1].forEach((side) => {
      const gate = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 7.1), gateMaterial.clone());
      gate.position.set(side * 5.9, 0.15, 0);
      gate.rotation.x = -Math.PI / 2;
      introGate.add(gate);
    });
    root.add(introGate);

    const lineMaterial = new THREE.LineBasicMaterial({ color: "#eafff4", transparent: true, opacity: 0.78 });
    const makeLine = (points: THREE.Vector3[]) => {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial);
      root.add(line);
      return line;
    };
    makeLine([
      new THREE.Vector3(-5.6, 0.02, -3.2),
      new THREE.Vector3(5.6, 0.02, -3.2),
      new THREE.Vector3(5.6, 0.02, 3.2),
      new THREE.Vector3(-5.6, 0.02, 3.2),
      new THREE.Vector3(-5.6, 0.02, -3.2),
    ]);
    makeLine([new THREE.Vector3(0, 0.04, -3.2), new THREE.Vector3(0, 0.04, 3.2)]);

    const center = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 0.86, 64),
      new THREE.MeshBasicMaterial({ color: "#eafff4", transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.06;
    root.add(center);

    const penaltyMaterial = new THREE.LineBasicMaterial({ color: "#eafff4", transparent: true, opacity: 0.52 });
    [-1, 1].forEach((side) => {
      const area = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(side * 5.6, 0.065, -1.5),
          new THREE.Vector3(side * 4.35, 0.065, -1.5),
          new THREE.Vector3(side * 4.35, 0.065, 1.5),
          new THREE.Vector3(side * 5.6, 0.065, 1.5),
        ]),
        penaltyMaterial,
      );
      root.add(area);
      const goalFrame = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(side * 5.82, 0.1, -0.55),
          new THREE.Vector3(side * 5.82, 0.95, -0.55),
          new THREE.Vector3(side * 5.82, 0.95, -0.55),
          new THREE.Vector3(side * 5.82, 0.95, 0.55),
          new THREE.Vector3(side * 5.82, 0.95, 0.55),
          new THREE.Vector3(side * 5.82, 0.1, 0.55),
        ]),
        new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.86 }),
      );
      root.add(goalFrame);
    });

    const hotZone = new THREE.Mesh(
      new THREE.CircleGeometry(1.15 + Math.max(homeProb, awayProb) * 1.8, 64),
      new THREE.MeshBasicMaterial({ color: favoriteColor, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
    );
    hotZone.rotation.x = -Math.PI / 2;
    hotZone.position.set(favoriteSide === "home" ? 2.8 : -2.8, 0.08, favoriteSide === "home" ? 0.7 : -0.7);
    root.add(hotZone);

    const probabilityHalo = new THREE.Mesh(
      new THREE.RingGeometry(1.35, 1.44, 96),
      new THREE.MeshBasicMaterial({ color: favoriteColor, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
    );
    probabilityHalo.rotation.x = -Math.PI / 2;
    probabilityHalo.position.copy(hotZone.position);
    probabilityHalo.position.y = 0.1;
    root.add(probabilityHalo);

    const heatCells: THREE.Mesh[] = [];
    for (let xIndex = 0; xIndex < 6; xIndex += 1) {
      for (let zIndex = 0; zIndex < 4; zIndex += 1) {
        const x = -4.8 + xIndex * 1.92;
        const z = -2.4 + zIndex * 1.6;
        const pressure = clamp(0.25 + (xIndex / 5) * homeProb + ((5 - xIndex) / 5) * awayProb, 0.18, 0.88);
        const cell = new THREE.Mesh(
          new THREE.PlaneGeometry(1.45, 1.05),
          new THREE.MeshBasicMaterial({
            color: xIndex >= 3 ? "#24d38e" : "#e8d25b",
            opacity: 0.035 + pressure * 0.11,
            side: THREE.DoubleSide,
            transparent: true,
          }),
        );
        cell.rotation.x = -Math.PI / 2;
        cell.position.set(x, 0.075, z);
        heatCells.push(cell);
        root.add(cell);
      }
    }

    const homeMaterial = new THREE.MeshStandardMaterial({ color: "#24d38e", emissive: "#0a6f4e", emissiveIntensity: 0.28, roughness: 0.58 });
    const awayMaterial = new THREE.MeshStandardMaterial({ color: "#e8d25b", emissive: "#7d6400", emissiveIntensity: 0.22, roughness: 0.58 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: "#f2d5b5", roughness: 0.72 });
    const faceMaterial = new THREE.MeshBasicMaterial({ color: "#172027" });
    const smileMaterial = new THREE.LineBasicMaterial({ color: "#172027", transparent: true, opacity: 0.92 });
    const playerGeometry = new THREE.CapsuleGeometry(0.13, 0.34, 8, 16);
    const makePlayer = (material: THREE.Material, x: number, z: number, keeper = false) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(playerGeometry, material);
      body.position.y = 0.32;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skinMaterial);
      head.position.y = 0.72;
      const eyeGeometry = new THREE.SphereGeometry(0.018, 8, 6);
      const leftEye = new THREE.Mesh(eyeGeometry, faceMaterial);
      leftEye.position.set(-0.042, 0.745, keeper ? -0.112 : 0.112);
      const rightEye = new THREE.Mesh(eyeGeometry, faceMaterial);
      rightEye.position.set(0.042, 0.745, keeper ? -0.112 : 0.112);
      const smile = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-0.045, 0.69, keeper ? -0.116 : 0.116),
          new THREE.Vector3(0, 0.675, keeper ? -0.126 : 0.126),
          new THREE.Vector3(0.045, 0.69, keeper ? -0.116 : 0.116),
        ]),
        smileMaterial,
      );
      group.add(body, head, leftEye, rightEye, smile);
      group.position.set(x, 0, z);
      group.rotation.y = keeper ? Math.PI : 0;
      return group;
    };
    const homeShape = [
      [-4.6, 0],
      [-3.4, -1.7],
      [-3.4, 1.7],
      [-1.7, -0.8],
      [-1.5, 0.9],
      [-0.5, 0.1],
    ];
    const awayShape = homeShape.map(([x, z]) => [-x, -z]);
    const players = [...homeShape, ...awayShape].map(([x, z], index) => {
      const player = makePlayer(index < homeShape.length ? homeMaterial : awayMaterial, x, z);
      if (index >= homeShape.length) player.rotation.y = Math.PI;
      root.add(player);
      return player;
    });

    const keeperMaterial = new THREE.MeshStandardMaterial({
      color: "#60a5fa",
      emissive: "#1d4ed8",
      emissiveIntensity: 0.55,
      roughness: 0.38,
    });
    [
      [-5.15, 0],
      [5.15, 0],
    ].forEach(([x, z]) => {
      const keeper = makePlayer(keeperMaterial.clone(), x, z, x > 0);
      keeper.scale.setScalar(1.08);
      players.push(keeper);
      root.add(keeper);
    });

    const activePlayerHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.36, 36),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.78, side: THREE.DoubleSide }),
    );
    activePlayerHalo.rotation.x = -Math.PI / 2;
    activePlayerHalo.position.set(-4.6, 0.11, 0);
    root.add(activePlayerHalo);

    const tacticalBlocks = [
      new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 4.6),
        new THREE.MeshBasicMaterial({ color: "#24d38e", opacity: 0.08, transparent: true, side: THREE.DoubleSide }),
      ),
      new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 4.6),
        new THREE.MeshBasicMaterial({ color: "#e8d25b", opacity: 0.08, transparent: true, side: THREE.DoubleSide }),
      ),
    ];
    tacticalBlocks.forEach((block, index) => {
      block.rotation.x = -Math.PI / 2;
      block.position.set(index === 0 ? -2.4 : 2.4, 0.085, 0);
      root.add(block);
    });

    const passLines: THREE.Line[] = [];
    const passMaterial = new THREE.LineBasicMaterial({ color: "#75ffd1", transparent: true, opacity: 0.48 });
    [
      [-4.6, 0, -3.4, -1.7],
      [-3.4, -1.7, -1.7, -0.8],
      [-1.5, 0.9, -0.5, 0.1],
      [4.6, 0, 3.4, 1.7],
      [3.4, 1.7, 1.7, 0.8],
      [1.5, -0.9, 0.5, -0.1],
    ].forEach(([x1, z1, x2, z2], index) => {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x1, 0.18 + index * 0.01, z1),
          new THREE.Vector3((x1 + x2) / 2, 0.32, (z1 + z2) / 2),
          new THREE.Vector3(x2, 0.18 + index * 0.01, z2),
        ]),
        passMaterial.clone(),
      );
      passLines.push(line);
      root.add(line);
    });

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 24, 16),
      new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#eaffff", emissiveIntensity: 0.4 }),
    );
    ball.position.set(-4.8, 0.3, 0);
    root.add(ball);

    const shotTrail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 32 }, (_, index) => new THREE.Vector3(-4.8 + index * 0.08, 0.28, Math.sin(index * 0.2) * 0.05)),
      ),
      new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.68 }),
    );
    root.add(shotTrail);

    const momentumArrows: THREE.Group[] = [];
    const arrowMaterial = new THREE.MeshStandardMaterial({
      color: favoriteColor,
      emissive: favoriteColor,
      emissiveIntensity: 0.48,
      transparent: true,
      opacity: 0.8,
      roughness: 0.35,
    });
    for (let index = 0; index < 7; index += 1) {
      const arrow = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 10), arrowMaterial.clone());
      shaft.rotation.z = Math.PI / 2;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.28, 14), arrowMaterial.clone());
      head.rotation.z = -Math.PI / 2;
      head.position.x = 0.48;
      arrow.add(shaft, head);
      arrow.position.set(-3.6 + index * 1.15, 0.18, -2.45 + (index % 3) * 0.85);
      arrow.rotation.y = favoriteSide === "home" ? 0 : Math.PI;
      momentumArrows.push(arrow);
      root.add(arrow);
    }

    const ribbons: THREE.Line[] = [];
    const ribbonMaterial = new THREE.LineBasicMaterial({ color: favoriteColor, transparent: true, opacity: 0.52 });
    for (let index = 0; index < 12; index += 1) {
      const points = Array.from({ length: 70 }, (_, pointIndex) => {
        const t = pointIndex / 69;
        const bias = (homeProb - awayProb) * 2.4;
        return new THREE.Vector3(-5.2 + t * 10.4, 0.22 + index * 0.06, Math.sin(t * Math.PI * 2 + index) * (1.05 + index * 0.035) + bias * (t - 0.5));
      });
      const ribbon = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), ribbonMaterial.clone());
      (ribbon.material as THREE.LineBasicMaterial).opacity = 0.16;
      ribbons.push(ribbon);
      root.add(ribbon);
    }

    const standsMaterial = new THREE.MeshStandardMaterial({ color: "#182a32", roughness: 0.92, metalness: 0.04 });
    [-5.2, -2.6, 0, 2.6, 5.2].forEach((x, index) => {
      const block = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62 + index * 0.02, 0.58), standsMaterial);
      block.position.set(x, 0.12, -4.0);
      block.rotation.x = -0.13;
      root.add(block);
      const opposite = block.clone();
      opposite.position.z = 4.0;
      opposite.rotation.x = 0.13;
      root.add(opposite);
    });

    [-6.8, 6.8].forEach((x) => {
      [-2.8, 0, 2.8].forEach((z, index) => {
        const tower = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.18 + (x < 0 ? homeProb : awayProb) * 0.65 + index * 0.03, 0.16),
          new THREE.MeshStandardMaterial({
            color: x < 0 ? "#24d38e" : "#e8d25b",
            emissive: x < 0 ? "#0a6f4e" : "#7d6400",
            emissiveIntensity: 0.2,
            roughness: 0.62,
          }),
        );
        tower.position.set(x * 0.93, tower.geometry.parameters.height / 2 + 0.02, z);
        root.add(tower);
      });
    });

    const drawTower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.28 + drawProb * 0.9, 20),
      new THREE.MeshStandardMaterial({ color: "#9aa6b2", emissive: "#425466", emissiveIntensity: 0.12, roughness: 0.65 }),
    );
    drawTower.position.set(0, drawTower.geometry.parameters.height / 2 + 0.02, -4.75);
    root.add(drawTower);

    const spotLights: THREE.SpotLight[] = [];
    [
      [-6.6, 5.6, -4.4],
      [6.6, 5.6, -4.4],
      [-6.6, 5.6, 4.4],
      [6.6, 5.6, 4.4],
    ].forEach(([x, y, z]) => {
      const spot = new THREE.SpotLight("#eafff4", 1.25, 20, Math.PI / 5, 0.55, 1.2);
      spot.position.set(x, y, z);
      spot.target.position.set(0, 0, 0);
      scene.add(spot);
      scene.add(spot.target);
      spotLights.push(spot);

      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(0.85, 3.2, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: "#d8fff0", opacity: 0.018, transparent: true, side: THREE.DoubleSide }),
      );
      beam.position.set(x * 0.72, y * 0.46, z * 0.72);
      beam.lookAt(0, 0, 0);
      root.add(beam);
    });

    refs.current = {
      renderer,
      scene,
      camera,
      activePlayerHalo,
      ball,
      cameraDistance: 15.7,
      drag: { active: false, x: 0, y: 0 },
      flags,
      heatCells,
      heatDisc: hotZone,
      introGate,
      liveProgress: progress,
      momentumArrows,
      passLines,
      players,
      probabilityHalo,
      ribbons,
      root,
      screens,
      shotTrail,
      spotLights,
      tacticalBlocks,
      targetRotation: { x: -0.14, y: -0.66 },
      clock: new THREE.Clock(),
    };

    const onResize = () => {
      if (!mount || !refs.current.renderer || !refs.current.camera) return;
      refs.current.camera.aspect = mount.clientWidth / mount.clientHeight;
      refs.current.camera.updateProjectionMatrix();
      refs.current.renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const onPointerDown = (event: PointerEvent) => {
      refs.current.drag = { active: true, x: event.clientX, y: event.clientY };
      mount.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = refs.current.drag;
      const targetRotation = refs.current.targetRotation;
      if (!drag?.active || !targetRotation) return;
      targetRotation.y += (event.clientX - drag.x) * 0.006;
      targetRotation.x = clamp(targetRotation.x + (event.clientY - drag.y) * 0.003, -0.34, 0.22);
      drag.x = event.clientX;
      drag.y = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (refs.current.drag) refs.current.drag.active = false;
      try {
        mount.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer may already be released by the browser.
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      refs.current.cameraDistance = clamp((refs.current.cameraDistance ?? 15.7) + event.deltaY * 0.006, 10.5, 22);
    };
    mount.addEventListener("pointerdown", onPointerDown);
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerup", onPointerUp);
    mount.addEventListener("pointercancel", onPointerUp);
    mount.addEventListener("wheel", onWheel, { passive: false });

    const animate = () => {
      const time = refs.current.clock?.getElapsedTime() ?? 0;
      const targetRotation = refs.current.targetRotation;
      const dragActive = refs.current.drag?.active;
      if (cinematic && targetRotation && !dragActive) {
        const live = refs.current.liveProgress ?? 0;
        const phase = live < 0.18 ? 0 : live < 0.5 ? 1 : live < 0.78 ? 2 : 3;
        const baseY = [-0.92, -0.48, -0.78, -0.28][phase];
        const baseX = [-0.22, -0.12, -0.18, -0.08][phase];
        const distancePreset = [14.8, 12.6, 13.9, 11.8][phase];
        targetRotation.y = baseY + Math.sin(time * 0.22) * 0.2 + live * 0.24;
        targetRotation.x = baseX + Math.sin(time * 0.18) * 0.035;
        refs.current.cameraDistance = THREE.MathUtils.lerp(refs.current.cameraDistance ?? 15.7, distancePreset + Math.sin(time * 0.3) * 0.7, 0.025);
      }
      if (refs.current.root && targetRotation) {
        refs.current.root.rotation.x = THREE.MathUtils.lerp(refs.current.root.rotation.x, targetRotation.x, 0.1);
        refs.current.root.rotation.y = THREE.MathUtils.lerp(refs.current.root.rotation.y, targetRotation.y, 0.1);
      }
      refs.current.players?.forEach((player, index) => {
        player.position.y = Math.sin(time * 2.4 + index) * 0.025;
      });
      if (refs.current.activePlayerHalo) {
        refs.current.activePlayerHalo.rotation.z += 0.035;
        refs.current.activePlayerHalo.scale.setScalar(1 + Math.sin(time * 4) * 0.08);
      }
      if (refs.current.introGate) {
        const live = refs.current.liveProgress ?? 0;
        refs.current.introGate.children.forEach((gate, index) => {
          gate.position.x = (index === 0 ? -5.9 : 5.9) * (1 - Math.max(0, 0.2 - live) * 1.6);
          (gate as THREE.Mesh).material && (((gate as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = live < 0.22 ? 0.16 - live * 0.45 : 0.02);
        });
      }
      if (refs.current.heatDisc) {
        refs.current.heatDisc.scale.setScalar(1 + Math.sin(time * 2.1) * 0.06);
        (refs.current.heatDisc.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(time * 1.8) * 0.05;
      }
      if (refs.current.probabilityHalo) {
        refs.current.probabilityHalo.rotation.z += 0.008;
        refs.current.probabilityHalo.scale.setScalar(1.1 + Math.sin(time * 1.6) * 0.18);
      }
      refs.current.momentumArrows?.forEach((arrow, index) => {
        arrow.position.x += Math.sin(time * 1.4 + index) * 0.003;
        arrow.position.y = 0.18 + Math.sin(time * 2 + index) * 0.035;
        arrow.scale.setScalar(0.85 + Math.sin(time * 1.8 + index) * 0.09);
      });
      refs.current.passLines?.forEach((line, index) => {
        const live = refs.current.liveProgress ?? 0;
        const phaseBoost = live > 0.28 && live < 0.72 ? 1 : 0.35;
        (line.material as THREE.LineBasicMaterial).opacity = (0.1 + Math.sin(time * 1.7 + index) * 0.08 + 0.1) * phaseBoost;
      });
      refs.current.heatCells?.forEach((cell, index) => {
        const live = refs.current.liveProgress ?? 0;
        const phaseBoost = live > 0.55 ? 1 : 0.45;
        (cell.material as THREE.MeshBasicMaterial).opacity = (0.035 + Math.sin(time * 1.2 + index * 0.35) * 0.018 + 0.052) * phaseBoost;
      });
      refs.current.flags?.forEach((flag, index) => {
        const cloth = flag.children[1];
        if (cloth) cloth.rotation.y = Math.sin(time * 2.1 + index) * 0.18;
      });
      refs.current.tacticalBlocks?.forEach((block, index) => {
        (block.material as THREE.MeshBasicMaterial).opacity = 0.055 + Math.sin(time * 1.1 + index) * 0.018 + 0.035;
      });
      refs.current.spotLights?.forEach((spot, index) => {
        spot.intensity = 1.05 + Math.sin(time * 0.8 + index) * 0.18;
      });
      refs.current.ribbons?.forEach((ribbon, index) => {
        ribbon.rotation.y = Math.sin(time * 0.25 + index) * 0.06;
        const live = refs.current.liveProgress ?? 0;
        const phaseBoost = live > 0.14 && live < 0.9 ? 1 : 0.3;
        (ribbon.material as THREE.LineBasicMaterial).opacity = (0.08 + Math.sin(time + index) * 0.05 + 0.11) * phaseBoost;
      });
      const distance = refs.current.cameraDistance ?? 15.7;
      refs.current.camera!.position.set(distance * 0.56, distance * 0.5, distance * 0.66);
      refs.current.camera!.lookAt(0, 0, 0);
      refs.current.renderer?.render(scene, camera);
      refs.current.frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener("resize", onResize);
      mount.removeEventListener("pointerdown", onPointerDown);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerup", onPointerUp);
      mount.removeEventListener("pointercancel", onPointerUp);
      mount.removeEventListener("wheel", onWheel);
      if (refs.current.frame) cancelAnimationFrame(refs.current.frame);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [cinematic, detail.match.id, houseLine?.home_win, houseLine?.draw, houseLine?.away_win]);

  useEffect(() => {
    const ball = refs.current.ball;
    if (!ball) return;
    refs.current.liveProgress = progress;
    const minute = progress * 90;
    const previous = [...moments].reverse().find((moment) => moment.minute <= minute) ?? moments[0];
    const next = moments.find((moment) => moment.minute >= minute) ?? moments[moments.length - 1];
    const local = previous === next ? 0 : (minute - previous.minute) / Math.max(1, next.minute - previous.minute);
    const x = THREE.MathUtils.lerp(previous.ball[0], next.ball[0], local);
    const z = THREE.MathUtils.lerp(previous.ball[1], next.ball[1], local);
    ball.position.set(x, 0.34 + Math.sin(progress * Math.PI * 24) * 0.18, z);
    const homePush = previous.momentum >= 0.5;
    if (refs.current.activePlayerHalo) {
      const nearest = refs.current.players?.reduce(
        (winner, player) => {
          const distance = Math.hypot(player.position.x - x, player.position.z - z);
          return distance < winner.distance ? { player, distance } : winner;
        },
        { player: refs.current.players[0], distance: Number.POSITIVE_INFINITY },
      );
      if (nearest?.player) {
        refs.current.activePlayerHalo.position.set(nearest.player.position.x, 0.11, nearest.player.position.z);
      }
    }
    refs.current.tacticalBlocks?.forEach((block, index) => {
      const push = homePush ? 0.45 : -0.45;
      block.position.x = (index === 0 ? -2.4 : 2.4) + push;
      block.scale.x = 1 + Math.abs(previous.momentum - 0.5) * 0.65;
    });
    refs.current.momentumArrows?.forEach((arrow, index) => {
      arrow.rotation.y = homePush ? 0 : Math.PI;
      arrow.position.z = -2.45 + ((index + Math.round(progress * 10)) % 3) * 0.85;
      arrow.visible = index / 7 < clamp(Math.abs(previous.momentum - 0.5) * 2 + 0.45, 0.35, 1);
    });
    if (refs.current.heatDisc && refs.current.probabilityHalo) {
      const dangerX = homePush ? 2.6 + previous.homeXg * 0.55 : -2.6 - previous.awayXg * 0.55;
      const dangerZ = homePush ? previous.ball[1] * 0.65 : -previous.ball[1] * 0.65;
      refs.current.heatDisc.position.set(clamp(dangerX, -4.2, 4.2), 0.08, clamp(dangerZ, -2.4, 2.4));
      refs.current.probabilityHalo.position.set(clamp(dangerX, -4.2, 4.2), 0.1, clamp(dangerZ, -2.4, 2.4));
    }
    if (refs.current.shotTrail) {
      const trailPoints = Array.from({ length: 36 }, (_, index) => {
        const t = index / 35;
        const tx = THREE.MathUtils.lerp(previous.ball[0], x, t);
        const tz = THREE.MathUtils.lerp(previous.ball[1], z, t);
        const arc = Math.sin(t * Math.PI) * (0.25 + previous.homeXg * 0.08 + previous.awayXg * 0.08);
        return new THREE.Vector3(tx, 0.22 + arc, tz);
      });
      refs.current.shotTrail.geometry.dispose();
      refs.current.shotTrail.geometry = new THREE.BufferGeometry().setFromPoints(trailPoints);
      (refs.current.shotTrail.material as THREE.LineBasicMaterial).opacity = 0.35 + previous.momentum * 0.35;
    }
  }, [moments, progress]);

  return <div className="replay-canvas interactive" ref={mountRef} aria-label="Maqueta 3D interactiva del partido" />;
}

function GameReplayPage() {
  const [detail, setDetail] = useState<MatchDetail>(demoMatch(fallbackSlug));
  const [houseLine, setHouseLine] = useState<HouseMatchLine | undefined>();
  const [mode, setMode] = useState("demo local");
  const [playing, setPlaying] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  const [progress, setProgress] = useState(0);
  const [autopsy, setAutopsy] = useState<LearningLogEntry | null>(null);
  const lastSpoken = useRef(-1);
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const moments = useMemo(() => buildMoments(detail, houseLine), [detail, houseLine]);
  const activeMinute = Math.round(progress * 90);
  let resolvedActiveIndex = 0;
  moments.forEach((moment, index) => {
    if (moment.minute <= activeMinute) resolvedActiveIndex = index;
  });
  const activeIndex = resolvedActiveIndex;
  const activeMoment = moments[activeIndex] ?? moments[0];
  const homeXg = activeMoment.homeXg.toFixed(2);
  const awayXg = activeMoment.awayXg.toFixed(2);
  const autopsyHref = `/diario-aprendizaje/?match=${detail.match.slug}`;
  const kitHref = `/diario-aprendizaje/?match=${detail.match.slug}&kit=1`;
  const matchHref = `/partidos/${detail.match.slug}/`;
  const autopsyLine = autopsyReplayLine(autopsy);

  useEffect(() => {
    fetchMatch(fallbackSlug)
      .then((data) => {
        setDetail(data);
        setMode("API activa");
      })
      .catch(() => setMode("demo local"));
  }, []);

  useEffect(() => {
    runHouseMatchBoard({
      simulations: 2500,
      seed: 2026,
      use_stadium: true,
      use_fixed_results: true,
      scenario: "replay_publico",
    })
      .then((board) => {
        const line = board.lines.find((item) => item.slug === detail.match.slug || item.match_id === detail.match.id);
        setHouseLine(line);
      })
      .catch(() => setHouseLine(undefined));
  }, [detail.match.id, detail.match.slug]);

  useEffect(() => {
    fetchLearningLog(100)
      .then((items) => {
        const matchAutopsies = items.filter((item) => item.slug === detail.match.slug);
        setAutopsy(matchAutopsies.find((item) => item.best_parameters_json.includes("calibrated_autopsy")) ?? matchAutopsies[0] ?? null);
      })
      .catch(() => setAutopsy(null));
  }, [detail.match.slug]);

  useEffect(() => {
    if (!playing) return undefined;
    const started = performance.now();
    const startProgress = progress;
    const tick = () => {
      const now = performance.now();
      const next = Math.min(1, startProgress + (now - started) / 68000);
      setProgress(next);
      if (next >= 1) setPlaying(false);
    };
    tick();
    const timer = window.setInterval(tick, 120);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (!cinematic || !playing) return undefined;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(1, current + 0.0022);
        if (next >= 1) setPlaying(false);
        return next;
      });
    }, 150);
    return () => window.clearInterval(timer);
  }, [cinematic, playing]);

  useEffect(() => {
    if (!voiceOn || !playing || activeIndex === lastSpoken.current) return;
    lastSpoken.current = activeIndex;
    speak(activeMoment.narration);
  }, [activeIndex, activeMoment.narration, playing, voiceOn]);

  useEffect(() => {
    if (!cinematic) return;
    arenaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (progress >= 1) setProgress(0);
    setPlaying(true);
    setVoiceOn(true);
    lastSpoken.current = -1;
  }, [cinematic]);

  const startReplay = () => {
    if (progress >= 1) setProgress(0);
    setPlaying(true);
    if (voiceOn) speak(activeMoment.narration);
  };

  const resetReplay = () => {
    setPlaying(false);
    setProgress(0);
    lastSpoken.current = -1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    if (next) speak(activeMoment.narration);
    else if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  return (
    <main className={cinematic ? "replay-page cinema" : "replay-page"}>
      <section className="replay-stage">
        <nav className="nav replay-nav" aria-label="Navegacion principal">
          <a className="brand" href="/">
            <Trophy size={22} />
            <span>Mundial Lab</span>
          </a>
          <div className="nav-links">
            <a href="/partidos/">Partidos</a>
            <a href={`/partidos/${detail.match.slug}/`}>Sala del partido</a>
            <a href="/laboratorio-datos/">Datos</a>
            <a href="/montecarlo-casa/">Monte Carlo</a>
          </div>
        </nav>

        <button
          className="replay-cinema-toggle"
          onClick={() => {
            const next = !cinematic;
            setCinematic(next);
            if (!next) {
              setVoiceOn(false);
              if ("speechSynthesis" in window) window.speechSynthesis.cancel();
            }
          }}
          type="button"
        >
          <Sparkles size={17} />
          {cinematic ? "Salir de modo cine" : "Modo cine"}
        </button>

        <section className="replay-hero-info">
          <div className="replay-copy">
            <p className="eyebrow">Replay 3D narrado</p>
            <h1>
              {detail.match.home_team}
              <span> vs </span>
              {detail.match.away_team}
            </h1>
            <p>
              Un resumen pambolero de datos: cancha, momentum, xG, eventos y narracion para convertir
              el modelo en una pelicula corta del partido.
            </p>
          </div>

          <aside className="replay-score">
            <span>{mode}</span>
            <strong>
              {detail.match.home_score} - {detail.match.away_score}
            </strong>
            <small>{detail.match.venue}, {detail.match.city}</small>
          </aside>

          <aside className="replay-house-line">
            <span>Monte Carlo de la casa</span>
            <strong>{houseLine?.favorite ?? "Linea pendiente"}</strong>
            <div>
              <b>{houseLine ? `${Math.round(houseLine.home_win * 100)}%` : "--"} local</b>
              <b>{houseLine ? `${Math.round(houseLine.draw * 100)}%` : "--"} empate</b>
              <b>{houseLine ? `${Math.round(houseLine.away_win * 100)}%` : "--"} visita</b>
            </div>
            <a href={kitHref}>Autopsia + kit</a>
          </aside>

        </section>

        <div className="replay-arena" ref={arenaRef}>
          <ReplayCanvas cinematic={cinematic} detail={detail} houseLine={houseLine} moments={moments} progress={progress} />
        </div>
        <section className="replay-broadcast-bar" aria-label="Marcador de transmision">
          <div className="replay-scorebug">
            <span>{teamFlag(detail.match.home_team)} {detail.match.home_team}</span>
            <strong>{detail.match.home_score} - {detail.match.away_score}</strong>
            <span>{teamFlag(detail.match.away_team)} {detail.match.away_team}</span>
          </div>
          <div className="replay-oddsbug">
            <span>Casa</span>
            <b>{houseLine ? `${Math.round(houseLine.home_win * 100)}%` : "--"} L</b>
            <b>{houseLine ? `${Math.round(houseLine.draw * 100)}%` : "--"} E</b>
            <b>{houseLine ? `${Math.round(houseLine.away_win * 100)}%` : "--"} V</b>
          </div>
          <div className="replay-momentum-bug">
            <span>Momentum</span>
            <i><em style={{ width: `${Math.round(activeMoment.momentum * 100)}%` }} /></i>
          </div>
        </section>
        <section className="replay-cinema-caption" aria-live="polite">
          <span>{activeMinute}' · {activeMoment.label}</span>
          <p>{activeMoment.narration}</p>
        </section>
        <div className="replay-orbit-hint">Arrastra para rotar · rueda para zoom</div>

        <section className="replay-cinema-strip" aria-live="polite">
          <div>
            <span>Minuto {activeMinute}</span>
            <strong>{activeMoment.label}</strong>
            <p>{activeMoment.narration}</p>
          </div>
          <dl>
            <div>
              <dt>xG local</dt>
              <dd>{homeXg}</dd>
            </div>
            <div>
              <dt>xG visita</dt>
              <dd>{awayXg}</dd>
            </div>
            <div>
              <dt>Momentum</dt>
              <dd>{Math.round(activeMoment.momentum * 100)}%</dd>
            </div>
          </dl>
        </section>

        <section className="replay-autopsy-note">
          <div>
            <span>Salida publicable</span>
            <strong>{autopsy ? "La lectura ya tiene autopsia y tarjeta" : "Autopsia en cola o pendiente"}</strong>
            <p>{autopsyLine}</p>
          </div>
          <div>
            <a href={kitHref}>Abrir kit</a>
            <a href={autopsyHref}>Ver Diario</a>
            <a href={matchHref}>Retar lectura</a>
          </div>
        </section>

        <section className="replay-panel">
          <div className="replay-caption">
            <span>Minuto {activeMinute}</span>
            <strong>{activeMoment.label}</strong>
            <p>{activeMoment.narration}</p>
          </div>
          <div className="replay-metrics">
            <article>
              <span>xG {detail.match.home_team}</span>
              <strong>{homeXg}</strong>
            </article>
            <article>
              <span>xG {detail.match.away_team}</span>
              <strong>{awayXg}</strong>
            </article>
            <article>
              <span>Momentum</span>
              <strong>{Math.round(activeMoment.momentum * 100)}%</strong>
            </article>
            <article>
              <span>Confianza casa</span>
              <strong>{houseLine ? `${Math.round(houseLine.confidence * 100)}%` : "--"}</strong>
            </article>
          </div>
          <div className="replay-controls">
            <button onClick={playing ? () => setPlaying(false) : startReplay} type="button">
              {playing ? <Pause size={18} /> : <Play size={18} />}
              {playing ? "Pausar" : "Reproducir"}
            </button>
            <button onClick={toggleVoice} type="button">
              {voiceOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
              Narracion
            </button>
            <button onClick={resetReplay} type="button">
              <RotateCcw size={18} />
              Reiniciar
            </button>
            <button onClick={() => setCinematic((value) => !value)} type="button">
              <Sparkles size={18} />
              {cinematic ? "Vista normal" : "Modo cine"}
            </button>
          </div>
          <div className="replay-timeline">
            <i style={{ width: `${progress * 100}%` }} />
            {moments.map((moment) => (
              <button
                aria-label={`Ir al minuto ${moment.minute}`}
                key={`${moment.minute}-${moment.label}`}
                onClick={() => {
                  setProgress(moment.minute / 90);
                  setPlaying(false);
                }}
                style={{ left: `${(moment.minute / 90) * 100}%` }}
                type="button"
              />
            ))}
          </div>
        </section>

        <section className="replay-events">
          <div className="workflow-title">
            <Sparkles />
            <h2>Guion del resumen</h2>
          </div>
          <ol>
            {moments.map((moment) => (
              <li className={moment === activeMoment ? "active" : ""} key={`${moment.minute}-${moment.label}`}>
                <span>{moment.minute}'</span>
                <strong>{moment.label}</strong>
              </li>
            ))}
          </ol>
        </section>

        <div className="replay-live-badge">
          <Radio size={16} />
          Listo para captura, video o pantalla de stand
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<GameReplayPage />);
