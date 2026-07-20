import { createRoot } from "react-dom/client";
import { ArrowLeft, Trophy } from "lucide-react";
import { ModelPage } from "../components/ModelPage";
import { SiteFooter } from "../components/SiteFooter";
import { fallbackModels } from "../lib/modelContent";
import { ModelName } from "../types";
import "../styles.css";

const modelId = document.documentElement.dataset.modelId as ModelName;
const model = fallbackModels.find((item) => item.id === modelId) ?? fallbackModels[0];

createRoot(document.getElementById("root")!).render(
  <main>
    <nav className="nav page-nav" aria-label="Navegación principal">
      <a className="brand" href="/">
        <Trophy size={22} />
        <span>Mundial Lab</span>
      </a>
      <div className="nav-links">
        <a href="/">Tablero</a>
        <a href="/partidos/">Partidos</a>
        <a href="/laboratorio-datos/">Datos</a>
        <a href="/diario-aprendizaje/">Diario</a>
        <a href="/modelos/ensemble/">Ensamble</a>
      </div>
    </nav>
    <div className="page-shell">
      <a className="back-link" href="/partidos/">
        <ArrowLeft size={18} />
        Volver al menu de partidos
      </a>
      <ModelPage model={model} />
    </div>
    <SiteFooter />
  </main>,
);
