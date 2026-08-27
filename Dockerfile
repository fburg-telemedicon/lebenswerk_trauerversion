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

# ffmpeg/ffprobe: nur für das Hörbuch im M4B-Format (api/_lib/m4b.js) — MP3 nach
# AAC wandeln und mit Kapitelmarken in einen MP4-Behälter legen. Alles andere am
# Ton kommt ohne aus (Azure liefert reine MPEG-Frames, die sich binär aneinander-
# hängen lassen). Fehlt das Paket, entfällt nur die M4B-Schaltfläche.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Nur Produktionsabhängigkeiten installieren.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Anwendungscode + gebautes SPA übernehmen.
COPY api ./api
# Website auf „/" (server.js liefert sie aus, wenn keine App-Parameter anliegen).
COPY public-site ./public-site
COPY scripts ./scripts
COPY server.js ./server.js
# changelog.json wird vom Tagesreport gelesen (api/_lib/changelog.js) → muss
# ins Laufzeit-Image, sonst bleibt der Abschnitt „Gestern umgesetzt" leer.
COPY changelog.json ./changelog.json
COPY --from=build /app/dist ./dist

EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
