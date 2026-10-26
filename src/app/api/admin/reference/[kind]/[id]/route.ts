import { apiRoute, ok, parseJson } from "@/server/api";
import { toggleReference, toggleSchema } from "@/server/services/admin";
import { NotFoundError } from "@/server/errors";

export const PATCH = apiRoute<{ kind: string; id: string }>(async (req, { actor, params }) => {
  if (params.kind !== "region" && params.kind !== "bank") throw new NotFoundError();
  const { isActive } = await parseJson(req, toggleSchema);
  return ok(await toggleReference(actor, params.kind, params.id, isActive));
});
