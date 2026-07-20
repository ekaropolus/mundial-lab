const currentYear = new Date().getFullYear();

const footerLinks = [
  { href: "/partidos/", label: "Partidos" },
  { href: "/simulador-partido/", label: "Replay 3D" },
  { href: "/montecarlo-casa/", label: "Monte Carlo" },
  { href: "/laboratorio-datos/", label: "Datos" },
  { href: "/directores/", label: "Directores" },
  { href: "/modelos/ensemble/", label: "Modelos" },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-main">
          <section className="footer-project" aria-label="Mundial Lab">
            <p>Mundial Lab</p>
            <span>
              Laboratorio educativo de datos, modelos probabilisticos y lectura en vivo para la
              Copa del Mundo.
            </span>
          </section>

          <section className="footer-partners" aria-label="Socios del proyecto">
            <a href="https://hadox.org" aria-label="Hadox Research Labs">
              <img src="/assets/hadox-research-labs-logo-white.png" alt="Hadox Research Labs" />
            </a>
            <a href="https://polisplexity.tech" aria-label="Polisplexity City Science">
              <img src="/assets/polisplexity-brand.png" alt="Polisplexity City Science" />
            </a>
          </section>
        </div>

        <div className="footer-meta">
          <nav className="footer-nav" aria-label="Navegacion secundaria">
            {footerLinks.map((link) => (
              <a href={link.href} key={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <p>
            (c) {currentYear} Mundial Lab. Datos abiertos o publicos, simulacion bajo demanda y
            resultados versionables.
          </p>
        </div>
      </div>
    </footer>
  );
}
