# Deploy — LoL Match Monitor (monorepo)

| App | Pasta | Plataforma |
|-----|-------|------------|
| Frontend | `web-frontend/` | **Vercel** |
| Backend | `bot-backend/` | **Render** (ou Railway) |

## Deploy rápido (local)

O script commita e faz `git push origin main`, acionando Vercel e Railway.

**Requisito:** a pasta precisa ser um repositório Git (existir `.git`) com `origin` apontando para o GitHub. Se ainda não inicializou:

```bat
git init
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git add .
git commit -m "Primeiro commit"
git branch -M main
git push -u origin main
```

Depois disso, use o deploy:

**Windows (CMD ou PowerShell)** — na raiz do repositório:

```bat
deploy.bat
```

ou:

```powershell
.\deploy.ps1
```

**Mac / Linux / Git Bash:**

```bash
chmod +x deploy.sh   # uma vez
./deploy.sh
```

## CI (GitHub Actions)

Em cada push/PR para `main`, o workflow `.github/workflows/ci.yml` valida `npm run build` em `bot-backend` e `web-frontend` antes do deploy.

---


## Backend (Render)

1. Repositório GitHub conectado ao Render.
2. **Root Directory:** `bot-backend`
3. **Runtime:** Docker (usa `bot-backend/Dockerfile`)
4. **URL:** ex. `https://lol-match-monitor.onrender.com`
5. Variáveis no dashboard Render (ver `bot-backend/.env.example`):
   - `RIOT_API_KEY`, `RIOT_GAME_NAME`, `RIOT_TAG_LINE`, `WHATSAPP_GROUP_ID`
   - `CORS_ORIGIN=https://seu-app.vercel.app`
   - `PERSISTENT_DATA_DIR=/app` (recomendado; `/app/data` também funciona)
   - `PORT` — o Render injeta automaticamente

Healthcheck: `GET /health`  
API: `GET /api/history`

## Backend (Railway) — alternativa

1. **Root Directory:** `bot-backend`
2. **Build:** `npm run build` | **Start:** `npm start`
3. Volume: mount `/data` → `PERSISTENT_DATA_DIR=/data`

---

## Frontend (Vercel)

1. Importe o repositório na Vercel.
2. **Root Directory:** `web-frontend`
3. Framework: Next.js (detecção automática)
4. Variável de ambiente:
   - `NEXT_PUBLIC_API_URL` = URL pública do backend (ex: `https://lol-match-monitor.onrender.com`)

---

## Desenvolvimento local

```bash
# Terminal 1
cd bot-backend && cp .env.example .env && npm install && npm run dev

# Terminal 2
cd web-frontend && cp .env.example .env.local && npm install && npm run dev
```

**`bot-backend/.env`** — Riot, WhatsApp, porta, CORS  
**`web-frontend/.env.local`** — apenas `NEXT_PUBLIC_API_URL`

Exemplo local:

```env
# bot-backend/.env
RIOT_API_KEY=...
CORS_ORIGIN=http://localhost:3000
PORT=4000

# web-frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## Docker (backend)

```bash
cd bot-backend
docker build -t lol-bot .
docker run -p 4000:4000 --env-file .env -v lol-data:/app/data lol-bot
```
