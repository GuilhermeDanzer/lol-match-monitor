"use client";

import { formatDamageAbsolute } from "@/lib/formatDamage";
import type { TeamDamageEntry } from "@/types/team";

interface TeamCompositionProps {
  team: TeamDamageEntry[];
}

export function TeamComposition({ team }: TeamCompositionProps) {
  if (!team.length) return null;

  const maxTeamDamage = Math.max(...team.map((m) => m.damageDealt), 1);

  return (
    <section className="mt-4 border-t border-zinc-800 pt-4">
      <p className="mb-3 text-sm font-medium text-zinc-400">
        Composição do Time
      </p>
      <ul className="space-y-2">
        {team.map((member, index) => {
          const widthPct = (member.damageDealt / maxTeamDamage) * 100;
          const barClass = member.isPlayer ? "bg-red-500" : "bg-zinc-500";
          const nameClass = member.isPlayer ? "text-red-400" : "text-zinc-400";
          return (
            <li
              key={`${member.championName}-${index}`}
              className="flex items-center gap-3"
            >
              <span
                className={`w-20 shrink-0 truncate text-xs font-medium ${nameClass}`}
                title={member.championName}
              >
                {member.championName}
              </span>
              <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <span
                  className={`block h-full rounded-full ${barClass}`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-zinc-500">
                {formatDamageAbsolute(member.damageDealt)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
