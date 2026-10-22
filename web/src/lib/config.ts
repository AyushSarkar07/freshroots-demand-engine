import "server-only";

const env = (k: string) => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

/** Each integration runs live when its keys are set, and is simulated (and labelled so) when not. */
export function getConfig() {
  return {
    db: env("DATABASE_URL") ? ("postgres" as const) : ("memory" as const),
    ai: env("GEMINI_API_KEY") ? ("gemini" as const) : ("template" as const),
    geminiModel: env("GEMINI_MODEL") ?? "gemini-3.8-flash",
    telegram: env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_CHAT_ID") ? ("live" as const) : ("simulated" as const),
    appUrl: env("APP_URL") ?? (env("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${env("VERCEL_PROJECT_PRODUCTION_URL")}` : "http://localhost:3000"),
    /** Evaluation date used for the bundled case export, so the seeded run is reproducible. */
    caseEvaluationDate: env("CASE_EVALUATION_DATE") ?? "2026-10-22",
  };
}
export type AppConfig = ReturnType<typeof getConfig>;
