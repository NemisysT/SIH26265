import { apiRoute, ok, parseJson } from "@/server/api";
import { updateUser, updateUserSchema } from "@/server/services/admin";

export const PATCH = apiRoute<{ id: string }>(async (req, { actor, params }) => {
  const input = await parseJson(req, updateUserSchema);
  return ok(await updateUser(actor, params.id, input));
});
