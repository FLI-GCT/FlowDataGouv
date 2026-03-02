"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon } from "lucide-react";
import type { ParsedTabularData } from "@/lib/parsers";
import dynamic from "next/dynamic";

// Dynamic import Recharts to avoid SSR issues
const RechartsBar = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.BarChart })),
  { ssr: false }
);
const RechartsLine = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.LineChart })),
  { ssr: false }
);
const RechartsPie = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.PieChart })),
  { ssr: false }
);
const Bar = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Bar })),
  { ssr: false }
);
const Line = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Line })),
  { ssr: false }
);
const Pie = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Pie })),
  { ssr: false }
);
const Cell = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Cell })),
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
const Legend = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.Legend })),
  { ssr: false }
);
const ResponsiveContainer = dynamic(
  () => import("recharts").then((mod) => ({ default: mod.ResponsiveContainer })),
  { ssr: false }
);

const COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
];

interface DataChartProps {
  data: ParsedTabularData;
}

type ChartType = "bar" | "line" | "pie";

export function DataChart({ data }: DataChartProps) {
  const [chartType, setChartType] = useState<ChartType>("bar");

  // Auto-detect numeric columns and a label column
  const analysis = useMemo(() => {
    const cols = data.columns.filter((c) => c !== "__id");
    const numericCols: string[] = [];
    const textCols: string[] = [];

    for (const col of cols) {
      const values = data.rows.map((r) => r[col]).filter(Boolean);
      const numericCount = values.filter((v) => !isNaN(parseFloat(v))).length;
      if (numericCount > values.length * 0.5 && values.length > 0) {
        numericCols.push(col);
      } else {
        textCols.push(col);
      }
    }

    // Pick best label column (first text column with varied values)
    let labelCol = textCols[0] || cols[0];
    for (const tc of textCols) {
      const uniqueValues = new Set(data.rows.map((r) => r[tc]));
      if (uniqueValues.size > 1 && uniqueValues.size <= data.rows.length) {
        labelCol = tc;
        break;
      }
    }

    // Limit numeric columns to 3 for readability
    const displayNumericCols = numericCols.slice(0, 3);

    return { numericCols: displayNumericCols, textCols, labelCol };
  }, [data]);

  // Prepare chart data
  const chartData = useMemo(() => {
    return data.rows.slice(0, 50).map((row) => {
      const item: Record<string, string | number> = {
        label: row[analysis.labelCol] || "",
      };
      for (const col of analysis.numericCols) {
        item[col] = parseFloat(row[col]) || 0;
      }
      return item;
    });
  }, [data.rows, analysis]);

  // Don't render chart if no numeric data
  if (analysis.numericCols.length === 0 || data.rows.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {/* Chart type selector */}
      <div className="flex items-center gap-1">
        <Button
          variant={chartType === "bar" ? "default" : "ghost"}
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setChartType("bar")}
        >
          <BarChart3 className="h-3 w-3" />
          Barres
        </Button>
        <Button
          variant={chartType === "line" ? "default" : "ghost"}
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setChartType("line")}
        >
          <LineChartIcon className="h-3 w-3" />
          Lignes
        </Button>
        {analysis.numericCols.length === 1 && (
          <Button
            variant={chartType === "pie" ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setChartType("pie")}
          >
            <PieChartIcon className="h-3 w-3" />
            Camembert
          </Button>
        )}
      </div>

      {/* Chart */}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "pie" && analysis.numericCols.length === 1 ? (
            <RechartsPie>
              <Pie
                data={chartData}
                dataKey={analysis.numericCols[0]}
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ((props: any) =>
                    `${props.name ?? ""}: ${((props.percent ?? 0) * 100).toFixed(0)}%`) as any
                }
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </RechartsPie>
          ) : chartType === "line" ? (
            <RechartsLine data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              {analysis.numericCols.map((col, i) => (
                <Line
                  key={col}
                  type="monotone"
                  dataKey={col}
                  stroke={COLORS[i]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              ))}
            </RechartsLine>
          ) : (
            <RechartsBar data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              {analysis.numericCols.map((col, i) => (
                <Bar key={col} dataKey={col} fill={COLORS[i]} />
              ))}
            </RechartsBar>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
