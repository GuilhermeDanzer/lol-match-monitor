import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";

/**
 * Agendador global de requisições à Riot API.
 *
 * Todas as chamadas passam por uma fila única que respeita os limites do
 * dev key (padrão: 20 req/s e 100 req/2min) e dá prioridade ao tráfego de
 * primeiro plano (comandos do WhatsApp) sobre o recálculo em background.
 *
 * Ao receber 429, pausa a fila inteira pelo tempo do header `Retry-After`.
 */

export type RiotRequestPriority = "high" | "low";

const PER_SECOND_LIMIT = Number(process.env.RIOT_RATE_PER_SECOND ?? 16);
const PER_WINDOW_LIMIT = Number(process.env.RIOT_RATE_PER_WINDOW ?? 90);
const WINDOW_MS = 120_000;
const MAX_RETRIES = 5;

interface QueueItem {
  priority: RiotRequestPriority;
  attempts: number;
  run: () => Promise<void>;
}

const queue: QueueItem[] = [];
let processing = false;
let pausedUntil = 0;
const recentRequests: number[] = [];

function prune(now: number): void {
  while (recentRequests.length > 0 && now - recentRequests[0] > WINDOW_MS) {
    recentRequests.shift();
  }
}

/** Retorna 0 se pode enviar agora, ou ms a esperar. */
function msUntilCanSend(): number {
  const now = Date.now();
  if (now < pausedUntil) return pausedUntil - now;

  prune(now);

  const inLastSecond = recentRequests.filter((t) => now - t < 1000);
  if (inLastSecond.length >= PER_SECOND_LIMIT) {
    return 1000 - (now - inLastSecond[0]) + 10;
  }

  if (recentRequests.length >= PER_WINDOW_LIMIT) {
    return WINDOW_MS - (now - recentRequests[0]) + 10;
  }

  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dequeue(): QueueItem | undefined {
  const highIndex = queue.findIndex((item) => item.priority === "high");
  if (highIndex >= 0) {
    return queue.splice(highIndex, 1)[0];
  }
  return queue.shift();
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (queue.length > 0) {
      const waitMs = msUntilCanSend();
      if (waitMs > 0) {
        await sleep(waitMs);
        continue;
      }

      const item = dequeue();
      if (!item) break;

      recentRequests.push(Date.now());
      await item.run();
    }
  } finally {
    processing = false;
  }
}

function parseRetryAfterMs(error: AxiosError): number {
  const header = error.response?.headers?.["retry-after"];
  const seconds = Number(Array.isArray(header) ? header[0] : header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  return 5_000;
}

/**
 * Agenda uma requisição axios respeitando o rate limit global.
 * Lança o AxiosError original em erros não-429 (para mapeamento de status).
 */
export function scheduleRiotRequest<T>(
  config: AxiosRequestConfig,
  priority: RiotRequestPriority = "high",
): Promise<AxiosResponse<T>> {
  return new Promise<AxiosResponse<T>>((resolve, reject) => {
    const item: QueueItem = {
      priority,
      attempts: 0,
      run: async () => {
        try {
          const response = await axios.request<T>(config);
          resolve(response);
        } catch (error) {
          if (
            error instanceof AxiosError &&
            error.response?.status === 429 &&
            item.attempts < MAX_RETRIES
          ) {
            item.attempts += 1;
            const retryMs = parseRetryAfterMs(error);
            pausedUntil = Date.now() + retryMs;
            console.warn(
              `[riot] 429 — pausando ${Math.round(retryMs / 1000)}s (tentativa ${item.attempts}/${MAX_RETRIES})`,
            );
            queue.push(item);
            return;
          }
          reject(error);
        }
      },
    };

    queue.push(item);
    void processQueue();
  });
}
