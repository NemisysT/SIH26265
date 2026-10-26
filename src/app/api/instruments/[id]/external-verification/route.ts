import { apiRoute, ok } from "@/server/api";
import { runExternalVerification } from "@/server/services/verification";

export const POST = apiRoute<{ id: string }>(async (_req, { actor, params }) => ok(await runExternalVerification(actor, params.id), 201), {
  rateLimit: [20, 60_000],
});
