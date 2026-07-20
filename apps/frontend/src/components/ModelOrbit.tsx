import { useEffect, useRef } from "react";
import { ModelName } from "../types";

type ModelOrbitProps = {
  variant?: ModelName | "home";
};

type ThreeModule = typeof import("three");

const orbitMeta: Record<ModelName | "home", { label: string; kicker: string }> = {
  home: {
    label: "Mundial Lab",
    kicker: "datos en juego",
  },
  elo: {
    label: "Elo",
    kicker: "jerarquia en la cancha",
  },
  poisson: {
    label: "Poisson",
    kicker: "cuantos goles caben hoy",
  },
  dixon_coles: {
    label: "Dixon-Coles",
    kicker: "partido amarrado",
  },
  bayes_live: {
    label: "Bayes Live",
    kicker: "cambia la lectura al minuto",
  },
  ensemble: {
    label: "Ensemble",
    kicker: "mesa tecnica de modelos",
  },
};

const palette = {
  blue: 0x23a6d5,
  cyan: 0x8bd3ff,
  green: 0x7ee2a8,
  gold: 0xffc857,
  pink: 0xff5c8a,
  violet: 0xb28cff,
  white: 0xf8fafc,
  dim: 0x6f7d88,
  dark: 0x101820,
};

function basic(THREE: ThreeModule, color: number, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
  });
}

function lineMaterial(THREE: ThreeModule, color: number, opacity = 0.55) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity });
}

function addLine(THREE: ThreeModule, group: import("three").Group, points: import("three").Vector3[], color: number, opacity = 0.55) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geometry, lineMaterial(THREE, color, opacity));
  group.add(line);
  return line;
}

function addTexturedPlane(THREE: ThreeModule, group: import("three").Group, width: number, height: number, color: number, opacity = 0.2) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), basic(THREE, color, opacity));
  group.add(mesh);
  return mesh;
}

function addHalo(THREE: ThreeModule, group: import("three").Group, color: number, radius: number, opacity = 0.16) {
  const halo = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.018, 18, 160), basic(THREE, color, opacity));
  halo.rotation.x = Math.PI / 2.35;
  group.add(halo);
  return halo;
}

function addSparkField(THREE: ThreeModule, group: import("three").Group, colors: number[], count = 28) {
  const sparks: import("three").Mesh[] = [];
  for (let i = 0; i < count; i += 1) {
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.025 + (i % 3) * 0.012, 10, 10),
      basic(THREE, colors[i % colors.length], 0.72),
    );
    spark.userData.phase = i / count;
    spark.userData.radius = 1.05 + (i % 6) * 0.18;
    spark.userData.height = -0.75 + ((i * 7) % 15) * 0.1;
    group.add(spark);
    sparks.push(spark);
  }
  return sparks;
}

function addBox(
  THREE: ThreeModule,
  group: import("three").Group,
  size: [number, number, number],
  position: [number, number, number],
  color: number,
  opacity = 0.9,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), basic(THREE, color, opacity));
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

function visualLayout(variant: ModelName | "home") {
  switch (variant) {
    case "elo":
      return { x: 1.0, y: -0.2, scale: 0.86 };
    case "poisson":
      return { x: 0.62, y: -0.18, scale: 0.9 };
    case "dixon_coles":
      return { x: 0.9, y: -0.08, scale: 0.82 };
    case "bayes_live":
      return { x: 0.86, y: 0, scale: 0.86 };
    case "ensemble":
      return { x: 0.56, y: -0.02, scale: 0.9 };
    default:
      return { x: 0.72, y: -0.08, scale: 1.12 };
  }
}

function motifLayout(variant: ModelName | "home") {
  switch (variant) {
    case "elo":
      return { x: 0.82, y: -0.62, z: 0.74, scale: 1.08 };
    case "poisson":
      return { x: 0.1, y: -0.58, z: 0.78, scale: 1.18 };
    case "dixon_coles":
      return { x: -0.08, y: -0.54, z: 0.76, scale: 1.02 };
    case "bayes_live":
      return { x: -0.18, y: -0.55, z: 0.8, scale: 1.08 };
    case "ensemble":
      return { x: -0.08, y: -0.5, z: 0.76, scale: 1.04 };
    default:
      return { x: -0.12, y: -0.62, z: 0.72, scale: 1.24 };
  }
}

function buildFootballMotif(THREE: ThreeModule, group: import("three").Group, variant: ModelName | "home") {
  const motif = new THREE.Group();
  const layout = motifLayout(variant);
  motif.position.set(layout.x, layout.y, layout.z);
  motif.rotation.x = -0.18;
  motif.scale.setScalar(layout.scale);
  group.add(motif);

  if (variant === "elo") {
    const shirt = addBox(THREE, motif, [0.36, 0.44, 0.035], [0.08, 0.1, 0], palette.green, 0.52);
    addBox(THREE, motif, [0.15, 0.2, 0.03], [-0.18, 0.22, 0], palette.green, 0.44).rotation.z = -0.68;
    addBox(THREE, motif, [0.15, 0.2, 0.03], [0.34, 0.22, 0], palette.green, 0.44).rotation.z = 0.68;
    addLine(THREE, motif, [new THREE.Vector3(-0.82, -0.2, 0.02), new THREE.Vector3(-0.32, 0.12, 0.02), new THREE.Vector3(0.78, 0.58, 0.02)], palette.gold, 0.82);
    return (t: number) => {
      shirt.scale.setScalar(1 + Math.sin(t * 2.2) * 0.035);
      motif.rotation.z = Math.sin(t * 1.4) * 0.05;
    };
  }

  if (variant === "poisson") {
    addBox(THREE, motif, [1.2, 0.035, 0.035], [0, 0.56, 0], palette.white, 0.6);
    addBox(THREE, motif, [0.035, 0.86, 0.035], [-0.58, 0.15, 0], palette.white, 0.58);
    addBox(THREE, motif, [0.035, 0.86, 0.035], [0.58, 0.15, 0], palette.white, 0.58);
    for (let i = -2; i <= 2; i += 1) {
      addLine(THREE, motif, [new THREE.Vector3(i * 0.22, 0.54, -0.03), new THREE.Vector3(i * 0.16, -0.28, -0.18)], palette.cyan, 0.28);
    }
    const balls = [-0.36, 0, 0.36].map((x, index) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 18), basic(THREE, index === 1 ? palette.gold : palette.white, 0.72));
      ball.position.set(x, -0.24 + index * 0.06, 0.12);
      motif.add(ball);
      return ball;
    });
    return (t: number) => {
      balls.forEach((ball, index) => {
        ball.position.y = -0.24 + index * 0.06 + Math.abs(Math.sin(t * 2.5 + index)) * 0.16;
        ball.rotation.y = t * 2;
      });
    };
  }

  if (variant === "dixon_coles") {
    const wall: import("three").Mesh[] = [];
    for (let i = 0; i < 4; i += 1) {
      const player = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.22, 4, 10), basic(THREE, i % 2 ? palette.gold : palette.pink, 0.58));
      player.position.set(-0.42 + i * 0.22, 0.04, 0.03);
      motif.add(player);
      wall.push(player);
    }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 18, 18), basic(THREE, palette.white, 0.76));
    ball.position.set(-0.72, -0.3, 0.08);
    motif.add(ball);
    const curve = addLine(THREE, motif, [new THREE.Vector3(-0.66, -0.24, 0.08), new THREE.Vector3(-0.05, 0.1, 0.08), new THREE.Vector3(0.62, -0.08, 0.08)], palette.pink, 0.82);
    return (t: number) => {
      wall.forEach((player, index) => {
        player.position.y = 0.04 + Math.max(0, Math.sin(t * 3 + index * 0.2)) * 0.04;
      });
      ball.position.x = -0.72 + (Math.sin(t * 1.2) + 1) * 0.12;
      curve.scale.y = 1 + Math.sin(t * 2.1) * 0.12;
    };
  }

  if (variant === "bayes_live") {
    const screen = addBox(THREE, motif, [0.94, 0.5, 0.04], [0, 0.14, 0], palette.dark, 0.46);
    addBox(THREE, motif, [0.78, 0.025, 0.06], [0, 0.35, 0.04], palette.green, 0.72);
    addBox(THREE, motif, [0.32, 0.06, 0.05], [0, -0.18, 0.02], palette.dark, 0.5);
    const card = addBox(THREE, motif, [0.15, 0.24, 0.04], [0.52, 0.34, 0.05], palette.gold, 0.8);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.072, 18, 18), basic(THREE, palette.white, 0.72));
    ball.position.set(-0.42, -0.12, 0.08);
    motif.add(ball);
    addLine(THREE, motif, [new THREE.Vector3(-0.36, -0.08, 0.08), new THREE.Vector3(-0.06, 0.28, 0.08), new THREE.Vector3(0.34, 0.08, 0.08)], palette.green, 0.7);
    return (t: number) => {
      screen.scale.x = 1 + Math.sin(t * 1.8) * 0.025;
      card.position.y = 0.34 + Math.sin(t * 2.4) * 0.07;
      ball.position.x = -0.42 + Math.sin(t * 1.8) * 0.16;
    };
  }

  const board = addBox(THREE, motif, [1.05, 0.66, 0.035], [0, 0.08, 0], palette.green, 0.36);
  const dots: import("three").Mesh[] = [];
  [[-0.32, 0.24], [0.28, 0.26], [-0.1, 0.05], [0.36, -0.08], [-0.36, -0.18]].forEach(([x, y], index) => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 14), basic(THREE, [palette.blue, palette.gold, palette.pink, palette.violet, palette.white][index], 0.76));
    dot.position.set(x, y, 0.06);
    motif.add(dot);
    dots.push(dot);
  });
  addLine(THREE, motif, [new THREE.Vector3(-0.32, 0.24, 0.07), new THREE.Vector3(-0.1, 0.05, 0.07), new THREE.Vector3(0.36, -0.08, 0.07)], palette.white, 0.72);
  return (t: number) => {
    board.rotation.z = Math.sin(t * 0.9) * 0.025;
    dots.forEach((dot, index) => {
      dot.scale.setScalar(1 + Math.sin(t * 2.3 + index) * 0.16);
    });
  };
}

function buildHomeScene(THREE: ThreeModule, group: import("three").Group) {
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.76, 2),
    basic(THREE, palette.white, 0.36),
  );
  group.add(core);

  [palette.blue, palette.green, palette.gold, palette.pink, palette.violet].forEach((color, index) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1 + index * 0.28, 0.009, 12, 120),
      basic(THREE, color, 0.3),
    );
    ring.rotation.x = Math.PI / 2.4 + index * 0.18;
    ring.rotation.y = index * 0.24;
    group.add(ring);
  });

  return (t: number) => {
    core.rotation.x = t * 0.7;
    core.rotation.y = t * 0.55;
    group.rotation.y = t * 0.28;
  };
}

function buildEloScene(THREE: ThreeModule, group: import("three").Group) {
  const halo = addHalo(THREE, group, palette.green, 1.55, 0.28);
  const sparks = addSparkField(THREE, group, [palette.green, palette.gold, palette.white], 30);
  const bars = [0.72, 1.04, 1.36, 1.78, 2.18];
  const barMeshes: import("three").Mesh[] = [];
  bars.forEach((height, index) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, height, 0.34), basic(THREE, index === 4 ? palette.green : palette.cyan, index === 4 ? 0.98 : 0.78));
    bar.position.set((index - 2) * 0.52, -0.95 + height / 2, 0);
    bar.rotation.z = -0.06;
    group.add(bar);
    barMeshes.push(bar);

    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 18), basic(THREE, index === 4 ? palette.gold : palette.white, 0.95));
    marker.position.set(bar.position.x, bar.position.y + height / 2 + 0.16, 0.02);
    group.add(marker);
  });

  addLine(
    THREE,
    group,
    bars.map((height, index) => new THREE.Vector3((index - 2) * 0.52, -0.95 + height + 0.16, 0.08)),
    palette.green,
    0.7,
  );

  const upset = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 3), basic(THREE, palette.pink, 0.9));
  upset.position.set(-1.45, 0.7, 0.15);
  upset.rotation.z = -0.6;
  group.add(upset);

  return (t: number) => {
    group.rotation.y = -0.18 + Math.sin(t * 0.75) * 0.08;
    group.rotation.z = -0.08;
    upset.position.y = 0.7 + Math.sin(t * 2.8) * 0.12;
    halo.rotation.z = t * 0.42;
    barMeshes.forEach((bar, index) => {
      bar.scale.y = 1 + Math.sin(t * 1.8 + index) * 0.035;
    });
    sparks.forEach((spark) => {
      const phase = spark.userData.phase + t * 0.08;
      spark.position.set(Math.cos(phase * Math.PI * 2) * spark.userData.radius, spark.userData.height, Math.sin(phase * Math.PI * 2) * 0.42);
    });
  };
}

function buildPoissonScene(THREE: ThreeModule, group: import("three").Group) {
  const halo = addHalo(THREE, group, palette.blue, 1.8, 0.24);
  const sparks = addSparkField(THREE, group, [palette.blue, palette.green, palette.gold], 36);
  const cellSize = 0.34;
  const cubes: import("three").Mesh[] = [];
  for (let x = 0; x < 6; x += 1) {
    for (let y = 0; y < 6; y += 1) {
      const distance = Math.abs(x - 2) + Math.abs(y - 1);
      const probability = Math.max(0.16, 0.82 - distance * 0.12);
      const color = probability > 0.62 ? palette.gold : probability > 0.38 ? palette.green : palette.blue;
      const cube = new THREE.Mesh(new THREE.BoxGeometry(cellSize, 0.06 + probability * 0.32, cellSize), basic(THREE, color, 0.84));
      cube.position.set((x - 2.5) * 0.42, -0.7 + probability * 0.16, (y - 2.5) * 0.42);
      cube.userData.baseY = cube.position.y;
      cube.userData.wave = x * 0.7 + y * 0.45;
      group.add(cube);
      cubes.push(cube);
    }
  }

  const lambdaHome = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 24), basic(THREE, palette.green));
  lambdaHome.position.set(-1.65, 1.05, 0.15);
  group.add(lambdaHome);
  const lambdaAway = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 24), basic(THREE, palette.blue));
  lambdaAway.position.set(1.65, 1.05, 0.15);
  group.add(lambdaAway);
  addLine(THREE, group, [lambdaHome.position, new THREE.Vector3(-0.45, 0.32, 0.1), new THREE.Vector3(0, -0.16, 0)], palette.green, 0.6);
  addLine(THREE, group, [lambdaAway.position, new THREE.Vector3(0.45, 0.32, 0.1), new THREE.Vector3(0, -0.16, 0)], palette.blue, 0.6);

  return (t: number) => {
    group.rotation.x = -0.82 + Math.sin(t * 0.7) * 0.04;
    group.rotation.y = -0.24;
    group.rotation.z = -0.08 + Math.sin(t * 0.35) * 0.035;
    halo.rotation.z = -t * 0.36;
    lambdaHome.scale.setScalar(1 + Math.sin(t * 2.1) * 0.16);
    lambdaAway.scale.setScalar(1 + Math.cos(t * 1.9) * 0.16);
    cubes.forEach((cube) => {
      cube.position.y = cube.userData.baseY + Math.sin(t * 2.2 + cube.userData.wave) * 0.035;
    });
    sparks.forEach((spark) => {
      const phase = spark.userData.phase + t * 0.11;
      spark.position.set(Math.cos(phase * Math.PI * 2) * 1.65, -0.78 + Math.sin(phase * Math.PI * 4) * 0.18, Math.sin(phase * Math.PI * 2) * 1.1);
    });
  };
}

function buildDixonColesScene(THREE: ThreeModule, group: import("three").Group) {
  addTexturedPlane(THREE, group, 3.3, 1.95, palette.white, 0.08);
  const halo = addHalo(THREE, group, palette.pink, 1.42, 0.3);
  const sparks = addSparkField(THREE, group, [palette.pink, palette.gold, palette.white], 26);
  const lowScores = [
    [-0.56, 0.42, "0-0"],
    [0.1, 0.42, "1-0"],
    [-0.56, -0.24, "0-1"],
    [0.1, -0.24, "1-1"],
  ] as const;

  const tiles: import("three").Mesh[] = [];
  lowScores.forEach(([x, y], index) => {
    const tile = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.08), basic(THREE, index === 0 ? palette.pink : palette.gold, 0.72));
    tile.position.set(x, y, 0);
    group.add(tile);
    tiles.push(tile);
  });

  const tension = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.026, 14, 120), basic(THREE, palette.pink, 0.56));
  tension.scale.set(1.4, 0.78, 1);
  group.add(tension);

  for (let i = 0; i < 5; i += 1) {
    const tail = addLine(
      THREE,
      group,
      [new THREE.Vector3(-1.35 + i * 0.66, -1.15, -0.1), new THREE.Vector3(-0.64 + (i % 2) * 0.74, -0.35 + (i % 2) * 0.7, 0.05)],
      palette.dim,
      0.32,
    );
    tail.userData.speed = 0.6 + i * 0.12;
  }

  return (t: number) => {
    group.rotation.x = -0.04;
    group.rotation.y = -0.16 + Math.sin(t * 0.6) * 0.06;
    group.rotation.z = 0.04;
    halo.rotation.z = t * 0.5;
    tension.scale.x = 1.35 + Math.sin(t * 2.4) * 0.08;
    tension.scale.y = 0.76 + Math.cos(t * 2.1) * 0.06;
    tiles.forEach((tile, index) => {
      tile.position.z = Math.sin(t * 2.8 + index) * 0.08;
      tile.scale.setScalar(1 + Math.sin(t * 2.2 + index) * 0.045);
    });
    sparks.forEach((spark) => {
      const phase = spark.userData.phase + t * 0.1;
      spark.position.set(-1.55 + phase % 1 * 3.1, Math.sin(phase * Math.PI * 6) * 0.75, 0.22);
    });
  };
}

function buildBayesScene(THREE: ThreeModule, group: import("three").Group) {
  const halo = addHalo(THREE, group, palette.violet, 1.7, 0.26);
  const sparks = addSparkField(THREE, group, [palette.violet, palette.green, palette.gold, palette.cyan], 40);
  const prior = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.035, 16, 120), basic(THREE, palette.violet, 0.95));
  prior.position.set(-1.05, 0, 0);
  prior.rotation.x = Math.PI / 2;
  group.add(prior);

  const posterior = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.035, 16, 120), basic(THREE, palette.green, 0.95));
  posterior.position.set(1.05, 0, 0);
  posterior.rotation.x = Math.PI / 2;
  group.add(posterior);

  const evidence = new THREE.Mesh(new THREE.SphereGeometry(0.22, 28, 28), basic(THREE, palette.gold, 1));
  evidence.position.set(0, 0.88, 0.05);
  group.add(evidence);

  addLine(THREE, group, [new THREE.Vector3(-0.55, 0.12, 0), new THREE.Vector3(-0.1, 0.72, 0.04), evidence.position], palette.violet, 0.55);
  addLine(THREE, group, [evidence.position, new THREE.Vector3(0.3, 0.56, 0.04), new THREE.Vector3(0.68, 0.16, 0)], palette.green, 0.72);

  const particles: import("three").Mesh[] = [];
  for (let i = 0; i < 16; i += 1) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), basic(THREE, i % 3 === 0 ? palette.gold : palette.cyan, 0.82));
    dot.userData.phase = i / 16;
    group.add(dot);
    particles.push(dot);
  }

  return (t: number) => {
    group.rotation.x = -0.08;
    group.rotation.y = -0.18 + Math.sin(t * 0.45) * 0.08;
    halo.rotation.z = -t * 0.38;
    prior.scale.setScalar(1 + Math.sin(t * 1.8) * 0.06);
    posterior.scale.setScalar(1 + Math.cos(t * 1.6) * 0.08);
    evidence.position.y = 0.88 + Math.sin(t * 2.2) * 0.1;
    particles.forEach((dot) => {
      const p = (dot.userData.phase + (t * 0.12) % 1) % 1;
      dot.position.set(-1.2 + p * 2.4, Math.sin(p * Math.PI) * 0.58 - 0.5, Math.cos(p * Math.PI * 2) * 0.16);
    });
    sparks.forEach((spark) => {
      const phase = spark.userData.phase + t * 0.075;
      spark.position.set(Math.cos(phase * Math.PI * 2) * spark.userData.radius, Math.sin(phase * Math.PI * 3) * 0.8, Math.sin(phase * Math.PI * 2) * 0.36);
    });
  };
}

function buildEnsembleScene(THREE: ThreeModule, group: import("three").Group) {
  const halo = addHalo(THREE, group, palette.gold, 1.65, 0.24);
  const sparks = addSparkField(THREE, group, [palette.blue, palette.green, palette.gold, palette.pink, palette.violet], 44);
  const center = new THREE.Mesh(new THREE.DodecahedronGeometry(0.44, 1), basic(THREE, palette.white, 0.76));
  group.add(center);

  const colors = [palette.blue, palette.green, palette.gold, palette.pink, palette.violet];
  const nodes: import("three").Mesh[] = [];
  const weights: import("three").Mesh[] = [];
  colors.forEach((color, index) => {
    const angle = (index / colors.length) * Math.PI * 2;
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 24), basic(THREE, color, 0.95));
    node.position.set(Math.cos(angle) * 1.45, Math.sin(angle) * 0.9, Math.sin(angle * 1.6) * 0.45);
    group.add(node);
    nodes.push(node);
    addLine(THREE, group, [node.position, new THREE.Vector3(0, 0, 0)], color, 0.55);

    const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7 + index * 0.12, 16), basic(THREE, color, 0.72));
    weight.position.set(-1.85 + index * 0.32, -1.15 + index * 0.06, 0);
    weight.rotation.z = -0.18;
    group.add(weight);
    weights.push(weight);
  });

  return (t: number) => {
    group.rotation.y = -0.24 + Math.sin(t * 0.42) * 0.1;
    group.rotation.x = -0.08 + Math.sin(t * 0.5) * 0.06;
    halo.rotation.z = t * 0.44;
    center.rotation.x = t * 0.8;
    center.rotation.z = t * 0.65;
    nodes.forEach((node, index) => {
      node.scale.setScalar(1 + Math.sin(t * 2.4 + index) * 0.12);
    });
    weights.forEach((weight, index) => {
      weight.scale.y = 1 + Math.sin(t * 1.9 + index * 0.8) * 0.18;
    });
    sparks.forEach((spark) => {
      const phase = spark.userData.phase + t * 0.09;
      spark.position.set(Math.cos(phase * Math.PI * 2) * 1.85, Math.sin(phase * Math.PI * 2) * 1.08, Math.cos(phase * Math.PI * 4) * 0.38);
    });
  };
}

export function ModelOrbit({ variant = "home" }: ModelOrbitProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function startScene() {
      const THREE = await import("three");
      if (!host || disposed) return;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, host.clientWidth / host.clientHeight, 0.1, 100);
      camera.position.set(0, 0, 5.2);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(host.clientWidth, host.clientHeight);
      host.appendChild(renderer.domElement);

      const group = new THREE.Group();
      const layout = visualLayout(variant);
      group.position.x = layout.x;
      group.position.y = layout.y;
      group.scale.setScalar(layout.scale);
      scene.add(group);

      const ambient = new THREE.Mesh(new THREE.SphereGeometry(2.5, 48, 48), basic(THREE, palette.white, 0.09));
      scene.add(ambient);

      const animateScene =
        variant === "elo"
          ? buildEloScene(THREE, group)
          : variant === "poisson"
            ? buildPoissonScene(THREE, group)
            : variant === "dixon_coles"
              ? buildDixonColesScene(THREE, group)
              : variant === "bayes_live"
                ? buildBayesScene(THREE, group)
                : variant === "ensemble"
                  ? buildEnsembleScene(THREE, group)
                  : buildHomeScene(THREE, group);
      const animateMotif = buildFootballMotif(THREE, group, variant);

      let frame = 0;
      const animate = () => {
        frame = requestAnimationFrame(animate);
        const t = Date.now() * 0.001;
        animateScene(t);
        animateMotif(t);
        renderer.render(scene, camera);
      };
      animate();

      const resize = () => {
        if (!host) return;
        camera.aspect = host.clientWidth / host.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(host.clientWidth, host.clientHeight);
      };
      window.addEventListener("resize", resize);

      cleanup = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", resize);
        renderer.dispose();
        if (host.contains(renderer.domElement)) {
          host.removeChild(renderer.domElement);
        }
      };
    }

    void startScene();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [variant]);

  const meta = orbitMeta[variant];

  return (
    <div className={`model-orbit orbit-${variant}`} ref={hostRef} aria-label={`Animacion 3D de ${meta.label}`}>
      <div className="orbit-copy" aria-hidden="true">
        <span>{meta.kicker}</span>
        <strong>{meta.label}</strong>
      </div>
      <i className="orbit-sweep" aria-hidden="true" />
    </div>
  );
}
