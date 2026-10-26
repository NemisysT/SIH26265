import { z } from "zod";
import { apiRoute, ok, parseJson } from "@/server/api";
import { instrumentDraftSchema, text } from "@/lib/validation";
import { startRenewal } from "@/server/services/instruments";

const schema = instrumentDraftSchema.extend({
  kind: z.enum(["RENEWAL", "REPLACEMENT"]),
  reason: text(1000).pipe(z.string().min(5, "Explain why the instrument is being renewed or replaced")),
});

export const POST = apiRoute<{ id: string }>(async (req, { actor, params }) => {
  const input = await parseJson(req, schema);
  return ok(await startRenewal(actor, params.id, input), 201);
});
