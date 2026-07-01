import { Redis } from "ioredis";

/**
 * Conexão Redis compartilhada pelo BullMQ (Queues + Workers).
 *
 * Configurada para Upstash / Redis Cloud / qualquer provider serverless:
 *
 *  - `maxRetriesPerRequest: null` → exigido pelo BullMQ. Sem isso, comandos
 *    bloqueantes (BRPOPLPUSH dos Workers) abortam após N tentativas e o
 *    Worker para de consumir.
 *
 *  - `retryStrategy` → reconexão infinita com backoff exponencial limitado
 *    a 3000ms. Cobre janelas de manutenção/cold-start do provider sem
 *    desistir.
 *
 *  - `family: 0` → DNS dual-stack (IPv4 + IPv6). Evita falha de resolução
 *    no Upstash quando o host só anuncia um dos protocolos.
 *
 * Pelo formato `rediss://` da URL, o ioredis já liga TLS automaticamente.
 *
 * O BullMQ duplica essa instância internamente para cada Worker (necessário
 * para blocking commands), então um único `connection` exportado é o
 * padrão recomendado.
 */

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL ausente — defina no .env do worker.");
}

export const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  family: 0,
  retryStrategy: (attempts) => Math.min(2 ** attempts * 100, 3000),
});

connection.on("error", (err) => {
  console.error("[redis] erro:", err.message);
});
connection.on("connect", () => {
  console.log("[redis] conectado");
});
connection.on("reconnecting", (delayMs: number) => {
  console.warn(`[redis] reconectando em ${delayMs}ms...`);
});
