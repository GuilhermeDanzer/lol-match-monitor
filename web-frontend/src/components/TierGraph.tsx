"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GraphDataPoint, GraphPeriod } from "@/types/history";

interface TierGraphProps {
  data: GraphDataPoint[];
}

const PERIODS: { id: GraphPeriod; label: string; days: number }[] = [
  { id: "daily", label: "Daily", days: 7 },
  { id: "weekly", label: "Weekly", days: 30 },
  { id: "monthly", label: "Monthly", days: 365 },
];

function filterByPeriod(
  data: GraphDataPoint[],
  period: GraphPeriod,
): GraphDataPoint[] {
  const config = PERIODS.find((p) => p.id === period) ?? PERIODS[0];
  const cutoff = Date.now() - config.days * 24 * 60 * 60 * 1000;
  const filtered = data.filter((p) => p.timestamp >= cutoff);
  return filtered.length > 0 ? filtered : data;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: GraphDataPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-zinc-900/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-xs text-zinc-400">{point.date}</p>
      <p className="text-sm font-bold text-amber-300">{point.label}</p>
      <p className="text-xs text-zinc-500">PDL: {point.pdlNum}</p>
    </div>
  );
}

function buildYAxisTicks(data: GraphDataPoint[]): number[] {
  const unique = [...new Set(data.map((d) => d.pdlNum))].sort((a, b) => a - b);
  if (unique.length <= 6) return unique;

  const min = unique[0]!;
  const max = unique[unique.length - 1]!;
  const steps = 5;
  const step = (max - min) / (steps - 1);
  if (step <= 0) return unique;

  return Array.from({ length: steps }, (_, i) => Math.round(min + step * i));
}

function formatYAxisTick(value: number, labelByPdl: Map<number, string>): string {
  if (labelByPdl.has(value)) return labelByPdl.get(value) ?? "";
  let closest = "";
  let bestDiff = Infinity;
  for (const [pdl, label] of labelByPdl) {
    const diff = Math.abs(pdl - value);
    if (diff < bestDiff && diff <= 25) {
      bestDiff = diff;
      closest = label;
    }
  }
  return closest;
}

function useChartDimensions() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      const w = Math.floor(width);
      const h = Math.floor(height);
      if (w > 0 && h > 0) {
        setSize((prev) =>
          prev.width === w && prev.height === h ? prev : { width: w, height: h },
        );
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { containerRef, ...size };
}

export function TierGraph({ data }: TierGraphProps) {
  const [period, setPeriod] = useState<GraphPeriod>("weekly");
  const { containerRef, width, height: chartHeight } = useChartDimensions();

  const chartData = useMemo(
    () => filterByPeriod(data, period),
    [data, period],
  );

  const labelByPdl = useMemo(() => {
    const map = new Map<number, string>();
    for (const point of chartData) {
      map.set(point.pdlNum, point.label.split(" ")[0] ?? "");
    }
    return map;
  }, [chartData]);

  const yTicks = useMemo(() => buildYAxisTicks(chartData), [chartData]);

  if (chartData.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <p className="text-center text-sm text-zinc-500">
          Sem dados de evolução de elo ainda. Jogue partidas ranqueadas para
          popular o gráfico.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/90 to-zinc-950 p-5 shadow-xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Evolução de Tier</h2>
          <p className="text-xs text-zinc-500">Histórico de PDL ao longo do tempo</p>
        </div>
        <div className="flex rounded-lg border border-zinc-700/80 bg-zinc-950/80 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
                period === p.id
                  ? "bg-amber-500/90 text-zinc-950 shadow-md shadow-amber-500/20"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="h-72 min-w-0 w-full sm:h-80">
        {width > 0 && chartHeight > 0 && (
          <LineChart
            width={width}
            height={chartHeight}
            data={chartData}
            margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#3f3f46"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              stroke="#71717a"
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              axisLine={{ stroke: "#52525b" }}
              tickLine={false}
            />
            <YAxis
              domain={[
                (min: number) => min - 30,
                (max: number) => max + 30,
              ]}
              ticks={yTicks}
              stroke="#71717a"
              tick={{ fill: "#d4d4d8", fontSize: 11 }}
              axisLine={{ stroke: "#52525b" }}
              tickLine={false}
              tickFormatter={(v) => formatYAxisTick(Number(v), labelByPdl)}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="pdlNum"
              connectNulls
              stroke="#f59e0b"
              strokeWidth={2.5}
              dot={{
                r: 4,
                fill: "#fbbf24",
                stroke: "#78350f",
                strokeWidth: 2,
              }}
              activeDot={{
                r: 6,
                fill: "#fcd34d",
                stroke: "#fff",
                strokeWidth: 2,
              }}
            />
          </LineChart>
        )}
      </div>
      {chartData.length === 1 && (
        <p className="mt-3 text-center text-xs text-zinc-500">
          Jogue mais partidas ranqueadas para ver a linha de evolução completa.
        </p>
      )}
    </section>
  );
}
