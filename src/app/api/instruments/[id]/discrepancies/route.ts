import { apiRoute, ok, parseJson } from "@/server/api";
import { raiseDiscrepancy, raiseDiscrepancySchema } from "@/server/services/verification";

export const POST = apiRoute<{ id: string }>(async (req, { actor, params }) => {
  const input = await parseJson(req, raiseDiscrepancySchema);
  return ok(await raiseDiscrepancy(actor, params.id, input), 201);
});
