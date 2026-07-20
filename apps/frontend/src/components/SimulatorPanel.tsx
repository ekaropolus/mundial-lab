import { useEffect, useState } from "react";
import { Play, Send } from "lucide-react";
import { enqueueSimulation, runInlineSimulation } from "../lib/api";
import { localSimulation } from "../lib/localSimulation";
import { ModelName, SimulationResult } from "../types";

type SimulatorPanelProps = {
  selectedModel?: ModelName;
  locked?: boolean;
};

const modelLabels: Record<ModelName, string> = {
  ensemble: "Ensamble",
  dixon_coles: "Dixon-Coles",
  bayes_live: "Bayes en vivo",
  poisson: "Poisson",
  elo: "Elo",
};

export function SimulatorPanel({ selectedModel = "ensemble", locked = false }: SimulatorPanelProps) {
  const [model, setModel] = useState<ModelName>(selectedModel);
  const [simulations, setSimulations] = useState(1000);
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [jobMessage, setJobMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setModel(selectedModel);
    setResult(null);
    setJobMessage("");
  }, [selectedModel]);

  async function runQuick() {
    setLoading(true);
    setJobMessage("");
    try {
      setResult(await runInlineSimulation(model, simulations));
      setJobMessage("Cálculo servido por la API.");
    } catch {
      setResult(localSimulation(model, simulations));
      setJobMessage("API apagada o inaccesible. Mostrando una corrida demo local.");
    } finally {
      setLoading(false);
    }
  }

  async function sendJob() {
    setLoading(true);
    setResult(null);
    try {
      const job = await enqueueSimulation(model, Math.max(simulations, 10000), email);
      setJobMessage(`Job creado: ${job.job_id}. La cola de cálculo lo procesará en segundo plano.`);
    } catch {
      setJobMessage("No se pudo contactar al motor de calculo. Intenta cuando el servidor este encendido.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="simulator" id="simulador">
      <div className="panel-title">
        <span>Laboratorio operativo</span>
        <strong>
          {locked
            ? `Prueba ${modelLabels[model]} como motor de decisión y observa cómo cambia la tabla de probabilidades.`
            : "Compara modelos y observa qué historia cuentan sus probabilidades."}
        </strong>
      </div>
      <div className="controls">
        {locked ? (
          <label>
            Modelo activo
            <input value={modelLabels[model]} readOnly />
          </label>
        ) : (
          <label>
            Modelo
            <select value={model} onChange={(event) => setModel(event.target.value as ModelName)}>
              <option value="ensemble">Ensamble</option>
              <option value="dixon_coles">Dixon-Coles</option>
              <option value="bayes_live">Bayes en vivo</option>
              <option value="poisson">Poisson</option>
              <option value="elo">Elo</option>
            </select>
          </label>
        )}
        <label>
          Corridas
          <input
            type="number"
            min={100}
            max={100000}
            step={100}
            value={simulations}
            onChange={(event) => setSimulations(Number(event.target.value))}
          />
        </label>
        <label>
          Correo para corridas pesadas
          <input
            type="email"
            placeholder="estudiante@escuela.edu"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
      </div>
      <div className="actions">
        <button onClick={runQuick} disabled={loading || simulations > 5000}>
          <Play size={18} />
          Correr demo rápida
        </button>
        <button className="secondary" onClick={sendJob} disabled={loading}>
          <Send size={18} />
          Enviar a cola
        </button>
      </div>
      {jobMessage && <p className="job-message">{jobMessage}</p>}
      {result && (
        <div className="results">
          <div>
            <span>Lectura metodológica</span>
            <p>{result.methodology}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Selección</th>
                <th>Campeón</th>
                <th>Final</th>
                <th>Semis</th>
              </tr>
            </thead>
            <tbody>
              {result.summary.slice(0, 8).map((team) => (
                <tr key={team.team_id}>
                  <td>{team.team}</td>
                  <td>{Math.round(team.champion * 100)}%</td>
                  <td>{Math.round(team.finalist * 100)}%</td>
                  <td>{Math.round(team.semifinalist * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
