import { Bot } from "lucide-react";
import { HeroSearch } from "@/components/layout/HeroSearch";
import { QueryExamples } from "@/components/landing/QueryExamples";
import { CatalogSummary } from "@/components/landing/CatalogSummary";
import { LatestContent } from "@/components/landing/LatestContent";

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="flex flex-col items-center justify-center gap-6 px-4 py-16 sm:py-20">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Bot className="h-8 w-8 text-primary" />
        </div>

        <div className="max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
            FlowDataGouv
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Explorez les 73 000+ datasets et APIs ouvertes francaises.
            <br />
            Recherche intelligente propulsee par{" "}
            <a
              href="https://mistral.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground font-medium"
            >
              Mistral AI
            </a>
            {" "}&middot; Donnees{" "}
            <a
              href="https://www.data.gouv.fr"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground font-medium"
            >
              data.gouv.fr
            </a>
          </p>
        </div>

        <HeroSearch />
        <QueryExamples />
      </section>

      {/* Catalog summary — stats, categories, top datasets, geo */}
      <section className="border-t bg-muted/20 py-12">
        <CatalogSummary />
      </section>

      {/* Latest content */}
      <section className="border-t px-4 py-12">
        <h2 className="mb-8 text-center text-2xl font-bold">
          En ce moment sur data.gouv.fr
        </h2>
        <LatestContent />
      </section>
    </main>
  );
}
