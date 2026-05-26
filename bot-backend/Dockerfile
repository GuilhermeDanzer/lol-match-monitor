# --- Build (devDependencies: typescript, tsc-alias) ---
FROM node:20-alpine AS builder

RUN apk add --no-cache git \
  && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
  && git config --global url."https://github.com/".insteadOf "git@github.com:"

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime (somente dependencias de producao) ---
FROM node:20-alpine

RUN apk add --no-cache git \
  && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
  && git config --global url."https://github.com/".insteadOf "git@github.com:"

WORKDIR /app

ENV NODE_ENV=production
ENV PERSISTENT_DATA_DIR=/app
ENV PORT=4000

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data

EXPOSE 4000

CMD ["npm", "start"]
