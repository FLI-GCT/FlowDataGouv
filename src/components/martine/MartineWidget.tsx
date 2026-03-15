"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MartineWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      router.push(`/martine?q=${encodeURIComponent(input.trim())}`);
      setOpen(false);
      setInput("");
    }
  };

  return (
    <>
      {/* Floating bubble */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary shadow-lg transition-transform hover:scale-110 sm:h-14 sm:w-14"
          title="Demander à Martine"
        >
          <Sparkles className="h-5 w-5 text-primary-foreground sm:h-6 sm:w-6" />
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
          </span>
        </button>
      )}

      {/* Mini overlay */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-80 rounded-2xl border bg-background shadow-2xl sm:w-96">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Martine</span>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="p-4">
            <p className="mb-3 text-sm text-muted-foreground">
              Posez votre question sur les données ouvertes françaises
            </p>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Votre question..."
                autoFocus
                className="flex-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <Button type="submit" size="icon" disabled={!input.trim()} className="shrink-0 rounded-lg">
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
            <button
              onClick={() => { router.push("/martine"); setOpen(false); }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              Ouvrir la conversation complète
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
