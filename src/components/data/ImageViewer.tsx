"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

interface ImageViewerProps {
  resourceId: string;
  resourceTitle: string;
}

export function ImageViewer({ resourceId, resourceTitle }: ImageViewerProps) {
  const [error, setError] = useState(false);
  const src = `/api/datagouv/download?resource_id=${encodeURIComponent(resourceId)}&inline=1`;

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-muted-foreground">
        <ImageOff className="h-8 w-8" />
        <p className="text-sm">Impossible de charger l&apos;image</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/10 p-2 flex justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={resourceTitle}
        className="max-h-96 w-full object-contain rounded"
        onError={() => setError(true)}
      />
    </div>
  );
}
