"use client";

import { useEffect } from "react";
import { useMcpCall } from "@/hooks/useMcpCall";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { OpenApiViewer } from "@/components/data/OpenApiViewer";
import { ApiExplorer } from "@/components/data/ApiExplorer";
import {
  Building2,
  ExternalLink,
  Calendar,
  Tag,
  FileCode2,
} from "lucide-react";
import type { ParsedDataservice, ParsedOpenApiSpec } from "@/lib/parsers";

interface DataserviceDetailProps {
  dataserviceId: string;
}

export function DataserviceDetail({ dataserviceId }: DataserviceDetailProps) {
  const infoCall = useMcpCall<ParsedDataservice>();
  const specCall = useMcpCall<ParsedOpenApiSpec>();

  useEffect(() => {
    infoCall.call("get_dataservice_info", { dataservice_id: dataserviceId });
    specCall.call("get_dataservice_openapi_spec", { dataservice_id: dataserviceId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataserviceId]);

  const info = infoCall.data;
  const spec = specCall.data;

  if (infoCall.isLoading && !info) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (infoCall.error) {
    return (
      <div className="p-6">
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
          {infoCall.error}
        </div>
      </div>
    );
  }

  if (!info || info.type !== "dataservice") return null;

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{info.title}</h1>
        <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
          {info.organization && (
            <span className="flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" />
              {info.organization}
            </span>
          )}
          {info.createdAt && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {info.createdAt}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {info.description && (
        <Card className="p-4">
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {info.description}
          </p>
        </Card>
      )}

      {/* Tags */}
      {info.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          {info.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {info.url && (
          <a href={info.url} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <ExternalLink className="h-3.5 w-3.5" />
              Voir sur data.gouv.fr
            </Button>
          </a>
        )}
        {info.openapiSpecUrl && (
          <a href={info.openapiSpecUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <FileCode2 className="h-3.5 w-3.5" />
              Spec OpenAPI brute
            </Button>
          </a>
        )}
      </div>

      {/* OpenAPI Spec — shown only when endpoints exist */}
      {specCall.isLoading && !spec && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <FileCode2 className="h-5 w-5" />
            Specification OpenAPI
          </h2>
          <Skeleton className="h-60 w-full" />
        </div>
      )}

      {spec?.type === "openapi_spec" && spec.endpoints.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <FileCode2 className="h-5 w-5" />
            Specification OpenAPI
          </h2>
          <OpenApiViewer spec={spec} />
        </div>
      )}

      {/* API Explorer — always shown when we have a base URL */}
      {info.baseApiUrl && (
        <ApiExplorer
          baseUrl={info.baseApiUrl}
          title={info.title}
          endpoints={spec?.type === "openapi_spec" ? spec.endpoints : undefined}
        />
      )}
    </div>
  );
}
