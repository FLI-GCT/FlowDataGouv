"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { DatasetDetail } from "@/components/explore/DatasetDetail";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function DatasetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  return (
    <main className="flex-1">
      <div className="border-b">
        <div className="mx-auto max-w-5xl px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Retour aux resultats
          </Button>
        </div>
      </div>
      <DatasetDetail datasetId={id} />
    </main>
  );
}
