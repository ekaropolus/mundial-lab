import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Radio, Trophy } from "lucide-react";
import { SiteFooter } from "../components/SiteFooter";
import { fetchLeaderboard } from "../lib/api";
import { demoLeaderboard } from "../lib/liveDemo";
import { DirectorScore } from "../types";
import "../styles.css";

function DirectorsPage() {
  const [rows, setRows] = useState<DirectorScore[]>(demoLeaderboard);
  const [mode, setMode] = useState("demo local");

  useEffect(() => {
    fetchLeaderboard()
      .then((items) => {
        setRows(items.length ? items : demoLeaderboard);
        setMode(items.length ? "API activa" : "demo local");
      })
      .catch(() => setMode("demo local"));
  }, []);

  return (
    <main>
      <nav className="nav page-nav" aria-label="Navegacion principal">
        <a className="brand" href="/">
          <Trophy size={22} />
          <span>Mundial Lab</span>
        </a>
        <div className="nav-links">
          <a href="/partidos/">Partidos</a>
          <a href="/montecarlo-casa/">Monte Carlo</a>
          <a href="/laboratorio-datos/">Datos</a>
          <a href="/modelos/ensemble/">Modelos</a>
        </div>
      </nav>
      <section className="dashboard directors-landing">
        <div className="section-heading">
          <p className="section-kicker">Leaderboard - {mode}</p>
          <h2>La tabla de quienes leen mejor el partido.</h2>
          <p>
            Cuando un marcador ya cerro, el score premia la probabilidad que le diste al resultado real.
            En partidos vivos, la lectura queda en observacion hasta el silbatazo final.
          </p>
          <div className="section-actions">
            <a href="/partidos/001-mexico-vs-south-africa/">
              <Radio size={17} />
              Hacer mi primera lectura
            </a>
            <a className="ghost-dark" href="/montecarlo-casa/">Ver linea Monte Carlo</a>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Director</th>
              <th>Predicciones</th>
              <th>Score vivo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.director_name}>
                <td>
                  <strong>#{index + 1}</strong> {row.director_name}
                </td>
                <td>{row.predictions}</td>
                <td>{Math.round(row.score * 100)} pts</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <SiteFooter />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<DirectorsPage />);
