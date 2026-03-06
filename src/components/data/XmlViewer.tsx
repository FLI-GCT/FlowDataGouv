"use client";

import { useState, useCallback, useMemo } from "react";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import xml from "react-syntax-highlighter/dist/esm/languages/hljs/xml";
import docco from "react-syntax-highlighter/dist/esm/styles/hljs/docco";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

SyntaxHighlighter.registerLanguage("xml", xml);

interface XmlViewerProps {
  content: string;
}

export function XmlViewer({ content }: XmlViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  const truncated = useMemo(
    () => content.length > 50_000 ? content.slice(0, 50_000) + "\n\n... (tronque)" : content,
    [content],
  );

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleCopy}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copie !" : "Copier XML"}
        </Button>
      </div>
      <div className="rounded-md border max-h-[500px] overflow-auto">
        <SyntaxHighlighter
          language="xml"
          style={docco}
          customStyle={{ margin: 0, padding: "0.75rem", fontSize: "0.75rem", background: "transparent" }}
          wrapLongLines
        >
          {truncated}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
