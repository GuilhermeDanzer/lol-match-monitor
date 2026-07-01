"use client";

import { useSession } from "next-auth/react";
import { type FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Users } from "lucide-react";
import {
  createSubscription,
  fetchWhatsAppGroups,
  type WhatsAppGroup,
} from "@/lib/setupApi";

/**
 * Novo rastreamento (auth-protegido via NextAuth).
 *
 * Espelha o `StepConfigure` do wizard, mas puxa o `userId` da sessão real
 * em vez de mock. Contrato com o backend:
 *   POST /api/subscriptions { userId, riotId, whatsappGroupId }
 */
export default function NewTrackingPage() {
  const { data: session, status: authStatus } = useSession();
  const userId = session?.user?.id;

  const [groups, setGroups] = useState<WhatsAppGroup[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  const [riotId, setRiotId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    const controller = new AbortController();
    let cancelled = false;

    fetchWhatsAppGroups(userId, controller.signal)
      .then((data) => {
        if (cancelled) return;
        setGroups(data);
        setGroupsError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setGroupsError(err instanceof Error ? err.message : "fetch_failed");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [userId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || !userId) return;

    setSubmitting(true);
    setSubmitError(null);
    setSuccess(null);

    try {
      const created = await createSubscription({
        userId,
        riotId: riotId.trim(),
        whatsappGroupId: groupId.trim(),
      });
      setSuccess(
        `Monitorando ${created.trackedPlayer.riotId} — alertas no grupo selecionado.`,
      );
      setRiotId("");
      setGroupId("");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "submit_failed");
    } finally {
      setSubmitting(false);
    }
  }

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

  const loadingGroups = groups === null && !groupsError;
  const canSubmit = !submitting && riotId.includes("#") && groupId.length > 0;

  return (
    <main className="flex min-h-screen flex-col items-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 px-4 py-12">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-zinc-100">Novo rastreamento</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Adicione um invocador para monitorar e o grupo que recebe alertas.
        </p>
      </div>

      <section className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl shadow-black/30 backdrop-blur">
        <header className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              Configurar alerta
            </h2>
            <p className="text-sm text-zinc-400">
              O Worker checa a cada 15 minutos.
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="riotId"
              className="mb-1.5 block text-sm font-medium text-zinc-300"
            >
              Riot ID do invocador
            </label>
            <input
              id="riotId"
              type="text"
              placeholder="Faker#KR1"
              value={riotId}
              onChange={(e) => setRiotId(e.target.value)}
              disabled={submitting}
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
            />
          </div>

          <div>
            <label
              htmlFor="groupId"
              className="mb-1.5 block text-sm font-medium text-zinc-300"
            >
              Grupo do WhatsApp
            </label>
            <select
              id="groupId"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={submitting || loadingGroups || !!groupsError}
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
            >
              <option value="" className="bg-zinc-900 text-zinc-400">
                {loadingGroups
                  ? "Carregando grupos…"
                  : groupsError
                    ? "Erro ao carregar grupos"
                    : groups && groups.length === 0
                      ? "Nenhum grupo encontrado"
                      : "Selecione um grupo"}
              </option>
              {groups?.map((g) => (
                <option
                  key={g.id}
                  value={g.id}
                  className="bg-zinc-900 text-zinc-100"
                >
                  {g.name}
                </option>
              ))}
            </select>
            {groupsError && (
              <p className="mt-1 text-xs text-red-400">
                {groupsError === "not_connected"
                  ? "WhatsApp não conectado. Vá em /dashboard/whatsapp para parear."
                  : groupsError}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Salvando…" : "Criar assinatura"}
          </button>

          {submitError && (
            <p
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {submitError}
            </p>
          )}

          {success && (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              {success}
            </p>
          )}
        </form>
      </section>

      <nav className="mt-6 text-sm">
        <a
          href="/dashboard/whatsapp"
          className="text-indigo-400 hover:text-indigo-300 hover:underline"
        >
          ← Voltar para WhatsApp
        </a>
      </nav>
    </main>
  );
}
