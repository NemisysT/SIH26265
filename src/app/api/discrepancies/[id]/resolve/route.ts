import { apiRoute, ok, parseJson } from "@/server/api";
import { resolveDiscrepancy, resolveDiscrepancySchema } from "@/server/services/verification";

export const POST = apiRoute<{ id: string }>(async (req, { actor, params }) => {
  const input = await parseJson(req, resolveDiscrepancySchema);
  return ok(await resolveDiscrepancy(actor, params.id, input));
});
