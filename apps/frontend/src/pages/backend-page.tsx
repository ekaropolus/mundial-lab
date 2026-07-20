import { createRoot } from "react-dom/client";
import { BarChart3, DatabaseZap, Goal, Trophy } from "lucide-react";
import { SiteFooter } from "../components/SiteFooter";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
  <main>
    <nav className="nav page-nav" aria-label="Navegación principal">
      <a className="brand" href="/">
        <Trophy size={22} />
        <span>Mundial Lab</span>
      </a>
      <div className="nav-links">
        <a href="/">Tablero</a>
        <a href="/modelos/ensemble/">Ensamble</a>
        <a href="/admin/live-control/">Admin</a>
      </div>
    </nav>
    <section className="architecture standalone" id="arquitectura">
      <div className="section-heading">
        <p className="section-kicker">Motor de calculo</p>
        <h2>Servidor propio, trabajos bajo demanda y páginas estáticas en la VPS.</h2>
        <p>
          La pagina no depende de que la API este prendida todo el tiempo. El motor vive como
          servicio de cálculo: se enciende para procesar jobs, entrenar modelos, refrescar datos o
          generar reportes.
        </p>
      </div>
      <div className="architecture-grid">
        <article>
          <DatabaseZap />
          <h3>Datos persistentes</h3>
          <p>
            SQLite funciona para prototipo y demos. PostgreSQL queda como ruta natural cuando haya
            usuarios, snapshots históricos y reportes guardados.
          </p>
        </article>
        <article>
          <BarChart3 />
          <h3>Módulos de modelo</h3>
          <p>
            Cada módulo declara entradas, controles, workflow, entrenamiento, simulación y forma de
            explicar resultados.
          </p>
        </article>
        <article>
          <Goal />
          <h3>Cola bajo demanda</h3>
          <p>
            Redis/RQ procesa corridas largas cuando el servidor esté activo. Si está apagado, el
            frontend sigue navegable con modo demo local.
          </p>
        </article>
      </div>
    </section>
    <SiteFooter />
  </main>,
);
