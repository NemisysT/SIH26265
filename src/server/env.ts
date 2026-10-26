// Centralised environment configuration. Secrets come only from the environment.
import path from "node:path";

function bool(v: string | undefined, fallback = false) {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const env = {
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  /** Enables the demo-account picker on the sign-in page and the demo banner. Never on by default. */
  get demoMode() {
    return bool(process.env.DEMO_MODE, false);
  },
  get appUrl() {
    return process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000";
  },
  /** Additional origins permitted for state-changing requests (comma separated). */
  get allowedOrigins(): string[] {
    const extra = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return [new URL(this.appUrl).origin, ...extra];
  },
  get storageDir() {
    return path.resolve(process.env.STORAGE_DIR ?? "./storage/documents");
  },
  get sessionTtlHours() {
    return Number(process.env.SESSION_TTL_HOURS ?? 8);
  },
  get secureCookies() {
    return bool(process.env.SECURE_COOKIES, this.isProduction);
  },
  get emailMode(): "simulated" | "disabled" {
    return process.env.EMAIL_MODE === "disabled" ? "disabled" : "simulated";
  },
};
