import { z } from "zod";
import { apiRoute, ok, parseJson } from "@/server/api";
import { text } from "@/lib/validation";
import { transitionRelease } from "@/server/services/releases";

const schema = z.object({
  action: z.enum(["START_SCRUTINY", "REQUEST_INFO", "PROVIDE_INFO", "FORWARD", "APPROVE", "REJECT", "COMPLETE", "WITHDRAW"]),
  note: text(2000).optional(),
  expectedVersion: z.number().int().optional(),
  completionReference: text(120).optional(),
});

export const POST = apiRoute<{ id: string }>(async (req, { actor, params }) => {
  const input = await parseJson(req, schema);
  return ok(await transitionRelease(actor, params.id, input));
});
