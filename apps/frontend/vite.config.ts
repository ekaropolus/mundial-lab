import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const page = (name: string, file: string) => [name, resolve(__dirname, file)] as const;
const partidoDir = resolve(__dirname, "partidos");
const partidoInputs = existsSync(partidoDir)
  ? Object.fromEntries(
      readdirSync(partidoDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => page(`partido_${entry.name.replace(/-/g, "_")}`, `partidos/${entry.name}/index.html`)),
    )
  : {};

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        backend: resolve(__dirname, "backend/index.html"),
        elo: resolve(__dirname, "modelos/elo/index.html"),
        poisson: resolve(__dirname, "modelos/poisson/index.html"),
        dixon_coles: resolve(__dirname, "modelos/dixon_coles/index.html"),
        bayes_live: resolve(__dirname, "modelos/bayes_live/index.html"),
        ensemble: resolve(__dirname, "modelos/ensemble/index.html"),
        partidos: resolve(__dirname, "partidos/index.html"),
        simulador_partido: resolve(__dirname, "simulador-partido/index.html"),
        directores: resolve(__dirname, "directores/index.html"),
        montecarlo_casa: resolve(__dirname, "montecarlo-casa/index.html"),
        diario_aprendizaje: resolve(__dirname, "diario-aprendizaje/index.html"),
        laboratorio_datos: resolve(__dirname, "laboratorio-datos/index.html"),
        admin_live_control: resolve(__dirname, "admin/live-control/index.html"),
        admin_social_room: resolve(__dirname, "admin/social-room/index.html"),
        ...partidoInputs,
      },
    },
  },
});
