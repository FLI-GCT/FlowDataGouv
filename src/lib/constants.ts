export const RATE_LIMIT_MAX = parseInt(
  process.env.RATE_LIMIT_MAX || "500",
  10
);

export const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export const MISTRAL_MODEL =
  process.env.MISTRAL_MODEL || "mistral-small-latest";

/** Max preview file size in MB (env PREVIEW_MAX_MB, default 50). */
export const PREVIEW_MAX_MB = parseInt(
  process.env.PREVIEW_MAX_MB || process.env.NEXT_PUBLIC_PREVIEW_MAX_MB || "50",
  10
);

/** Max file size in bytes for resource preview (JSON, XML, ZIP, images, PDF). */
export const PREVIEW_MAX_BYTES = PREVIEW_MAX_MB * 1024 * 1024;

export const SITE_NAME = "FlowDataGouv";
export const SITE_DESCRIPTION =
  "Explorez les donnees ouvertes francaises avec l'IA";
