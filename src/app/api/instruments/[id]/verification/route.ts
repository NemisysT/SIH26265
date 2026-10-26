import { apiRoute, ok, parseJson } from "@/server/api";
import { recordVerification, recordVerificationSchema } from "@/server/services/verification";

export const POST = apiRoute<{ id: string }>(async (req, { actor, params }) => {
  const input = await parseJson(req, recordVerificationSchema);
  return ok(await recordVerification(actor, params.id, input), 201);
});
