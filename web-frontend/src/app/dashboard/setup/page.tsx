"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { StepConnect } from "./StepConnect";
import { StepConfigure } from "./StepConfigure";
import { DiagnosticPanel } from "./DiagnosticPanel";

/**
 * Wizard de 2 passos — onboarding do SaaS.
 *   1. Pareamento WhatsApp (QR Code via polling).
 *   2. Configuração de monitoramento (Riot ID + grupo).
 *
 * O `userId` está mockado como `user_123` enquanto não há Auth real.
 * O backend (rota /api/whatsapp/:userId/status) cria o User on-the-fly.
 */

const MOCK_USER_ID = "user_123";

type WizardStep = 1 | 2 | 3;

interface StepHeaderProps {
  current: WizardStep;
}

function StepHeader({ current }: StepHeaderProps) {
  const steps = [
    { id: 1, label: "Conectar WhatsApp" },
    { id: 2, label: "Configurar alerta" },
  ] as const;

  return (
    <ol className="mb-8 flex items-center justify-center gap-4">
      {steps.map((s, idx) => {
        const isDone = current > s.id;
        const isActive = current === s.id;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition ${
                isDone
                  ? "bg-emerald-500 text-zinc-950"
                  : isActive
                    ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/30"
                    : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {isDone ? <Check className="h-4 w-4" /> : s.id}
            </div>
            <span
              className={`text-sm ${
                isActive ? "font-medium text-zinc-100" : "text-zinc-500"
              }`}
            >
              {s.label}
            </span>
            {idx < steps.length - 1 && (
              <div className="ml-2 h-px w-8 bg-zinc-700" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function SetupPage() {
  const [step, setStep] = useState<WizardStep>(1);

  return (
    <main className="flex min-h-screen flex-col items-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-zinc-100">
          Configurar LoL Match Monitor
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Em 2 passos seu bot está pronto.
        </p>
      </div>

      <StepHeader current={step} />

      {step === 1 && (
        <StepConnect userId={MOCK_USER_ID} onConnected={() => setStep(2)} />
      )}

      {step === 2 && (
        <StepConfigure userId={MOCK_USER_ID} onDone={() => setStep(3)} />
      )}

      {step === 3 && (
        <DiagnosticPanel
          userId={MOCK_USER_ID}
          onAddAnother={() => setStep(2)}
          onResetSession={() => setStep(1)}
        />
      )}
    </main>
  );
}
