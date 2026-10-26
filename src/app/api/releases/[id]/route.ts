import { apiRoute, ok } from "@/server/api";
import { getReleaseDetail } from "@/server/services/releases";

export const GET = apiRoute<{ id: string }>(async (_req, { actor, params }) => {
  return ok(await getReleaseDetail(actor, params.id));
});
