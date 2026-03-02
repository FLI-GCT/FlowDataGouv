"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Database,
  Globe,
  Eye,
  Download,
  Calendar,
  Building2,
  MapPin,
} from "lucide-react";

interface ResultCardProps {
  id: string;
  title: string;
  organization: string;
  type: "dataset" | "dataservice";
  summary: string;
  category: string;
  categoryLabel: string;
  geoScope: string;
  geoArea: string;
  tags: string[];
  views: number;
  downloads: number;
  lastModified: string;
  license: string;
  quality: number;
}

const GEO_LABELS: Record<string, string> = {
  national: "National",
  regional: "Regional",
  departemental: "Departemental",
  communal: "Communal",
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.substring(0, 10);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return dateStr.substring(0, 10);
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("fr-FR");
}

export function ResultCard(props: ResultCardProps) {
  const router = useRouter();
  const isApi = props.type === "dataservice";
  const href = isApi ? `/explore/api/${props.id}` : `/explore/dataset/${props.id}`;

  return (
    <div
      className="rounded-lg border bg-card p-4 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group"
      onClick={() => router.push(href)}
    >
      {/* Title + type */}
      <div className="flex items-start gap-2.5">
        {isApi ? (
          <Globe className="h-4.5 w-4.5 text-violet-500 shrink-0 mt-0.5" />
        ) : (
          <Database className="h-4.5 w-4.5 text-blue-500 shrink-0 mt-0.5" />
        )}
        <h3 className="font-medium text-[15px] leading-snug line-clamp-2 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
          {props.title}
        </h3>
      </div>

      {/* Summary */}
      {props.summary && (
        <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed pl-7">
          {props.summary}
        </p>
      )}

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5 mt-2.5 pl-7">
        {props.categoryLabel && (
          <Badge variant="secondary" className="text-xs px-2 py-0.5">
            {props.categoryLabel}
          </Badge>
        )}
        {props.geoScope && (
          <Badge variant="outline" className="text-xs px-2 py-0.5 gap-1">
            <MapPin className="h-3 w-3" />
            {GEO_LABELS[props.geoScope] || props.geoScope}
            {props.geoArea && ` · ${props.geoArea}`}
          </Badge>
        )}
        {isApi && (
          <Badge className="text-xs px-2 py-0.5 bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300">
            API
          </Badge>
        )}
        {props.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="outline" className="text-xs px-2 py-0.5">
            {tag}
          </Badge>
        ))}
      </div>

      {/* Meta line */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 pl-7 text-xs text-muted-foreground">
        {props.organization && (
          <span className="flex items-center gap-1">
            <Building2 className="h-3 w-3" />
            <span className="truncate max-w-[200px]">{props.organization}</span>
          </span>
        )}
        {props.lastModified && (
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(props.lastModified)}
          </span>
        )}
        {props.views > 0 && (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Eye className="h-3 w-3" />
            {formatNumber(props.views)}
          </span>
        )}
        {props.downloads > 0 && (
          <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
            <Download className="h-3 w-3" />
            {formatNumber(props.downloads)}
          </span>
        )}
      </div>
    </div>
  );
}
