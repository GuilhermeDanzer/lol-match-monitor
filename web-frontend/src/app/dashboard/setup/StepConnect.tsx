"use client";

import { useEffect } from "react";
import { Loader2, QrCode, Smartphone } from "lucide-react";
import { useWhatsAppStatus } from "@/lib/useWhatsAppStatus";

interface StepConnectProps {
  userId: string;
  onConnected: () => void;
}

/**
 * Passo 1 — pareamento WhatsApp.
 *
 * Polling de 3s no backend. Exibe o QR Code em PNG (base64) assim que o
 * Baileys gera. Quando `connected` vira true, dispara `onConnected()` que
 * leva ao passo 2.
 */
export function StepConnect({ userId, onConnected }: StepConnectProps) {
  const { status, error } = useWhatsAppStatus(userId, 3000, true);

  useEffect(() => {
    if (status?.connected) onConnected();
  }, [status?.connected, onConnected]);

  const showSpinner = !status || (!status.connected && !status.qr);

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl shadow-black/30 backdrop-blur">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
          <Smartphone className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">
            Conectar WhatsApp
          </h2>
          <p className="text-sm text-zinc-400">
            Abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho.
          </p>
        </div>
      </header>

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

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
          >
            Falha ao consultar status: {error}
          </p>
        )}
      </div>
    </div>
  );
}
