FROM node:20-alpine

WORKDIR /app

ENV PERSISTENT_DATA_DIR=/app
ENV NODE_ENV=production
ENV PORT=4000

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev && npm cache clean --force

RUN mkdir -p /app/data

EXPOSE 4000

CMD ["npm", "start"]
