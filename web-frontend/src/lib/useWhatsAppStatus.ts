"use client";

import { useEffect, useRef, useState } from "react";
import { fetchWhatsAppStatus, type WhatsAppStatus } from "@/lib/setupApi";

interface UseWhatsAppStatusState {
  status: WhatsAppStatus | null;
  error: string | null;
}

/**
 * Polling em GET /api/whatsapp/:userId/status a cada `intervalMs`.
 *
 * - Para automaticamente quando o backend devolve `connected: true`.
 * - Cancela limpo no unmount via AbortController (suporta StrictMode em dev).
 * - Se `userId` estiver vazio, fica idle (útil enquanto a sessão NextAuth carrega).
 */
export function useWhatsAppStatus(
  userId: string | undefined,
  intervalMs = 3000,
  enabled = true,
): UseWhatsAppStatusState {
  const [state, setState] = useState<UseWhatsAppStatusState>({
    status: null,
    error: null,
  });
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled || !userId) return;

    cancelledRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const tick = async () => {
      try {
        const data = await fetchWhatsAppStatus(userId, controller.signal);
        if (cancelledRef.current) return;
        setState({ status: data, error: null });
        if (!data.connected) {
          timer = setTimeout(tick, intervalMs);
        }
      } catch (err) {
        if (cancelledRef.current || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "fetch_failed";
        setState((prev) => ({ ...prev, error: message }));
        timer = setTimeout(tick, intervalMs);
      }
    };

    void tick();

    return () => {
      cancelledRef.current = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [userId, intervalMs, enabled]);

  return state;
}
