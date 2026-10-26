import { z } from "zod";
import { apiRoute, ok, parseJson } from "@/server/api";
import { text } from "@/lib/validation";
import { transitionInstrument } from "@/server/services/instruments";

const schema = z.object({
  action: z.enum(["SUBMIT", "WITHDRAW", "START_REVIEW", "REQUEST_CORRECTION", "RESUBMIT", "SEND_FOR_VERIFICATION", "ACCEPT", "REJECT"]),
  expectedVersion: z.number().int().optional(),
  note: text(2000).optional(),
});

export const POST = apiRoute<{ id: string }>(async (req, { actor, params }) => {
  const input = await parseJson(req, schema);
  return ok(await transitionInstrument(actor, params.id, input));
});
