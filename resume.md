# LoL Match Monitor — Resumo do Projeto

Monorepo para monitorar partidas ranqueadas de League of Legends de **um jogador** configurado via Riot ID, com bot WhatsApp para consultas em tempo real e dashboard web para visualização do histórico.

---

## Visão geral

| Parte | Pasta | Deploy | Função |
|-------|-------|--------|--------|
| **Backend** | `bot-backend/` | Render / Railway (Docker) | API Express, Riot API, WhatsApp, crons, SQLite |
| **Frontend** | `web-frontend/` | Vercel | Dashboard Next.js (somente UI) |

O backend é a fonte da verdade: persiste partidas, calcula PDL, responde comandos no WhatsApp e expõe `GET /api/history` para o site.

---

## Stack técnica

### Backend (`bot-backend`)
- **Runtime:** Node.js **≥ 22** (usa `node:sqlite` nativo)
- **Linguagem:** TypeScript
- **HTTP:** Express 5
- **WhatsApp:** `whatsapp-web.js` + Puppeteer/Chromium
- **Banco:** SQLite (`journey.db`) via `node:sqlite`
- **APIs externas:** Riot Match-V5, League-V4, Spectator-V5, Data Dragon
- **Agendamento:** `node-cron`

### Frontend (`web-frontend`)
- **Framework:** Next.js 16 (App Router)
- **UI:** React 19, Tailwind CSS 4, Recharts, Lucide
- **Dados:** fetch em `NEXT_PUBLIC_API_URL/api/history` (sem backend próprio)

### Infra
- CI: GitHub Actions (build backend + frontend)
- Scripts de deploy: `deploy.bat`, `deploy.ps1`, `deploy.sh`
- Docker multi-stage com Chromium (`bot-backend/Dockerfile`)

---

## Arquitetura de dados

```
Riot API ──► riotClient (fila global + rate limit)
                │
                ├──► getMatchDetails ──► match_detail_cache (SQLite)
                │                              │
                └──► monitor / comandos ◄────────┘
                         │
                         ▼
                  journey_matches (SQLite)
                         │
                         ▼
              GET /api/history ──► Dashboard Vercel

Estado auxiliar: lastMatch.json (última partida processada, elo, cache season)
Sessão WhatsApp: .wwebjs_auth / .wwebjs_cache (disco persistente)
```

### Tabelas SQLite (`journey.db`)

| Tabela | Conteúdo |
|--------|----------|
| `journey_matches` | Partidas monitoradas (KDA, dano, time, elo, PDL, notified) |
| `match_detail_cache` | JSON bruto do Match-V5 por `match_id` (imutável após fim da partida) |

### Arquivos JSON (`data/`)

| Arquivo | Conteúdo |
|---------|----------|
| `lastMatch.json` | `lastMatchId`, snapshot de elo, stats da temporada (`seasonSolo`), IDs já processados |
| `journey.json.bak` | Backup após migração one-time para SQLite |

---

## O que já existe (implementado)

### 1. Monitoramento automático (crons)

| Cron | Intervalo | Comportamento |
|------|-----------|---------------|
| `syncRankedMatches` | 15 min | Detecta partidas ranqueadas novas, calcula PDL, grava no SQLite **sem** enviar WhatsApp |
| `sendJourneyReport` | 6 h | Envia resumo das partidas com `notified=false` e marca como notificadas |

No bootstrap também rodam (em background):
- Seed de ~30 partidas se o banco estiver vazio
- Backfill de partidas antigas sem dano/duração/time
- Recálculo de W/L da temporada (excluindo remakes)

### 2. Comandos WhatsApp

Prefixo configurável (`WHATSAPP_COMMAND_PREFIX`, padrão `!`). Só respondem no grupo configurado (`WHATSAPP_GROUP_ID`) ou em qualquer grupo se não configurado.

| Comando | Aliases | O que faz |
|---------|---------|-----------|
| `!status` | `!lol` | Última partida (pula remakes), elo, PDL, win rate **da temporada inteira**, dano do time, partidas nas últimas 6h |
| `!live` | `!partida`, `!ingame` | Verifica partida ativa via Spectator-V5 (campeões, fila, tempo) |
| `!dano` | — | Breakdown de dano do time na última partida |
| `!historico` | `!history` | Últimas 5 partidas com KDA e dano do time (pula remakes) |
| `!jornada` | — | Stats do histórico **monitorado** (desde que o bot passou a registrar) |
| `!site` | — | Link do dashboard web |
| `!ajuda` | `!help` | Lista de comandos |

### 3. Integração Riot API

- Resolução de PUUID por Riot ID (`RIOT_GAME_NAME` + `RIOT_TAG_LINE`)
- Match-V5: histórico, detalhes, contagem recente
- League-V4: elo atual, W/L bruto da API
- Spectator-V5: partida ao vivo
- Data Dragon: nomes de campeões por ID
- **Detecção de remakes** (KDA 0/0/0 + duração curta) — alinhado ao cliente LoL / OP.GG
- **Rate limit global** (`riotClient.ts`): fila única, prioridade alta para comandos, baixa para rebuild da season, retry com `Retry-After` em 429
- **Cache de detalhes** (`matchCache.ts`): partida nova → API + grava; partida conhecida → SQLite

### 4. Stats da temporada (`seasonStats.ts`)

- Recalcula W/L Solo/Duo desde `RIOT_RANKED_SEASON_START` (padrão: 2026-01-08)
- Exclui remakes (diferente do League-V4, que conta remake como derrota)
- Cache em `lastMatch.json` com TTL de 6 h
- Rebuild em background para não bloquear `!status`
- Incremento automático quando o monitor processa partida nova

### 5. Dashboard web (`web-frontend`)

- Cards: elo atual, win streak, win rate
- Gráfico de PDL ao longo do tempo (`TierGraph` / Recharts)
- Lista das últimas 50 partidas monitoradas com KDA, barra de dano, composição do time
- Tema visual por tier (Iron → Challenger)
- Reconstrução retroativa de elo no gráfico quando partidas antigas não tinham tier salvo

### 6. API HTTP (backend)

| Rota | Uso |
|------|-----|
| `GET /health` | Healthcheck |
| `GET /api/history` | Payload completo para o dashboard |
| `GET /api/qr` | Página HTML para escanear WhatsApp |
| `GET /api/qr/data` | QR em JSON (auto-refresh) |
| `GET /api/whatsapp/status` | Debug da sessão WA |
| `POST /api/whatsapp/reset` | Limpa sessão corrompida (opcional `?key=` + `WHATSAPP_RESET_KEY`) |

CORS aceita `CORS_ORIGIN` configurado + qualquer `*.vercel.app` + localhost.

### 7. Persistência e migração

- Migração automática de `journey.json` → SQLite na primeira execução
- Volume persistente recomendado em produção (`PERSISTENT_DATA_DIR`)
- Script manual: `npm run backfill` (enriquecimento de journey)

### 8. Deploy documentado

- `README.md`, `DEPLOY.md`, `bot-backend/.env.example`
- Render (Docker) ou Railway (volume `/data`)
- Vercel com Root Directory = `web-frontend`

---

## Fluxos principais

### Nova partida ranqueada
1. Cron (15 min) busca IDs recentes na Riot
2. Compara com `lastMatchId` em `lastMatch.json`
3. Para cada partida nova: busca detalhes (cache ou API), espera delay de PDL, lê elo atual, calcula `lpChange`, grava em `journey_matches`
4. Atualiza cache da temporada (`applySeasonMatchResult`)
5. Marca `notified=false` → entra no relatório de 6 h

### `!status`
1. Busca última partida não-remake (Match-V5 + cache)
2. Elo atual (League-V4)
3. Contagem 6h (Riot, fallback SQLite se falhar)
4. Win rate temporada (cache `seasonSolo` ou fallback League-V4; dispara rebuild em background se stale)
5. Monta mensagem formatada

---

## Variáveis de ambiente importantes

### Backend (`bot-backend/.env`)

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `RIOT_API_KEY` | Sim | Chave dev/prod Riot |
| `RIOT_GAME_NAME` / `RIOT_TAG_LINE` | Sim | Jogador monitorado |
| `WHATSAPP_GROUP_ID` | Recomendada | ID do grupo (senão aceita qualquer grupo) |
| `PERSISTENT_DATA_DIR` | Prod | `/app` (Render) ou `/data` (Railway) |
| `CORS_ORIGIN` | Sim | URL(s) do frontend |
| `FRONTEND_URL` | Recomendada | URL do site (`!site`) |
| `RIOT_RANKED_SEASON_START` | Opcional | Início da season para W/L |
| `RIOT_RATE_PER_SECOND` / `RIOT_RATE_PER_WINDOW` | Opcional | Tune do rate limiter |

### Frontend (`web-frontend/.env.local`)

| Variável | Descrição |
|----------|-----------|
| `NEXT_PUBLIC_API_URL` | URL do backend (ex: `http://localhost:4000`) |

---

## O que está faltando / gaps atuais

### Funcionalidades ausentes

| Item | Detalhe |
|------|---------|
| **Alerta instantâneo no WhatsApp** | Existe `formatWhatsAppMessage()` mas **não é usado**. Hoje só há relatório a cada 6 h; não há push imediato ao terminar uma partida |
| **Multi-jogador** | Um único Riot ID por instância; sem suporte a vários amigos/contas |
| **Partida ao vivo no site** | `!live` existe no WhatsApp; dashboard não mostra status ingame |
| **Win rate da temporada no site** | Dashboard usa win rate da **jornada monitorada** (`summarizeJourneyMatches`), não o W/L da season inteira como o `!status` |
| **Autenticação na API** | `/api/history` é público; qualquer um com a URL do backend lê o histórico |
| **Notificações push web** | Sem PWA, WebSocket ou polling para atualizar o dashboard em tempo real |

### Limitações técnicas

| Item | Detalhe |
|------|---------|
| **Rebuild da season ainda lista IDs na Riot** | Detalhes vêm do cache SQLite, mas a listagem de até 1000 match IDs ainda bate na API a cada 6 h |
| **Cap de 1000 partidas na season** | Paginação para em 1000 IDs; jogadores com mais partidas na season ficam incompletos |
| **`lastMatch.json` separado do SQLite** | Estado de elo/season ainda em JSON; journey já migrou para SQLite |
| **`!site` com URL hardcoded** | Código usa URL fixa da Vercel em vez de `process.env.FRONTEND_URL` |
| **CI com Node 20** | Workflow `.github/workflows/ci.yml` usa Node 20; backend exige **Node ≥ 22** — build local pode passar e CI falhar (ou vice-versa) |
| **Sem testes automatizados** | Nenhum teste unitário ou de integração; só `npm run build` no CI |
| **WhatsApp frágil** | `whatsapp-web.js` depende de Chromium + sessão local; desconexões e bloqueios do Meta são comuns |
| **Render free tier** | Serviço dorme → cold start lento; disco efêmero sem volume → perda de `journey.db` e sessão WA |
| **Primeiro rebuild da season** | Mesmo com cache, a primeira execução (ou após perda de disco) pode levar vários minutos e consumir muita cota da API |
| **Dev key Riot** | Rate limit baixo (≈20/s, 100/2min); rebuild + comandos simultâneos ainda podem gerar 429 em picos |

### Dívida técnica / melhorias desejáveis

- Unificar persistência (`lastMatch.json` → SQLite ou uma tabela `app_state`)
- Usar `FRONTEND_URL` no comando `!site`
- Atualizar CI para Node 22
- Opcional: alerta WhatsApp imediato no `syncRankedMatches` (reutilizar `formatWhatsAppMessage`)
- Opcional: expor win rate da season no `/api/history` para o dashboard
- Opcional: cachear lista de match IDs da season no SQLite para evitar re-fetch completo
- Opcional: testes para remake detection, LP calculator, season stats
- Documentar `RIOT_RATE_*` no `.env.example`

---

## Estrutura de pastas (referência)

```
lol-match-monitor/
├── bot-backend/
│   ├── src/
│   │   ├── index.ts              # Express, crons, bootstrap
│   │   ├── services/
│   │   │   ├── riot.ts           # Riot API
│   │   │   ├── monitor.ts        # Sync + relatório periódico
│   │   │   ├── whatsapp.ts       # Cliente WA
│   │   │   └── whatsappCommands.ts
│   │   └── lib/
│   │       ├── db.ts             # Schema SQLite
│   │       ├── journeyStore.ts   # CRUD journey_matches
│   │       ├── matchCache.ts     # Cache Match-V5
│   │       ├── matchStore.ts     # lastMatch.json
│   │       ├── seasonStats.ts    # W/L temporada
│   │       ├── riotClient.ts     # Rate limit global
│   │       ├── formatMatch.ts    # Formatação WhatsApp
│   │       ├── historyStats.ts   # GET /api/history
│   │       ├── lpCalculator.ts   # PDL / tiers
│   │       └── ...
│   └── data/                     # Local dev (gitignored)
├── web-frontend/
│   └── src/
│       ├── app/page.tsx
│       └── components/           # Dashboard, TierGraph, etc.
├── README.md
├── DEPLOY.md
└── resume.md                     # Este arquivo
```

---

## Comandos úteis

```bash
# Raiz — instalar tudo
npm install

# Desenvolvimento
npm run dev:bot    # backend :4000
npm run dev:web    # frontend :3000

# Build
npm run build

# Backfill manual (backend)
cd bot-backend && npm run backfill
```

---

## Status resumido

| Área | Status |
|------|--------|
| Bot WhatsApp + comandos | ✅ Funcional |
| Monitor 15 min + SQLite | ✅ Funcional |
| Dashboard web | ✅ Funcional (dados da jornada monitorada) |
| Win rate season no `!status` | ✅ (com cache + rebuild background) |
| Cache de partidas antigas | ✅ (`match_detail_cache`) |
| Rate limit coordenado | ✅ (`riotClient`) |
| Alerta imediato pós-partida | ❌ Não implementado |
| Season stats no dashboard | ❌ Não implementado |
| Testes / CI alinhado Node 22 | ❌ Pendente |
| Multi-jogador | ❌ Fora de escopo atual |

---

*Última atualização: junho/2026 — reflete o estado do repositório após migração SQLite, cache Match-V5, comandos `!live`/`!dano`, season stats e rate limiter global.*
