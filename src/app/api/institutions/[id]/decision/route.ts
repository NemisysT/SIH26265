import { apiRoute, ok, parseJson } from "@/server/api";
import { decideInstitution, institutionDecisionSchema } from "@/server/services/institutions";

export const POST = apiRoute<{ id: string }>(async (req, { actor, params }) => {
  const input = await parseJson(req, institutionDecisionSchema);
  return ok(await decideInstitution(actor, params.id, input));
});
