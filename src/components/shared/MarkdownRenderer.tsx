"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto rounded-md border">
            <table className="w-full text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-muted/50">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left font-medium">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border-t px-3 py-2">{children}</td>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline hover:text-blue-800"
          >
            {children}
          </a>
        ),
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3">
              <code className="text-sm font-mono" {...props}>
                {children}
              </code>
            </pre>
          );
        },
        ul: ({ children }) => (
          <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>
        ),
        p: ({ children }) => <p className="my-1">{children}</p>,
        h1: ({ children }) => (
          <h1 className="my-2 text-xl font-bold">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="my-2 text-lg font-bold">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="my-1.5 text-base font-semibold">{children}</h3>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-4 border-muted-foreground/30 pl-3 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-border" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
