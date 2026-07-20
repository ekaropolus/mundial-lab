import { Activity, BarChart3, Brain, GitBranch, Orbit, Sigma } from "lucide-react";

const models = [
  {
    icon: Activity,
    name: "Elo dinámico",
    copy: "Cada partido mueve la fuerza de una selección. Es simple, visual y sirve para explicar aprendizaje incremental.",
  },
  {
    icon: Sigma,
    name: "Poisson",
    copy: "Convierte ataque y defensa en marcadores probables. Ideal para ver por qué 1-0, 1-1 y 2-1 aparecen tanto.",
  },
  {
    icon: GitBranch,
    name: "Dixon-Coles",
    copy: "Corrige el fútbol de baja anotación. Funciona como prototipo calibrable para explicar partidos cerrados.",
  },
  {
    icon: Brain,
    name: "Bayes live",
    copy: "Actualiza creencias con evidencia viva del partido. Muestra incertidumbre, no solo una predicción.",
  },
  {
    icon: Orbit,
    name: "Monte Carlo",
    copy: "Corre miles de escenarios para observar caminos, sorpresas, sensibilidad y campeones frecuentes.",
  },
  {
    icon: BarChart3,
    name: "Ensemble",
    copy: "Combina señales. Los estudiantes comparan modelos y entienden que toda predicción tiene supuestos.",
  },
];

export function ModelCards() {
  return (
    <section className="model-grid" id="modelos">
      {models.map((model) => {
        const Icon = model.icon;
        return (
          <article className="model-card" key={model.name}>
            <Icon aria-hidden="true" />
            <h3>{model.name}</h3>
            <p>{model.copy}</p>
          </article>
        );
      })}
    </section>
  );
}
