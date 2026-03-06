"use client";

import { Badge } from "@/components/ui/badge";
import { FileText, Folder } from "lucide-react";

interface ZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
}

interface ZipViewerProps {
  entries: ZipEntry[];
  totalFiles: number;
  totalSize: number;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function ZipViewer({ entries, totalFiles, totalSize }: ZipViewerProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">
          {totalFiles} fichier{totalFiles > 1 ? "s" : ""}
        </Badge>
        <Badge variant="outline">
          {formatSize(totalSize)} (decompresse)
        </Badge>
      </div>
      <div className="rounded-md border max-h-[400px] overflow-auto">
        <div className="divide-y">
          {entries.map((entry) => (
            <div
              key={entry.name}
              className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/30"
            >
              {entry.isDirectory ? (
                <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              ) : (
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="font-mono truncate flex-1">{entry.name}</span>
              {!entry.isDirectory && (
                <span className="text-muted-foreground shrink-0">{formatSize(entry.size)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
