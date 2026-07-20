# Mundial Lab

> [!IMPORTANT]
> Este repositorio es publicamente visible, pero **no es open source**. El codigo propio se distribuye bajo una licencia propietaria; consulta [LICENSE](LICENSE) y [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Simulador educativo de Copa del Mundo 2026 para mostrar datos abiertos, modelos probabilisticos y simulaciones Monte Carlo.

El proyecto esta pensado como showcase:

- Frontend ligero hecho por Polisplexity.
- Backend, datos y computo pesado hechos por Hadox.
- Todo corre con Docker.
- Jobs largos via cola Redis/RQ.
- Resultados listos para dashboard web y reportes por correo.

## Stack

- Frontend: React + TypeScript + Vite + Three.js
- Backend: FastAPI + Python
- Cola: Redis + RQ
- Persistencia: PostgreSQL en Docker, con SQLite solo como fallback local sin `DATABASE_URL`
- Integracion continua: GitHub Actions (sin despliegue automatico)

## Fixture base

El proyecto ya trae el calendario completo de la Copa del Mundo 2026 como semilla versionada:

- 104 partidos en `data/matches_seed.json`.
- 104 paginas estaticas de sala en vivo bajo `apps/frontend/partidos/<slug>/`.
- Campos de fixture: numero de partido, fase, kickoff UTC, horario local, sede y ciudad.
- El backend hace upsert de la semilla sin borrar marcador, minuto ni estado vivo de partidos ya capturados.

## Arranque local

```bash
docker compose up --build
```

Servicios:

- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- API docs: http://localhost:8000/docs
- Postgres: localhost:5433
- Redis: localhost:6379

## Publicacion recomendada

La documentacion existente separa marcas y responsabilidades:

- **Polisplexity**: capa publica, experimentos de producto, simulacion, city intelligence y visualizacion.
- **Hadox**: infraestructura cientifica, backends, datos, computo pesado y deployment interno con Drone cuando aplique.

Por eso la ruta recomendada es:

- Frontend publico: `https://mundial.hadox.org`
- Backend/API: `https://api-mundial.hadox.org`
- Fallback tecnico: GitHub Pages en el repo publico, usando el subdominio anterior como dominio canonico.

El despliegue recomendado para la VPS esta documentado en `docs/deploy-vps-postgres.md`. El frontend incluye `apps/frontend/public/CNAME` para GitHub Pages con `mundial.hadox.org`, pero la ruta principal ahora es servir frontend y API desde la VPS con Caddy.

## Comandos utiles

```bash
docker compose run --rm backend pytest
docker compose run --rm frontend npm run build
```

## Roadmap corto

El flujo de producto, fases de construccion e instrucciones operativas estan en
`docs/plan-maestro-flujo.md`.

1. Conectar snapshots reales de fuentes abiertas.
2. Agregar entrenamiento Elo historico.
3. Implementar Dixon-Coles calibrado.
4. Agregar envio real de correo con Resend/SES/SendGrid.
5. Publicar frontend, API, worker, Redis y Postgres en la VPS.
