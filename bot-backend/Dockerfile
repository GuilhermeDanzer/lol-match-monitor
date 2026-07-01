# =============================================================================
# LoL Match Monitor — Worker SaaS (Baileys + Prisma + BullMQ)
# Build context: bot-backend/ (Render Root Directory)
# =============================================================================

# --- Build (TypeScript + Prisma Client) ---
FROM node:22-bookworm-slim AS builder

# Baileys depende de libsignal via git — slim não traz git por padrão.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssl \
  && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
  && git config --global url."https://github.com/".insteadOf "git@github.com:" \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci

COPY . .
RUN npm run build

# --- Runtime (sem Chromium — Baileys não usa Puppeteer) ---
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssl \
  && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
  && git config --global url."https://github.com/".insteadOf "git@github.com:" \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV WORKER_HTTP_PORT=4000

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci --omit=dev \
  && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 4000

CMD ["npm", "start"]
