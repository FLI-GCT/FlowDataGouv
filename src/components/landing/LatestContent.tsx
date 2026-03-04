"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Database,
  Globe,
  Building2,
  Clock,
  Calendar,
  ArrowRight,
} from "lucide-react";
import type { ParsedDatasetList, ParsedDataserviceList } from "@/lib/parsers";

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.substring(0, 10);
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr.substring(0, 10);
  }
}

export interface LatestContentData {
  datasets: ParsedDatasetList | null;
  dataservices: ParsedDataserviceList | null;
}

export function LatestContent({ initialData }: { initialData?: LatestContentData | null }) {
  const [datasets, setDatasets] = useState<ParsedDatasetList | null>(initialData?.datasets ?? null);
  const [dataservices, setDataservices] =
    useState<ParsedDataserviceList | null>(initialData?.dataservices ?? null);
  const [loadingDs, setLoadingDs] = useState(!initialData?.datasets);
  const [loadingApi, setLoadingApi] = useState(!initialData?.dataservices);

  useEffect(() => {
    if (initialData) return; // skip fetch when server-provided
    fetch("/api/datagouv/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "get_latest_datasets", args: { page_size: 6 } }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.result?.type === "dataset_list") setDatasets(json.result);
      })
      .catch(() => {})
      .finally(() => setLoadingDs(false));

    fetch("/api/datagouv/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "get_latest_dataservices",
        args: { page_size: 6 },
      }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.result?.type === "dataservice_list")
          setDataservices(json.result);
      })
      .catch(() => {})
      .finally(() => setLoadingApi(false));
  }, [initialData]);

  return (
    <div className="mx-auto max-w-6xl grid gap-8 md:grid-cols-2">
      {/* Latest datasets */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Database className="h-5 w-5 text-blue-600" />
          <h3 className="font-semibold text-lg">Derniers datasets mis a jour</h3>
        </div>

        {loadingDs && (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!loadingDs && datasets?.datasets && (
          <div className="space-y-2">
            {datasets.datasets.map((ds) => (
              <Link
                key={ds.id}
                href={`/explore/dataset/${ds.id}`}
                className="block rounded-lg border bg-card p-3 transition-all hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800"
              >
                <h4 className="font-medium text-sm leading-snug line-clamp-1 text-blue-700 dark:text-blue-400">
                  {ds.title}
                </h4>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                  {ds.organization && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      <span className="line-clamp-1">{ds.organization}</span>
                    </span>
                  )}
                  {ds.lastModified && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(ds.lastModified)}
                    </span>
                  )}
                </div>
                {ds.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {ds.tags.slice(0, 3).map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </Link>
            ))}
            <Link
              href="/explore"
              className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline pt-1"
            >
              Explorer tous les datasets <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>

      {/* Latest dataservices */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Globe className="h-5 w-5 text-violet-600" />
          <h3 className="font-semibold text-lg">APIs recemment ajoutees</h3>
        </div>

        {loadingApi && (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!loadingApi && dataservices?.dataservices && (
          <div className="space-y-2">
            {dataservices.dataservices.map((api) => (
              <Link
                key={api.id}
                href={`/explore/api/${api.id}`}
                className="block rounded-lg border bg-card p-3 transition-all hover:shadow-md hover:border-violet-200 dark:hover:border-violet-800"
              >
                <h4 className="font-medium text-sm leading-snug line-clamp-1 text-violet-700 dark:text-violet-400">
                  {api.title}
                </h4>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                  {api.organization && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      <span className="line-clamp-1">{api.organization}</span>
                    </span>
                  )}
                  {api.createdAt && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(api.createdAt)}
                    </span>
                  )}
                </div>
                {api.baseApiUrl && (
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded mt-1.5 block truncate">
                    {api.baseApiUrl}
                  </code>
                )}
              </Link>
            ))}
            <Link
              href="/explore"
              className="flex items-center gap-1 text-sm font-medium text-violet-600 hover:underline pt-1"
            >
              Explorer toutes les APIs <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
