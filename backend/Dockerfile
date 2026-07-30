# syntax=docker/dockerfile:1
#
# Documento 22 (auditoría y plan) — Fase 2: contenedorización local.
# Node 20 LTS (misma versión mayor usada en desarrollo/CI, ver
# @types/node ^20.14.10 en package.json y actions/setup-node@v4 con
# node-version: '20' en .github/workflows/ci.yml) — Alpine por tamaño de
# imagen, sin dependencias nativas en package.json que lo desaconsejen.

# =============================================================================
# Etapa 1 — build: instala TODAS las dependencias (incluidas devDependencies,
# necesarias para compilar TypeScript) y genera dist/.
# =============================================================================
FROM node:20-alpine AS build

WORKDIR /app

# Copiar solo los manifiestos primero: si no cambian, Docker reutiliza la capa
# de `npm ci` en builds posteriores aunque el código fuente sí cambie.
COPY package.json package-lock.json ./
RUN npm ci

# Solo lo que el compilador necesita — nunca .env/secrets/tests (ver
# .dockerignore, que además actúa como red de seguridad si esta lista
# cambiara a `COPY . .` en el futuro).
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# =============================================================================
# Etapa 2 — runtime: imagen final. Solo dependencias de PRODUCCIÓN + el
# resultado ya compilado (dist/) — sin TypeScript, sin ts-jest, sin eslint,
# sin ningún devDependency, sin el código fuente .ts original.
# =============================================================================
FROM node:20-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

# `npm ci --omit=dev` es determinista (usa package-lock.json) e instala
# únicamente lo listado en "dependencies" de package.json.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Únicamente el JavaScript compilado — nunca el .ts fuente, nunca tests.
COPY --from=build /app/dist ./dist

# Usuario no root — la imagen base `node:20-alpine` ya incluye el usuario
# `node` (uid 1000), no hace falta crearlo a mano.
USER node

EXPOSE 3000

# HEALTHCHECK vía Node puro (sin instalar curl/wget, ausentes en Alpine por
# defecto — agregarlos infla la imagen y requeriría una capa `apk add`
# adicional antes de bajar a usuario no root). Confiable para verificación
# local/docker run; en Cloud Run específicamente este HEALTHCHECK de Docker
# se ignora (esa plataforma usa su propio healthcheck HTTP contra /v1/health
# a nivel de servicio), así que no estorba ni se vuelve redundante ahí.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/v1/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Todas las variables sensibles (DATABASE_URL, JWT_PRIVATE_KEY_PATH/
# JWT_PUBLIC_KEY_PATH apuntando a un volumen/secreto montado en runtime,
# CORS_ALLOWED_ORIGINS, etc.) se inyectan externamente — nunca viven en
# esta imagen. Ninguna URL ni secreto está hardcodeado aquí.
CMD ["node", "dist/main.js"]
