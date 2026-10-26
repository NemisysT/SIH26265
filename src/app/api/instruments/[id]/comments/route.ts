import { apiRoute, ok, parseJson } from "@/server/api";
import { addInstrumentComment, commentSchema } from "@/server/services/verification";

export const POST = apiRoute<{ id: string }>(async (req, { actor, params }) => {
  const input = await parseJson(req, commentSchema);
  return ok(await addInstrumentComment(actor, params.id, input), 201);
});
