import { Bot } from "lucide-react";
import { HeroSearch } from "@/components/layout/HeroSearch";
import { QueryExamples } from "@/components/landing/QueryExamples";
import { CatalogSummary, type CatalogSummaryData } from "@/components/landing/CatalogSummary";
import { LatestContent, type LatestContentData } from "@/components/landing/LatestContent";
import * as fs from "fs/promises";
import * as path from "path";
import type { Catalog } from "@/lib/sync/catalog";
import {
  getLatestDatasets,
  getLatestDataservices,
} from "@/lib/datagouv/api";

export const revalidate = 600; // ISR: revalidate every 10 min

async function getCatalogSummary(): Promise<CatalogSummaryData | null> {
  try {
    const filePath = path.join(process.cwd(), "data", "catalog.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const catalog: Catalog = JSON.parse(raw);
    return {
      lastSync: catalog.lastSync,
      stats: catalog.stats,
      categories: catalog.categories.map((c) => ({
        slug: c.slug,
        label: c.label,
        totalItems: c.totalItems,
        color: c.color,
        description: c.description,
      })),
      topDatasets: catalog.topDatasets,
      categoryStats: catalog.categoryStats,
      geoRegions: (catalog.geoRegions || []).slice(0, 20),
    };
  } catch {
    return null;
  }
}

async function getLatestContent(): Promise<LatestContentData | null> {
  try {
    const [datasets, dataservices] = await Promise.all([
      getLatestDatasets(6),
      getLatestDataservices(6),
    ]);
    return {
      datasets: datasets?.type === "dataset_list" ? datasets : null,
      dataservices: dataservices?.type === "dataservice_list" ? dataservices : null,
    };
  } catch {
    return null;
  }
}

export default async function Home() {
  const [catalogData, latestData] = await Promise.all([
    getCatalogSummary(),
    getLatestContent(),
  ]);

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
            Explorez les 73 000+ datasets, APIs ouvertes et 29 millions d&apos;entreprises francaises.
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
            {" "}&middot;{" "}
            <a
              href="/statut"
              className="underline hover:text-foreground font-medium"
            >
              Serveur MCP
            </a>
          </p>
        </div>

        <HeroSearch />
        <QueryExamples />
      </section>

      {/* Catalog summary — stats, categories, top datasets, geo */}
      <section className="border-t bg-muted/20 py-12">
        <CatalogSummary initialData={catalogData} />
      </section>

      {/* Latest content */}
      <section className="border-t px-4 py-12">
        <h2 className="mb-8 text-center text-2xl font-bold">
          En ce moment sur data.gouv.fr
        </h2>
        <LatestContent initialData={latestData} />
      </section>
    </main>
  );
}
