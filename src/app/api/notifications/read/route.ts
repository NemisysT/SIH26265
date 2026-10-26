import { z } from "zod";
import { apiRoute, ok, parseJson } from "@/server/api";
import { markRead } from "@/server/services/activity";

const schema = z.object({ ids: z.union([z.literal("all"), z.array(z.string()).max(200)]) });

export const POST = apiRoute(async (req, { actor }) => {
  const { ids } = await parseJson(req, schema);
  return ok({ updated: await markRead(actor, ids) });
});
