"use client";

import { FileText } from "lucide-react";

interface PdfViewerProps {
  resourceId: string;
}

export function PdfViewer({ resourceId }: PdfViewerProps) {
  const src = `/api/datagouv/download?resource_id=${encodeURIComponent(resourceId)}&inline=1`;

  return (
    <div className="space-y-2">
      <iframe
        src={src}
        className="w-full h-[500px] rounded-md border"
        title="PDF preview"
      />
      <p className="text-xs text-muted-foreground text-center">
        Si le PDF ne s&apos;affiche pas,{" "}
        <a href={src} target="_blank" rel="noopener noreferrer" className="underline">
          ouvrir dans un nouvel onglet
        </a>
      </p>
    </div>
  );
}
