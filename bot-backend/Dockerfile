FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PERSISTENT_DATA_DIR=/app

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

RUN npm prune --omit=dev && npm cache clean --force

ENV NODE_ENV=production
ENV PORT=4000

RUN mkdir -p /app/data

EXPOSE 4000

CMD ["npm", "start"]
