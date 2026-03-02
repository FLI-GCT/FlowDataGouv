"use client";

import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Eye, Download } from "lucide-react";
import type { ParsedMetrics } from "@/lib/parsers";
import dynamic from "next/dynamic";

const AreaChart = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.AreaChart })),
  { ssr: false }
);
const Area = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Area })),
  { ssr: false }
);
const XAxis = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.XAxis })),
  { ssr: false }
);
const YAxis = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.YAxis })),
  { ssr: false }
);
const CartesianGrid = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.CartesianGrid })),
  { ssr: false }
);
const Tooltip = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Tooltip })),
  { ssr: false }
);
const ResponsiveContainer = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.ResponsiveContainer })),
  { ssr: false }
);

interface MetricsChartProps {
  metrics: ParsedMetrics;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("fr-FR");
}

export function MetricsChart({ metrics }: MetricsChartProps) {
  const data = metrics.months.map((m) => ({
    ...m,
    label: m.month.replace(/^(\d{4})-(\d{2})$/, (_match, y, mo) => {
      const months = [
        "Jan", "Fev", "Mar", "Avr", "Mai", "Jun",
        "Jul", "Aou", "Sep", "Oct", "Nov", "Dec",
      ];
      return `${months[parseInt(mo) - 1]} ${y}`;
    }),
  }));

  // Calculate trend
  const recentVisits = metrics.months.slice(-3).reduce((s, m) => s + m.visits, 0);
  const olderVisits = metrics.months.slice(0, 3).reduce((s, m) => s + m.visits, 0);
  const trend = olderVisits > 0 ? ((recentVisits - olderVisits) / olderVisits) * 100 : 0;
  const trendUp = trend > 0;

  return (
    <div className="space-y-3">
      {/* Stats summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            Visites totales
          </div>
          <p className="mt-1 text-lg font-bold">{formatNumber(metrics.totalVisits)}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Download className="h-3.5 w-3.5" />
            Telechargements
          </div>
          <p className="mt-1 text-lg font-bold">{formatNumber(metrics.totalDownloads)}</p>
        </div>
      </div>

      {/* Trend badge */}
      {metrics.months.length >= 6 && (
        <div className="flex items-center gap-2">
          <Badge
            variant={trendUp ? "default" : "secondary"}
            className={`gap-1 ${trendUp ? "bg-green-600" : ""}`}
          >
            {trendUp ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {trendUp ? "+" : ""}{trend.toFixed(0)}% sur 3 mois
          </Badge>
        </div>
      )}

      {/* Chart */}
      {data.length > 1 && (
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="visitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="dlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={formatNumber} />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={((value: any) => Number(value).toLocaleString("fr-FR")) as any}
              />
              <Area
                type="monotone"
                dataKey="visits"
                name="Visites"
                stroke="#3b82f6"
                fill="url(#visitGrad)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="downloads"
                name="Telechargements"
                stroke="#22c55e"
                fill="url(#dlGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
