import { apiRoute, ok } from "@/server/api";
import { requirePermission } from "@/server/auth/scope";
import { runMonitor } from "@/server/jobs/monitor";

/** Administrator "run now" for the maturity / escalation monitor (development & demonstrations). */
export const POST = apiRoute(
  async (_req, { actor }) => {
    requirePermission(actor, "admin:jobs");
    return ok(await runMonitor({ trigger: "MANUAL", triggeredById: actor.id }));
  },
  { rateLimit: [6, 60_000] },
);
