import Link from "next/link";
import { ArrowRight, Bell, MessageSquare, Swords } from "lucide-react";

/**
 * Landing — direciona o visitante pro onboarding do SaaS.
 *
 * O Dashboard legado de histórico (`components/Dashboard.tsx`) ainda existe
 * no repo mas dependia do endpoint single-tenant `/api/history` que foi
 * removido na migração para o Worker multi-tenant. Não há reposição imediata
 * — o foco do MVP é o fluxo de alertas via wizard.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 px-4 text-white">
      <div className="w-full max-w-2xl text-center">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="text-4xl">⚔️</span>
          <h1 className="text-3xl font-bold tracking-tight">
            LoL Match Monitor
          </h1>
        </div>

        <p className="mx-auto mb-10 max-w-xl text-zinc-400">
          Receba alertas no WhatsApp toda vez que um amigo termina uma partida
          ranqueada. Configure em menos de 2 minutos.
        </p>

        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Feature
            icon={<MessageSquare className="h-5 w-5" />}
            title="WhatsApp nativo"
            desc="Sem app extra. Pareia QR Code do seu próprio número."
          />
          <Feature
            icon={<Swords className="h-5 w-5" />}
            title="Match-V5 oficial"
            desc="PDL, KDA, dano e história — direto da Riot."
          />
          <Feature
            icon={<Bell className="h-5 w-5" />}
            title="Tempo real"
            desc="Worker BullMQ checa a cada 15 minutos."
          />
        </div>

        <Link
          href="/dashboard/setup"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700"
        >
          Configurar agora
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </main>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-left">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-300">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      <p className="mt-1 text-xs text-zinc-400">{desc}</p>
    </div>
  );
}
