# LoL Match Monitor

Monorepo com frontend (Next.js → **Vercel**) e backend (Express + WhatsApp + Cron → **Railway**).

## Estrutura

```
lol-match-monitor/
├── bot-backend/     # API Express, Riot, WhatsApp, crons, SQLite (journey.db)
└── web-frontend/    # Next.js (UI apenas)
```

## Variáveis de ambiente (importante)

| Arquivo | O que contém |
|---------|----------------|
| **`bot-backend/.env`** | `RIOT_API_KEY`, `RIOT_GAME_NAME`, `WHATSAPP_GROUP_ID`, `PORT=4000`, `CORS_ORIGIN` |
| **`web-frontend/.env.local`** | **Somente** `NEXT_PUBLIC_API_URL=http://localhost:4000` |

Não use mais `.env.local` na **raiz** do repositório — ele foi removido de propósito.

## Desenvolvimento local

### 1. Backend (`bot-backend`)

```bash
cd bot-backend
cp .env.example .env   # ou edite o .env já existente
npm install
npm run dev
```

API: `http://localhost:4000/api/history`

### 2. Frontend (`web-frontend`)

```bash
cd web-frontend
cp .env.example .env.local
npm install
npm run dev
```

UI: `http://localhost:3000`

### Atalhos na raiz

```bash
npm install
npm run dev:bot   # terminal 1
npm run dev:web   # terminal 2
```

## Deploy

| Parte | Plataforma | Pasta |
|-------|------------|-------|
| Frontend | Vercel | `web-frontend` |
| Backend | Railway | `bot-backend` |

- **Vercel:** Root Directory = `web-frontend`, env `NEXT_PUBLIC_API_URL` = URL do Railway.
- **Railway:** Root Directory = `bot-backend`, volume em `/data`, `PERSISTENT_DATA_DIR=/data`, `CORS_ORIGIN` = URL da Vercel.

Veja `DEPLOY.md` e `bot-backend/.env.example` para detalhes.
