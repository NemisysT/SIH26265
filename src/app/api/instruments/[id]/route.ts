import { z } from "zod";
import { apiRoute, ok, parseJson } from "@/server/api";
import { instrumentDraftSchema } from "@/lib/validation";
import { getInstrumentDetail, updateInstrumentFields } from "@/server/services/instruments";

export const GET = apiRoute<{ id: string }>(async (_req, { actor, params }) => ok(await getInstrumentDetail(actor, params.id)));

const patchSchema = instrumentDraftSchema.partial().extend({ expectedVersion: z.number().int() });

export const PATCH = apiRoute<{ id: string }>(async (req, { actor, params }) => {
  const { expectedVersion, clientRequestId: _ignored, ...fields } = await parseJson(req, patchSchema);
  return ok(await updateInstrumentFields(actor, params.id, fields, expectedVersion));
});
