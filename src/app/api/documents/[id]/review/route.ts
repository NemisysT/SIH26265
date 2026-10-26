import { z } from "zod";
import { apiRoute, ok, parseJson } from "@/server/api";
import { text } from "@/lib/validation";
import { reviewDocument } from "@/server/services/documents";

const schema = z.object({ status: z.enum(["ACCEPTED", "REJECTED"]), note: text(1000).optional() });

export const POST = apiRoute<{ id: string }>(async (req, { actor, params }) => {
  const input = await parseJson(req, schema);
  const { storageKey: _hidden, ...safe } = await reviewDocument(actor, params.id, input);
  return ok(safe);
});
