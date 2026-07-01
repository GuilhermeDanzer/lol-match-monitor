"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  TriangleAlert,
} from "lucide-react";
import {
  listSubscriptions,
  resetWhatsAppSession,
  sendTestMessage,
  type SubscriptionListItem,
} from "@/lib/setupApi";
import { useWhatsAppStatus } from "@/lib/useWhatsAppStatus";

interface DiagnosticPanelProps {
  userId: string;
  onAddAnother: () => void;
  onResetSession: () => void;
}

type TestState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; sentAt: string }
  | { kind: "error"; message: string };

/**
 * Painel pós-setup — mostra status ao vivo, lista subscriptions e permite
 * enviar mensagem de teste para validar a entrega no grupo.
 *
 * Substitui o "Tudo pronto!" estático original. O usuário pode confirmar
 * VISUALMENTE no WhatsApp dele que o bot está conectado e é membro do grupo
 * antes de esperar pelo primeiro tick do Cron.
 */
export function DiagnosticPanel({
  userId,
  onAddAnother,
  onResetSession,
}: DiagnosticPanelProps) {
  const { status } = useWhatsAppStatus(userId, 5000, true);
  const connected = Boolean(status?.connected);

  const [subs, setSubs] = useState<SubscriptionListItem[] | null>(null);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleReset() {
    const ok = window.confirm(
      "Isso vai desconectar a sessão atual do WhatsApp. Você precisará escanear o QR de novo. Continuar?",
    );
    if (!ok) return;

    setResetting(true);
    setResetError(null);
    try {
      await resetWhatsAppSession(userId);
      onResetSession(); // volta pro passo 1
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "reset_failed");
    } finally {
      setResetting(false);
    }
  }

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await listSubscriptions(userId, signal);
        setSubs(data);
        setSubsError(null);
      } catch (err) {
        if (signal?.aborted) return;
        setSubsError(err instanceof Error ? err.message : "fetch_failed");
      }
    },
    [userId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function handleTest(sub: SubscriptionListItem) {
    setTestStates((prev) => ({ ...prev, [sub.id]: { kind: "sending" } }));
    try {
      const result = await sendTestMessage({
        userId,
        whatsappGroupId: sub.whatsappGroupId,
      });
      setTestStates((prev) => ({
        ...prev,
        [sub.id]: { kind: "ok", sentAt: result.sentAt },
      }));
    } catch (err) {
      setTestStates((prev) => ({
        ...prev,
        [sub.id]: {
          kind: "error",
          message: err instanceof Error ? err.message : "send_failed",
        },
      }));
    }
  }

  return (
    <div className="w-full max-w-md space-y-4">
      {/* status pill */}
      <div
        className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
          connected
            ? "border-emerald-500/30 bg-emerald-500/10"
            : "border-amber-500/30 bg-amber-500/10"
        }`}
      >
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            connected
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-amber-500/20 text-amber-300"
          }`}
        >
          {connected ? (
            <Activity className="h-4 w-4" />
          ) : (
            <TriangleAlert className="h-4 w-4" />
          )}
        </div>
        <div className="flex-1">
          <p
            className={`text-sm font-semibold ${
              connected ? "text-emerald-200" : "text-amber-200"
            }`}
          >
            {connected ? "Bot ativo" : "Bot desconectado"}
          </p>
          <p
            className={`text-xs ${
              connected ? "text-emerald-300/80" : "text-amber-300/80"
            }`}
          >
            {connected
              ? "Sessão WhatsApp pareada. Worker checa partidas a cada 15 min."
              : "A sessão caiu. Reabra o passo 1 ou reinicie o worker."}
          </p>
        </div>
      </div>

      {/* subscriptions list */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl shadow-black/30 backdrop-blur">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              Monitoramentos ativos
            </h2>
            <p className="text-xs text-zinc-500">
              Envie um teste para confirmar que o bot entrega no grupo.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddAnother}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar
          </button>
        </header>

        {subs === null && !subsError && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        )}

        {subsError && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {subsError}
          </p>
        )}

        {subs && subs.length === 0 && (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-sm text-zinc-500">
            Nenhuma subscription ainda.
          </p>
        )}

        {subs && subs.length > 0 && (
          <ul className="divide-y divide-zinc-800">
            {subs.map((sub) => (
              <SubscriptionRow
                key={sub.id}
                sub={sub}
                connected={connected}
                state={testStates[sub.id] ?? { kind: "idle" }}
                onTest={() => handleTest(sub)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* troubleshooting */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400">
        <p className="mb-2 font-semibold text-zinc-300">
          Bot não responde a comandos no grupo?
        </p>
        <p className="mb-3">
          Se você mandou <code className="rounded bg-zinc-800 px-1">!status</code>{" "}
          no grupo e o bot ficou mudo, a sessão Signal pode ter corrompido
          (comum após múltiplas reconexões). Reconectar zera as chaves e resolve.
        </p>
        <button
          type="button"
          onClick={handleReset}
          disabled={resetting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-40"
        >
          {resetting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {resetting ? "Resetando…" : "Reconectar WhatsApp"}
        </button>
        {resetError && (
          <p className="mt-2 text-red-300">Falha: {resetError}</p>
        )}
      </div>
    </div>
  );
}

interface SubscriptionRowProps {
  sub: SubscriptionListItem;
  connected: boolean;
  state: TestState;
  onTest: () => void;
}

function SubscriptionRow({
  sub,
  connected,
  state,
  onTest,
}: SubscriptionRowProps) {
  const sending = state.kind === "sending";
  const disabled = !connected || sending;

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium text-zinc-100"
            title={sub.riotId}
          >
            {sub.riotId}
          </p>
          <p className="truncate text-xs text-zinc-500" title={sub.whatsappGroupId}>
            → {sub.groupName || sub.whatsappGroupId}
          </p>
        </div>
        <button
          type="button"
          onClick={onTest}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {sending ? "Enviando…" : "Enviar teste"}
        </button>
      </div>

      {state.kind === "ok" && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Mensagem enviada — verifique o grupo.
        </p>
      )}

      {state.kind === "error" && (
        <p className="flex items-center gap-1.5 text-xs text-red-300">
          <TriangleAlert className="h-3.5 w-3.5" />
          Falha: {state.message}
        </p>
      )}
    </li>
  );
}
