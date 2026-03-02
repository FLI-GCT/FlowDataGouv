import Link from "next/link";
import { Shield, Github } from "lucide-react";

export function AppFooter() {
  return (
    <footer className="border-t px-4 py-8">
      <div className="mx-auto max-w-7xl flex flex-col gap-6">
        {/* Navigation */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>
            Donnees{" "}
            <a
              href="https://www.data.gouv.fr"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              data.gouv.fr
            </a>
            {" "}&middot; IA{" "}
            <a
              href="https://mistral.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Mistral AI
            </a>
          </p>
          <div className="flex items-center gap-4">
            <Link href="/explore" className="hover:text-foreground hover:underline">
              Explorer
            </Link>
            <Link href="/mcp" className="hover:text-foreground hover:underline">
              MCP
            </Link>
            <a
              href="https://github.com/FLI-GCT/FlowDataGouv"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
              aria-label="GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
          </div>
        </div>

        {/* Mention legale + confidentialite */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-border/50 text-xs text-muted-foreground/70">
          <p>
            Projet personnel de Guillaume CLEMENT &middot; Open Source{" "}
            <a
              href="https://www.apache.org/licenses/LICENSE-2.0"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground/70"
            >
              Licence Apache 2.0
            </a>
          </p>
          <div className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            <span>Aucun cookie &middot; Aucun pistage &middot; Logs anonymises sans IP</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
