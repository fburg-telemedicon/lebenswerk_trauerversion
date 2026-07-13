# syntax=docker/dockerfile:1
# ============================================================================
# Lebenswerk – Container-Image für Azure Container Apps.
# Multi-Stage: 1) SPA bauen (vite)  2) schlankes Runtime-Image (Server + API).
# sharp (Bildkomposition) läuft mit prebuilt libvips auf bookworm-slim.
# ============================================================================

# ---- Build-Stage: SPA ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Öffentliche Asset-Basis (Blob) wird beim Vite-Build in die SPA gebacken
# (Intro-Video). Leer lassen ⇒ relative Pfade.
ARG VITE_PUBLIC_ASSET_BASE=""
ENV VITE_PUBLIC_ASSET_BASE=$VITE_PUBLIC_ASSET_BASE
RUN npm run build

# ---- Runtime-Stage ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Nur Produktionsabhängigkeiten installieren.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Anwendungscode + gebautes SPA übernehmen.
COPY api ./api
COPY scripts ./scripts
COPY server.js ./server.js
# changelog.json wird vom Tagesreport gelesen (api/_lib/changelog.js) → muss
# ins Laufzeit-Image, sonst bleibt der Abschnitt „Gestern umgesetzt" leer.
COPY changelog.json ./changelog.json
COPY --from=build /app/dist ./dist

EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
