"use client";

import { useSession } from "next-auth/react";
import { CheckCircle2, Loader2, QrCode, Smartphone } from "lucide-react";
import { useWhatsAppStatus } from "@/lib/useWhatsAppStatus";

/**
 * Página auth-protegida de status do WhatsApp do usuário.
 *
 * Difere do wizard `/dashboard/setup` (que usa userId mockado) por puxar o
 * `userId` real da sessão NextAuth. Estratégia idêntica ao wizard:
 *   GET /api/whatsapp/:userId/status  (polling 3s)
 *   - connected: false → mostra QR
 *   - connected: true  → mostra confirmação
 */
export default function WhatsAppDashboardPage() {
  const { data: session, status: authStatus } = useSession();
  const userId = session?.user?.id;

  const { status, error } = useWhatsAppStatus(userId, 3000, Boolean(userId));

  if (authStatus === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-400">Sessão não disponível.</p>
      </main>
    );
  }

  const showSpinner = !status || (!status.connected && !status.qr);

  return (
    <main className="flex min-h-screen flex-col items-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 px-4 py-12">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-zinc-100">WhatsApp</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Usuário: <span className="font-mono">{session?.user?.email}</span>
        </p>
      </div>

      <section className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl shadow-black/30 backdrop-blur">
        <header className="mb-6 flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${
              status?.connected
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-zinc-800 text-zinc-400"
            }`}
          >
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              {status?.connected ? "Conectado" : "Pareamento"}
            </h2>
            <p className="text-sm text-zinc-400">
              {status?.connected
                ? "Os alertas sairão pelo seu número."
                : "Abra WhatsApp > Aparelhos conectados > Conectar aparelho."}
            </p>
          </div>
        </header>

        {status?.connected ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-6 text-emerald-300">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">Sessão ativa</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {showSpinner ? (
              <div className="flex h-72 w-72 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-950/40">
                <QrCode className="h-10 w-10 text-zinc-600" />
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                <p className="text-xs text-zinc-500">Gerando QR Code…</p>
              </div>
            ) : (
              status?.qr && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={status.qr}
                    alt="QR Code WhatsApp"
                    className="h-72 w-72 rounded-xl border border-zinc-700 bg-white p-2"
                  />
                  <div className="flex items-center gap-2 text-sm text-zinc-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Aguardando leitura…</span>
                  </div>
                </>
              )
            )}
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
          >
            Falha ao consultar status: {error}
          </p>
        )}
      </section>

      <nav className="mt-6 text-sm">
        <a
          href="/dashboard/tracking/new"
          className="text-indigo-400 hover:text-indigo-300 hover:underline"
        >
          Rastrear novo jogador →
        </a>
      </nav>
    </main>
  );
}
