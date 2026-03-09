"use client";

import { useEffect } from "react";

/**
 * Next.js global error boundary.
 * Catches "Failed to find Server Action" errors caused by stale client cache
 * after a new deployment, and silently reloads the page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const msg = error?.message ?? "";
    // Stale deployment: client JS references server actions that no longer exist
    if (
      msg.includes("Failed to find Server Action") ||
      msg.includes("failed to find server action")
    ) {
      // Reload once — use sessionStorage to avoid infinite loops
      const key = "__fdg_reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
        return;
      }
      sessionStorage.removeItem(key);
    }
  }, [error]);

  return (
    <html lang="fr">
      <body className="min-h-dvh flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-4 p-8">
          <h2 className="text-xl font-semibold text-gray-900">
            Une erreur est survenue
          </h2>
          <p className="text-sm text-gray-600">
            Le site a ete mis a jour. Veuillez recharger la page.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            Recharger la page
          </button>
        </div>
      </body>
    </html>
  );
}
