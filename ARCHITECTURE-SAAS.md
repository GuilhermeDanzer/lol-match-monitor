# Arquitetura SaaS — LoL Match Monitor

Pivot multi-tenant: cada usuário conecta **seu próprio WhatsApp** (Baileys) e assina alertas de jogadores rastreados globalmente.

## Stack

| Camada | Tecnologia |
|--------|------------|
| API | Express 5 + TypeScript |
| ORM | Prisma → PostgreSQL |
| Filas | BullMQ → Redis |
| WhatsApp | Baileys (Multi-Device), auth no Postgres |
| Frontend | Next.js 16 + NextAuth (mock) |

## Modelo de dados

```
User ──1:1── SessionWA (sessionData JSONB — creds + Signal keys Baileys)
  │
  └── Subscription ──N:1── TrackedPlayer (puuid único global)
                              │
                              └── ProcessedMatch (dedup por jogador)

MatchCache (matchId único — JSON Match-V5 imutável, compartilhado)
```

- **TrackedPlayer** é global: dois usuários rastreando o mesmo amigo compartilham PUUID, elo snapshot e `MatchCache`.
- **Subscription** define *para qual grupo WA de qual usuário* os alertas daquele jogador vão.

## Filas BullMQ

| Fila | Trigger | Worker |
|------|---------|--------|
| `poll-ranked-matches` | Repeat 15 min + manual | Lista IDs recentes; enfileira `process-match` para partidas novas |
| `process-match` | Poll worker | Busca detalhes (cache PG), calcula PDL, grava `ProcessedMatch`, enfileira `notify` |
| `notify-whatsapp` | Process worker | `SessionManager.sendGroupMessage(userId, groupId, msg)` |

**Rate limit Riot:** fila `process-match` usa `limiter: { max: 90, duration: 120_000 }` + `riotClient` legado com prioridade `low`.

## WhatsApp multi-tenant

```
WhatsAppSessionManager
  Map<userId, WASocket>
  usePostgresAuthState(userId) → SessionWA.sessionData
  EventEmitter: qr | connection
```

- `GET /api/whatsapp/:userId/qr` — SSE (`event: qr`, `event: connected`)
- Auth mock: header `X-User-Id` (frontend envia após NextAuth)

## Frontend (esqueletos)

| Rota | Função |
|------|--------|
| `/login` | NextAuth credentials mock |
| `/dashboard/whatsapp` | Botão conectar + SSE QR |
| `/dashboard/tracking/new` | Form Riot ID + grupo WA → `POST /api/subscriptions` |

## Bootstrap local

```bash
# PostgreSQL + Redis (Docker)
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
docker run -d -p 6379:6379 redis:7

# Backend
cd bot-backend
cp .env.example .env   # DATABASE_URL, REDIS_URL, RIOT_API_KEY
npm run db:push
npm run dev

# Frontend
cd web-frontend
cp .env.example .env.local
npm run dev
```

## Legado

`ENABLE_LEGACY=true` monta rotas single-tenant (whatsapp-web.js + SQLite + node-cron) em paralelo.

## Próximos passos sugeridos

1. JWT real entre NextAuth ↔ backend (substituir `X-User-Id`)
2. Reconectar sockets Baileys no boot a partir de `SessionWA` com status `connected`
3. Migrar `journey_matches` legado → `TrackedPlayer` + histórico por subscription
4. Dashboard web multi-tenant (listar assinaturas, status WA)
5. Worker separado (`npm run worker`) para escalar horizontalmente
