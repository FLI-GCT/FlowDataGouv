export const RATE_LIMIT_MAX = parseInt(
  process.env.RATE_LIMIT_MAX || "500",
  10
);

export const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export const MISTRAL_MODEL =
  process.env.MISTRAL_MODEL || "mistral-small-latest";

export const SITE_NAME = "FlowDataGouv";
export const SITE_DESCRIPTION =
  "Explorez les donnees ouvertes francaises avec l'IA";
