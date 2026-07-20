> Infra note (2026-07-09): Hostinger API reports srv1309116 (72.60.113.121) as suspended. References to kharkiv.polisplexity.tech, twin.polisplexity.tech, ldt.polisplexity.tech, twin.hadox.org, or old Polisplexity app demo routes are historical. Use https://lab.polisplexity.tech/ as the current Polisplexity demo/lab domain. aracnia.icu/OEPPEH had no confirmed replacement domain in the current local inventory.

# Deploy VPS con Postgres

Este despliegue corre todo el stack en la VPS: frontend, API, worker de modelos, Redis, Postgres y Caddy para TLS. Los modelos pesados ya no dependen de GitHub Pages ni de una maquina local prendida.

## Arquitectura

- `caddy`: publica `mundial.hadox.org` y `api-mundial.hadox.org`.
- `frontend`: build estatico de React servido por Nginx.
- `backend`: FastAPI con los endpoints publicos y administrativos.
- `worker`: RQ para corridas Monte Carlo y trabajos largos.
- `postgres`: base persistente fuerte para usuarios, predicciones, resultados fijos, eventos vivos y auditoria.
- `redis`: cola de trabajos y estado temporal.

SQLite queda como fallback local si alguien ejecuta el backend sin `DATABASE_URL`, pero Docker usa Postgres.

## VPS objetivo

Usar la VPS grande:

- Host: `srv1309116.hstgr.cloud`
- Perfil: 4 CPU, 16 GB RAM, 200 GB
- Sistema esperado: Ubuntu con Docker

## Variables

Crear un `.env.prod` en la VPS a partir de `.env.example`:

```bash
cp .env.example .env.prod
```

Valores minimos a revisar:

```bash
FRONTEND_DOMAIN=mundial.hadox.org
API_DOMAIN=api-mundial.hadox.org
VITE_API_URL=https://api-mundial.hadox.org
CORS_ORIGINS=https://mundial.hadox.org
PUBLIC_FRONTEND_URL=https://mundial.hadox.org
POSTGRES_DB=mundial_lab
POSTGRES_USER=mundial
POSTGRES_PASSWORD=poner_un_password_largo
API_WORKERS=2
ADMIN_TOKEN=poner_una_llave_larga_para_operadores
```

Antes de levantar Caddy, apuntar los DNS `A` de ambos dominios a la IP de la VPS. Caddy genera certificados automaticamente.

## Levantar

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Ver salud:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f backend worker
curl https://api-mundial.hadox.org/health
```

## Desarrollo local con Postgres

El compose local tambien trae Postgres:

```bash
docker compose up --build
```

Servicios:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Postgres interno: `postgres:5432`
- Postgres desde host: `localhost:5433`
- Redis: `localhost:6379`

## Datos persistentes

Volumenes importantes:

- `postgres_data`: base fuerte del producto.
- `redis_data`: cola persistente en produccion.
- `backend_results`: archivos de resultados de corridas pesadas.
- `caddy_data`: certificados TLS.

No borrar esos volumenes en produccion salvo migracion planeada.

## Operacion

Para recalcular la linea de Monte Carlo de la casa, usar el admin web o encolar desde la API. El worker corre la simulacion sin bloquear el frontend. Cuando haya resultados fijos nuevos, primero se capturan en admin, despues se relanza la corrida de la casa para que la pagina publica `/montecarlo-casa/` muestre la linea actual.
